/**
 * WorkingDaysPlanner
 * ------------------
 * A small, read-only row that shows the date that falls 15 and 20
 * working days after today. "Working day" excludes Saturdays, Sundays,
 * and any closure range configured in Settings → Business Closures.
 *
 * Used on the main dashboard to give staff an at-a-glance view of the
 * standard production-horizon dates without having to count on the
 * calendar.
 */

import React, { useMemo } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import type { HolidayRange } from './SettingsModal';
import { addWorkingDays, countWeekdayClosuresBetween } from '../utils/workingDays';

interface Props {
  holidayRanges?: HolidayRange[];
  /** Override "today" — exposed for tests / storybook. Defaults to now. */
  today?: Date;
  /** Working-day milestones to display. Defaults to [15, 20]. */
  milestones?: number[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatShort(d: Date): string {
  // e.g. "Wed 14 May" — compact, unambiguous, no ambiguity about DD/MM vs MM/DD.
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function formatFull(d: Date): string {
  // e.g. "Wed 14 May 2026" for the tooltip.
  return `${formatShort(d)} ${d.getFullYear()}`;
}

const WorkingDaysPlanner: React.FC<Props> = ({ holidayRanges, today, milestones }) => {
  const list = milestones && milestones.length > 0 ? milestones : [15, 20];

  const { start, rows, footnote } = useMemo(() => {
    const now = today ? new Date(today) : new Date();
    // Normalise to local midnight so the label doesn't flicker across
    // time zones and isn't affected by the time of day.
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const rows = list.map(n => {
      const date = addWorkingDays(start, n, holidayRanges);
      const closuresHit = countWeekdayClosuresBetween(
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1),
        date,
        holidayRanges
      );
      return { n, date, closuresHit };
    });

    const totalClosuresConsidered = rows.length > 0 ? rows[rows.length - 1].closuresHit : 0;
    const footnote = totalClosuresConsidered > 0
      ? `Excludes weekends + ${totalClosuresConsidered} closure day${totalClosuresConsidered === 1 ? '' : 's'} in range`
      : 'Excludes Sat & Sun';

    return { start, rows, footnote };
  }, [today, holidayRanges, list.join('|')]);

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
        <CalendarClock className="w-3.5 h-3.5 text-indigo-500" />
        Planning Horizon
      </div>
      <span className="text-[10px] text-gray-400 font-bold">
        from {formatShort(start)}
      </span>
      <div className="h-4 w-px bg-gray-200" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        {rows.map(r => (
          <div
            key={r.n}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg"
            title={`${r.n} working days from ${formatFull(start)} = ${formatFull(r.date)}${r.closuresHit > 0 ? ` (skipped ${r.closuresHit} closure day${r.closuresHit === 1 ? '' : 's'})` : ''}`}
          >
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
              {r.n} Working Days
            </span>
            <span className="text-[11px] font-black text-gray-900">
              {formatShort(r.date)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-gray-400 ml-auto">
        <Info className="w-3 h-3" />
        {footnote}
      </div>
    </div>
  );
};

export default WorkingDaysPlanner;
