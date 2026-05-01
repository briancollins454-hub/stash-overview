import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, CheckSquare, ClipboardList, ExternalLink, Loader2, Plus, RefreshCw,
  Sparkles, Trash2, AlertTriangle,
} from 'lucide-react';
import type { DecoJob } from '../types';
import { isSupabaseReady, supabaseFetch } from '../services/supabase';
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
  manual: 'Manual',
  priority: 'Priority',
  finance_sni: 'Finance',
  finance_credit: 'Finance',
  finance_unpaid: 'Finance',
  production_issues: 'Issues',
};

function tabForTask(row: DailyTaskRow): string {
  return TAB_FOR_SOURCE[row.source_page] || 'dashboard';
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
      setError('Supabase isn\'t configured.');
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
    } catch (e: any) {
      setError(e?.message || 'Couldn\'t load tasks');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [taskDate]);

  useEffect(() => { load(); }, [load]);

  const nextSortOrder = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.max(...rows.map(r => r.sort_order)) + 1;
  }, [rows]);

  /** Highest-pressure work first: live job scores, then finance, issues, manual. */
  const displayRows = useMemo(() => {
    const base = hideDone ? rows.filter(r => !r.completed) : [...rows];
    return sortDailyTaskRowsForDisplay(base, decoJobs);
  }, [rows, hideDone, decoJobs]);

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

      const post = async (payload: Record<string, unknown>) => {
        try {
          await supabaseFetch('stash_daily_tasks', 'POST', payload);
          imported++;
        } catch {
          /* duplicate key / RLS */
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
    <div className="max-w-3xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-gray-900 dark:text-white">Daily task list</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Rows sort automatically: hottest Deco jobs first (same engine as the priority board), then credit / unpaid / invoicing checks, then the issue log, then your manual lines.
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
          placeholder="Add a task…"
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
          {displayRows.map(row => (
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
                    <span className={`text-sm font-semibold ${row.completed ? 'line-through text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                      {row.title}
                    </span>
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
                          Order
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
          ))}
        </ul>
      )}
    </div>
  );
};

export default DailyTaskList;
