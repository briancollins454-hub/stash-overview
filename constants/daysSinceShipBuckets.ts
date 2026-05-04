/**
 * Shared "days since ship" bands for finance chase views (Unpaid Orders,
 * Shipped Not Invoiced). Keep labels aligned across pages.
 */
export type DaysSinceShipBucket =
  | 'all'
  | 'lt30'
  | '30-39'
  | '40-49'
  | '50-59'
  | '60-89'
  | 'ge90';

export const DAYS_SHIP_BUCKET_OPTIONS: { id: DaysSinceShipBucket; label: string }[] = [
  { id: 'all', label: 'All ages (days)' },
  { id: 'lt30', label: 'Under 30 days' },
  { id: '30-39', label: '30–39 days' },
  { id: '40-49', label: '40–49 days' },
  { id: '50-59', label: '50–59 days' },
  { id: '60-89', label: '60–89 days' },
  { id: 'ge90', label: '90+ days' },
];

export function matchesDaysSinceShipBucket(daysSince: number, bucket: DaysSinceShipBucket): boolean {
  if (bucket === 'all') return true;
  if (bucket === 'lt30') return daysSince < 30;
  if (bucket === '30-39') return daysSince >= 30 && daysSince <= 39;
  if (bucket === '40-49') return daysSince >= 40 && daysSince <= 49;
  if (bucket === '50-59') return daysSince >= 50 && daysSince <= 59;
  if (bucket === '60-89') return daysSince >= 60 && daysSince <= 89;
  if (bucket === 'ge90') return daysSince >= 90;
  return true;
}
