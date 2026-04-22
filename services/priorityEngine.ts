import type { DecoJob } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────
export const pd = (d?: string) => (d ? new Date(d) : null);
export const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / 86400000);

// ── Types ──────────────────────────────────────────────────────────────────
export interface PriorityThreshold { days: number; score: number; label: string }
export interface PriorityRule { status: string; metric: 'days_since_ordered' | 'days_overdue' | 'days_until_due'; thresholds: PriorityThreshold[] }
export type Urgency = 'critical' | 'high' | 'medium' | 'low';
export interface PriorityResult { job: DecoJob; score: number; matchedRules: string[]; reason: string; urgency: Urgency }

// ── Priority Rules (single source of truth) ────────────────────────────────
// Thresholds are checked top-down; first match wins per status.
export const PRIORITY_RULES: PriorityRule[] = [
  { status: 'Not Ordered', metric: 'days_since_ordered', thresholds: [
    { days: 10, score: 100, label: 'PO 10d+ wait' },
    { days: 7,  score: 70,  label: 'PO 7d+ wait' },
    { days: 5,  score: 50,  label: 'PO 5d+ wait' },
    { days: 3,  score: 30,  label: 'PO 3d+ wait' },
  ]},
  { status: 'Awaiting Stock', metric: 'days_until_due', thresholds: [
    { days: -7, score: 90, label: 'Stock 7d+ overdue' },
    { days: -5, score: 60, label: 'Stock 5d+ overdue' },
    { days: -3, score: 35, label: 'Stock 3d+ overdue' },
    { days: 3,  score: 20, label: 'Stock ships in 3d' },
  ]},
  { status: 'Awaiting Processing', metric: 'days_until_due', thresholds: [
    { days: -7, score: 90, label: 'Process 7d+ overdue' },
    { days: -5, score: 60, label: 'Process 5d+ overdue' },
    { days: -3, score: 35, label: 'Process 3d+ overdue' },
    { days: 3,  score: 20, label: 'Process ships in 3d' },
  ]},
  { status: 'Ready for Shipping', metric: 'days_overdue', thresholds: [
    { days: 10, score: 80, label: 'Ship 10d+ delay' },
    { days: 5,  score: 50, label: 'Ship 5d+ delay' },
    { days: 3,  score: 30, label: 'Ship 3d+ delay' },
  ]},
  { status: 'Completed', metric: 'days_overdue', thresholds: [
    { days: 10, score: 80, label: 'Collect 10d+ delay' },
    { days: 5,  score: 50, label: 'Collect 5d+ delay' },
    { days: 3,  score: 30, label: 'Collect 3d+ delay' },
  ]},
];

export const BONUS_RULES = {
  highValue: { threshold: 1000, score: 15, label: 'High value' },
  medValue:  { threshold: 500,  score: 10, label: 'Mid value' },
  balance:   { score: 15, label: 'Balance owed' },
  stale:     { days: 30,  score: 25, label: 'Stale 30d+' },
};

const BLOCKED = new Set(['Not Ordered', 'Awaiting Processing', 'Awaiting Artwork', 'Awaiting Review', 'On Hold', 'Awaiting Stock']);
const PRODUCING = new Set(['In Production', 'Ready for Shipping', 'Completed']);

// ── Scoring function ───────────────────────────────────────────────────────
export function calculatePriority(job: DecoJob, now: Date): PriorityResult {
  let score = 0;
  const matchedRules: string[] = [];
  const status = job.status || '';
  const due = pd(job.dateDue) || pd(job.productionDueDate);
  const ordered = pd(job.dateOrdered);
  const val = job.orderTotal || job.billableAmount || 0;

  // Status-specific rules
  const rule = PRIORITY_RULES.find(r => r.status === status);
  if (rule) {
    let metricDays: number | null = null;
    if (rule.metric === 'days_since_ordered' && ordered) {
      metricDays = daysBetween(ordered, now);
    } else if (rule.metric === 'days_overdue' && due) {
      const d = daysBetween(due, now);
      if (d > 0) metricDays = d;
    } else if (rule.metric === 'days_until_due' && due) {
      // Negative = overdue, positive = days remaining
      metricDays = daysBetween(now, due);
    }
    if (metricDays !== null) {
      for (const t of rule.thresholds) {
        // For days_until_due: threshold is negative for overdue (metricDays <= threshold), positive for approaching (metricDays <= threshold)
        if (rule.metric === 'days_until_due') {
          if (metricDays <= t.days) { score += t.score; matchedRules.push(t.label); break; }
        } else {
          if (metricDays >= t.days) { score += t.score; matchedRules.push(t.label); break; }
        }
      }
    }
  }

  // Generic overdue / due-soon for statuses without specific rules
  if (!rule && due) {
    const t0d = new Date(now); t0d.setHours(0, 0, 0, 0);
    const eod = new Date(t0d); eod.setHours(23, 59, 59, 999);
    const in48 = new Date(t0d); in48.setDate(t0d.getDate() + 2); in48.setHours(23, 59, 59, 999);
    if (due < t0d) {
      const dl = daysBetween(due, now);
      score += dl > 30 ? 100 : dl > 14 ? 70 : dl > 7 ? 50 : 30;
      matchedRules.push(`${dl}d overdue`);
    } else if (due <= eod) { score += 60; matchedRules.push('Due today'); }
    else if (due <= in48) { score += 40; matchedRules.push('Due in 48h'); }
  }

  // Bonus modifiers
  if (val >= BONUS_RULES.highValue.threshold) { score += BONUS_RULES.highValue.score; matchedRules.push(BONUS_RULES.highValue.label); }
  else if (val >= BONUS_RULES.medValue.threshold) { score += BONUS_RULES.medValue.score; matchedRules.push(BONUS_RULES.medValue.label); }
  if (PRODUCING.has(status) && (job.outstandingBalance || 0) > 0) { score += BONUS_RULES.balance.score; matchedRules.push(BONUS_RULES.balance.label); }
  if (ordered && daysBetween(ordered, now) > BONUS_RULES.stale.days && BLOCKED.has(status)) { score += BONUS_RULES.stale.score; matchedRules.push(BONUS_RULES.stale.label); }

  const reason = matchedRules[0] || (BLOCKED.has(status) ? 'Blocked' : 'Review');
  const urgency: Urgency = score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { job, score, matchedRules, reason, urgency };
}

// ── Urgency styling ────────────────────────────────────────────────────────
export const URGENCY_STYLE: Record<Urgency, { dot: string; pill: string; pulse: string; border: string; bg: string; text: string }> = {
  critical: { dot: 'bg-red-500/20 text-red-400',      pill: 'bg-red-500/10 text-red-400',      pulse: ' animate-pulse', border: 'border-red-500/30',    bg: 'bg-red-500/5',     text: 'text-red-400' },
  high:     { dot: 'bg-orange-500/20 text-orange-400', pill: 'bg-orange-500/10 text-orange-400', pulse: '',               border: 'border-orange-500/20', bg: 'bg-orange-500/5',  text: 'text-orange-400' },
  medium:   { dot: 'bg-amber-500/20 text-amber-400',   pill: 'bg-amber-500/10 text-amber-400',   pulse: '',               border: 'border-amber-500/20',  bg: 'bg-amber-500/5',   text: 'text-amber-400' },
  low:      { dot: 'bg-blue-500/20 text-blue-400',     pill: 'bg-blue-500/10 text-blue-400',     pulse: '',               border: 'border-blue-500/20',   bg: 'bg-blue-500/5',    text: 'text-blue-400' },
};

// ── Section definitions for the Priority Board ─────────────────────────────
export interface PrioritySection {
  key: string;
  title: string;
  subtitle: string;
  statuses: string[];
  icon: string;
  color: string;
  /** What metric the time-frame filter uses for this section */
  filterMetric: 'days_since_ordered' | 'days_until_due' | 'days_past_due' | 'days_since_ready';
  /** Column header for the "Days" column in the table */
  daysLabel: string;
}

export const PRIORITY_SECTIONS: PrioritySection[] = [
  { key: 'po',         title: 'Awaiting PO',         subtitle: 'Purchase orders not yet raised — blocks everything',   statuses: ['Not Ordered'],                     icon: '📋', color: 'rose',   filterMetric: 'days_since_ordered', daysLabel: 'Waiting' },
  { key: 'stock',      title: 'Awaiting Stock',       subtitle: 'Garments or materials not yet available',              statuses: ['Awaiting Stock'],                  icon: '📦', color: 'amber',  filterMetric: 'days_until_due',     daysLabel: 'Ship By' },
  { key: 'processing', title: 'Awaiting Processing',  subtitle: 'Orders pending production pickup',                    statuses: ['Awaiting Processing'],             icon: '⚙️', color: 'blue',   filterMetric: 'days_until_due',     daysLabel: 'Ship By' },
  { key: 'shipping',   title: 'Awaiting Shipping',    subtitle: 'Production complete — ready to dispatch or collect',  statuses: ['Ready for Shipping', 'Completed'], icon: '🚚', color: 'green',  filterMetric: 'days_since_ready',   daysLabel: 'Waiting' },
];
