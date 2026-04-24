import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CircleDollarSign, Search, ArrowUpDown, AlertTriangle, ExternalLink, Download,
  RefreshCw, Check, Copy, ShieldAlert, ChevronDown, ChevronRight, ShieldCheck, Undo2,
  Printer, UserRound,
} from 'lucide-react';
import { DecoJob } from '../types';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  onNavigateToOrder?: (orderNumber: string) => void;
  currentUserEmail?: string;
}

type SortKey = 'jobNumber' | 'customerName' | 'outstandingBalance' | 'dateShipped' | 'dateOrdered' | 'daysSince' | 'status' | 'salesPerson';

// Sentinel used in the responsible-person dropdown to represent jobs that
// have no salesperson attached in Deco. Kept as a non-printable character
// so it can never clash with a real name.
const UNASSIGNED = '\u0000__UNASSIGNED__';
type SortDir = 'asc' | 'desc';
type SectionKey = 'zero' | 'priced' | 'authorised';

interface Row extends DecoJob {
  daysSince: number;
  isZeroPriced: boolean;
  hasShipped: boolean;
  authorisedAt?: string;
  authorisedBy?: string;
}

interface AuthorisedRow {
  job_number: string;
  authorised_at: string;
  authorised_by: string | null;
}

// ─── Click-to-copy job number ─────────────────────────────────────────────
const CopyableJobNum: React.FC<{ jobNumber: string; onNavigate?: () => void }> = ({ jobNumber, onNavigate }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jobNumber);
      } else {
        const ta = document.createElement('textarea');
        ta.value = jobNumber;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* silently ignore — clipboard denied */ }
  };
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Click to copy job number'}
        className={`font-mono font-medium text-xs flex items-center gap-1 transition-colors ${copied ? 'text-emerald-400' : 'text-indigo-400 hover:text-indigo-300'}`}
      >
        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> {jobNumber}</>}
      </button>
      {onNavigate && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
          title="Go to order"
          className="text-slate-500 hover:text-indigo-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

/**
 * Unpaid Orders — three buckets:
 *   1. Zero priced (£0 total, no payment, not yet authorised)
 *   2. Priced but unpaid (real price, no payment)
 *   3. Authorised £0 invoice — previously in bucket 1, but a user has
 *      explicitly confirmed the £0 invoice is legitimate. Persisted in
 *      Supabase (stash_zero_invoice_authorised) so the decision is shared
 *      with the rest of the team and survives refreshes.
 *
 * All three buckets are individually collapsible. Zero + Priced open by
 * default (active work); Authorised starts collapsed (reference bucket).
 */
const UnpaidOrders: React.FC<Props> = ({ decoJobs, isDark, onNavigateToOrder, currentUserEmail }) => {
  const [search, setSearch] = useState('');
  // Default sort — newest shipped first. Empty dateShipped values fall to
  // the bottom in descending order, which is what we want (unshipped rows
  // shouldn't push shipped ones off-screen).
  const [sortKey, setSortKey] = useState<SortKey>('dateShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);

  const [authorised, setAuthorised] = useState<Record<string, AuthorisedRow>>({});
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);

  // Multi-select on the Zero priced section. We keep the single-row
  // "Authorise £0" button intact for one-off decisions; this set drives
  // the bulk action bar that appears when >=1 row is ticked.
  const [selectedZero, setSelectedZero] = useState<Set<string>>(new Set());
  const [bulkAuthorising, setBulkAuthorising] = useState(false);
  const toggleZeroSelected = useCallback((jobNumber: string) => {
    setSelectedZero(prev => {
      const next = new Set(prev);
      if (next.has(jobNumber)) next.delete(jobNumber);
      else next.add(jobNumber);
      return next;
    });
  }, []);
  const clearZeroSelection = useCallback(() => setSelectedZero(new Set()), []);

  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    zero: false,
    priced: false,
    authorised: true, // reference bucket — start closed to keep the page tidy
  });
  const toggleSection = (key: SectionKey) => setCollapsed(c => ({ ...c, [key]: !c[key] }));

  // Responsible-person filter. '' means "show all". Selecting a specific
  // name here narrows every section (and the PDF export) to that staff
  // member's jobs. UNASSIGNED matches jobs with no salesperson on them.
  const [responsibleFilter, setResponsibleFilter] = useState<string>('');

  // ─── Data loading ────────────────────────────────────────────────────
  const loadFromFinanceCache = useCallback(async () => {
    if (!isSupabaseReady()) { setNoCache(true); return; }
    setIsLoading(true);
    try {
      const res = await supabaseFetch(
        'stash_finance_cache?id=eq.finance_jobs&select=data,last_synced', 'GET'
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data) && rows[0].data.length > 0) {
        setAllJobs(rows[0].data);
        setLastSynced(rows[0].last_synced);
        setNoCache(false);
      } else {
        setNoCache(true);
      }
    } catch {
      setNoCache(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadAuthorised = useCallback(async () => {
    if (!isSupabaseReady()) return;
    try {
      const res = await supabaseFetch(
        'stash_zero_invoice_authorised?select=job_number,authorised_at,authorised_by', 'GET'
      );
      const rows: AuthorisedRow[] = await res.json();
      if (!Array.isArray(rows)) return;
      const map: Record<string, AuthorisedRow> = {};
      for (const r of rows) map[r.job_number] = r;
      setAuthorised(map);
    } catch {
      // Non-fatal — button just won't persist.
    }
  }, []);

  useEffect(() => {
    loadFromFinanceCache();
    loadAuthorised();
  }, [loadFromFinanceCache, loadAuthorised]);

  // ─── Authorise / un-authorise ────────────────────────────────────────
  const markAuthorised = useCallback(async (jobNumber: string, customerName: string) => {
    if (!isSupabaseReady() || isTogglingId) return;

    // Confirmation — this is a financial decision with shared visibility,
    // so staff should acknowledge before the row disappears.
    const ok = window.confirm(
      `Authorise £0 invoice for job #${jobNumber} (${customerName})?\n\n` +
      `This confirms the order is legitimately a £0 invoice (sample / promo / ` +
      `internal). It will move to the "Authorised £0 invoice" section and be ` +
      `visible to the rest of the team. You can undo this later.`
    );
    if (!ok) return;

    setIsTogglingId(jobNumber);
    const now = new Date().toISOString();
    const optimistic: AuthorisedRow = { job_number: jobNumber, authorised_at: now, authorised_by: currentUserEmail || null };
    setAuthorised(prev => ({ ...prev, [jobNumber]: optimistic }));

    try {
      await supabaseFetch(
        'stash_zero_invoice_authorised',
        'POST',
        { job_number: jobNumber, authorised_at: now, authorised_by: currentUserEmail || null, updated_at: now },
        'resolution=merge-duplicates'
      );
    } catch (e) {
      setAuthorised(prev => {
        const next = { ...prev };
        delete next[jobNumber];
        return next;
      });
      console.error('Failed to authorise £0 invoice', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [currentUserEmail, isTogglingId]);

  // Bulk authorise: one confirmation, then fires each upsert in parallel.
  // Optimistic UI — rows flip to the Authorised section immediately, and
  // the selection clears. Any row that fails to upsert is rolled back and
  // surfaces a console error (the rest still commit, consistent with
  // existing single-row failure behaviour).
  const bulkMarkAuthorised = useCallback(async () => {
    if (!isSupabaseReady() || bulkAuthorising) return;
    const jobNumbers = Array.from(selectedZero);
    if (jobNumbers.length === 0) return;

    const ok = window.confirm(
      `Authorise ${jobNumbers.length} £0 invoice${jobNumbers.length === 1 ? '' : 's'}?\n\n` +
      `This confirms each order is legitimately a £0 invoice (sample / promo / ` +
      `internal). Rows will move to the "Authorised £0 invoice" section and be ` +
      `visible to the rest of the team. You can undo individual rows later.`
    );
    if (!ok) return;

    setBulkAuthorising(true);
    const now = new Date().toISOString();

    const optimistic: Record<string, AuthorisedRow> = {};
    jobNumbers.forEach(jn => {
      optimistic[jn] = { job_number: jn, authorised_at: now, authorised_by: currentUserEmail || null };
    });
    setAuthorised(prev => ({ ...prev, ...optimistic }));
    clearZeroSelection();

    const results = await Promise.allSettled(jobNumbers.map(jn => supabaseFetch(
      'stash_zero_invoice_authorised',
      'POST',
      { job_number: jn, authorised_at: now, authorised_by: currentUserEmail || null, updated_at: now },
      'resolution=merge-duplicates',
    )));

    const failed = results
      .map((r, i) => (r.status === 'rejected' ? jobNumbers[i] : null))
      .filter((x): x is string => !!x);

    if (failed.length > 0) {
      setAuthorised(prev => {
        const next = { ...prev };
        failed.forEach(jn => { delete next[jn]; });
        return next;
      });
      console.error(`Bulk authorise: ${failed.length}/${jobNumbers.length} failed`, failed);
    }

    setBulkAuthorising(false);
  }, [selectedZero, bulkAuthorising, currentUserEmail, clearZeroSelection]);

  const unmarkAuthorised = useCallback(async (jobNumber: string) => {
    if (!isSupabaseReady() || isTogglingId) return;
    setIsTogglingId(jobNumber);

    const prevRow = authorised[jobNumber];
    setAuthorised(prev => {
      const next = { ...prev };
      delete next[jobNumber];
      return next;
    });

    try {
      await supabaseFetch(
        `stash_zero_invoice_authorised?job_number=eq.${encodeURIComponent(jobNumber)}`,
        'DELETE'
      );
    } catch (e) {
      if (prevRow) setAuthorised(prev => ({ ...prev, [jobNumber]: prevRow }));
      console.error('Failed to un-authorise £0 invoice', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [authorised, isTogglingId]);

  // ─── Filter + transform ──────────────────────────────────────────────
  const jobs: Row[] = useMemo(() => {
    return allJobs
      .filter(j => {
        const paymentCount = Array.isArray(j.payments) ? j.payments.length : 0;
        if (paymentCount > 0) return false;

        if (j.status === 'Cancelled') return false;
        if (j.isQuote) return false;

        const balance = typeof j.outstandingBalance === 'string'
          ? parseFloat(j.outstandingBalance)
          : (j.outstandingBalance || 0);
        const total = j.orderTotal || 0;

        const customer = (j.customerName || '').toLowerCase();
        if (balance === 0 && customer.includes('stash')) return false;

        // Expected-£0 keyword exclusions — GOK, Stash Shop, Sample.
        const haystack = `${j.jobName || ''}\u0001${j.customerName || ''}\u0001${j.notes || ''}`.toLowerCase();
        if (/\bgok\b/.test(haystack)) return false;
        if (haystack.includes('gift of kit')) return false;
        if (haystack.includes('stash shop')) return false;
        if (/\bsamples?\b/.test(haystack)) return false;

        if (balance === 0 && total === 0 && !j.dateShipped) return false;

        return true;
      })
      .map(j => {
        const balance = typeof j.outstandingBalance === 'string'
          ? parseFloat(j.outstandingBalance)
          : (j.outstandingBalance || 0);
        const total = j.orderTotal || 0;
        const anchor = j.dateShipped || j.dateOrdered;
        const daysSince = anchor
          ? Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000)
          : 0;
        const auth = authorised[j.jobNumber];
        return {
          ...j,
          outstandingBalance: balance,
          orderTotal: total,
          daysSince,
          isZeroPriced: total === 0,
          hasShipped: !!j.dateShipped,
          authorisedAt: auth?.authorised_at,
          authorisedBy: auth?.authorised_by || undefined,
        };
      });
  }, [allJobs, authorised]);

  const sorter = useCallback((a: Row, b: Row) => {
    let av: any, bv: any;
    switch (sortKey) {
      case 'jobNumber': av = a.jobNumber; bv = b.jobNumber; break;
      case 'customerName': av = a.customerName; bv = b.customerName; break;
      case 'outstandingBalance': av = a.outstandingBalance || 0; bv = b.outstandingBalance || 0; break;
      case 'dateShipped': av = a.dateShipped || ''; bv = b.dateShipped || ''; break;
      case 'dateOrdered': av = a.dateOrdered || ''; bv = b.dateOrdered || ''; break;
      case 'daysSince': av = a.daysSince; bv = b.daysSince; break;
      case 'status': av = a.status; bv = b.status; break;
      case 'salesPerson': av = (a.salesPerson || '').toLowerCase(); bv = (b.salesPerson || '').toLowerCase(); break;
      default: av = 0; bv = 0;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }, [sortKey, sortDir]);

  // Unique salespeople present across all current jobs (post search, pre
  // responsible filter) — this keeps the dropdown options stable while a
  // filter is applied so staff can switch between names without the list
  // collapsing. "Unassigned" is only offered if at least one job has no
  // salesperson on it.
  const salesPeople = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;
    if (q) {
      list = list.filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.poNumber?.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.jobName.toLowerCase().includes(q)
      );
    }
    const set = new Set<string>();
    let hasUnassigned = false;
    for (const j of list) {
      const sp = (j.salesPerson || '').trim();
      if (sp) set.add(sp); else hasUnassigned = true;
    }
    const names = Array.from(set).sort((a, b) => a.localeCompare(b));
    return { names, hasUnassigned };
  }, [jobs, search]);

  const { zeroPricedRows, pricedRows, authorisedRows } = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;
    if (q) {
      list = list.filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.poNumber?.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.jobName.toLowerCase().includes(q)
      );
    }
    if (responsibleFilter) {
      list = list.filter(j => {
        const sp = (j.salesPerson || '').trim();
        if (responsibleFilter === UNASSIGNED) return !sp;
        return sp === responsibleFilter;
      });
    }
    // Authorisation only has semantic meaning for zero-priced rows. If the
    // order later gets a real price, it drifts into priced-but-unpaid and
    // the authorisation is implicitly ignored (but not deleted).
    const authorisedRows = list.filter(j => j.isZeroPriced && !!j.authorisedAt).sort(sorter);
    const zeroPricedRows = list.filter(j => j.isZeroPriced && !j.authorisedAt).sort(sorter);
    const pricedRows = list.filter(j => !j.isZeroPriced).sort(sorter);
    return { zeroPricedRows, pricedRows, authorisedRows };
  }, [jobs, search, sorter, responsibleFilter]);

  const zeroPricedOutstanding = useMemo(
    () => zeroPricedRows.reduce((s, j) => s + (j.outstandingBalance || 0), 0),
    [zeroPricedRows]
  );

  // Drop selected IDs that no longer appear in the zero-priced list (e.g.
  // after a bulk authorise moved them to the Authorised section or a filter
  // change hid them). Prevents the bulk bar from claiming rows that aren't
  // visible / actionable.
  useEffect(() => {
    if (selectedZero.size === 0) return;
    const validIds = new Set(zeroPricedRows.map(r => r.jobNumber));
    let changed = false;
    const next = new Set<string>();
    selectedZero.forEach(id => {
      if (validIds.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelectedZero(next);
  }, [zeroPricedRows, selectedZero]);
  const pricedOutstanding = useMemo(
    () => pricedRows.reduce((s, j) => s + (j.outstandingBalance || 0), 0),
    [pricedRows]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fmt = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (d?: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const exportCsv = () => {
    const header = ['Section', 'Job Number', 'PO Number', 'Customer', 'Job Name', 'Responsible', 'Status', 'Outstanding', 'Order Date', 'Shipped Date', 'Days Since', 'Shipped', 'Authorised At', 'Authorised By'];
    const toRow = (j: Row, section: string) => [
      section, j.jobNumber, j.poNumber || '', j.customerName, j.jobName,
      j.salesPerson || '',
      j.status,
      (j.outstandingBalance || 0).toFixed(2),
      j.dateOrdered || '', j.dateShipped || '',
      j.daysSince.toString(),
      j.hasShipped ? 'YES' : 'no',
      j.authorisedAt || '',
      j.authorisedBy || '',
    ];
    const rows = [
      ...zeroPricedRows.map(r => toRow(r, 'Zero priced')),
      ...pricedRows.map(r => toRow(r, 'Priced but unpaid')),
      ...authorisedRows.map(r => toRow(r, 'Authorised £0 invoice')),
    ];
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unpaid-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Chase list PDF ────────────────────────────────────────────────
  // Generates a printable HTML document that opens in a new window with
  // the browser's print dialog, matching the existing DecoProductionTable
  // pattern. When a responsible person is selected, this is scoped to
  // their jobs so they can take the PDF to chase their own customers.
  const printChaseList = () => {
    if (zeroPricedRows.length + pricedRows.length === 0) return;

    const esc = (s: unknown) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const whoLabel = responsibleFilter
      ? (responsibleFilter === UNASSIGNED ? 'Unassigned jobs' : responsibleFilter)
      : 'All staff';

    const fmtMoney = (n: number) =>
      '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const fmtDay = (d?: string | null) => {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    };

    const renderSection = (title: string, rows: Row[], accent: 'amber' | 'rose') => {
      if (rows.length === 0) return '';
      const totalOut = rows.reduce((s, r) => s + (r.outstandingBalance || 0), 0);
      const borderClr = accent === 'amber' ? '#d97706' : '#e11d48';
      const headerBg = accent === 'amber' ? '#fef3c7' : '#ffe4e6';
      const headerText = accent === 'amber' ? '#92400e' : '#9f1239';

      const bodyRows = rows.map(r => `
        <tr>
          <td class="job-num">${esc(r.jobNumber)}</td>
          <td>${esc(r.customerName)}</td>
          <td class="job-name">${esc(r.jobName || '—')}</td>
          <td>${esc(r.salesPerson || '—')}</td>
          <td>${esc(r.status)}</td>
          <td class="num ${(r.outstandingBalance || 0) > 0 ? 'owed' : ''}">${esc(fmtMoney(r.outstandingBalance || 0))}</td>
          <td>${esc(fmtDay(r.dateOrdered))}</td>
          <td>${esc(fmtDay(r.dateShipped))}</td>
          <td class="num">${r.daysSince}</td>
          <td class="notes-col"></td>
        </tr>
      `).join('');

      return `
        <section class="group">
          <div class="group-header" style="background:${headerBg};color:${headerText};border-left:4px solid ${borderClr};">
            <strong>${esc(title)}</strong>
            <span class="group-meta">${rows.length} ${rows.length === 1 ? 'order' : 'orders'} · Outstanding ${esc(fmtMoney(totalOut))}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Job #</th>
                <th>Customer</th>
                <th>Job Name</th>
                <th>Responsible</th>
                <th>Status</th>
                <th class="num">Outstanding</th>
                <th>Ordered</th>
                <th>Shipped</th>
                <th class="num">Days</th>
                <th class="notes-col">Notes / Action taken</th>
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </section>
      `;
    };

    const combinedOut =
      zeroPricedRows.reduce((s, r) => s + (r.outstandingBalance || 0), 0) +
      pricedRows.reduce((s, r) => s + (r.outstandingBalance || 0), 0);

    const styles = `
      * { box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; margin: 24px; background: #fff; }
      h1 { margin: 0 0 4px 0; font-size: 22px; }
      .brand { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #6366f1; font-weight: 700; margin-bottom: 6px; }
      .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid #e5e7eb; }
      .meta { text-align: right; font-size: 12px; color: #4b5563; line-height: 1.5; }
      .meta strong { color: #111827; }
      .summary { display: flex; gap: 12px; margin-bottom: 20px; }
      .tile { flex: 1; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; }
      .tile-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; }
      .tile-value { font-size: 18px; font-weight: 700; color: #111827; margin-top: 2px; }
      .tile-value.rose { color: #e11d48; }
      .group { margin-bottom: 22px; page-break-inside: avoid; }
      .group-header { padding: 8px 12px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; border-radius: 4px 4px 0 0; }
      .group-meta { font-weight: 600; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #f3f4f6; text-align: left; padding: 6px 8px; border-bottom: 2px solid #d1d5db; font-weight: 600; color: #374151; }
      td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.job-num { font-family: 'SF Mono', Menlo, monospace; font-weight: 600; color: #4f46e5; white-space: nowrap; }
      td.job-name { max-width: 180px; }
      td.owed { color: #e11d48; font-weight: 600; }
      td.notes-col { width: 160px; }
      .actions { background: #eef2ff; border: 1px solid #c7d2fe; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
      .actions button { background: #4f46e5; color: #fff; border: 0; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }
      .print-footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #6b7280; text-align: center; }
      @media print {
        body { margin: 12mm; }
        .no-print { display: none !important; }
        .group { page-break-inside: auto; }
        thead { display: table-header-group; }
      }
    `;

    const bodyHtml = `
      <div class="actions no-print">
        <span>Invoice chase list — use your browser's print dialog to save as PDF or send to the printer.</span>
        <button onclick="window.print()">Print / Save as PDF</button>
      </div>

      <div class="report-header">
        <div>
          <div class="brand">Stash · Invoice Chase</div>
          <h1>Unpaid Invoice Chase List</h1>
          <div style="font-size:13px;color:#4b5563;margin-top:4px;">Responsible: <strong style="color:#111827;">${esc(whoLabel)}</strong></div>
        </div>
        <div class="meta">
          <strong>${esc(dateStr)}</strong><br>
          Generated ${esc(timeStr)}<br>
          ${zeroPricedRows.length + pricedRows.length} ${zeroPricedRows.length + pricedRows.length === 1 ? 'order' : 'orders'} to chase
        </div>
      </div>

      <div class="summary">
        <div class="tile">
          <div class="tile-label">Zero priced</div>
          <div class="tile-value">${zeroPricedRows.length}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Priced but unpaid</div>
          <div class="tile-value">${pricedRows.length}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Outstanding total</div>
          <div class="tile-value rose">${esc(fmtMoney(combinedOut))}</div>
        </div>
      </div>

      ${renderSection('Zero priced — shipped without a price (no invoice raised yet)', zeroPricedRows, 'amber')}
      ${renderSection('Priced but unpaid — invoice likely raised, payment outstanding', pricedRows, 'rose')}

      <div class="print-footer">
        Stash Unpaid Orders · Chase list for ${esc(whoLabel)} · ${esc(dateStr)} ${esc(timeStr)} · Contact the customer to confirm invoicing / payment status.
      </div>
    `;

    const win = window.open('', '_blank');
    if (!win) {
      alert('Please allow pop-ups for this site to generate the chase list PDF.');
      return;
    }
    const scopeTag = responsibleFilter
      ? (responsibleFilter === UNASSIGNED ? 'unassigned' : responsibleFilter.replace(/\s+/g, '_'))
      : 'all-staff';
    const title = `Unpaid Orders — ${scopeTag} — ${dateStr}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${styles}</style></head><body>${bodyHtml}</body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* user can click the button */ } }, 300);
  };

  const cardBg = isDark ? 'bg-[#232347]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-indigo-300' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const hoverRow = isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50';

  // ─── Shared table renderer ───────────────────────────────────────────
  const renderTable = (rows: Row[], variant: SectionKey) => {
    if (rows.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <p className={`text-sm font-medium ${textSecondary}`}>
            {search
              ? `No ${variant === 'zero' ? 'zero-priced' : variant === 'priced' ? 'priced' : 'authorised'} orders match your search`
              : variant === 'zero'
                ? 'No zero-priced orders — every unpaid order has a price on it.'
                : variant === 'priced'
                  ? 'No other unpaid orders.'
                  : 'Nothing has been authorised as a £0 invoice yet.'}
          </p>
        </div>
      );
    }
    // Multi-select state derived from the visible `rows` (which already
    // respects the responsible-staff filter and sort). Applies to the
    // zero-priced variant only.
    const visibleIds = variant === 'zero' ? rows.map(r => r.jobNumber) : [];
    const selectedVisibleCount = visibleIds.filter(id => selectedZero.has(id)).length;
    const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
    const toggleSelectAllVisible = () => {
      if (allVisibleSelected) {
        setSelectedZero(prev => {
          const next = new Set(prev);
          visibleIds.forEach(id => next.delete(id));
          return next;
        });
      } else {
        setSelectedZero(prev => {
          const next = new Set(prev);
          visibleIds.forEach(id => next.add(id));
          return next;
        });
      }
    };

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`border-b ${borderColor} ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              {variant === 'zero' && (
                <th className={`px-3 py-3 text-left ${textSecondary}`} style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible zero-priced rows"
                    title={allVisibleSelected ? 'Deselect all' : 'Select all visible'}
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                    onChange={toggleSelectAllVisible}
                    className="w-4 h-4 cursor-pointer accent-emerald-500"
                  />
                </th>
              )}
              {([
                ['jobNumber', 'Job #'],
                ['customerName', 'Customer'],
                ['', 'Job Name'],
                ['salesPerson', 'Responsible'],
                ['status', 'Status'],
                ['outstandingBalance', 'Outstanding'],
                ['dateOrdered', 'Ordered'],
                ['dateShipped', 'Shipped'],
                ['daysSince', 'Days'],
                ['', ''],
              ] as [SortKey | '', string][]).map(([key, label], idx) => (
                <th
                  key={`${label}-${idx}`}
                  onClick={key ? () => toggleSort(key as SortKey) : undefined}
                  className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${textSecondary} ${key ? 'cursor-pointer select-none hover:text-indigo-400' : ''}`}
                >
                  <span className="flex items-center gap-1">
                    {label}
                    {key && sortKey === key && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(j => {
              const toggling = isTogglingId === j.jobNumber;
              const isSelected = variant === 'zero' && selectedZero.has(j.jobNumber);
              return (
                <tr
                  key={j.id || j.jobNumber}
                  className={`border-b ${borderColor} ${hoverRow} transition-colors ${variant === 'authorised' ? 'opacity-75' : ''} ${isSelected ? (isDark ? 'bg-emerald-500/5' : 'bg-emerald-50') : ''}`}
                >
                  {variant === 'zero' && (
                    <td className="px-3 py-3" style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label={`Select job ${j.jobNumber}`}
                        checked={isSelected}
                        onChange={() => toggleZeroSelected(j.jobNumber)}
                        className="w-4 h-4 cursor-pointer accent-emerald-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <CopyableJobNum
                      jobNumber={j.jobNumber}
                      onNavigate={onNavigateToOrder ? () => onNavigateToOrder(j.poNumber || j.jobNumber) : undefined}
                    />
                  </td>
                  <td className={`px-4 py-3 font-medium ${textPrimary}`}>{j.customerName}</td>
                  <td className={`px-4 py-3 ${textSecondary} max-w-[200px] truncate`}>{j.jobName}</td>
                  <td className={`px-4 py-3 ${textSecondary} whitespace-nowrap`}>
                    {j.salesPerson ? (
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="w-3 h-3" />
                        {j.salesPerson}
                      </span>
                    ) : (
                      <span className="italic opacity-60">Unassigned</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 ${textSecondary}`}>
                    <span className="flex items-center gap-1.5">
                      {j.status}
                      {(variant === 'zero' || variant === 'authorised') && !j.hasShipped && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-700'}`} title="No ship date yet">
                          not shipped
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-bold ${
                    j.isZeroPriced
                      ? 'text-amber-400'
                      : (j.outstandingBalance || 0) > 0
                        ? 'text-rose-400'
                        : textSecondary
                  }`}>
                    {fmt(j.outstandingBalance || 0)}
                  </td>
                  <td className={`px-4 py-3 ${textSecondary}`}>{fmtDate(j.dateOrdered)}</td>
                  <td className={`px-4 py-3 ${textSecondary}`}>{fmtDate(j.dateShipped)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      j.daysSince > 30
                        ? 'bg-red-500/20 text-red-400'
                        : j.daysSince > 14
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-500/20 text-slate-300'
                    }`}>
                      {j.daysSince > 30 && <AlertTriangle className="w-3 h-3" />}
                      {j.daysSince}d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {variant === 'zero' && (
                      <button
                        onClick={() => markAuthorised(j.jobNumber, j.customerName)}
                        disabled={toggling}
                        title="Authorise this £0 invoice (moves row to Authorised section)"
                        className={`flex items-center gap-1.5 px-2 py-1 rounded border ${borderColor} text-xs font-medium ${textSecondary} hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors disabled:opacity-40`}
                      >
                        <div className="w-3.5 h-3.5 rounded-sm border border-current flex items-center justify-center">
                          {toggling && <Check className="w-2.5 h-2.5" />}
                        </div>
                        Authorise £0
                      </button>
                    )}
                    {variant === 'authorised' && (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400" title={`Authorised by ${j.authorisedBy || 'unknown'}`}>
                          <ShieldCheck className="w-3 h-3" />
                          Authorised {fmtDateTime(j.authorisedAt)}
                        </span>
                        <button
                          onClick={() => unmarkAuthorised(j.jobNumber)}
                          disabled={toggling}
                          title={`Undo authorisation (authorised by ${j.authorisedBy || 'unknown'})`}
                          className="text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-40"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Section header renderer (collapsible) ───────────────────────────
  interface HeaderProps {
    sectionKey: SectionKey;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    count: number;
    outstanding?: number;
    accentClasses?: { header: string; title: string; count: string };
  }
  const SectionHeader: React.FC<HeaderProps> = ({ sectionKey, icon, title, subtitle, count, outstanding, accentClasses }) => {
    const isCollapsed = collapsed[sectionKey];
    return (
      <div
        onClick={() => toggleSection(sectionKey)}
        className={`flex items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'} ${accentClasses?.header || ''}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
            className={`shrink-0 ${textSecondary} hover:text-white transition-colors`}
            onClick={(e) => { e.stopPropagation(); toggleSection(sectionKey); }}
          >
            {isCollapsed
              ? <ChevronRight className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="shrink-0">{icon}</div>
          <div className="min-w-0">
            <h3 className={`text-sm font-bold uppercase tracking-wider ${accentClasses?.title || textPrimary}`}>
              {title}
            </h3>
            <p className={`text-xs ${textSecondary} mt-0.5 truncate`}>{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className={`rounded-lg px-3 py-1.5 border ${accentClasses?.count || `${borderColor} ${cardBg}`}`}>
            <span className={`text-[10px] uppercase font-semibold block leading-none ${accentClasses?.title || textSecondary}`}>Count</span>
            <span className={`text-base font-bold ${accentClasses?.title || textPrimary}`}>{count}</span>
          </div>
          {outstanding !== undefined && (
            <div className={`rounded-lg px-3 py-1.5 border ${borderColor} ${cardBg}`}>
              <span className={`text-[10px] uppercase ${textSecondary} font-semibold block leading-none`}>Outstanding</span>
              <span className={`text-base font-bold ${textPrimary}`}>{fmt(outstanding)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const totalCount = zeroPricedRows.length + pricedRows.length + authorisedRows.length;
  const combinedOutstanding = zeroPricedOutstanding + pricedOutstanding;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
            <CircleDollarSign className="w-5 h-5 text-rose-500" />
            Unpaid Orders
          </h2>
          <p className={`text-sm ${textSecondary} mt-0.5`}>
            {isLoading ? 'Loading from cache...' : noCache
              ? 'No data yet — run a Full Sync from the Finance tab first'
              : lastSynced
                ? `Data from Finance sync: ${new Date(lastSynced).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : 'Orders with no payment recorded in Deco — catches pricing / invoicing slips'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadFromFinanceCache} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} ${cardBg} text-xs font-medium ${textSecondary} ${isLoading ? 'opacity-50' : 'hover:bg-white/10'} transition-colors`} title="Reload from Finance cache">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Total Outstanding</span>
            <p className="text-lg font-bold text-rose-500">{fmt(combinedOutstanding)}</p>
          </div>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Open orders</span>
            <p className={`text-lg font-bold ${textPrimary}`}>{zeroPricedRows.length + pricedRows.length}</p>
          </div>
        </div>
      </div>

      {/* Search + Responsible filter + Exports */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
          <input
            type="text"
            placeholder="Search by job number, customer, PO..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 rounded-lg border ${borderColor} ${cardBg} ${textPrimary} text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none`}
          />
        </div>

        <div className="relative">
          <UserRound className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary} pointer-events-none`} />
          <select
            value={responsibleFilter}
            onChange={e => setResponsibleFilter(e.target.value)}
            className={`pl-9 pr-8 py-2 rounded-lg border ${borderColor} ${cardBg} ${textPrimary} text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none`}
            title="Filter by the staff member responsible for each job"
          >
            <option value="">Responsible: All staff</option>
            {salesPeople.names.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
            {salesPeople.hasUnassigned && (
              <option value={UNASSIGNED}>— Unassigned —</option>
            )}
          </select>
          <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary} pointer-events-none`} />
        </div>

        <button
          onClick={printChaseList}
          disabled={zeroPricedRows.length + pricedRows.length === 0}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            zeroPricedRows.length + pricedRows.length === 0
              ? 'bg-slate-500/40 text-white/60 cursor-not-allowed'
              : 'bg-rose-600 text-white hover:bg-rose-700'
          }`}
          title={responsibleFilter
            ? `Print an invoice-chase list for ${responsibleFilter === UNASSIGNED ? 'unassigned jobs' : responsibleFilter}`
            : 'Print an invoice-chase list for the currently shown jobs'}
        >
          <Printer className="w-3.5 h-3.5" /> Chase list PDF
        </button>

        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>

        {responsibleFilter && (
          <button
            onClick={() => setResponsibleFilter('')}
            className={`text-xs ${textSecondary} hover:underline`}
            title="Clear responsible filter"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* ─── SECTION 1: Zero priced ─────────────────────────────────── */}
      <div className={`rounded-xl border overflow-hidden ${zeroPricedRows.length > 0
        ? 'border-amber-500/40 bg-amber-500/5'
        : `${borderColor} ${cardBg}`}`}
      >
        <SectionHeader
          sectionKey="zero"
          icon={<ShieldAlert className={`w-5 h-5 ${zeroPricedRows.length > 0 ? 'text-amber-400' : textSecondary}`} />}
          title="Zero priced — shipped without a price"
          subtitle="Order total is £0.00 and no payment has been recorded. Most dangerous bucket — likely never priced."
          count={zeroPricedRows.length}
          outstanding={zeroPricedOutstanding}
          accentClasses={zeroPricedRows.length > 0 ? {
            header: '',
            title: 'text-amber-400',
            count: 'border-amber-500/30 bg-amber-500/10',
          } : undefined}
        />
        {!collapsed.zero && (
          <div className={`border-t ${zeroPricedRows.length > 0 ? 'border-amber-500/30' : borderColor}`}>
            {selectedZero.size > 0 && (
              <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 border-b ${zeroPricedRows.length > 0 ? 'border-amber-500/30' : borderColor} ${isDark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold tracking-wider uppercase ${isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {selectedZero.size} selected
                </span>
                <button
                  onClick={bulkMarkAuthorised}
                  disabled={bulkAuthorising}
                  title={`Authorise ${selectedZero.size} £0 invoice${selectedZero.size === 1 ? '' : 's'} in one go`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold tracking-wider uppercase bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {bulkAuthorising ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Authorising...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Authorise selected ({selectedZero.size})
                    </>
                  )}
                </button>
                <button
                  onClick={clearZeroSelection}
                  disabled={bulkAuthorising}
                  className={`text-xs font-medium uppercase tracking-wider ${textSecondary} hover:text-rose-400 transition-colors disabled:opacity-50`}
                >
                  Clear
                </button>
              </div>
            )}
            {renderTable(zeroPricedRows, 'zero')}
          </div>
        )}
      </div>

      {/* ─── SECTION 2: Priced but unpaid ───────────────────────────── */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        <SectionHeader
          sectionKey="priced"
          icon={<CircleDollarSign className={`w-5 h-5 ${pricedRows.length > 0 ? 'text-rose-400' : textSecondary}`} />}
          title="Priced but unpaid"
          subtitle="A price is on the order but Deco has no payment recorded — invoice may have been missed."
          count={pricedRows.length}
          outstanding={pricedOutstanding}
        />
        {!collapsed.priced && (
          <div className={`border-t ${borderColor}`}>
            {renderTable(pricedRows, 'priced')}
          </div>
        )}
      </div>

      {/* ─── SECTION 3: Authorised £0 invoice (reference) ───────────── */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        <SectionHeader
          sectionKey="authorised"
          icon={<ShieldCheck className={`w-5 h-5 ${authorisedRows.length > 0 ? 'text-emerald-400' : textSecondary}`} />}
          title="Authorised £0 invoice"
          subtitle="Zero-priced orders that have been explicitly approved as legitimate £0 invoices."
          count={authorisedRows.length}
        />
        {!collapsed.authorised && (
          <div className={`border-t ${borderColor}`}>
            {renderTable(authorisedRows, 'authorised')}
          </div>
        )}
      </div>

      {/* Empty state */}
      {totalCount === 0 && !isLoading && (
        <div className={`${cardBg} rounded-xl border ${borderColor} flex flex-col items-center justify-center py-10`}>
          <CircleDollarSign className={`w-10 h-10 ${textSecondary} opacity-40 mb-3`} />
          <p className={`text-sm font-medium ${textSecondary}`}>
            {noCache
              ? 'Run a Full Sync from the Finance tab to populate this report'
              : 'All good — every active order has at least one payment recorded'}
          </p>
        </div>
      )}

      {/* Explanatory footer */}
      <div className={`text-xs ${textSecondary} px-1`}>
        Shown when Deco has <span className="font-semibold">no payment records</span> against the order. Excludes cancelled, quotes, &pound;0-balance internal <span className="font-mono">stash</span> customers, <span className="font-mono">GOK</span> / Gift of Kit orders, <span className="font-mono">Stash Shop</span> orders, and <span className="font-mono">Sample</span> orders. Sort defaults to newest shipped first.
      </div>
    </div>
  );
};

export default UnpaidOrders;
