import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, ChevronDown, ChevronUp, BarChart3, Filter } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type Period = '30d' | '90d' | '365d' | 'all';

interface OrderCost {
  orderNumber: string;
  customerName: string;
  shopifyRevenue: number;
  decoCost: number;
  shippingCost: number;
  profit: number;
  margin: number;
  itemCount: number;
  discrepancies: Array<{ item: string; shopifyPrice: number; decoPrice: number; diff: number }>;
  date: string;
}

const TrueCostReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('90d');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'margin' | 'profit' | 'revenue' | 'discrepancy'>('margin');
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);

  const periodDays: Record<Period, number> = { '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const { costData, summary } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);

    const results: OrderCost[] = [];

    for (const o of orders) {
      const orderDate = new Date(o.shopify.date);
      if (orderDate < cutoff) continue;
      if (!o.deco) continue;

      const shopifyRevenue = parseFloat(o.shopify.totalPrice) || 0;
      const decoCost = o.deco.orderTotal ?? o.deco.orderSubtotal ?? 0;
      const shippingCost = o.shipStationTracking?.shippingCost ?? (parseFloat(o.shopify.shippingCost || '0'));
      const profit = shopifyRevenue - decoCost - shippingCost;
      const margin = shopifyRevenue > 0 ? (profit / shopifyRevenue) * 100 : 0;

      // Find price discrepancies between Shopify and Deco items
      const discrepancies: OrderCost['discrepancies'] = [];
      for (const si of o.shopify.items) {
        const shopifyPrice = parseFloat(si.price || '0') * si.quantity;
        // Try to find a matching Deco item
        const matchedDeco = o.deco.items.find(di =>
          di.productCode === si.sku || di.name.toLowerCase().includes(si.name.toLowerCase().slice(0, 15))
        );
        if (matchedDeco?.totalPrice != null && shopifyPrice > 0) {
          const diff = Math.abs(shopifyPrice - matchedDeco.totalPrice);
          if (diff > 0.50) { // Only flag >50p differences
            discrepancies.push({
              item: si.name,
              shopifyPrice,
              decoPrice: matchedDeco.totalPrice,
              diff: shopifyPrice - matchedDeco.totalPrice
            });
          }
        }
      }

      results.push({
        orderNumber: o.shopify.orderNumber,
        customerName: o.shopify.customerName,
        shopifyRevenue,
        decoCost,
        shippingCost,
        profit,
        margin,
        itemCount: o.shopify.items.length,
        discrepancies,
        date: o.shopify.date,
      });
    }

    // Sort
    results.sort((a, b) => {
      if (sortBy === 'margin') return a.margin - b.margin;
      if (sortBy === 'profit') return a.profit - b.profit;
      if (sortBy === 'revenue') return b.shopifyRevenue - a.shopifyRevenue;
      if (sortBy === 'discrepancy') return b.discrepancies.length - a.discrepancies.length;
      return 0;
    });

    const filtered = showOnlyDiscrepancies ? results.filter(r => r.discrepancies.length > 0) : results;

    const totalRevenue = results.reduce((s, r) => s + r.shopifyRevenue, 0);
    const totalCost = results.reduce((s, r) => s + r.decoCost, 0);
    const totalShipping = results.reduce((s, r) => s + r.shippingCost, 0);
    const totalProfit = results.reduce((s, r) => s + r.profit, 0);
    const avgMargin = results.length > 0 ? results.reduce((s, r) => s + r.margin, 0) / results.length : 0;
    const unprofitable = results.filter(r => r.profit < 0).length;
    const discrepancyCount = results.filter(r => r.discrepancies.length > 0).length;

    return {
      costData: filtered,
      summary: { totalRevenue, totalCost, totalShipping, totalProfit, avgMargin, unprofitable, discrepancyCount, total: results.length }
    };
  }, [orders, period, sortBy, showOnlyDiscrepancies]);

  const fmt = (n: number) => `£${n.toFixed(2)}`;
  const hasCostData = costData.some(c => c.decoCost > 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">True Cost &amp; Profitability</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Deco costs vs Shopify revenue · Price discrepancy alerts</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={showOnlyDiscrepancies} onChange={e => setShowOnlyDiscrepancies(e.target.checked)} className="rounded" />
              <AlertTriangle className="w-3 h-3" /> Discrepancies only
            </label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="text-xs border rounded-lg px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">
              <option value="margin">Sort: Margin ↑</option>
              <option value="profit">Sort: Profit ↑</option>
              <option value="revenue">Sort: Revenue ↓</option>
              <option value="discrepancy">Sort: Discrepancies</option>
            </select>
            <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden">
              {(['30d','90d','365d','all'] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!hasCostData ? (
        <div className="p-12 text-center">
          <DollarSign className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No cost data available yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Cost data appears when DecoNetwork orders include pricing fields</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Total Revenue</p>
              <p className="text-xl font-bold text-blue-900 dark:text-blue-100">{fmt(summary.totalRevenue)}</p>
              <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">{summary.total} orders</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4">
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Total Deco Cost</p>
              <p className="text-xl font-bold text-amber-900 dark:text-amber-100">{fmt(summary.totalCost)}</p>
              <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">+ {fmt(summary.totalShipping)} shipping</p>
            </div>
            <div className={`rounded-xl p-4 ${summary.totalProfit >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
              <p className={`text-xs font-medium ${summary.totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>Net Profit</p>
              <p className={`text-xl font-bold ${summary.totalProfit >= 0 ? 'text-emerald-900 dark:text-emerald-100' : 'text-red-900 dark:text-red-100'}`}>{fmt(summary.totalProfit)}</p>
              <p className={`text-xs mt-1 ${summary.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>Avg margin: {summary.avgMargin.toFixed(1)}%</p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">Alerts</p>
              <p className="text-xl font-bold text-red-900 dark:text-red-100">{summary.unprofitable}</p>
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">unprofitable · {summary.discrepancyCount} price gaps</p>
            </div>
          </div>

          {/* Order Rows */}
          <div className="px-6 pb-6">
            <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                <span>Order</span><span>Revenue</span><span>Deco Cost</span><span>Profit</span><span>Margin</span><span></span>
              </div>
              {costData.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No matching orders</div>
              ) : costData.slice(0, 50).map(row => (
                <div key={row.orderNumber} className="border-t dark:border-gray-700">
                  <button onClick={() => setExpandedOrder(expandedOrder === row.orderNumber ? null : row.orderNumber)}
                    className="w-full grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors items-center text-left">
                    <div>
                      <button onClick={e => { e.stopPropagation(); onNavigateToOrder?.(row.orderNumber); }}
                        className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline text-sm">#{row.orderNumber}</button>
                      <span className="text-xs text-gray-400 ml-2">{row.customerName}</span>
                      {row.discrepancies.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> {row.discrepancies.length} price gap{row.discrepancies.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">{fmt(row.shopifyRevenue)}</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">{fmt(row.decoCost)}</span>
                    <span className={`text-sm font-mono font-semibold ${row.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {row.profit >= 0 ? '+' : ''}{fmt(row.profit)}
                    </span>
                    <span className={`text-sm font-mono ${row.margin >= 20 ? 'text-emerald-600' : row.margin >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                      {row.margin.toFixed(1)}%
                    </span>
                    {expandedOrder === row.orderNumber ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>

                  {expandedOrder === row.orderNumber && (
                    <div className="px-4 pb-4 bg-gray-50/50 dark:bg-gray-900/30">
                      <div className="grid grid-cols-3 gap-4 text-xs mb-3">
                        <div><span className="text-gray-500 dark:text-gray-400">Shipping Cost:</span> <span className="font-medium text-gray-700 dark:text-gray-300">{fmt(row.shippingCost)}</span></div>
                        <div><span className="text-gray-500 dark:text-gray-400">Items:</span> <span className="font-medium text-gray-700 dark:text-gray-300">{row.itemCount}</span></div>
                        <div><span className="text-gray-500 dark:text-gray-400">Date:</span> <span className="font-medium text-gray-700 dark:text-gray-300">{new Date(row.date).toLocaleDateString('en-GB')}</span></div>
                      </div>
                      {row.discrepancies.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Price Discrepancies</p>
                          <div className="space-y-1">
                            {row.discrepancies.map((d, i) => (
                              <div key={i} className="flex justify-between text-xs bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-1.5">
                                <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]">{d.item}</span>
                                <div className="flex gap-4">
                                  <span className="text-gray-500">Shopify: {fmt(d.shopifyPrice)}</span>
                                  <span className="text-gray-500">Deco: {fmt(d.decoPrice)}</span>
                                  <span className={`font-semibold ${d.diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.diff > 0 ? '+' : ''}{fmt(d.diff)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TrueCostReport;
