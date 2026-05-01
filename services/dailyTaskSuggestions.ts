import type { DecoJob } from '../types';
import { calculatePriority, PRIORITY_SECTIONS, type PrioritySection } from './priorityEngine';

const isCancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';

/** Active jobs the Priority Board would show (non-shipped, non-cancelled). */
export function activePriorityJobs(jobs: DecoJob[]): DecoJob[] {
  return jobs.filter(j => {
    if (isCancelled(j)) return false;
    const st = (j.status || '').toLowerCase();
    return st !== 'shipped';
  });
}

export interface PrioritySuggestion {
  jobNumber: string;
  title: string;
  sectionKey: string;
  sectionTitle: string;
  urgency: string;
  score: number;
}

/**
 * Top N highest-scoring active (non-shipped) jobs for the daily list — same scorer as
 * the priority board, but includes every open status (artwork, on hold, etc.), not
 * only the four board columns.
 */
export function buildPriorityImportSuggestions(jobs: DecoJob[], limit = 20): PrioritySuggestion[] {
  const now = new Date();
  const active = activePriorityJobs(jobs);

  const scored = active.map(j => ({ job: j, pr: calculatePriority(j, now) }));

  scored.sort((a, b) => {
    if (b.pr.score !== a.pr.score) return b.pr.score - a.pr.score;
    const ua = a.pr.urgency;
    const ub = b.pr.urgency;
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    const oa = order[ua] ?? 99;
    const ob = order[ub] ?? 99;
    if (oa !== ob) return oa - ob;
    const da = new Date(a.job.dateOrdered || 0).getTime();
    const db = new Date(b.job.dateOrdered || 0).getTime();
    return da - db;
  });

  const out: PrioritySuggestion[] = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    const { job, pr } = scored[i];
    const sec = PRIORITY_SECTIONS.find((s: PrioritySection) => s.statuses.includes(job.status || ''));
    const sectionTitle = sec?.title || job.status || 'Priority';
    out.push({
      jobNumber: job.jobNumber,
      title: `#${job.jobNumber} · ${job.customerName || 'Job'} — ${sectionTitle} (${pr.urgency})`,
      sectionKey: sec?.key || 'other',
      sectionTitle,
      urgency: pr.urgency,
      score: pr.score,
    });
  }
  return out;
}

/** Static finance-tab reminders (one row each when imported). Order = business priority. */
export const FINANCE_CHECKLIST_SUGGESTIONS: ReadonlyArray<{
  source_page: string;
  source_ref: string;
  title: string;
  tab: string;
}> = [
  { source_page: 'finance_credit', source_ref: 'open_tab', title: 'Review: Credit block list', tab: 'credit-block' },
  { source_page: 'finance_unpaid', source_ref: 'open_tab', title: 'Review: Unpaid orders', tab: 'unpaid-orders' },
  { source_page: 'finance_sni', source_ref: 'open_tab', title: 'Review: Shipped not invoiced', tab: 'shipped-not-invoiced' },
];

export const PRODUCTION_ISSUES_SUGGESTION = {
  source_page: 'production_issues',
  source_ref: 'open_tab',
  title: 'Review: Production issue log (open items)',
  tab: 'issues',
} as const;

/** Finance rows: credit risk first, then cash collection, then invoicing. */
const FINANCE_ORDER: Record<string, number> = {
  finance_credit: 0,
  finance_unpaid: 1,
  finance_sni: 2,
};

const URGENCY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Display order for the daily list: live Deco priority (highest score first),
 * then finance checks, production-issue reminder, then manual tasks.
 * Stale priority rows (job no longer in data) sink to the bottom of the job block.
 */
export function sortDailyTaskRowsForDisplay<
  T extends { id: number; source_page: string; source_ref: string | null; sort_order: number },
>(rows: T[], decoJobs: DecoJob[], now: Date = new Date()): T[] {
  const byJobNum = new Map(decoJobs.map(j => [String(j.jobNumber), j]));

  const tier = (r: T): number => {
    if (r.source_page === 'priority') return 0;
    if (r.source_page in FINANCE_ORDER) return 1;
    if (r.source_page === 'production_issues') return 2;
    if (r.source_page === 'manual') return 3;
    return 4;
  };

  const priorityScore = (r: T): number => {
    if (r.source_page !== 'priority' || !r.source_ref) return 0;
    const job = byJobNum.get(String(r.source_ref));
    if (!job) return -1_000_000;
    return calculatePriority(job, now).score;
  };

  const priorityUrgency = (r: T): number => {
    if (r.source_page !== 'priority' || !r.source_ref) return 99;
    const job = byJobNum.get(String(r.source_ref));
    if (!job) return 99;
    const u = calculatePriority(job, now).urgency;
    return URGENCY_ORDER[u] ?? 99;
  };

  const priorityOrderDate = (r: T): number => {
    if (r.source_page !== 'priority' || !r.source_ref) return 0;
    const job = byJobNum.get(String(r.source_ref));
    return job ? new Date(job.dateOrdered || 0).getTime() : 0;
  };

  return [...rows].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;

    if (ta === 0) {
      const sa = priorityScore(a);
      const sb = priorityScore(b);
      if (sb !== sa) return sb - sa;
      const ua = priorityUrgency(a);
      const ub = priorityUrgency(b);
      if (ua !== ub) return ua - ub;
      const oa = priorityOrderDate(a);
      const ob = priorityOrderDate(b);
      if (oa !== ob) return oa - ob;
      return a.id - b.id;
    }

    if (ta === 1) {
      const fa = FINANCE_ORDER[a.source_page] ?? 99;
      const fb = FINANCE_ORDER[b.source_page] ?? 99;
      if (fa !== fb) return fa - fb;
      return a.sort_order - b.sort_order || a.id - b.id;
    }

    return a.sort_order - b.sort_order || a.id - b.id;
  });
}
