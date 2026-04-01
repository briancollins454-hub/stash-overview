import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { Factory, ChevronDown, ChevronUp, Clock, Package, AlertTriangle, TrendingUp } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type Period = '30d' | '90d' | '365d' | 'all';

interface SupplierStats {
  name: string;
  supplierId: string;
  totalItems: number;
  receivedItems: number;
  avgLeadDays: number | null;
  minLeadDays: number | null;
  maxLeadDays: number | null;
  pendingItems: number;
  products: Map<string, number>;
  recentOrders: Array<{ orderNumber: string; itemName: string; leadDays: number | null; received: boolean; dueDate?: string }>;
}

const SupplierLeadTimeReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('90d');
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'leadTime' | 'volume' | 'pending'>('leadTime');

  const periodDays: Record<Period, number> = { '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const { suppliers, summary, hasData } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);
    const map = new Map<string, SupplierStats>();

    for (const o of orders) {
      if (!o.deco?.items) continue;
      const orderDate = new Date(o.shopify.date);
      if (orderDate < cutoff) continue;

      for (const item of o.deco.items) {
        // Use supplier info from item, or fall back to Shopify vendor
        const supplierName = item.supplierName || item.vendorSku?.split('-')[0] ||
          o.shopify.items.find(si => si.sku === item.productCode)?.vendor || 'Unknown';
        const supplierId = item.supplierId || supplierName;

        if (!map.has(supplierId)) {
          map.set(supplierId, {
            name: supplierName, supplierId, totalItems: 0, receivedItems: 0,
            avgLeadDays: null, minLeadDays: null, maxLeadDays: null, pendingItems: 0,
            products: new Map(), recentOrders: []
          });
        }

        const s = map.get(supplierId)!;
        s.totalItems++;
        if (item.isReceived) s.receivedItems++;
        else s.pendingItems++;

        // Track product variety
        const pCode = item.productCode || item.name;
        s.products.set(pCode, (s.products.get(pCode) || 0) + 1);

        // Calculate lead time (order date → received — proxy using procurement status)
        let leadDays: number | null = null;
        if (item.isReceived && o.deco.dateOrdered) {
          const ordered = new Date(o.deco.dateOrdered);
          // Approx: if item is received, estimate lead from order date to production due
          const received = o.deco.dateShipped ? new Date(o.deco.dateShipped) : new Date();
          leadDays = Math.max(0, Math.round((received.getTime() - ordered.getTime()) / (1000 * 60 * 60 * 24)));
        }

        if (leadDays !== null) {
          if (s.minLeadDays === null || leadDays < s.minLeadDays) s.minLeadDays = leadDays;
          if (s.maxLeadDays === null || leadDays > s.maxLeadDays) s.maxLeadDays = leadDays;
        }

        s.recentOrders.push({
          orderNumber: o.shopify.orderNumber,
          itemName: item.name,
          leadDays,
          received: item.isReceived,
          dueDate: o.deco.dateDue
        });
      }
    }

    // Calculate averages
    for (const s of map.values()) {
      const withLead = s.recentOrders.filter(r => r.leadDays !== null);
      if (withLead.length > 0) {
        s.avgLeadDays = Math.round(withLead.reduce((sum, r) => sum + (r.leadDays || 0), 0) / withLead.length);
      }
    }

    const supplierList = Array.from(map.values())
      .filter(s => s.totalItems > 0)
      .sort((a, b) => {
        if (sortBy === 'leadTime') return (b.avgLeadDays ?? 999) - (a.avgLeadDays ?? 999);
        if (sortBy === 'volume') return b.totalItems - a.totalItems;
        if (sortBy === 'pending') return b.pendingItems - a.pendingItems;
        return 0;
      });

    const totalSuppliers = supplierList.length;
    const totalPending = supplierList.reduce((s, sup) => s + sup.pendingItems, 0);
    const avgLead = supplierList.filter(s => s.avgLeadDays !== null);
    const overallAvgLead = avgLead.length > 0 ? Math.round(avgLead.reduce((s, sup) => s + (sup.avgLeadDays || 0), 0) / avgLead.length) : null;

    return {
      suppliers: supplierList,
      summary: { totalSuppliers, totalPending, overallAvgLead },
      hasData: supplierList.length > 0
    };
  }, [orders, period, sortBy]);

  const maxItems = Math.max(...suppliers.map(s => s.totalItems), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <Factory className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Supplier Lead Times</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Procurement tracking by supplier &amp; product</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="text-xs border rounded-lg px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200">
              <option value="leadTime">Sort: Lead Time</option>
              <option value="volume">Sort: Volume</option>
              <option value="pending">Sort: Pending</option>
            </select>
            <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden">
              {(['30d','90d','365d','all'] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-violet-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <Factory className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No supplier data available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Supplier tracking appears when DecoNetwork orders include vendor/supplier details</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 p-6">
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-violet-900 dark:text-violet-100">{summary.totalSuppliers}</p>
              <p className="text-xs text-violet-600 dark:text-violet-400">Suppliers</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{summary.overallAvgLead ?? '—'}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">Avg Lead Days</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${summary.totalPending > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <p className={`text-2xl font-bold ${summary.totalPending > 0 ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100'}`}>{summary.totalPending}</p>
              <p className={`text-xs ${summary.totalPending > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Pending Items</p>
            </div>
          </div>

          {/* Supplier Rows */}
          <div className="px-6 pb-6 space-y-2">
            {suppliers.map(s => (
              <div key={s.supplierId} className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => setExpandedSupplier(expandedSupplier === s.supplierId ? null : s.supplierId)}
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {s.totalItems} items · {s.receivedItems} received · {s.products.size} products
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {s.avgLeadDays !== null && (
                      <div className="text-right">
                        <p className={`text-sm font-mono font-semibold ${s.avgLeadDays > 14 ? 'text-red-600' : s.avgLeadDays > 7 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {s.avgLeadDays}d avg
                        </p>
                        <p className="text-xs text-gray-400">{s.minLeadDays}–{s.maxLeadDays}d range</p>
                      </div>
                    )}
                    {s.pendingItems > 0 && (
                      <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                        {s.pendingItems} pending
                      </span>
                    )}
                    <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(s.totalItems / maxItems) * 100}%` }} />
                    </div>
                    {expandedSupplier === s.supplierId ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {expandedSupplier === s.supplierId && (
                  <div className="border-t dark:border-gray-700 max-h-64 overflow-y-auto">
                    {s.recentOrders.slice(0, 20).map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 dark:border-gray-700/50 text-xs">
                        <div className="flex items-center gap-2">
                          <button onClick={() => onNavigateToOrder?.(r.orderNumber)}
                            className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">#{r.orderNumber}</button>
                          <span className="text-gray-600 dark:text-gray-300 truncate max-w-[200px]">{r.itemName}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {r.leadDays !== null && <span className="text-gray-500 font-mono">{r.leadDays}d</span>}
                          <span className={`px-2 py-0.5 rounded-full ${r.received ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {r.received ? 'Received' : 'Pending'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SupplierLeadTimeReport;
