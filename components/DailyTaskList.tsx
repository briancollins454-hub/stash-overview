import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, CheckSquare, ClipboardList, ExternalLink, Loader2, Plus, RefreshCw,
  Sparkles, Trash2, AlertTriangle,
} from 'lucide-react';
import type { DecoJob } from '../types';
import { isSupabaseReady, supabaseFetch } from '../services/supabase';
import { calculatePriority, URGENCY_STYLE, type Urgency } from '../services/priorityEngine';
import {
  buildPriorityImportSuggestions,
  FINANCE_CHECKLIST_SUGGESTIONS,
  PRODUCTION_ISSUES_SUGGESTION,
  sortDailyTaskRowsForDisplay,
} from '../services/dailyTaskSuggestions';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyTaskRow {
  id: number;
  task_date: string;
  title: string;
  source_page: string;
  source_ref: string | null;
  sort_order: number;
  completed: boolean;
  completed_at: string | null;
  hold_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  decoJobs: DecoJob[];
  currentUser: { id?: string | null; name?: string | null; email?: string | null };
  onNavigateTab: (tabId: string) => void;
  /** Optional: jump to dashboard with order search when a task carries a job # */
  onNavigateToOrder?: (orderNum: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const TAB_FOR_SOURCE: Record<string, string> = {
  manual: 'dashboard',
  priority: 'priority',
  finance_sni: 'shipped-not-invoiced',
  finance_credit: 'credit-block',
  finance_unpaid: 'unpaid-orders',
  production_issues: 'issues',
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Your note',
  priority: 'Deco job',
  finance_sni: 'Finance · invoicing',
  finance_credit: 'Finance · credit',
  finance_unpaid: 'Finance · payment',
  production_issues: 'Issue log',
};

function tabForTask(row: DailyTaskRow): string {
  return TAB_FOR_SOURCE[row.source_page] || 'dashboard';
}

function errStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    return (e as { status: number }).status;
  }
  return undefined;
}

/** PostgREST 404 / PGRST205 when `stash_daily_tasks` was never migrated. */
function isDailyTasksTableMissing(e: unknown): boolean {
  const st = errStatus(e);
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    st === 404
    || msg.includes('schema cache')
    || msg.includes('stash_daily_tasks')
    || msg.includes('pgrst205')
  );
}

function friendlyDailyTasksError(e: unknown): string {
  if (isDailyTasksTableMissing(e)) {
    return 'Daily tasks need the Supabase table `stash_daily_tasks`. In the Supabase dashboard → SQL Editor, run `migrations/stash_daily_tasks.sql` from the Stash repo on this project, then reload.';
  }
  return e instanceof Error ? e.message : 'Couldn\'t load tasks';
}

function fmtShortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(n?: number): string | null {
  if (n == null || Number.isNaN(n)) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `£${Math.round(n)}`;
  }
}

const FINANCE_HELP: Record<string, string> = {
  finance_credit: 'Open Credit block — clear or adjust holds so jobs can move.',
  finance_unpaid: 'Open Unpaid orders — chase payment or match receipts.',
  finance_sni: 'Open Shipped not invoiced — raise invoices for dispatched work.',
};

function TaskRowContext({
  row,
  job,
}: {
  row: DailyTaskRow;
  job: DecoJob | undefined;
}) {
  const now = new Date();

  if (row.source_page === 'priority' && row.source_ref) {
    if (job) {
      const pr = calculatePriority(job, now);
      const urgency = pr.urgency in URGENCY_STYLE ? pr.urgency as Urgency : 'low';
      const st = URGENCY_STYLE[urgency];
      const due = job.dateDue || job.productionDueDate;
      const subtotal = fmtMoney(job.orderTotal ?? job.billableAmount);
      return (
        <div className="mt-2 space-y-2 border-t border-gray-100 dark:border-white/10 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:text-xs text-gray-600 dark:text-gray-400">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Customer</span>
              <p className="font-medium text-gray-900 dark:text-gray-100">{job.customerName || '—'}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Deco job #</span>
              <p className="font-mono font-semibold text-gray-900 dark:text-gray-100">{job.jobNumber}</p>
            </div>
            {job.poNumber ? (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">PO / reference</span>
                <p className="font-mono text-gray-800 dark:text-gray-200">{job.poNumber}</p>
              </div>
            ) : null}
            {job.jobName && job.jobName.trim() !== (job.customerName || '').trim() ? (
              <div className="sm:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Job name</span>
                <p className="text-gray-800 dark:text-gray-200">{job.jobName}</p>
              </div>
            ) : null}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Production status</span>
              <p className="text-gray-800 dark:text-gray-200">{job.status || '—'}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Ship / due</span>
              <p className="text-gray-800 dark:text-gray-200">{fmtShortDate(due) || '—'}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Ordered</span>
              <p className="text-gray-800 dark:text-gray-200">{fmtShortDate(job.dateOrdered) || '—'}</p>
            </div>
            {subtotal ? (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Order value</span>
                <p className="text-gray-800 dark:text-gray-200">{subtotal}</p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wide ${st.pill}`}>
              {pr.urgency} · score {pr.score}
            </span>
            {pr.reason ? (
              <span className="text-gray-600 dark:text-gray-400">{pr.reason}</span>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <p className="mt-2 text-xs text-amber-800 dark:text-amber-300/95 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-lg px-2 py-1.5">
        This line is tied to job <span className="font-mono font-bold">{row.source_ref}</span>, but that job isn&apos;t in the current Deco list (sync, shipped, or removed). The text above is what was saved when the task was added.
      </p>
    );
  }

  if (row.source_page === 'manual') {
    return (
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Manual reminder — use the note below for detail or handover.
      </p>
    );
  }

  const fin = FINANCE_HELP[row.source_page];
  if (fin) {
    return <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">{fin}</p>;
  }

  if (row.source_page === 'production_issues') {
    return (
      <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
        Opens the production issue log — each issue there has its own order reference and notes.
      </p>
    );
  }

  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

const DailyTaskList: React.FC<Props> = ({
  decoJobs,
  currentUser,
  onNavigateTab,
  onNavigateToOrder,
}) => {
  const [taskDate, setTaskDate] = useState(() => localDateISO());
  const [rows, setRows] = useState<DailyTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [importing, setImporting] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const holdDebounceRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const createdBy = currentUser.email || currentUser.name || null;

  const load = useCallback(async () => {
    if (!isSupabaseReady()) {
      setError('Supabase isn\'t configured yet — wait a moment and use refresh, or check API keys in settings.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await supabaseFetch(
        `stash_daily_tasks?task_date=eq.${taskDate}&order=sort_order.asc,id.asc`,
        'GET',
      );
      const data: DailyTaskRow[] = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(friendlyDailyTasksError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [taskDate]);

  /** Load when the date changes; retry once Supabase is initialised (config can load after first paint). */
  useEffect(() => {
    if (isSupabaseReady()) {
      load();
      return;
    }
    const t = window.setInterval(() => {
      if (isSupabaseReady()) {
        window.clearInterval(t);
        load();
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [load]);

  const nextSortOrder = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.max(...rows.map(r => r.sort_order)) + 1;
  }, [rows]);

  /** Highest-pressure work first: live job scores, then finance, issues, manual. */
  const displayRows = useMemo(() => {
    const base = hideDone ? rows.filter(r => !r.completed) : [...rows];
    return sortDailyTaskRowsForDisplay(base, decoJobs);
  }, [rows, hideDone, decoJobs]);

  const jobByNumber = useMemo(() => {
    const m = new Map<string, DecoJob>();
    for (const j of decoJobs) m.set(String(j.jobNumber), j);
    return m;
  }, [decoJobs]);

  const addManual = async () => {
    const title = newTitle.trim();
    if (!title || !isSupabaseReady()) return;
    try {
      const payload = {
        task_date: taskDate,
        title,
        source_page: 'manual',
        source_ref: null,
        sort_order: nextSortOrder,
        completed: false,
        hold_note: null,
        created_by: createdBy,
      };
      const res = await supabaseFetch('stash_daily_tasks', 'POST', payload, 'return=representation');
      const inserted: DailyTaskRow[] = await res.json();
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      if (row) setRows(prev => [...prev, row].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
      setNewTitle('');
    } catch (e: any) {
      alert(e?.message || 'Couldn\'t add task');
    }
  };

  const patchRow = async (id: number, patch: Partial<DailyTaskRow>) => {
    try {
      await supabaseFetch(`stash_daily_tasks?id=eq.${id}`, 'PATCH', patch);
      setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    } catch (e: any) {
      alert(e?.message || 'Couldn\'t update task');
    }
  };

  const toggleComplete = (row: DailyTaskRow) => {
    const next = !row.completed;
    patchRow(row.id, {
      completed: next,
      completed_at: next ? new Date().toISOString() : null,
    });
  };

  const updateHoldNote = (id: number, hold_note: string) => {
    patchRow(id, { hold_note: hold_note || null });
  };

  const onHoldNoteChange = (id: number, value: string) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, hold_note: value } : r)));
    const prevTimer = holdDebounceRef.current[id];
    if (prevTimer) clearTimeout(prevTimer);
    holdDebounceRef.current[id] = setTimeout(() => {
      updateHoldNote(id, value);
      delete holdDebounceRef.current[id];
    }, 650);
  };

  const removeRow = async (id: number) => {
    if (!window.confirm('Remove this task from the list?')) return;
    try {
      await supabaseFetch(`stash_daily_tasks?id=eq.${id}`, 'DELETE');
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      alert(e?.message || 'Couldn\'t delete');
    }
  };

  const existingKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.source_ref) s.add(`${r.source_page}:${r.source_ref}`);
    }
    return s;
  }, [rows]);

  /** One pass: top scored jobs → finance checks → issue log (skips duplicates). */
  const importFromSystem = async () => {
    if (!isSupabaseReady()) return;
    const suggestions = buildPriorityImportSuggestions(decoJobs, 25);
    setImporting(true);
    try {
      let order = nextSortOrder;
      let imported = 0;
      let postAttempts = 0;
      let firstError: unknown = null;

      const post = async (payload: Record<string, unknown>) => {
        postAttempts++;
        try {
          await supabaseFetch('stash_daily_tasks', 'POST', payload);
          imported++;
        } catch (e: unknown) {
          if (!firstError) firstError = e;
        }
      };

      for (const s of suggestions) {
        const key = `priority:${s.jobNumber}`;
        if (existingKeys.has(key)) continue;
        await post({
          task_date: taskDate,
          title: s.title,
          source_page: 'priority',
          source_ref: s.jobNumber,
          sort_order: order++,
          completed: false,
          hold_note: null,
          created_by: createdBy,
        });
      }

      for (const item of FINANCE_CHECKLIST_SUGGESTIONS) {
        const key = `${item.source_page}:${item.source_ref}`;
        if (existingKeys.has(key)) continue;
        await post({
          task_date: taskDate,
          title: item.title,
          source_page: item.source_page,
          source_ref: item.source_ref,
          sort_order: order++,
          completed: false,
          hold_note: null,
          created_by: createdBy,
        });
      }

      const pi = PRODUCTION_ISSUES_SUGGESTION;
      if (!existingKeys.has(`${pi.source_page}:${pi.source_ref}`)) {
        await post({
          task_date: taskDate,
          title: pi.title,
          source_page: pi.source_page,
          source_ref: pi.source_ref,
          sort_order: order++,
          completed: false,
          hold_note: null,
          created_by: createdBy,
        });
      }

      await load();
      if (imported === 0 && postAttempts > 0 && isDailyTasksTableMissing(firstError)) {
        alert(friendlyDailyTasksError(firstError));
        return;
      }
      if (imported === 0 && postAttempts > 0 && firstError) {
        alert(
          `Could not save tasks: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
        );
        return;
      }
      if (imported === 0) {
        alert(
          suggestions.length === 0
            ? 'No scored jobs to add (sync Deco) or every checklist row is already on this date.'
            : 'Every pulled item was already on today\'s list.',
        );
      }
    } finally {
      setImporting(false);
    }
  };

  const openLinked = (row: DailyTaskRow) => {
    const tab = tabForTask(row);
    onNavigateTab(tab);
  };

  const openOrderIfAny = (row: DailyTaskRow) => {
    if (row.source_page === 'priority' && row.source_ref && onNavigateToOrder) {
      onNavigateToOrder(row.source_ref);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-gray-900 dark:text-white">Daily task list</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Each <strong className="font-semibold text-gray-600 dark:text-gray-300">Deco job</strong> row shows order #, customer, PO, status, dates, and priority score from live data. Finance rows link to the right tab. Order is hottest jobs first, then finance checks, issue log, then your notes.
            </p>
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300"
          title="Reload"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-[#1e1e3a] border border-gray-200 dark:border-indigo-500/20 rounded-xl p-3">
        <label className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300">
          <CalendarDays className="w-4 h-4" />
          Day
          <input
            type="date"
            value={taskDate}
            onChange={e => setTaskDate(e.target.value)}
            className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a55] text-gray-900 dark:text-white text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
          Hide completed
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Pull from elsewhere */}
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 border border-violet-200/60 dark:border-violet-500/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-800 dark:text-violet-300">
          <Sparkles className="w-4 h-4" /> Pull into today&apos;s list
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={importing || loading}
            onClick={importFromSystem}
            className="px-3 py-2 rounded-lg bg-violet-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
            Pull from system (priority order)
          </button>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          Adds up to 25 scored jobs (most urgent first), then finance reviews, then the production issue log. Skips anything already on this date. Your manual tasks stay at the bottom unless you tick them off.
        </p>
      </div>

      {/* Add manual */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addManual()}
          placeholder="Add your own task (e.g. call supplier — mention PO or order #)…"
          className="flex-1 px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a55] text-gray-900 dark:text-white text-sm"
        />
        <button
          type="button"
          onClick={addManual}
          disabled={!newTitle.trim()}
          className="px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-gray-800 dark:hover:bg-indigo-500 disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {/* List */}
      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16 text-gray-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : displayRows.length === 0 ? (
        <div className="text-center py-14 text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl">
          {hideDone && rows.some(r => r.completed)
            ? 'All tasks done for this day — toggle off "Hide completed" to see them.'
            : 'No tasks yet — import from priority/finance or add your own.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {displayRows.map(row => {
            const job =
              row.source_page === 'priority' && row.source_ref
                ? jobByNumber.get(String(row.source_ref))
                : undefined;
            const primaryTitle =
              row.source_page === 'priority' && row.source_ref && job
                ? `#${job.jobNumber} · ${job.customerName || 'Customer'}`
                : row.title;
            const legacyTitle =
              row.source_page === 'priority' && job && row.title.trim() !== primaryTitle.trim();

            return (
            <li
              key={row.id}
              className={`rounded-xl border p-3 sm:p-4 transition-colors ${
                row.completed
                  ? 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 opacity-75'
                  : 'bg-white dark:bg-[#1e1e3a] border-gray-200 dark:border-indigo-500/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={row.completed}
                  onChange={() => toggleComplete(row)}
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <span className={`text-sm sm:text-base font-bold leading-snug block ${row.completed ? 'line-through text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                        {primaryTitle}
                      </span>
                      {legacyTitle ? (
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 block">
                          Earlier label: {row.title}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                        {SOURCE_LABEL[row.source_page] || row.source_page}
                      </span>
                      {row.source_page !== 'manual' && (
                        <button
                          type="button"
                          onClick={() => openLinked(row)}
                          className="p-1 rounded text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                          title="Open linked page"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      )}
                      {row.source_page === 'priority' && row.source_ref && onNavigateToOrder && (
                        <button
                          type="button"
                          onClick={() => openOrderIfAny(row)}
                          className="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Find order
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <TaskRowContext row={row} job={job} />
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Hold-up / note</label>
                    <textarea
                      value={row.hold_note || ''}
                      onChange={e => onHoldNoteChange(row.id, e.target.value)}
                      onBlur={e => {
                        const t = holdDebounceRef.current[row.id];
                        if (t) clearTimeout(t);
                        delete holdDebounceRef.current[row.id];
                        const v = e.target.value.trim();
                        patchRow(row.id, { hold_note: v || null });
                      }}
                      rows={2}
                      placeholder="Waiting on stock, customer reply, artwork…"
                      className="w-full text-sm px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-[#2a2a55] text-gray-900 dark:text-white placeholder:text-gray-400 resize-y min-h-[2.5rem]"
                    />
                  </div>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default DailyTaskList;
