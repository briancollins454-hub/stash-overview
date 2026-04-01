import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { Flame, Clock, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type Period = '30d' | '90d' | '365d' | 'all';

interface WeekBucket {
  weekLabel: string;
  weekStart: Date;
  ordered: number;
  received: number;
  produced: number;
  shipped: number;
  avgDaysToShip: number | null;
  orderNumbers: string[];
}

const ProductionVelocityReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('90d');
  const [metric, setMetric] = useState<'throughput' | 'speed'>('throughput');

  const periodDays: Record<Period, number> = { '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const { weeks, summary, hasData } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);
    const now = new Date();

    // Build weekly buckets
    const weekMap = new Map<string, WeekBucket>();

    const getWeekKey = (d: Date): string => {
      const start = new Date(d);
      start.setDate(start.getDate() - start.getDay() + 1); // Monday
      start.setHours(0, 0, 0, 0);
      return start.toISOString().slice(0, 10);
    };

    const getWeekLabel = (key: string): string => {
      const d = new Date(key);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };

    for (const o of orders) {
      if (!o.deco) continue;
      const orderDate = new Date(o.shopify.date);
      if (orderDate < cutoff) continue;

      const weekKey = getWeekKey(orderDate);
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, {
          weekLabel: getWeekLabel(weekKey),
          weekStart: new Date(weekKey),
          ordered: 0, received: 0, produced: 0, shipped: 0,
          avgDaysToShip: null, orderNumbers: []
        });
      }

      const w = weekMap.get(weekKey)!;
      const totalItems = o.deco.items.length;
      const receivedItems = o.deco.items.filter(i => i.isReceived).length;
      const producedItems = o.deco.items.filter(i => i.isProduced).length;
      const shippedItems = o.deco.items.filter(i => i.isShipped).length;

      w.ordered += totalItems;
      w.received += receivedItems;
      w.produced += producedItems;
      w.shipped += shippedItems;
      w.orderNumbers.push(o.shopify.orderNumber);
    }

    // Calculate avg days to ship per week
    for (const o of orders) {
      if (!o.deco?.dateShipped || !o.deco.dateOrdered) continue;
      const orderDate = new Date(o.deco.dateOrdered);
      if (orderDate < cutoff) continue;

      const weekKey = getWeekKey(orderDate);
      const w = weekMap.get(weekKey);
      if (!w) continue;

      const days = Math.round((new Date(o.deco.dateShipped).getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
      if (w.avgDaysToShip === null) w.avgDaysToShip = days;
      else w.avgDaysToShip = Math.round((w.avgDaysToShip + days) / 2);
    }

    const weekList = Array.from(weekMap.values()).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

    const totalOrdered = weekList.reduce((s, w) => s + w.ordered, 0);
    const totalProduced = weekList.reduce((s, w) => s + w.produced, 0);
    const totalShipped = weekList.reduce((s, w) => s + w.shipped, 0);
    const avgWeeklyThroughput = weekList.length > 0 ? Math.round(totalProduced / weekList.length) : 0;

    // Velocity trend: compare last 4 weeks vs previous 4
    const recentWeeks = weekList.slice(-4);
    const prevWeeks = weekList.slice(-8, -4);
    const recentAvg = recentWeeks.length > 0 ? recentWeeks.reduce((s, w) => s + w.produced, 0) / recentWeeks.length : 0;
    const prevAvg = prevWeeks.length > 0 ? prevWeeks.reduce((s, w) => s + w.produced, 0) / prevWeeks.length : 0;
    const velocityTrend = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg) * 100 : 0;

    return {
      weeks: weekList,
      summary: { totalOrdered, totalProduced, totalShipped, avgWeeklyThroughput, velocityTrend },
      hasData: weekList.length > 0
    };
  }, [orders, period]);

  const maxVal = Math.max(...weeks.map(w => metric === 'throughput' ? Math.max(w.ordered, w.produced, w.shipped) : (w.avgDaysToShip || 0)), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
              <Flame className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Production Velocity</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Weekly throughput &amp; speed trends</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select value={metric} onChange={e => setMetric(e.target.value as any)}
              className="text-xs border rounded-lg px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">
              <option value="throughput">View: Throughput</option>
              <option value="speed">View: Speed (days)</option>
            </select>
            <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden">
              {(['30d','90d','365d','all'] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-rose-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <Flame className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No production data available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Velocity chart appears when DecoNetwork orders are tracked over time</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
            <div className="bg-rose-50 dark:bg-rose-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-rose-900 dark:text-rose-100">{summary.totalOrdered}</p>
              <p className="text-xs text-rose-600 dark:text-rose-400">Items Ordered</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{summary.totalProduced}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">Items Produced</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{summary.avgWeeklyThroughput}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Avg/Week</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${summary.velocityTrend >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
              <div className="flex items-center justify-center gap-1">
                {summary.velocityTrend >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
                <p className={`text-2xl font-bold ${summary.velocityTrend >= 0 ? 'text-emerald-900 dark:text-emerald-100' : 'text-red-900 dark:text-red-100'}`}>
                  {summary.velocityTrend > 0 ? '+' : ''}{summary.velocityTrend.toFixed(0)}%
                </p>
              </div>
              <p className={`text-xs ${summary.velocityTrend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>vs prev 4 weeks</p>
            </div>
          </div>

          {/* Bar Chart */}
          <div className="px-6 pb-6">
            <div className="border dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-end gap-1" style={{ height: '200px' }}>
                {weeks.map((w, i) => {
                  if (metric === 'throughput') {
                    const oH = (w.ordered / maxVal) * 100;
                    const pH = (w.produced / maxVal) * 100;
                    const sH = (w.shipped / maxVal) * 100;
                    return (
                      <div key={i} className="flex-1 flex items-end gap-px" title={`W/C ${w.weekLabel}: ${w.ordered} ordered, ${w.produced} produced, ${w.shipped} shipped`}>
                        <div className="flex-1 bg-rose-200 dark:bg-rose-800 rounded-t transition-all" style={{ height: `${oH}%`, minHeight: w.ordered > 0 ? '4px' : 0 }} />
                        <div className="flex-1 bg-blue-400 dark:bg-blue-600 rounded-t transition-all" style={{ height: `${pH}%`, minHeight: w.produced > 0 ? '4px' : 0 }} />
                        <div className="flex-1 bg-emerald-400 dark:bg-emerald-600 rounded-t transition-all" style={{ height: `${sH}%`, minHeight: w.shipped > 0 ? '4px' : 0 }} />
                      </div>
                    );
                  } else {
                    const h = ((w.avgDaysToShip || 0) / maxVal) * 100;
                    return (
                      <div key={i} className="flex-1 flex items-end" title={`W/C ${w.weekLabel}: ${w.avgDaysToShip ?? '—'}d avg`}>
                        <div className={`w-full rounded-t transition-all ${(w.avgDaysToShip || 0) > 14 ? 'bg-red-400' : (w.avgDaysToShip || 0) > 7 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ height: `${h}%`, minHeight: (w.avgDaysToShip || 0) > 0 ? '4px' : 0 }} />
                      </div>
                    );
                  }
                })}
              </div>
              {/* Week labels */}
              <div className="flex gap-1 mt-2">
                {weeks.map((w, i) => (
                  <div key={i} className="flex-1 text-center text-[10px] text-gray-400 truncate">{w.weekLabel}</div>
                ))}
              </div>
              {/* Legend */}
              {metric === 'throughput' && (
                <div className="flex items-center justify-center gap-4 mt-3">
                  <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-3 bg-rose-200 dark:bg-rose-800 rounded" /> Ordered</span>
                  <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-3 bg-blue-400 dark:bg-blue-600 rounded" /> Produced</span>
                  <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-3 bg-emerald-400 dark:bg-emerald-600 rounded" /> Shipped</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ProductionVelocityReport;
