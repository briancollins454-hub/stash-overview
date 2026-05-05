import type { DecoJob } from '../types';

/**
 * Merge finance-wide cache (IndexedDB `stash_finance_jobs` or Supabase
 * `stash_finance_cache` rows) with live main-sync `decoJobs` from the app.
 *
 * One row per `jobNumber`. When both sources have the same order, **deco wins**
 * so status, balances, line items, and staff assignments match the last
 * dashboard Deco pull — avoids duplicate rows keyed by different `id`
 * (internal order_id vs order_number) and stale finance-only copies.
 */
export function mergeFinanceAndDecoJobs(
  financeJobs: DecoJob[] | null | undefined,
  decoJobs: DecoJob[] | null | undefined,
): DecoJob[] {
  const fin = financeJobs ?? [];
  const deco = decoJobs ?? [];
  if (fin.length === 0) return deco.slice();
  if (deco.length === 0) return fin.slice();
  const byNum = new Map<string, DecoJob>();
  for (const j of fin) {
    if (j.jobNumber) byNum.set(j.jobNumber, j);
  }
  for (const j of deco) {
    if (j.jobNumber) byNum.set(j.jobNumber, j);
  }
  return Array.from(byNum.values());
}

/**
 * Merge cloud `stash_deco_jobs` rows into a job map **without overwriting**
 * keys that already exist. Supabase often holds older snapshots; applying
 * every cloud row with `set(jobNumber, job)` was stomping fresher IndexedDB
 * (and tail-refreshed) rows on each sync before the API layer ran.
 */
export function mergeCloudDecoFillOnly(jobMap: Map<string, DecoJob>, cloudJobs: DecoJob[]): void {
  for (const j of cloudJobs) {
    if (j.jobNumber && !jobMap.has(j.jobNumber)) jobMap.set(j.jobNumber, j);
  }
}
