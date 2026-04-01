import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { LineChart, TrendingUp, TrendingDown, AlertTriangle, Calendar, Target } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type Period = '30d' | '90d' | '365d' | 'all';

interface WeekCapacity {
  weekLabel: string;
  weekStart: Date;
  ordersIn: number;
  ordersOut: number; // fulfilled
  backlog: number;
  avgCycleTime: number | null;
}

const CapacityForecast: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('90d');

  const periodDays: Record<Period, number> = { '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const { weeks, forecast, summary, hasData } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);
    const now = new Date();

    const getWeekKey = (d: Date): string => {
      const start = new Date(d);
      start.setDate(start.getDate() - start.getDay() + 1);
      start.setHours(0, 0, 0, 0);
      return start.toISOString().slice(0, 10);
    };

    const getWeekLabel = (key: string): string => {
      const d = new Date(key);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };

    const weekMap = new Map<string, WeekCapacity>();
    const cycleTimes: number[] = [];

    for (const o of orders) {
      const orderDate = new Date(o.shopify.date);
      if (orderDate < cutoff) continue;

      // Orders in
      const inKey = getWeekKey(orderDate);
      if (!weekMap.has(inKey)) {
        weekMap.set(inKey, { weekLabel: getWeekLabel(inKey), weekStart: new Date(inKey), ordersIn: 0, ordersOut: 0, backlog: 0, avgCycleTime: null });
      }
      weekMap.get(inKey)!.ordersIn++;

      // Orders out (fulfilled)
      if (o.shopify.fulfillmentStatus === 'fulfilled' && o.fulfillmentDate) {
        const shipDate = new Date(o.fulfillmentDate);
        const outKey = getWeekKey(shipDate);
        if (!weekMap.has(outKey)) {
          weekMap.set(outKey, { weekLabel: getWeekLabel(outKey), weekStart: new Date(outKey), ordersIn: 0, ordersOut: 0, backlog: 0, avgCycleTime: null });
        }
        weekMap.get(outKey)!.ordersOut++;

        // Cycle time
        const cycle = Math.max(0, Math.round((shipDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24)));
        cycleTimes.push(cycle);
      } else if (o.deco?.dateShipped) {
        const shipDate = new Date(o.deco.dateShipped);
        const outKey = getWeekKey(shipDate);
        if (!weekMap.has(outKey)) {
          weekMap.set(outKey, { weekLabel: getWeekLabel(outKey), weekStart: new Date(outKey), ordersIn: 0, ordersOut: 0, backlog: 0, avgCycleTime: null });
        }
        weekMap.get(outKey)!.ordersOut++;

        const cycle = Math.max(0, Math.round((shipDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24)));
        cycleTimes.push(cycle);
      }
    }

    const weekList = Array.from(weekMap.values()).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

    // Calculate running backlog
    let backlog = 0;
    for (const w of weekList) {
      backlog += w.ordersIn - w.ordersOut;
      w.backlog = Math.max(0, backlog);
    }

    // Calculate avg cycle time per week
    const avgCycleTime = cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((s, c) => s + c, 0) / cycleTimes.length) : null;
    const medianCycleTime = cycleTimes.length > 0 ? cycleTimes.sort((a, b) => a - b)[Math.floor(cycleTimes.length / 2)] : null;

    // Forecast: avg weekly in/out for last 4 weeks
    const last4 = weekList.slice(-4);
    const avgIn = last4.length > 0 ? Math.round(last4.reduce((s, w) => s + w.ordersIn, 0) / last4.length) : 0;
    const avgOut = last4.length > 0 ? Math.round(last4.reduce((s, w) => s + w.ordersOut, 0) / last4.length) : 0;
    const currentBacklog = weekList.length > 0 ? weekList[weekList.length - 1].backlog : 0;

    // Weeks to clear backlog at current rate
    const netCapacity = avgOut - avgIn;
    const weeksToClear = netCapacity > 0 && currentBacklog > 0 ? Math.ceil(currentBacklog / netCapacity) : currentBacklog > 0 ? null : 0;

    // Capacity utilisation
    const utilisation = avgOut > 0 ? Math.round((avgIn / avgOut) * 100) : 0;

    // Trend
    const prev4 = weekList.slice(-8, -4);
    const prevAvgOut = prev4.length > 0 ? prev4.reduce((s, w) => s + w.ordersOut, 0) / prev4.length : 0;
    const outputTrend = prevAvgOut > 0 ? ((avgOut - prevAvgOut) / prevAvgOut) * 100 : 0;

    return {
      weeks: weekList,
      forecast: { avgIn, avgOut, currentBacklog, weeksToClear, utilisation, outputTrend },
      summary: { avgCycleTime, medianCycleTime, totalIn: weekList.reduce((s, w) => s + w.ordersIn, 0), totalOut: weekList.reduce((s, w) => s + w.ordersOut, 0) },
      hasData: weekList.length > 0
    };
  }, [orders, period]);

  const maxVal = Math.max(...weeks.map(w => Math.max(w.ordersIn, w.ordersOut, w.backlog)), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
              <LineChart className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Production Capacity Forecast</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Order intake vs output · Backlog &amp; cycle time analysis</p>
            </div>
          </div>
          <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden">
            {(['30d','90d','365d','all'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-sky-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                {p === 'all' ? 'All' : p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <LineChart className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No capacity data available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Capacity analysis appears when there is historical order data</p>
        </div>
      ) : (
        <>
          {/* Forecast Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
            <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-4">
              <p className="text-xs text-sky-600 dark:text-sky-400 font-medium">Avg Weekly In</p>
              <p className="text-2xl font-bold text-sky-900 dark:text-sky-100">{forecast.avgIn}</p>
              <p className="text-xs text-sky-500 mt-1">orders/wk</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Avg Weekly Out</p>
              <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{forecast.avgOut}</p>
              <div className="flex items-center gap-1 mt-1">
                {forecast.outputTrend >= 0 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-red-500" />}
                <p className={`text-xs ${forecast.outputTrend >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{forecast.outputTrend > 0 ? '+' : ''}{forecast.outputTrend.toFixed(0)}%</p>
              </div>
            </div>
            <div className={`rounded-xl p-4 ${forecast.currentBacklog > 10 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <p className={`text-xs font-medium ${forecast.currentBacklog > 10 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Current Backlog</p>
              <p className={`text-2xl font-bold ${forecast.currentBacklog > 10 ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100'}`}>{forecast.currentBacklog}</p>
              <p className={`text-xs mt-1 ${forecast.currentBacklog > 10 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {forecast.weeksToClear === 0 ? 'Clear' : forecast.weeksToClear === null ? 'Growing' : `~${forecast.weeksToClear}wk to clear`}
              </p>
            </div>
            <div className={`rounded-xl p-4 ${forecast.utilisation > 100 ? 'bg-red-50 dark:bg-red-900/20' : forecast.utilisation > 80 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <p className={`text-xs font-medium ${forecast.utilisation > 100 ? 'text-red-600' : forecast.utilisation > 80 ? 'text-amber-600' : 'text-emerald-600'}`}>Utilisation</p>
              <p className={`text-2xl font-bold ${forecast.utilisation > 100 ? 'text-red-900 dark:text-red-100' : forecast.utilisation > 80 ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100'}`}>{forecast.utilisation}%</p>
              <p className={`text-xs mt-1 ${forecast.utilisation > 100 ? 'text-red-500' : forecast.utilisation > 80 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {forecast.utilisation > 100 ? 'Over capacity' : forecast.utilisation > 80 ? 'Near capacity' : 'Healthy'}
              </p>
            </div>
          </div>

          {/* Cycle Time */}
          <div className="px-6">
            <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-900/30 rounded-xl px-4 py-3">
              <Calendar className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Avg Cycle Time (order → ship)</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{summary.avgCycleTime ?? '—'} days</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-gray-500 dark:text-gray-400">Median</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{summary.medianCycleTime ?? '—'} days</p>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="px-6 py-6">
            <div className="border dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-end gap-1" style={{ height: '180px' }}>
                {weeks.map((w, i) => {
                  const inH = (w.ordersIn / maxVal) * 100;
                  const outH = (w.ordersOut / maxVal) * 100;
                  const blH = (w.backlog / maxVal) * 100;
                  return (
                    <div key={i} className="flex-1 flex items-end gap-px" title={`W/C ${w.weekLabel}: ${w.ordersIn} in, ${w.ordersOut} out, ${w.backlog} backlog`}>
                      <div className="flex-1 bg-sky-300 dark:bg-sky-700 rounded-t transition-all" style={{ height: `${inH}%`, minHeight: w.ordersIn > 0 ? '3px' : 0 }} />
                      <div className="flex-1 bg-emerald-400 dark:bg-emerald-600 rounded-t transition-all" style={{ height: `${outH}%`, minHeight: w.ordersOut > 0 ? '3px' : 0 }} />
                      <div className="flex-1 bg-amber-300 dark:bg-amber-700 rounded-t transition-all" style={{ height: `${blH}%`, minHeight: w.backlog > 0 ? '3px' : 0 }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1 mt-2">
                {weeks.map((w, i) => (
                  <div key={i} className="flex-1 text-center text-[10px] text-gray-400 truncate">{w.weekLabel}</div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-3">
                <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-3 bg-sky-300 dark:bg-sky-700 rounded" /> In</span>
                <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-3 bg-emerald-400 dark:bg-emerald-600 rounded" /> Out</span>
                <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-3 bg-amber-300 dark:bg-amber-700 rounded" /> Backlog</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CapacityForecast;
