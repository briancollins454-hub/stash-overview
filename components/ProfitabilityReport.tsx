import React, { useMemo, useState } from 'react';
import { UnifiedOrder } from '../types';
import { PoundSterling, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Eye, AlertTriangle } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface ProfitLine {
  orderNumber: string;
  orderId: string;
  customer: string;
  club: string;
  revenue: number;
  decoCost: number | null;
  margin: number | null;
  marginPct: number | null;
  itemCount: number;
  status: string;
}

const ProfitabilityReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [sortBy, setSortBy] = useState<'margin' | 'revenue' | 'order'>('margin');
  const [showAll, setShowAll] = useState(false);
  const [filterNegative, setFilterNegative] = useState(false);

  const lines = useMemo<ProfitLine[]>(() => {
    return orders
      .map(o => {
        const revenue = parseFloat(o.shopify.totalPrice) || 0;
        // Try to estimate DecoNetwork cost from job data if available
        // DecoNetwork API doesn't always expose cost, so we'll flag as N/A when unavailable
        let decoCost: number | null = null;
        // If we have a Deco job linked, we can estimate based on item count
        // This is a placeholder — real cost would come from DecoNetwork's pricing API
        if (o.deco && o.deco.totalItems > 0) {
          // Rough estimate based on average decoration cost per item
          // In practice, this should come from DecoNetwork's job cost field
          decoCost = null; // We don't have actual cost data
        }
        return {
          orderNumber: o.shopify.orderNumber,
          orderId: o.shopify.id,
          customer: o.shopify.customerName,
          club: o.clubName || 'No Club',
          revenue,
          decoCost,
          margin: decoCost !== null ? revenue - decoCost : null,
          marginPct: decoCost !== null && revenue > 0 ? ((revenue - decoCost) / revenue) * 100 : null,
          itemCount: o.shopify.items.reduce((s, i) => s + i.quantity, 0),
          status: o.shopify.fulfillmentStatus,
        };
      })
      .sort((a, b) => {
        if (sortBy === 'margin') {
          if (a.margin === null) return 1;
          if (b.margin === null) return -1;
          return a.margin - b.margin;
        }
        if (sortBy === 'revenue') return b.revenue - a.revenue;
        return b.orderNumber.localeCompare(a.orderNumber);
      });
  }, [orders, sortBy]);

  const displayed = useMemo(() => {
    let result = lines;
    if (filterNegative) result = result.filter(l => l.margin !== null && l.margin < 0);
    return showAll ? result : result.slice(0, 25);
  }, [lines, showAll, filterNegative]);

  const totals = useMemo(() => {
    const totalRevenue = lines.reduce((s, l) => s + l.revenue, 0);
    const withCost = lines.filter(l => l.decoCost !== null);
    const totalCost = withCost.reduce((s, l) => s + (l.decoCost || 0), 0);
    const totalMargin = withCost.length > 0 ? totalRevenue - totalCost : null;
    return { totalRevenue, totalCost, totalMargin, orderCount: lines.length, withCostCount: withCost.length };
  }, [lines]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PoundSterling className="w-4 h-4 text-emerald-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Profitability Report</h3>
        </div>
        <div className="flex items-center gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="margin">Sort by Margin</option>
            <option value="revenue">Sort by Revenue</option>
            <option value="order">Sort by Order #</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-3 border-b border-gray-50 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Total Revenue</p>
          <p className="text-lg font-black text-gray-800">£{totals.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Orders</p>
          <p className="text-lg font-black text-gray-800">{totals.orderCount}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Avg Order Value</p>
          <p className="text-lg font-black text-gray-800">£{totals.orderCount > 0 ? (totals.totalRevenue / totals.orderCount).toFixed(2) : '0.00'}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Cost Data Available</p>
          <p className="text-lg font-black text-gray-800">{totals.withCostCount}/{totals.orderCount}</p>
          {totals.withCostCount === 0 && (
            <p className="text-[8px] text-amber-500 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> DecoNetwork doesn't expose cost data via API</p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Order</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Customer</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Club</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Items</th>
              <th className="px-4 py-2 text-right font-black uppercase tracking-widest text-gray-500">Revenue</th>
              <th className="px-4 py-2 text-right font-black uppercase tracking-widest text-gray-500">Cost</th>
              <th className="px-4 py-2 text-right font-black uppercase tracking-widest text-gray-500">Margin</th>
              <th className="px-4 py-2 text-right font-black uppercase tracking-widest text-gray-500">%</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(l => (
              <tr key={l.orderId} className="border-t border-gray-50 hover:bg-indigo-50/50 transition-colors cursor-pointer group" onClick={() => onNavigateToOrder?.(l.orderNumber)}>
                <td className="px-4 py-2 font-black text-gray-800 group-hover:text-indigo-600 transition-colors">#{l.orderNumber}</td>
                <td className="px-4 py-2 font-bold text-gray-600 truncate max-w-[120px]">{l.customer}</td>
                <td className="px-4 py-2 font-bold text-indigo-500">{l.club}</td>
                <td className="px-4 py-2 text-center font-bold text-gray-600">{l.itemCount}</td>
                <td className="px-4 py-2 text-right font-black text-gray-800">£{l.revenue.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-bold text-gray-500">{l.decoCost !== null ? `£${l.decoCost.toFixed(2)}` : '—'}</td>
                <td className={`px-4 py-2 text-right font-black ${l.margin !== null ? (l.margin >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-400'}`}>
                  {l.margin !== null ? (
                    <span className="flex items-center justify-end gap-1">
                      {l.margin >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      £{Math.abs(l.margin).toFixed(2)}
                    </span>
                  ) : '—'}
                </td>
                <td className={`px-4 py-2 text-right font-black ${l.marginPct !== null ? (l.marginPct >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-400'}`}>
                  {l.marginPct !== null ? `${l.marginPct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lines.length > 25 && (
        <div className="px-4 py-2 border-t border-gray-100 text-center">
          <button onClick={() => setShowAll(!showAll)} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest flex items-center gap-1 mx-auto">
            {showAll ? <><ChevronUp className="w-3 h-3" /> Show Less</> : <><ChevronDown className="w-3 h-3" /> Show All ({lines.length})</>}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProfitabilityReport;
