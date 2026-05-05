import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, CheckSquare, ClipboardList, Copy, Check, ExternalLink, Loader2, Plus, RefreshCw,
  Sparkles, Trash2, AlertTriangle, UserRound, FileText,
} from 'lucide-react';
import type { DecoJob } from '../types';
import { isSupabaseReady, supabaseFetch } from '../services/supabase';
import { calculatePriority, URGENCY_STYLE, type Urgency, type PriorityResult } from '../services/priorityEngine';
import { displayStaffName } from '../services/staffDisplay';
import { isDecoJobCancelled } from '../services/decoJobFilters';
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
  reviewed: boolean;
  reviewed_at: string | null;
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

/** Staff view: all Deco jobs, or filter to one responsible name / unassigned. */
const STAFF_VIEW_ALL = 'all';
const STAFF_VIEW_UNASSIGNED = '__unassigned__';

function priorityRowStaffBucket(job: DecoJob | undefined): string {
  if (!job) return STAFF_VIEW_UNASSIGNED;
  return displayStaffName(job.salesPerson) || STAFF_VIEW_UNASSIGNED;
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

function weekBoundsFromDateISO(iso: string): { startIso: string; endIso: string; start: Date; end: Date } {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const diffToMonday = (day + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(0, 0, 0, 0);
  return { startIso: localDateISO(start), endIso: localDateISO(end), start, end };
}

function escHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

const FINANCE_WHY_INTRO: Record<string, string> = {
  finance_credit:
    'Added when you used Pull from system — it’s a standing finance sweep so credit holds don’t stall jobs silently.',
  finance_unpaid:
    'Added when you used Pull from system — cash collection issues shouldn’t sit unattended.',
  finance_sni:
    'Added when you used Pull from system — shipped work should be invoiced on time for cashflow.',
};

function priorityIssueExplanation(job: DecoJob, pr: PriorityResult): { summary: string; factors: string[] } {
  const jobSt = (job.status || '').trim().toLowerCase();
  if (jobSt === 'shipped') {
    return {
      summary:
        'Deco shows this job as Shipped. It remains on this date because the daily list is stored in your database until you tick Done or delete the row — it is not removed automatically when Deco status changes.',
      factors: [],
    };
  }
  if (isDecoJobCancelled(job)) {
    return {
      summary:
        'Deco shows this job as cancelled. Remove or complete this checklist row; new pulls will not treat it as active priority work.',
      factors: [],
    };
  }
  const factors = pr.matchedRules.filter(Boolean);
  if (factors.length === 0) {
    return {
      summary: `Still an active Deco job (${job.status || 'unknown status'}). It appears on today’s list because it ranked in your pulled queue with priority score ${pr.score} (${pr.urgency}) — often due dates, value, or balance rules.`,
      factors: [],
    };
  }
  return {
    summary: `Ranked by the same rules as the Priority Board (total score ${pr.score}, ${pr.urgency}). These are the concrete signals — that’s why it needs attention today.`,
    factors,
  };
}

function DailyListWhySection({
  summary,
  bullets,
}: {
  summary: string;
  bullets?: string[];
}) {
  return (
    <div className="sm:col-span-2 rounded-lg border border-violet-200 dark:border-violet-500/35 bg-violet-50/70 dark:bg-violet-950/35 px-2.5 py-2.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-400">
        Why it&apos;s on today&apos;s list
      </span>
      <p className="text-[13px] text-gray-800 dark:text-gray-100 mt-1.5 leading-snug">{summary}</p>
      {bullets && bullets.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[12px] text-gray-700 dark:text-gray-300 list-disc pl-4 marker:text-violet-500">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } finally {
      document.body.removeChild(ta);
    }
  } catch {
    return false;
  }
}

/**
 * Deco jobs the user has ticked off as completed on any daily list date.
 * Pull from system skips these so they don't reappear the next day.
 */
async function fetchCompletedPriorityJobRefsEver(): Promise<Set<string>> {
  const out = new Set<string>();
  if (!isSupabaseReady()) return out;
  try {
    const res = await supabaseFetch(
      'stash_daily_tasks?source_page=eq.priority&completed=eq.true&select=source_ref&limit=10000',
      'GET',
    );
    const data: { source_ref: string | null }[] = await res.json();
    if (!Array.isArray(data)) return out;
    for (const r of data) {
      if (r.source_ref != null && String(r.source_ref).trim() !== '') {
        out.add(String(r.source_ref));
      }
    }
  } catch {
    /* Import still runs; cross-day skip is best-effort */
  }
  return out;
}

/** One-click copy Deco order/job number (plain digits — paste into search or chat). */
function JobNumberCopyButton({ jobNumber, className = '' }: { jobNumber: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async e => {
        e.stopPropagation();
        const ok = await copyTextSafe(jobNumber);
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }
      }}
      title={copied ? 'Copied to clipboard' : `Copy order number ${jobNumber}`}
      className={`inline-flex items-center gap-1 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a55] text-gray-700 dark:text-gray-200 hover:bg-violet-50 hover:border-violet-300 dark:hover:bg-violet-950/40 dark:hover:border-violet-600 ${copied ? 'border-emerald-400 text-emerald-700 dark:text-emerald-400' : ''} ${className}`}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3 opacity-70" />}
      {copied ? 'Copied' : 'Copy #'}
    </button>
  );
}

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
      const staff = displayStaffName(job.salesPerson);
      const issueExpl = priorityIssueExplanation(job, pr);
      return (
        <div className="mt-2 space-y-2 border-t border-gray-100 dark:border-white/10 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:text-xs text-gray-600 dark:text-gray-400">
            <DailyListWhySection summary={issueExpl.summary} bullets={issueExpl.factors.length ? issueExpl.factors : undefined} />
            <div className="sm:col-span-2 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-500/20 px-2.5 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Speak to (responsible in Deco)</span>
              <p className="font-semibold text-indigo-950 dark:text-indigo-100 mt-0.5">{staff || 'Not assigned — check Deco order / sales owner'}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Customer</span>
              <p className="font-medium text-gray-900 dark:text-gray-100">{job.customerName || '—'}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Deco job #</span>
              <p className="font-mono font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{job.jobNumber}</p>
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
              <span className="text-gray-500 dark:text-gray-500" title="Primary rule from scorer">
                Top signal: {pr.reason}
              </span>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 space-y-2">
        <DailyListWhySection
          summary="This row was saved for an older pull or manual add. We can’t recompute the live priority reason until Deco sync includes this job again."
          bullets={[
            'Usually means the job shipped, was cancelled, or hasn’t appeared in the latest Deco fetch.',
            'Use Copy # below if you still need the order number elsewhere.',
          ]}
        />
        <div className="text-xs text-amber-800 dark:text-amber-300/95 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-lg px-2 py-1.5 space-y-2">
          <p>
            Tied to job <span className="font-mono font-bold">{row.source_ref}</span> — not in the current Deco list.
          </p>
          {row.source_ref ? <JobNumberCopyButton jobNumber={String(row.source_ref)} /> : null}
        </div>
      </div>
    );
  }

  if (row.source_page === 'manual') {
    return (
      <div className="mt-2 space-y-2">
        <DailyListWhySection
          summary="You added this line yourself for this date — it isn’t driven by the Deco priority scorer."
          bullets={['Use the hold-up note below if someone else needs context.']}
        />
      </div>
    );
  }

  const fin = FINANCE_HELP[row.source_page];
  const finWhy = FINANCE_WHY_INTRO[row.source_page];
  if (fin && finWhy) {
    return (
      <div className="mt-2 space-y-2">
        <DailyListWhySection summary={finWhy} bullets={[fin]} />
      </div>
    );
  }

  if (row.source_page === 'production_issues') {
    return (
      <div className="mt-2 space-y-2">
        <DailyListWhySection
          summary="Added when you used Pull from system — a rolling reminder so open production issues don’t get forgotten."
          bullets={[
            'Each real issue lives on the Issue log tab with its own order # and detail.',
            'Use this row to batch-review; drill into the tab for specifics.',
          ]}
        />
      </div>
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
  const [weeklyExporting, setWeeklyExporting] = useState(false);
  /** Narrow list to one Deco responsible person (finance / manual rows only show when All). */
  const [staffViewFilter, setStaffViewFilter] = useState<string>(STAFF_VIEW_ALL);
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
  const displayRows = useMemo(
    () => sortDailyTaskRowsForDisplay([...rows], decoJobs),
    [rows, decoJobs],
  );

  const jobByNumber = useMemo(() => {
    const m = new Map<string, DecoJob>();
    for (const j of decoJobs) m.set(String(j.jobNumber), j);
    return m;
  }, [decoJobs]);

  const staffNamesOnFile = useMemo(() => {
    const s = new Set<string>();
    for (const j of decoJobs) {
      const n = displayStaffName(j.salesPerson);
      if (n) s.add(n);
    }
    for (const r of rows) {
      if (r.source_page !== 'priority' || !r.source_ref) continue;
      const j = jobByNumber.get(String(r.source_ref));
      const n = displayStaffName(j?.salesPerson);
      if (n) s.add(n);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [decoJobs, rows, jobByNumber]);

  const filteredDisplayRows = useMemo(() => {
    if (staffViewFilter === STAFF_VIEW_ALL) return displayRows;
    return displayRows.filter(row => {
      if (row.source_page !== 'priority') return false;
      const job = row.source_ref ? jobByNumber.get(String(row.source_ref)) : undefined;
      return priorityRowStaffBucket(job) === staffViewFilter;
    });
  }, [displayRows, staffViewFilter, jobByNumber]);

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
        reviewed: false,
        reviewed_at: null,
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

  const toggleReviewed = (row: DailyTaskRow) => {
    const next = !row.reviewed;
    patchRow(row.id, {
      reviewed: next,
      reviewed_at: next ? new Date().toISOString() : null,
      // If unchecked from reviewed, keep final completion untouched.
    });
  };

  const toggleComplete = (row: DailyTaskRow) => {
    const next = !row.completed;
    patchRow(row.id, {
      completed: next,
      completed_at: next ? new Date().toISOString() : null,
      // Completing always implies reviewed.
      reviewed: next ? true : row.reviewed,
      reviewed_at: next ? (row.reviewed_at || new Date().toISOString()) : row.reviewed_at,
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
      const completedPriorityEver = await fetchCompletedPriorityJobRefsEver();
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
        if (completedPriorityEver.has(String(s.jobNumber))) continue;
        await post({
          task_date: taskDate,
          title: s.title,
          source_page: 'priority',
          source_ref: s.jobNumber,
          sort_order: order++,
          reviewed: false,
          reviewed_at: null,
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
          reviewed: false,
          reviewed_at: null,
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
          reviewed: false,
          reviewed_at: null,
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
            : 'Nothing new to add — already on today\'s list, already checked off on a previous day, or every checklist row is present.',
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

  const dailyRows = useMemo(
    () => filteredDisplayRows.filter(r => !r.reviewed && !r.completed),
    [filteredDisplayRows],
  );
  const toCompleteRows = useMemo(
    () => filteredDisplayRows.filter(r => r.reviewed && !r.completed),
    [filteredDisplayRows],
  );
  const completedRows = useMemo(
    () => filteredDisplayRows.filter(r => r.completed),
    [filteredDisplayRows],
  );

  const renderTaskRow = (row: DailyTaskRow) => {
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
            ? 'bg-emerald-50/70 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-700/40 opacity-90'
            : row.reviewed
              ? 'bg-amber-50/70 dark:bg-amber-900/15 border-amber-200 dark:border-amber-700/40'
              : 'bg-white dark:bg-[#1e1e3a] border-gray-200 dark:border-indigo-500/20'
        }`}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={row.reviewed}
            onChange={() => toggleReviewed(row)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            title="Checked / reviewed"
          />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm sm:text-base font-bold leading-snug ${row.completed ? 'line-through text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                    {primaryTitle}
                  </span>
                  {row.source_page === 'priority' && row.source_ref ? (
                    <JobNumberCopyButton jobNumber={String(row.source_ref)} />
                  ) : null}
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    row.completed
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : row.reviewed
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300'
                  }`}>
                    {row.completed ? 'Completed' : row.reviewed ? 'To be completed' : 'Daily task'}
                  </span>
                </div>
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
                {!row.completed && (
                  <button
                    type="button"
                    onClick={() => toggleComplete(row)}
                    className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400 hover:underline px-1"
                    title="Mark this task as completed by staff"
                  >
                    Complete
                  </button>
                )}
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
  };

  const fetchWeekRows = useCallback(async (): Promise<DailyTaskRow[]> => {
    const { startIso, endIso } = weekBoundsFromDateISO(taskDate);
    const res = await supabaseFetch(
      `stash_daily_tasks?task_date=gte.${startIso}&task_date=lte.${endIso}&order=task_date.asc,sort_order.asc,id.asc`,
      'GET',
    );
    const data: DailyTaskRow[] = await res.json();
    return Array.isArray(data) ? data : [];
  }, [taskDate]);

  const rowStaffName = useCallback((row: DailyTaskRow): string => {
    if (row.source_page !== 'priority' || !row.source_ref) return 'Shared / admin';
    const job = jobByNumber.get(String(row.source_ref));
    return displayStaffName(job?.salesPerson) || 'Unassigned';
  }, [jobByNumber]);

  const rowsForStaffView = useCallback((allRows: DailyTaskRow[], staff: string): DailyTaskRow[] => {
    if (staff === STAFF_VIEW_ALL) return allRows;
    return allRows.filter(row => {
      if (row.source_page !== 'priority') return false;
      const job = row.source_ref ? jobByNumber.get(String(row.source_ref)) : undefined;
      return priorityRowStaffBucket(job) === staff;
    });
  }, [jobByNumber]);

  const openWeeklyPdf = useCallback((
    title: string,
    audience: string,
    rowsToPrint: DailyTaskRow[],
  ) => {
    const byDate = new Map<string, DailyTaskRow[]>();
    rowsToPrint.forEach(r => {
      const key = r.task_date;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(r);
    });
    const sections = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rowsForDate]) => {
        const dayTitle = fmtShortDate(date) || date;
        const lis = rowsForDate.map(r => {
          const staff = rowStaffName(r);
          const source = SOURCE_LABEL[r.source_page] || r.source_page;
          const done = r.completed ? 'Completed' : r.reviewed ? 'To be completed' : 'Daily task';
          const note = (r.hold_note || '').trim() || '—';
          const ref = r.source_ref ? `#${r.source_ref}` : '';
          return `<tr>
            <td>${escHtml(dayTitle)}</td>
            <td>${escHtml(done)}</td>
            <td>${escHtml(source)}</td>
            <td>${escHtml(staff)}</td>
            <td>${escHtml((r.title || '').trim())}${ref ? ` <span style="color:#6d28d9;font-family:ui-monospace,monospace;">${escHtml(ref)}</span>` : ''}</td>
            <td>${escHtml(note)}</td>
          </tr>`;
        }).join('');
        return lis;
      }).join('');

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;padding:20px;color:#111827}
h1{margin:0 0 6px;font-size:20px} .meta{color:#6b7280;font-size:12px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #e5e7eb;padding:7px 8px;vertical-align:top}
th{background:#f5f3ff;color:#4c1d95;text-transform:uppercase;font-size:10px;letter-spacing:.08em}
tr:nth-child(even) td{background:#fafafa}
</style></head><body>
<h1>${escHtml(title)}</h1>
<div class="meta">${escHtml(audience)} · Generated ${escHtml(new Date().toLocaleString())}</div>
<table>
<thead><tr><th>Day</th><th>Status</th><th>Source</th><th>Owner</th><th>Task</th><th>Hold-up note</th></tr></thead>
<tbody>${sections || '<tr><td colspan="6">No tasks in this week.</td></tr>'}</tbody>
</table>
</body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      window.alert('Please allow pop-ups for PDF generation.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    window.setTimeout(() => { try { win.print(); } catch { /* noop */ } }, 250);
  }, [rowStaffName]);

  const exportWeeklyAllPdf = useCallback(async () => {
    if (!isSupabaseReady()) return;
    setWeeklyExporting(true);
    try {
      const weekRows = rowsForStaffView(await fetchWeekRows(), staffViewFilter);
      const { startIso, endIso } = weekBoundsFromDateISO(taskDate);
      const audience =
        staffViewFilter === STAFF_VIEW_ALL
          ? 'Audience: all staff'
          : `Audience: ${staffViewFilter === STAFF_VIEW_UNASSIGNED ? 'Unassigned' : staffViewFilter}`;
      openWeeklyPdf(
        `Weekly task briefing (${startIso} → ${endIso})`,
        audience,
        weekRows,
      );
    } catch (e: unknown) {
      window.alert(friendlyDailyTasksError(e));
    } finally {
      setWeeklyExporting(false);
    }
  }, [fetchWeekRows, taskDate, openWeeklyPdf, rowsForStaffView, staffViewFilter]);

  const exportWeeklyIndividualPdfs = useCallback(async () => {
    if (!isSupabaseReady()) return;
    setWeeklyExporting(true);
    try {
      const weekRows = rowsForStaffView(await fetchWeekRows(), staffViewFilter);
      const owners =
        staffViewFilter === STAFF_VIEW_ALL
          ? Array.from(new Set(weekRows.map(rowStaffName))).sort((a, b) => a.localeCompare(b))
          : [staffViewFilter];
      const { startIso, endIso } = weekBoundsFromDateISO(taskDate);
      let generated = 0;
      owners.forEach(owner => {
        const scoped = weekRows.filter(r => rowStaffName(r) === owner);
        if (scoped.length === 0) return;
        generated += 1;
        openWeeklyPdf(
          `Weekly tasks (${startIso} → ${endIso})`,
          `Audience: ${owner}`,
          scoped,
        );
      });
      if (generated === 0) {
        window.alert('No tasks found for the selected staff view in this week.');
      }
    } catch (e: unknown) {
      window.alert(friendlyDailyTasksError(e));
    } finally {
      setWeeklyExporting(false);
    }
  }, [fetchWeekRows, taskDate, rowStaffName, openWeeklyPdf, rowsForStaffView, staffViewFilter]);

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
              Each <strong className="font-semibold text-gray-600 dark:text-gray-300">Deco job</strong> row shows who to speak to (sales / responsible from Deco). Use <strong className="font-semibold text-gray-600 dark:text-gray-300">View</strong> to focus on one person&apos;s jobs. With a person selected, finance checklists and manual notes are hidden so you only see their Deco queue.
            </p>
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={exportWeeklyAllPdf}
          disabled={weeklyExporting}
          className="px-2.5 py-2 rounded-lg border border-violet-200 dark:border-violet-500/30 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-50"
          title="Compile this week into one PDF including notes"
        >
          {weeklyExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Weekly PDF (all)
        </button>
        <button
          type="button"
          onClick={exportWeeklyIndividualPdfs}
          disabled={weeklyExporting}
          className="px-2.5 py-2 rounded-lg border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-50"
          title="Compile this week into one PDF per owner including notes"
        >
          {weeklyExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserRound className="w-3.5 h-3.5" />}
          Weekly PDF (individual)
        </button>
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
        <label className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300">
          <UserRound className="w-4 h-4 shrink-0 text-indigo-500" />
          View
          <select
            value={staffViewFilter}
            onChange={e => setStaffViewFilter(e.target.value)}
            className="max-w-[11rem] sm:max-w-[14rem] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a55] text-gray-900 dark:text-white text-sm font-medium"
            title="Show only Deco jobs owned by this person in Deco"
          >
            <option value={STAFF_VIEW_ALL}>All staff</option>
            <option value={STAFF_VIEW_UNASSIGNED}>Unassigned</option>
            {staffNamesOnFile.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {staffViewFilter !== STAFF_VIEW_ALL ? (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {filteredDisplayRows.length} job{filteredDisplayRows.length !== 1 ? 's' : ''}
            {staffViewFilter === STAFF_VIEW_UNASSIGNED ? ' (no owner in Deco)' : ''}
          </span>
        ) : null}
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
          Adds up to 25 scored jobs (most urgent first), then finance reviews, then the production issue log. Skips rows already on this date. Jobs you previously ticked complete on any day are not pulled again — uncheck or delete that older row if you need it back.
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
          No tasks yet — import from priority/finance or add your own.
        </div>
      ) : filteredDisplayRows.length === 0 ? (
        <div className="text-center py-14 text-gray-500 dark:text-gray-400 border border-dashed border-amber-300/80 dark:border-amber-700/50 rounded-xl bg-amber-50/40 dark:bg-amber-950/20 px-4">
          No Deco jobs for this view on this day — choose <strong className="text-gray-700 dark:text-gray-300">All staff</strong> to see finance checks and everyone&apos;s tasks, or pick another name.
        </div>
      ) : (
        <div className="space-y-4">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">Daily tasks</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{dailyRows.length}</span>
            </div>
            {dailyRows.length === 0 ? <div className="text-xs text-gray-400 px-1">No rows in this section.</div> : <ul className="space-y-2">{dailyRows.map(renderTaskRow)}</ul>}
          </section>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">To be completed</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{toCompleteRows.length}</span>
            </div>
            {toCompleteRows.length === 0 ? <div className="text-xs text-gray-400 px-1">No rows in this section.</div> : <ul className="space-y-2">{toCompleteRows.map(renderTaskRow)}</ul>}
          </section>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Completed</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{completedRows.length}</span>
            </div>
            {completedRows.length === 0 ? <div className="text-xs text-gray-400 px-1">No rows in this section.</div> : <ul className="space-y-2">{completedRows.map(renderTaskRow)}</ul>}
          </section>
        </div>
      )}
    </div>
  );
};

export default DailyTaskList;
