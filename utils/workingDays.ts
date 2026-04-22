/**
 * Working-day arithmetic.
 * ------------------------
 * A "working day" is any day that is not Saturday, not Sunday, and
 * does not fall inside a business-closure range configured in
 * Settings → Business Closures (`apiSettings.holidayRanges`).
 *
 * These helpers are intentionally pure and side-effect free — all
 * date work is done with local-time `Date` objects so the displayed
 * day matches the user's screen. If we ever need to render in a
 * specific timezone this is the one file to audit.
 */

import type { HolidayRange } from '../components/SettingsModal';

/** Parse a YYYY-MM-DD string to a local-midnight Date. Safer than
 *  `new Date('2026-05-01')` which is interpreted as UTC and can shift
 *  the day by one for users west of GMT. */
function parseYmdLocal(ymd: string): Date | null {
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** True when `d` is Sat or Sun. */
function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/** True when `d` falls within any configured closure range (inclusive). */
function isWithinClosure(d: Date, ranges?: HolidayRange[]): boolean {
  if (!ranges || ranges.length === 0) return false;
  const t = d.getTime();
  for (const r of ranges) {
    const start = parseYmdLocal(r.start);
    const end = parseYmdLocal(r.end);
    if (!start || !end) continue;
    // Make the comparison inclusive on both ends, so a single-day
    // closure with start==end still matches that day.
    end.setHours(23, 59, 59, 999);
    if (t >= start.getTime() && t <= end.getTime()) return true;
  }
  return false;
}

export function isWorkingDay(d: Date, ranges?: HolidayRange[]): boolean {
  return !isWeekend(d) && !isWithinClosure(d, ranges);
}

/**
 * Advance `start` by `businessDays` working days and return the date.
 * Day 0 is the earliest working day on or after `start` — i.e. if you
 * ask for 0 working days and today is Saturday, you get Monday. For
 * the "X working days from today" label we pass today, so we use the
 * convention that day 1 is the first working day strictly after today.
 *
 * Guard: loop caps at 3650 iterations (~10 years) so a mis-configured
 * closure range that covers every day cannot hang the browser.
 */
export function addWorkingDays(
  start: Date,
  businessDays: number,
  ranges?: HolidayRange[]
): Date {
  const date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (!Number.isFinite(businessDays) || businessDays <= 0) return date;

  let added = 0;
  let safety = 0;
  while (added < businessDays && safety < 3650) {
    date.setDate(date.getDate() + 1);
    if (isWorkingDay(date, ranges)) added++;
    safety++;
  }
  return date;
}

/** Count closure days between `from` (inclusive) and `to` (inclusive)
 *  that actually fall on a weekday — useful for "excl. weekends + N
 *  closure days" labels where we don't want to double-count a closure
 *  that landed on a Saturday. */
export function countWeekdayClosuresBetween(
  from: Date,
  to: Date,
  ranges?: HolidayRange[]
): number {
  if (!ranges || ranges.length === 0) return 0;
  if (to.getTime() < from.getTime()) return 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let count = 0;
  let safety = 0;
  while (cursor.getTime() <= end.getTime() && safety < 3650) {
    if (!isWeekend(cursor) && isWithinClosure(cursor, ranges)) count++;
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  return count;
}
