import type { DecoJob } from '../types';
import { calculatePriority } from './priorityEngine';
import { isDecoJobCancelled } from './decoJobFilters';

export interface AiDailyTaskSuggestion {
  sourceRef: string;
  jobNumber: string;
  title: string;
  reason: string;
  score: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysFromNow(d: Date, now: Date): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

function compactStatus(job: DecoJob): string {
  return (job.status || 'unknown').toLowerCase().trim();
}

export function buildAiDailyTaskSuggestions(jobs: DecoJob[], limit = 12): AiDailyTaskSuggestion[] {
  const now = new Date();
  const out: AiDailyTaskSuggestion[] = [];

  for (const job of jobs) {
    if (!job?.jobNumber) continue;
    if (isDecoJobCancelled(job)) continue;
    if (compactStatus(job) === 'shipped') continue;

    const pr = calculatePriority(job, now);
    const dueDate = parseIsoDate(job.dateDue || job.productionDueDate);
    const orderedDate = parseIsoDate(job.dateOrdered);
    const dueInDays = dueDate ? daysFromNow(dueDate, now) : null;
    const ageDays = orderedDate ? Math.max(0, -daysFromNow(orderedDate, now)) : null;
    const status = compactStatus(job);

    let score = pr.score;
    const reasons: string[] = [];

    // Strict mode: only chase overdue jobs.
    if (dueInDays == null || dueInDays >= 0) continue;
    score += 50;
    reasons.push(`overdue by ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? '' : 's'}`);

    if (ageDays != null) {
      if (ageDays >= 30) {
        score += 18;
        reasons.push(`order age ${ageDays} days`);
      } else if (ageDays >= 20) {
        score += 10;
        reasons.push(`aging at ${ageDays} days`);
      }
    }

    if (/(hold|waiting|artwork|proof)/i.test(status)) {
      score += 14;
      reasons.push(`stuck in "${job.status || 'unknown'}"`);
    }

    if (job.outstandingBalance != null && job.outstandingBalance > 0) {
      score += 8;
      reasons.push(`outstanding balance £${Math.round(job.outstandingBalance)}`);
    }

    if (pr.urgency === 'critical') score += 12;
    else if (pr.urgency === 'high') score += 6;

    if (reasons.length === 0 && score < 95) continue;

    const shortReason = reasons.slice(0, 3).join(' · ') || `priority score ${pr.score} (${pr.urgency})`;
    const who = (job.customerName || 'Customer').trim();
    out.push({
      sourceRef: `job:${job.jobNumber}`,
      jobNumber: String(job.jobNumber),
      title: `AI: Chase #${job.jobNumber} · ${who}`,
      reason: `AI scan: ${shortReason}.`,
      score,
    });
  }

  out.sort((a, b) => b.score - a.score || a.jobNumber.localeCompare(b.jobNumber));
  return out.slice(0, Math.max(1, limit));
}

