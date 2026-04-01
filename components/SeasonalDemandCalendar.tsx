import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { Calendar, TrendingUp, TrendingDown, BarChart3, ArrowRight } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type ViewMode = 'heatmap' | 'monthly' | 'dayOfWeek';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SeasonalDemandCalendar: React.FC<Props> = ({ orders }) => {
  const [view, setView] = useState<ViewMode>('heatmap');
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const { weeks, monthSummary, dowSummary, yearRange, peakMonth, quietMonth, peakDay, summary } = useMemo(() => {
    // Build daily buckets
    const dayMap = new Map<string, number>(); // 'YYYY-MM-DD' → count
    const monthMap = new Map<string, number>(); // 'YYYY-MM' → count
    const dowCounts = new Array(7).fill(0); // Mon–Sun
    const dowRevenue = new Array(7).fill(0);
    let minDate = new Date();
    let maxDate = new Date(0);

    for (const o of orders) {
      const d = new Date(o.shopify.date);
      if (isNaN(d.getTime())) continue;

      const dayKey = d.toISOString().slice(0, 10);
      dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);

      const monthKey = d.toISOString().slice(0, 7);
      monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);

      // JS getDay: 0=Sun, adjust to Mon=0
      const dow = (d.getDay() + 6) % 7;
      dowCounts[dow]++;
      dowRevenue[dow] += parseFloat(o.shopify.totalPrice) || 0;

      if (d < minDate) minDate = new Date(d);
      if (d > maxDate) maxDate = new Date(d);
    }

    // Build week-based heatmap grid (last 52 weeks)
    const now = new Date();
    const weeksToShow = 52;
    const weekData: Array<{ weekStart: Date; days: Array<{ date: string; count: number; dow: number }> }> = [];

    // Start from weeksToShow weeks ago, aligned to Monday
    const start = new Date(now);
    start.setDate(start.getDate() - (weeksToShow * 7) - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);

    const cursor = new Date(start);
    while (cursor <= now) {
      const week: { weekStart: Date; days: Array<{ date: string; count: number; dow: number }> } = {
        weekStart: new Date(cursor),
        days: []
      };
      for (let d = 0; d < 7; d++) {
        const dateKey = cursor.toISOString().slice(0, 10);
        const dow = (cursor.getDay() + 6) % 7;
        week.days.push({ date: dateKey, count: dayMap.get(dateKey) || 0, dow });
        cursor.setDate(cursor.getDate() + 1);
      }
      weekData.push(week);
    }

    // Monthly summary with year grouping
    const monthlyData: Array<{ key: string; month: number; year: number; count: number; label: string }> = [];
    for (const [key, count] of monthMap.entries()) {
      const [y, m] = key.split('-').map(Number);
      monthlyData.push({ key, month: m - 1, year: y, count, label: `${MONTH_NAMES[m - 1]} ${y}` });
    }
    monthlyData.sort((a, b) => a.key.localeCompare(b.key));

    // Month-of-year averages (across all years)
    const monthOfYearTotals = new Array(12).fill(0);
    const monthOfYearCounts = new Array(12).fill(0);
    for (const m of monthlyData) {
      monthOfYearTotals[m.month] += m.count;
      monthOfYearCounts[m.month]++;
    }
    const monthOfYearAvg = monthOfYearTotals.map((total, i) => monthOfYearCounts[i] > 0 ? Math.round(total / monthOfYearCounts[i]) : 0);

    // Peak/quiet month
    const peakMonthIdx = monthOfYearAvg.indexOf(Math.max(...monthOfYearAvg));
    const quietMonthIdx = monthOfYearAvg.indexOf(Math.min(...monthOfYearAvg.filter(v => v > 0)));

    // Peak day of week
    const peakDowIdx = dowCounts.indexOf(Math.max(...dowCounts));

    // Day of week summary
    const totalOrders = orders.length;
    const dowData = DAY_NAMES.map((name, i) => ({
      name,
      count: dowCounts[i],
      pct: totalOrders > 0 ? (dowCounts[i] / totalOrders) * 100 : 0,
      revenue: dowRevenue[i],
      avgRevenue: dowCounts[i] > 0 ? dowRevenue[i] / dowCounts[i] : 0,
    }));

    // Year-over-year comparison
    const years = [...new Set(monthlyData.map(m => m.year))].sort();

    return {
      weeks: weekData,
      monthSummary: { monthly: monthlyData, monthOfYearAvg, years },
      dowSummary: dowData,
      yearRange: { min: minDate, max: maxDate, years },
      peakMonth: MONTH_NAMES[peakMonthIdx],
      quietMonth: MONTH_NAMES[quietMonthIdx] || '—',
      peakDay: DAY_NAMES[peakDowIdx],
      summary: {
        totalOrders,
        avgPerDay: totalOrders > 0 ? (totalOrders / Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)))).toFixed(1) : '0',
        avgPerWeek: totalOrders > 0 ? Math.round(totalOrders / Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24 * 7)))) : 0,
      }
    };
  }, [orders]);

  // Color scale for heatmap
  const maxDaily = Math.max(...weeks.flatMap(w => w.days.map(d => d.count)), 1);

  const getCellColor = (count: number): string => {
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
    const intensity = count / maxDaily;
    if (intensity <= 0.25) return 'bg-emerald-200 dark:bg-emerald-900/60';
    if (intensity <= 0.5) return 'bg-emerald-400 dark:bg-emerald-700';
    if (intensity <= 0.75) return 'bg-emerald-500 dark:bg-emerald-600';
    return 'bg-emerald-700 dark:bg-emerald-400';
  };

  // Month labels for heatmap
  const monthLabels = useMemo(() => {
    const labels: Array<{ label: string; colIdx: number }> = [];
    let lastMonth = -1;
    weeks.forEach((w, i) => {
      const m = w.weekStart.getMonth();
      if (m !== lastMonth) {
        labels.push({ label: MONTH_NAMES[m], colIdx: i });
        lastMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  const maxMonthly = Math.max(...monthSummary.monthly.map(m => m.count), 1);
  const maxDow = Math.max(...dowSummary.map(d => d.count), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Seasonal Demand Calendar</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Order volume patterns over time</p>
            </div>
          </div>
          <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden">
            {([['heatmap', 'Heatmap'], ['monthly', 'Monthly'], ['dayOfWeek', 'Day of Week']] as [ViewMode, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? 'bg-amber-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-6">
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Total Orders</p>
          <p className="text-xl font-bold text-amber-900 dark:text-amber-100">{summary.totalOrders}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Avg / Day</p>
          <p className="text-xl font-bold text-blue-900 dark:text-blue-100">{summary.avgPerDay}</p>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Avg / Week</p>
          <p className="text-xl font-bold text-indigo-900 dark:text-indigo-100">{summary.avgPerWeek}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Peak Month</p>
          <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100">{peakMonth}</p>
        </div>
        <div className="bg-rose-50 dark:bg-rose-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">Busiest Day</p>
          <p className="text-xl font-bold text-rose-900 dark:text-rose-100">{peakDay}</p>
        </div>
      </div>

      {/* HEATMAP VIEW — GitHub contribution style */}
      {view === 'heatmap' && (
        <div className="px-6 pb-6">
          <div className="border dark:border-gray-700 rounded-xl p-4 overflow-x-auto">
            {/* Month labels */}
            <div className="flex mb-1" style={{ paddingLeft: '32px' }}>
              {monthLabels.map((ml, i) => {
                const nextCol = i < monthLabels.length - 1 ? monthLabels[i + 1].colIdx : weeks.length;
                const span = nextCol - ml.colIdx;
                return (
                  <div key={i} className="text-[10px] text-gray-400 dark:text-gray-500" style={{ width: `${span * 14}px`, minWidth: `${span * 14}px` }}>
                    {span >= 3 ? ml.label : ''}
                  </div>
                );
              })}
            </div>

            {/* Grid: rows = days of week, columns = weeks */}
            {[0, 1, 2, 3, 4, 5, 6].map(dow => (
              <div key={dow} className="flex items-center gap-0">
                <div className="w-8 text-[10px] text-gray-400 dark:text-gray-500 text-right pr-1 shrink-0">
                  {dow % 2 === 0 ? DAY_NAMES[dow] : ''}
                </div>
                <div className="flex gap-[2px]">
                  {weeks.map((w, wi) => {
                    const day = w.days.find(d => d.dow === dow);
                    if (!day) return <div key={wi} className="w-[11px] h-[11px]" />;
                    const today = new Date().toISOString().slice(0, 10);
                    const isFuture = day.date > today;
                    return (
                      <div key={wi}
                        className={`w-[11px] h-[11px] rounded-[2px] transition-all cursor-pointer hover:ring-1 hover:ring-gray-400
                          ${isFuture ? 'bg-transparent' : getCellColor(day.count)}
                          ${selectedCell === day.date ? 'ring-2 ring-amber-500' : ''}`}
                        title={`${day.date}: ${day.count} order${day.count !== 1 ? 's' : ''}`}
                        onClick={() => setSelectedCell(selectedCell === day.date ? null : day.date)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-3">
              <span className="text-[10px] text-gray-400">Less</span>
              <div className="w-[11px] h-[11px] rounded-[2px] bg-gray-100 dark:bg-gray-800" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-emerald-200 dark:bg-emerald-900/60" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-emerald-400 dark:bg-emerald-700" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-emerald-500 dark:bg-emerald-600" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-emerald-700 dark:bg-emerald-400" />
              <span className="text-[10px] text-gray-400">More</span>
            </div>

            {/* Selected cell detail */}
            {selectedCell && (
              <div className="mt-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-semibold">{new Date(selectedCell + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                  {' — '}
                  {(() => {
                    const count = weeks.flatMap(w => w.days).find(d => d.date === selectedCell)?.count || 0;
                    return <span className="font-bold text-amber-600 dark:text-amber-400">{count} order{count !== 1 ? 's' : ''}</span>;
                  })()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MONTHLY VIEW — Bar chart with year-over-year */}
      {view === 'monthly' && (
        <div className="px-6 pb-6 space-y-4">
          {/* Monthly average by month-of-year */}
          <div className="border dark:border-gray-700 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Average Orders by Month (All Years)</p>
            <div className="flex items-end gap-2" style={{ height: '140px' }}>
              {monthSummary.monthOfYearAvg.map((avg, i) => {
                const h = maxMonthly > 0 ? (avg / maxMonthly) * 100 : 0;
                const isMax = avg === Math.max(...monthSummary.monthOfYearAvg);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-gray-500 font-mono">{avg > 0 ? avg : ''}</span>
                    <div className={`w-full rounded-t transition-all ${isMax ? 'bg-amber-500 dark:bg-amber-400' : 'bg-amber-200 dark:bg-amber-800'}`}
                      style={{ height: `${h}%`, minHeight: avg > 0 ? '4px' : 0 }} />
                    <span className="text-[10px] text-gray-400">{MONTH_NAMES[i]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Year-over-year bars */}
          {yearRange.years.length > 1 && (
            <div className="border dark:border-gray-700 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Monthly Volume by Year</p>
              <div className="space-y-3">
                {yearRange.years.map(year => {
                  const yearMonths = monthSummary.monthly.filter(m => m.year === year);
                  const yearTotal = yearMonths.reduce((s, m) => s + m.count, 0);
                  return (
                    <div key={year}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{year}</span>
                        <span className="text-xs text-gray-500">{yearTotal} orders</span>
                      </div>
                      <div className="flex gap-1">
                        {Array.from({ length: 12 }, (_, m) => {
                          const data = yearMonths.find(ym => ym.month === m);
                          const count = data?.count || 0;
                          const intensity = maxMonthly > 0 ? count / maxMonthly : 0;
                          return (
                            <div key={m} className="flex-1 group relative">
                              <div className={`h-6 rounded transition-all ${count === 0 ? 'bg-gray-100 dark:bg-gray-800'
                                : intensity <= 0.25 ? 'bg-amber-200 dark:bg-amber-900/60'
                                : intensity <= 0.5 ? 'bg-amber-300 dark:bg-amber-700'
                                : intensity <= 0.75 ? 'bg-amber-400 dark:bg-amber-600'
                                : 'bg-amber-600 dark:bg-amber-400'}`}
                                title={`${MONTH_NAMES[m]} ${year}: ${count} orders`}
                              />
                              <span className="text-[9px] text-gray-400 text-center block mt-0.5">{MONTH_NAMES[m][0]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DAY OF WEEK VIEW */}
      {view === 'dayOfWeek' && (
        <div className="px-6 pb-6">
          <div className="border dark:border-gray-700 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-4">Orders by Day of Week</p>
            <div className="space-y-3">
              {dowSummary.map((d, i) => {
                const barW = maxDow > 0 ? (d.count / maxDow) * 100 : 0;
                const isPeak = d.count === Math.max(...dowSummary.map(x => x.count));
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-8 text-xs font-medium ${isPeak ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-gray-600 dark:text-gray-400'}`}>{d.name}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-6 overflow-hidden relative">
                      <div className={`h-full rounded-full transition-all ${isPeak ? 'bg-amber-500 dark:bg-amber-400' : 'bg-amber-200 dark:bg-amber-700'}`}
                        style={{ width: `${barW}%` }} />
                      <span className="absolute inset-0 flex items-center px-3 text-xs font-mono text-gray-700 dark:text-gray-200">
                        {d.count} orders ({d.pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="text-right w-20">
                      <p className="text-xs text-gray-500 dark:text-gray-400">avg £{d.avgRevenue.toFixed(0)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Insight */}
            <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <span className="font-semibold">{peakDay}</span> is the busiest day with {dowSummary.find(d => d.name === peakDay)?.pct.toFixed(1)}% of all orders. 
                Quietest day is <span className="font-semibold">{dowSummary.reduce((min, d) => d.count < min.count ? d : min, dowSummary[0]).name}</span> with {dowSummary.reduce((min, d) => d.count < min.count ? d : min, dowSummary[0]).pct.toFixed(1)}%.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SeasonalDemandCalendar;
