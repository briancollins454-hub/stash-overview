/**
 * Cloud Health (Sync Audit)
 * -------------------------
 * Admin-only dashboard that surfaces the state of Supabase cloud
 * synchronisation without anyone having to crack open the database.
 *
 * Three sections:
 *   1. Alert banner — shown only when something is actually wrong
 *      (a table hasn't successfully saved in >10 min, or the integrity
 *      check found missing rows).
 *   2. Per-table health grid — for each table we track, show local row
 *      count, cloud row count, delta, last successful save, and a status
 *      dot. Auto-refreshes every 30s; manual refresh available.
 *   3. Integrity check — on-demand. Picks 100 random local IDs per table
 *      and verifies they exist in the cloud via a PostgREST in.() query.
 *
 * The recent saves table at the bottom shows the last N events emitted
 * by syncAuditService (max 200, newest first).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react';

import { getItem as getLocalItem } from '../services/localStore';
import { supabaseCount, supabaseExistsBatch, isSupabaseReady } from '../services/supabase';
import {
  AuditEvent,
  clearAuditEvents,
  getAuditEvents,
  subscribeAuditEvents,
} from '../services/syncAuditService';

interface Props {
  /** Counts passed from App state so we don't reload huge blobs from IDB. */
  localCounts?: Partial<Record<string, number>>;
}

interface TableDef {
  /** Supabase table name (also used as key everywhere). */
  table: string;
  /** Display label in the UI. */
  label: string;
  /** IndexedDB key where we persist the local copy (if any). */
  localKey?: string;
  /**
   * If the IDB blob is a Record<string, string> (e.g. mappings), we count
   * entries via Object.keys(); otherwise we treat it as an array.
   */
  isRecord?: boolean;
  /**
   * PostgREST column used for the integrity-check in.() filter. If missing
   * the table is skipped during the integrity check.
   */
  idColumn?: string;
  /** How to extract the same id from a local record for the integrity check. */
  localId?: (row: any) => string | null;
  /**
   * Optional predicate. If provided, the Cloud Health integrity check and
   * the local-vs-cloud count comparison only consider rows passing this
   * filter. Use this when the cloud intentionally stores a subset of the
   * local data (e.g. stash_orders only keeps active orders — fulfilled /
   * restocked are deleted from the cloud to keep it lean).
   */
  cloudScope?: (row: any) => boolean;
  /** Short note shown on the card explaining a reduced cloud scope. */
  cloudScopeNote?: string;
}

const TABLES: TableDef[] = [
  {
    table: 'stash_orders',
    label: 'Shopify Orders',
    localKey: 'stash_raw_shopify_orders',
    idColumn: 'order_id',
    localId: (r: any) => (r?.id ? String(r.id) : null),
    // Cloud only keeps active orders — fulfilled/restocked are intentionally
    // deleted from Supabase by saveCloudOrders() to keep the table lean.
    // Compare like-for-like by filtering the local side the same way.
    cloudScope: (o: any) => {
      const s = o?.fulfillmentStatus;
      return s !== 'fulfilled' && s !== 'restocked';
    },
    cloudScopeNote: 'Cloud intentionally excludes fulfilled & restocked orders',
  },
  {
    table: 'stash_deco_jobs',
    label: 'Deco Jobs',
    localKey: 'stash_raw_deco_jobs',
    idColumn: 'job_number',
    localId: (r: any) => (r?.jobNumber ? String(r.jobNumber) : null),
  },
  {
    table: 'stash_mappings',
    label: 'Item Mappings',
    localKey: 'stash_confirmed_matches',
    isRecord: true,
    idColumn: 'item_id',
    localId: (entry: any) => (entry?.key ? String(entry.key) : null),
  },
  {
    table: 'stash_product_patterns',
    label: 'Product Patterns',
    localKey: 'stash_product_mappings',
    isRecord: true,
    idColumn: 'shopify_pattern',
    localId: (entry: any) => (entry?.key ? String(entry.key) : null),
  },
  {
    table: 'stash_job_links',
    label: 'Item-Job Links',
    localKey: 'stash_item_job_links',
    isRecord: true,
    idColumn: 'order_id',
    localId: (entry: any) => (entry?.key ? String(entry.key) : null),
  },
  { table: 'stash_stock', label: 'Physical Stock' },
  { table: 'stash_returns', label: 'Return Stock' },
  { table: 'stash_reference_products', label: 'Reference Products' },
  { table: 'stash_settings', label: 'Settings' },
];

const STALE_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_INTERVAL_MS = 30_000;

type TableStat = {
  local: number | null;
  cloud: number | null;
  loading: boolean;
  lastSuccessTs: number | null;
  lastSuccessEvent: AuditEvent | null;
};

const prettyRelative = (iso?: string | null): string => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const formatNum = (n: number | null): string => {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
};

const CloudHealth: React.FC<Props> = ({ localCounts }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [stats, setStats] = useState<Record<string, TableStat>>(() => {
    const init: Record<string, TableStat> = {};
    TABLES.forEach(t => {
      init[t.table] = { local: null, cloud: null, loading: false, lastSuccessTs: null, lastSuccessEvent: null };
    });
    return init;
  });
  const [integrityResult, setIntegrityResult] = useState<Record<string, { checked: number; missing: number; sample: string[] }>>({});
  const [integrityRunning, setIntegrityRunning] = useState(false);
  const [integrityRanAt, setIntegrityRanAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now()); // re-render "X ago" every 15s
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /* ---------- Events ---------- */
  useEffect(() => {
    let active = true;
    getAuditEvents().then(e => { if (active) setEvents(e); });
    const unsub = subscribeAuditEvents(() => {
      getAuditEvents().then(e => { if (active) setEvents(e); });
    });
    return () => { active = false; unsub(); };
  }, []);

  /* ---------- Live "X ago" labels ---------- */
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  /* ---------- Stats refresh ---------- */
  const refreshStats = useCallback(async () => {
    if (!isSupabaseReady()) return;
    setRefreshing(true);

    // Merge latest-success timestamps from audit log.
    const lastSuccessByTable: Record<string, AuditEvent> = {};
    for (const e of events) {
      if (e.status === 'success' && !lastSuccessByTable[e.table]) {
        lastSuccessByTable[e.table] = e;
      }
    }

    // Kick off local + cloud in parallel per table.
    await Promise.all(TABLES.map(async (def) => {
      setStats(prev => ({ ...prev, [def.table]: { ...prev[def.table], loading: true } }));

      // Local count: if the cloud only stores a filtered subset of the local
      // data, we always load the blob and apply the filter so the local vs
      // cloud comparison is apples-to-apples. Otherwise we prefer the fast
      // prop count and fall back to the IDB blob length.
      let local: number | null = null;
      if (def.cloudScope && def.localKey) {
        try {
          const blob = await getLocalItem<any>(def.localKey);
          if (Array.isArray(blob)) local = blob.filter(def.cloudScope).length;
          else if (blob && typeof blob === 'object') local = Object.values(blob).filter(def.cloudScope).length;
          else local = 0;
        } catch {
          local = null;
        }
      } else if (localCounts && localCounts[def.table] !== undefined) {
        local = localCounts[def.table] ?? null;
      } else if (def.localKey) {
        try {
          const blob = await getLocalItem<any>(def.localKey);
          if (Array.isArray(blob)) local = blob.length;
          else if (blob && typeof blob === 'object') local = Object.keys(blob).length;
          else local = 0;
        } catch {
          local = null;
        }
      }

      const cloud = await supabaseCount(def.table);
      const lastEvt = lastSuccessByTable[def.table] || null;

      if (!mountedRef.current) return;
      setStats(prev => ({
        ...prev,
        [def.table]: {
          local,
          cloud,
          loading: false,
          lastSuccessTs: lastEvt ? new Date(lastEvt.timestamp).getTime() : prev[def.table].lastSuccessTs,
          lastSuccessEvent: lastEvt || prev[def.table].lastSuccessEvent,
        },
      }));
    }));

    if (mountedRef.current) setRefreshing(false);
  }, [events, localCounts]);

  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshStats]);

  /* ---------- Integrity check ---------- */
  const runIntegrityCheck = useCallback(async () => {
    if (integrityRunning || !isSupabaseReady()) return;
    setIntegrityRunning(true);
    const results: Record<string, { checked: number; missing: number; sample: string[] }> = {};

    const checkable = TABLES.filter(t => t.localKey && t.idColumn);
    for (const def of checkable) {
      try {
        const blob = await getLocalItem<any>(def.localKey!);
        let ids: string[] = [];
        if (Array.isArray(blob)) {
          const source = def.cloudScope ? blob.filter(def.cloudScope) : blob;
          ids = source
            .map(r => (r && r.id ? String(r.id) : (def.table === 'stash_deco_jobs' && r?.jobNumber ? String(r.jobNumber) : null)))
            .filter((x): x is string => !!x);
        } else if (blob && typeof blob === 'object' && def.isRecord) {
          ids = Object.keys(blob);
        }
        if (ids.length === 0) {
          results[def.table] = { checked: 0, missing: 0, sample: [] };
          continue;
        }
        // Fisher–Yates partial shuffle — pick up to 100 random ids.
        const sampleSize = Math.min(100, ids.length);
        const picked: string[] = [];
        const pool = ids.slice();
        for (let i = 0; i < sampleSize; i++) {
          const j = Math.floor(Math.random() * pool.length);
          picked.push(pool[j]);
          pool.splice(j, 1);
        }
        const found = await supabaseExistsBatch(def.table, def.idColumn!, picked);
        // Use a Set to dedupe — `picked` is unique by construction but clamp
        // defensively so the display can never show a nonsense ratio like 101/100.
        const missingSet = new Set<string>();
        picked.forEach(p => { if (!found.has(p)) missingSet.add(p); });
        const missingCount = Math.min(missingSet.size, picked.length);
        results[def.table] = { checked: picked.length, missing: missingCount, sample: Array.from(missingSet).slice(0, 5) };
      } catch (e: any) {
        results[def.table] = { checked: 0, missing: -1, sample: [String(e?.message || e).slice(0, 120)] };
      }
    }

    if (mountedRef.current) {
      setIntegrityResult(results);
      setIntegrityRanAt(Date.now());
      setIntegrityRunning(false);
    }
  }, [integrityRunning]);

  /* ---------- Derived alerts ---------- */
  const alerts = useMemo(() => {
    const list: string[] = [];
    const now = Date.now();
    for (const def of TABLES) {
      const stat = stats[def.table];
      if (!stat) continue;
      // A local row count of 0 means nothing's ever been saved — skip.
      if (stat.local === 0 || stat.local === null) continue;
      if (stat.lastSuccessTs && now - stat.lastSuccessTs > STALE_MS) {
        list.push(`${def.label} — last successful save ${prettyRelative(new Date(stat.lastSuccessTs).toISOString())}`);
      }
    }
    const missingEntries = Object.entries(integrityResult).filter(([, r]) => r.missing > 0);
    missingEntries.forEach(([table, r]) => {
      const def = TABLES.find(t => t.table === table);
      list.push(`${def?.label || table} — integrity check: ${r.missing} / ${r.checked} sampled rows missing from cloud`);
    });
    return list;
  }, [stats, integrityResult, nowTick]);

  /* ---------- Rendering helpers ---------- */
  const statusDot = (stat: TableStat) => {
    if (stat.loading) return <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />;
    if (stat.cloud === null) return <CloudOff className="w-3 h-3 text-slate-400" />;
    if (stat.local !== null && stat.cloud !== null) {
      const delta = Math.abs(stat.local - stat.cloud);
      if (delta === 0) return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
      // Tolerate ≤5% drift (retries, fulfilled-order sweeps, etc.)
      const larger = Math.max(stat.local, stat.cloud, 1);
      if (delta / larger <= 0.05) return <CheckCircle2 className="w-3 h-3 text-amber-400" />;
      return <AlertTriangle className="w-3 h-3 text-rose-400" />;
    }
    return <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />;
  };

  const deltaLabel = (stat: TableStat) => {
    if (stat.local === null || stat.cloud === null) return '—';
    const d = stat.local - stat.cloud;
    if (d === 0) return '0';
    return d > 0 ? `+${d.toLocaleString()}` : d.toLocaleString();
  };

  const saving = events.filter(e => e.status === 'error').slice(0, 5);

  const totalSuccess = events.filter(e => e.status === 'success').length;
  const totalError = events.filter(e => e.status === 'error').length;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-indigo-400" />
          <h2 className="text-xl font-bold text-white">Cloud Health</h2>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            Admin
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshStats}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#232354] text-indigo-200 hover:text-white rounded text-xs font-bold uppercase tracking-wider border border-indigo-500/20 hover:border-indigo-500/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Now
          </button>
          <button
            onClick={runIntegrityCheck}
            disabled={integrityRunning}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {integrityRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            Run Integrity Check
          </button>
        </div>
      </div>

      {/* Alert banner */}
      {alerts.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <div className="text-rose-200 font-bold text-sm">Attention — {alerts.length} issue{alerts.length === 1 ? '' : 's'} detected</div>
          </div>
          <ul className="text-rose-200/90 text-xs space-y-1 list-disc pl-5">
            {alerts.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {!isSupabaseReady() && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-200 text-sm">
          Supabase is not yet initialised. Cloud counts will populate once the app has loaded credentials from settings.
        </div>
      )}

      {/* Per-table health grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-300">Per-Table Health</h3>
          <span className="text-[10px] text-indigo-400/70">Auto-refresh every 30s</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TABLES.map(def => {
            const stat = stats[def.table];
            return (
              <div
                key={def.table}
                className="bg-[#1a1a3a] border border-indigo-500/20 rounded-lg p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {statusDot(stat)}
                    <div className="text-white font-bold text-sm">{def.label}</div>
                  </div>
                  <div className="text-[9px] font-mono text-indigo-400/70">{def.table}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-indigo-400/70">Local</div>
                    <div className="text-base font-bold text-white font-mono">{formatNum(stat.local)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-indigo-400/70">Cloud</div>
                    <div className="text-base font-bold text-white font-mono">{formatNum(stat.cloud)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-indigo-400/70">Delta</div>
                    <div className={`text-base font-bold font-mono ${
                      stat.local !== null && stat.cloud !== null && stat.local === stat.cloud
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                    }`}>{deltaLabel(stat)}</div>
                  </div>
                </div>
                <div className="pt-2 border-t border-indigo-500/10 text-[10px] text-indigo-200/70 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  Last push: {stat.lastSuccessEvent ? (
                    <>
                      <span className="text-white">{prettyRelative(stat.lastSuccessEvent.timestamp)}</span>
                      <span className="text-indigo-400/50">·</span>
                      <span>{stat.lastSuccessEvent.recordCount.toLocaleString()} rec</span>
                    </>
                  ) : (
                    <span className="text-indigo-400/50">no recent saves logged</span>
                  )}
                </div>
                {def.cloudScopeNote && (
                  <div className="text-[10px] text-indigo-400/70 italic pt-0.5" title={def.cloudScopeNote}>
                    ⓘ {def.cloudScopeNote}
                  </div>
                )}
                {integrityResult[def.table] && integrityResult[def.table].checked > 0 && (
                  <div className="text-[10px] text-indigo-200/70 flex items-center gap-1.5 pt-1">
                    {integrityResult[def.table].missing === 0 ? (
                      <><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Integrity: all {integrityResult[def.table].checked} sampled rows exist in cloud</>
                    ) : (
                      <><AlertTriangle className="w-3 h-3 text-rose-400" /> Integrity: {integrityResult[def.table].missing}/{integrityResult[def.table].checked} missing</>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Integrity check summary */}
      {integrityRanAt && (
        <div className="text-[11px] text-indigo-300/70 italic">
          Integrity check last ran {prettyRelative(new Date(integrityRanAt).toISOString())}.
        </div>
      )}

      {/* Recent saves */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-300">
            Recent Saves
            <span className="ml-2 text-[10px] text-indigo-400/70 font-normal normal-case">
              (last {events.length} · {totalSuccess} ok, {totalError} errors)
            </span>
          </h3>
          <button
            onClick={() => { if (window.confirm('Clear the audit log? This does not affect cloud data.')) clearAuditEvents(); }}
            className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-indigo-300 hover:text-rose-300 hover:bg-rose-500/10 rounded transition-colors uppercase tracking-wider font-bold"
            title="Clear local audit log"
          >
            <Trash2 className="w-3 h-3" /> Clear Log
          </button>
        </div>
        <div className="bg-[#1a1a3a] border border-indigo-500/20 rounded-lg overflow-hidden">
          {events.length === 0 ? (
            <div className="p-6 text-center text-indigo-300/70 text-sm">
              No save events recorded yet. Events appear here the moment any cloud write happens.
            </div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#12122a] text-indigo-300 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2 font-bold">When</th>
                    <th className="text-left px-3 py-2 font-bold">Table</th>
                    <th className="text-left px-3 py-2 font-bold">Op</th>
                    <th className="text-right px-3 py-2 font-bold">Records</th>
                    <th className="text-right px-3 py-2 font-bold">Ms</th>
                    <th className="text-left px-3 py-2 font-bold">Status</th>
                    <th className="text-left px-3 py-2 font-bold">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id} className="border-t border-indigo-500/10 hover:bg-indigo-500/5">
                      <td className="px-3 py-2 text-indigo-200/80 whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleTimeString()}
                        <span className="text-indigo-400/50 ml-1">({prettyRelative(e.timestamp)})</span>
                      </td>
                      <td className="px-3 py-2 text-white font-mono text-[11px]">{e.table}</td>
                      <td className="px-3 py-2 text-indigo-200/80 uppercase text-[10px]">{e.operation}</td>
                      <td className="px-3 py-2 text-right text-white font-mono">{e.recordCount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-indigo-400/70 font-mono">{e.durationMs ?? '—'}</td>
                      <td className="px-3 py-2">
                        {e.status === 'success' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-300">
                            <XCircle className="w-3 h-3" /> FAIL
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-rose-300/90 text-[11px] max-w-xs truncate" title={e.error || ''}>
                        {e.error || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {saving.length > 0 && (
          <div className="mt-3 text-[11px] text-rose-300/80">
            Last {saving.length} error{saving.length === 1 ? '' : 's'} shown above. Check Supabase RLS / table definitions if this is recurring.
          </div>
        )}
      </div>
    </div>
  );
};

export default CloudHealth;
