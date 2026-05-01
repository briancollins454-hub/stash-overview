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
 * Top N highest-scoring active priority jobs for importing into the daily list.
 */
export function buildPriorityImportSuggestions(jobs: DecoJob[], limit = 20): PrioritySuggestion[] {
  const now = new Date();
  const active = activePriorityJobs(jobs);
  const covered = new Set(PRIORITY_SECTIONS.flatMap((s: PrioritySection) => s.statuses));

  const scored = active
    .map(j => ({ job: j, pr: calculatePriority(j, now) }))
    .filter(({ job }) => covered.has(job.status || ''));

  scored.sort((a, b) => {
    if (b.pr.score !== a.pr.score) return b.pr.score - a.pr.score;
    const da = new Date(a.job.dateOrdered || 0).getTime();
    const db = new Date(b.job.dateOrdered || 0).getTime();
    return da - db;
  });

  const out: PrioritySuggestion[] = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    const { job, pr } = scored[i];
    const sec = PRIORITY_SECTIONS.find(s => s.statuses.includes(job.status || ''));
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

/** Static finance-tab reminders (one row each when imported). */
export const FINANCE_CHECKLIST_SUGGESTIONS: ReadonlyArray<{
  source_page: string;
  source_ref: string;
  title: string;
  tab: string;
}> = [
  { source_page: 'finance_sni', source_ref: 'open_tab', title: 'Review: Shipped not invoiced', tab: 'shipped-not-invoiced' },
  { source_page: 'finance_credit', source_ref: 'open_tab', title: 'Review: Credit block list', tab: 'credit-block' },
  { source_page: 'finance_unpaid', source_ref: 'open_tab', title: 'Review: Unpaid orders', tab: 'unpaid-orders' },
];

export const PRODUCTION_ISSUES_SUGGESTION = {
  source_page: 'production_issues',
  source_ref: 'open_tab',
  title: 'Review: Production issue log (open items)',
  tab: 'issues',
} as const;
