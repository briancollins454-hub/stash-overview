import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { AlertTriangle, Clock, Package, TrendingUp, ChevronDown, ChevronUp, Filter, Zap } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type Period = '30d' | '90d' | '365d' | 'all';
type GroupBy = 'vendor' | 'productType' | 'club';

interface GroupStats {
  name: string;
  orderCount: number;
  itemCount: number;
  avgDaysToShip: number;
  medianDaysToShip: number;
  maxDaysToShip: number;
  avgCompletionPct: number;
  overdueCount: number;
  totalDaysSum: number;
  allDays: number[];
  slowOrders: Array<{ orderNumber: string; customerName: string; days: number; status: string }>;
}

const BottleneckReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('90d');
  const [groupBy, setGroupBy] = useState<GroupBy>('vendor');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showActive, setShowActive] = useState(true);

  const periodDays: Record<Period, number> = { '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const { groups, summary } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);

    const relevantOrders = orders.filter(o => {
      const orderDate = new Date(o.shopify.date);
      if (orderDate < cutoff) return false;
      if (showActive) {
        return o.shopify.fulfillmentStatus !== 'fulfilled' && o.shopify.fulfillmentStatus !== 'restocked';
      }
      return true;
    });

    const groupMap = new Map<string, GroupStats>();

    let totalDays = 0;
    let totalOrders = 0;
    let totalOverdue = 0;
    let totalItems = 0;

    for (const o of relevantOrders) {
      const now = new Date();
      const orderDate = new Date(o.shopify.date);
      const shipDate = o.shipStationTracking?.shipDate ? new Date(o.shipStationTracking.shipDate) : null;
      const endDate = shipDate || now;
      const daysToShip = Math.max(0, Math.round((endDate.getTime() - orderDate.getTime()) / 86400000));

      const isOverdue = o.daysRemaining < 0;

      // Group items by the selected dimension
      const itemGroups = new Map<string, number>();
      for (const item of o.shopify.items) {
        let key: string;
        if (groupBy === 'vendor') key = item.vendor || 'Unknown Vendor';
        else if (groupBy === 'productType') key = item.productType || item.name?.split(' - ')[0] || 'Unknown Type';
        else key = o.clubName || 'No Club';

        itemGroups.set(key, (itemGroups.get(key) || 0) + item.quantity);
      }

      // If no items matched, use a fallback group
      if (itemGroups.size === 0) {
        const fallback = groupBy === 'club' ? (o.clubName || 'No Club') : 'Unknown';
        itemGroups.set(fallback, o.shopify.items.reduce((s, i) => s + i.quantity, 0));
      }

      for (const [name, qty] of itemGroups) {
        if (!groupMap.has(name)) {
          groupMap.set(name, {
            name, orderCount: 0, itemCount: 0,
            avgDaysToShip: 0, medianDaysToShip: 0, maxDaysToShip: 0,
            avgCompletionPct: 0, overdueCount: 0, totalDaysSum: 0,
            allDays: [], slowOrders: []
          });
        }
        const g = groupMap.get(name)!;
        g.orderCount++;
        g.itemCount += qty;
        g.totalDaysSum += daysToShip;
        g.allDays.push(daysToShip);
        if (daysToShip > g.maxDaysToShip) g.maxDaysToShip = daysToShip;
        if (isOverdue) g.overdueCount++;
        g.avgCompletionPct = ((g.avgCompletionPct * (g.orderCount - 1)) + o.completionPercentage) / g.orderCount;

        // Track slowest orders
        g.slowOrders.push({
          orderNumber: o.shopify.orderNumber,
          customerName: o.shopify.customerName,
          days: daysToShip,
          status: o.shopify.fulfillmentStatus
        });
      }

      totalDays += daysToShip;
      totalOrders++;
      if (isOverdue) totalOverdue++;
      totalItems += o.shopify.items.reduce((s, i) => s + i.quantity, 0);
    }

    // Finalize stats
    const result: GroupStats[] = [];
    for (const g of groupMap.values()) {
      g.avgDaysToShip = g.orderCount > 0 ? g.totalDaysSum / g.orderCount : 0;
      g.allDays.sort((a, b) => a - b);
      g.medianDaysToShip = g.allDays.length > 0 ? g.allDays[Math.floor(g.allDays.length / 2)] : 0;
      g.slowOrders.sort((a, b) => b.days - a.days);
      g.slowOrders = g.slowOrders.slice(0, 10);
      result.push(g);
    }

    // Sort by avg days descending (slowest first)
    result.sort((a, b) => b.avgDaysToShip - a.avgDaysToShip);

    return {
      groups: result,
      summary: {
        totalOrders, totalItems, totalOverdue,
        avgDays: totalOrders > 0 ? totalDays / totalOrders : 0,
      }
    };
  }, [orders, period, groupBy, showActive]);

  const maxAvgDays = Math.max(...groups.map(g => g.avgDaysToShip), 1);

  const getDaysColor = (days: number) => {
    if (days <= 5) return 'text-emerald-400';
    if (days <= 10) return 'text-amber-400';
    if (days <= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  const getBarColor = (days: number) => {
    if (days <= 5) return 'bg-emerald-500/60';
    if (days <= 10) return 'bg-amber-500/60';
    if (days <= 20) return 'bg-orange-500/60';
    return 'bg-red-500/60';
  };

  if (groups.length === 0) {
    return (
      <div className="bg-[#0d1117] rounded-2xl border border-white/10 p-6">
        <h2 className="text-sm font-black text-white flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-amber-400" /> Production Bottleneck Analysis</h2>
        <p className="text-[10px] text-gray-500">No orders in this period</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] rounded-2xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm font-black text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Production Bottleneck Analysis</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Active/All toggle */}
          <button onClick={() => setShowActive(!showActive)}
            className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider border transition-all ${showActive ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-white/5 text-gray-500 border-white/10'}`}>
            {showActive ? 'Active Only' : 'All Orders'}
          </button>
          {/* Group by */}
          <div className="flex bg-white/5 rounded-lg overflow-hidden border border-white/10">
            {(['vendor', 'productType', 'club'] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)}
                className={`px-2 py-1 text-[8px] font-black uppercase tracking-wider transition-all ${groupBy === g ? 'bg-purple-500/20 text-purple-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {g === 'productType' ? 'Type' : g === 'club' ? 'Club' : 'Vendor'}
              </button>
            ))}
          </div>
          {/* Period */}
          <div className="flex bg-white/5 rounded-lg overflow-hidden border border-white/10">
            {(['30d', '90d', '365d', 'all'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2 py-1 text-[8px] font-black uppercase tracking-wider transition-all ${period === p ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {p === 'all' ? 'ALL' : p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Orders Analysed</p>
          <p className="text-lg font-black text-white">{summary.totalOrders.toLocaleString()}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Total Items</p>
          <p className="text-lg font-black text-white">{summary.totalItems.toLocaleString()}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Avg Days to Ship</p>
          <p className={`text-lg font-black ${getDaysColor(summary.avgDays)}`}>{summary.avgDays.toFixed(1)}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Overdue</p>
          <p className={`text-lg font-black ${summary.totalOverdue > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{summary.totalOverdue}</p>
        </div>
      </div>

      {/* Group Rows — sorted slowest first */}
      <div className="space-y-2">
        <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">
          Grouped by {groupBy === 'productType' ? 'Product Type' : groupBy === 'club' ? 'Club/Team' : 'Vendor'} — Slowest First
        </p>
        {groups.map(g => {
          const isExpanded = expandedGroup === g.name;
          return (
            <div key={g.name} className="bg-white/[0.03] rounded-xl border border-white/10 overflow-hidden">
              <div
                onClick={() => setExpandedGroup(isExpanded ? null : g.name)}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-white/[0.03] transition-all"
              >
                <Package className="w-4 h-4 text-purple-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-black text-white truncate">{g.name}</span>
                    <span className="text-[9px] font-bold text-gray-500">{g.orderCount} order{g.orderCount !== 1 ? 's' : ''} · {g.itemCount} items</span>
                    {g.overdueCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-[8px] font-black text-red-400 flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" /> {g.overdueCount} overdue
                      </span>
                    )}
                  </div>
                  {/* Severity bar */}
                  <div className="mt-1.5 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${getBarColor(g.avgDaysToShip)}`}
                      style={{ width: `${Math.min(100, (g.avgDaysToShip / maxAvgDays) * 100)}%` }} />
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase text-gray-500">Avg Days</p>
                    <p className={`text-[11px] font-black ${getDaysColor(g.avgDaysToShip)}`}>{g.avgDaysToShip.toFixed(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase text-gray-500">Median</p>
                    <p className={`text-[11px] font-black ${getDaysColor(g.medianDaysToShip)}`}>{g.medianDaysToShip}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase text-gray-500">Max</p>
                    <p className={`text-[11px] font-black ${getDaysColor(g.maxDaysToShip)}`}>{g.maxDaysToShip}</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-[8px] font-black uppercase text-gray-500">Completion</p>
                    <p className={`text-[11px] font-black ${g.avgCompletionPct >= 80 ? 'text-emerald-400' : g.avgCompletionPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                      {g.avgCompletionPct.toFixed(0)}%
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-white/10 p-4 space-y-3">
                  {/* Day distribution */}
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-2">Days Distribution</p>
                    <div className="flex items-end gap-0.5 h-12">
                      {(() => {
                        const buckets = [0, 0, 0, 0, 0]; // 0-3, 4-7, 8-14, 15-21, 22+
                        const labels = ['0-3d', '4-7d', '8-14d', '15-21d', '22d+'];
                        for (const d of g.allDays) {
                          if (d <= 3) buckets[0]++;
                          else if (d <= 7) buckets[1]++;
                          else if (d <= 14) buckets[2]++;
                          else if (d <= 21) buckets[3]++;
                          else buckets[4]++;
                        }
                        const maxB = Math.max(...buckets, 1);
                        const colors = ['bg-emerald-500', 'bg-emerald-500/70', 'bg-amber-500', 'bg-orange-500', 'bg-red-500'];
                        return buckets.map((b, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                            <span className="text-[7px] font-bold text-gray-500">{b}</span>
                            <div className={`w-full rounded-t ${colors[i]}`} style={{ height: `${Math.max(2, (b / maxB) * 40)}px` }} />
                            <span className="text-[6px] font-bold text-gray-600">{labels[i]}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* Slowest orders */}
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-2">Slowest Orders</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {g.slowOrders.map((so, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[10px] py-1 border-b border-white/5">
                          <button onClick={() => onNavigateToOrder?.(so.orderNumber)} className="text-indigo-300 hover:text-indigo-200 font-bold">
                            #{so.orderNumber}
                          </button>
                          <span className="text-gray-500">{so.customerName}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${so.status === 'fulfilled' ? 'bg-emerald-500/20 text-emerald-400' : so.status === 'partial' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400'}`}>
                            {so.status}
                          </span>
                          <span className={`font-black ${getDaysColor(so.days)}`}>{so.days}d</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BottleneckReport;
