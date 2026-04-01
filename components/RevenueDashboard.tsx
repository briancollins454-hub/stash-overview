import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { DollarSign, TrendingUp, TrendingDown, BarChart3, Users, ShoppingBag, Calendar, ChevronDown } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder: (orderNumber: string) => void;
}

type Period = '7d' | '30d' | '90d' | '365d' | 'all';
type Granularity = 'day' | 'week' | 'month';

const RevenueDashboard: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showTopCustomers, setShowTopCustomers] = useState(false);

  const periodDays: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const filteredOrders = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);
    return orders.filter(o => new Date(o.shopify.date) >= cutoff);
  }, [orders, period]);

  const previousOrders = useMemo(() => {
    const days = periodDays[period];
    if (days >= 99999) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const prevCutoff = new Date();
    prevCutoff.setDate(prevCutoff.getDate() - days * 2);
    return orders.filter(o => {
      const d = new Date(o.shopify.date);
      return d >= prevCutoff && d < cutoff;
    });
  }, [orders, period]);

  const stats = useMemo(() => {
    const revenue = filteredOrders.reduce((sum, o) => sum + parseFloat(o.shopify.totalPrice || '0'), 0);
    const prevRevenue = previousOrders.reduce((sum, o) => sum + parseFloat(o.shopify.totalPrice || '0'), 0);
    const orderCount = filteredOrders.length;
    const prevOrderCount = previousOrders.length;
    const aov = orderCount > 0 ? revenue / orderCount : 0;
    const prevAov = prevOrderCount > 0 ? prevRevenue / prevOrderCount : 0;

    const customers = new Set(filteredOrders.map(o => o.shopify.email).filter(Boolean));
    const prevCustomers = new Set(previousOrders.map(o => o.shopify.email).filter(Boolean));

    const revenueChange = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
    const orderChange = prevOrderCount > 0 ? ((orderCount - prevOrderCount) / prevOrderCount) * 100 : 0;
    const aovChange = prevAov > 0 ? ((aov - prevAov) / prevAov) * 100 : 0;
    const customerChange = prevCustomers.size > 0 ? ((customers.size - prevCustomers.size) / prevCustomers.size) * 100 : 0;

    return { revenue, prevRevenue, orderCount, prevOrderCount, aov, prevAov, customers: customers.size, prevCustomers: prevCustomers.size, revenueChange, orderChange, aovChange, customerChange };
  }, [filteredOrders, previousOrders]);

  const chartData = useMemo(() => {
    const buckets = new Map<string, { revenue: number; orders: number }>();

    filteredOrders.forEach(o => {
      const d = new Date(o.shopify.date);
      let key: string;
      if (granularity === 'day') {
        key = d.toISOString().split('T')[0];
      } else if (granularity === 'week') {
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      const existing = buckets.get(key) || { revenue: 0, orders: 0 };
      existing.revenue += parseFloat(o.shopify.totalPrice || '0');
      existing.orders += 1;
      buckets.set(key, existing);
    });

    return Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, data]) => ({ date, ...data }));
  }, [filteredOrders, granularity]);

  const topVendors = useMemo(() => {
    const vendorMap = new Map<string, { revenue: number; items: number }>();
    filteredOrders.forEach(o => {
      o.shopify.items.forEach(item => {
        const v = item.vendor || 'Unknown';
        const existing = vendorMap.get(v) || { revenue: 0, items: 0 };
        existing.revenue += parseFloat(item.price || '0') * item.quantity;
        existing.items += item.quantity;
        vendorMap.set(v, existing);
      });
    });
    return Array.from(vendorMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10).map(([name, data]) => ({ name, ...data }));
  }, [filteredOrders]);

  const topCustomers = useMemo(() => {
    const customerMap = new Map<string, { name: string; email: string; revenue: number; orders: number; lastOrder: string }>();
    filteredOrders.forEach(o => {
      const email = o.shopify.email || 'guest';
      const existing = customerMap.get(email) || { name: o.shopify.customerName, email, revenue: 0, orders: 0, lastOrder: '' };
      existing.revenue += parseFloat(o.shopify.totalPrice || '0');
      existing.orders += 1;
      if (!existing.lastOrder || o.shopify.date > existing.lastOrder) existing.lastOrder = o.shopify.date;
      customerMap.set(email, existing);
    });
    return Array.from(customerMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  }, [filteredOrders]);

  const revenueByTag = useMemo(() => {
    const tagMap = new Map<string, number>();
    filteredOrders.forEach(o => {
      const tags = o.shopify.tags || [];
      const price = parseFloat(o.shopify.totalPrice || '0');
      if (tags.length === 0) {
        tagMap.set('No Tags', (tagMap.get('No Tags') || 0) + price);
      } else {
        tags.forEach(t => tagMap.set(t, (tagMap.get(t) || 0) + price));
      }
    });
    return Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filteredOrders]);

  const maxRevenue = Math.max(...chartData.map(d => d.revenue), 1);
  const maxVendorRevenue = Math.max(...topVendors.map(v => v.revenue), 1);

  const fmt = (n: number) => n >= 1000 ? `£${(n / 1000).toFixed(1)}k` : `£${n.toFixed(2)}`;
  const fmtFull = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  const ChangeIndicator = ({ value }: { value: number }) => (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-black ${value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
      {value >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {pct(value)}
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-white">Revenue Dashboard</h2>
        </div>
        <div className="flex items-center gap-2">
          <select value={granularity} onChange={e => setGranularity(e.target.value as Granularity)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-bold text-white">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
          <div className="flex bg-white/5 rounded border border-white/10">
            {(['7d', '30d', '90d', '365d', 'all'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all ${period === p ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:text-white'}`}>{p === 'all' ? 'ALL' : p}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenue', value: fmtFull(stats.revenue), change: stats.revenueChange, icon: DollarSign, color: 'emerald' },
          { label: 'Orders', value: stats.orderCount.toLocaleString(), change: stats.orderChange, icon: ShoppingBag, color: 'blue' },
          { label: 'Avg Order Value', value: fmtFull(stats.aov), change: stats.aovChange, icon: BarChart3, color: 'purple' },
          { label: 'Unique Customers', value: stats.customers.toLocaleString(), change: stats.customerChange, icon: Users, color: 'amber' },
        ].map(card => (
          <div key={card.label} className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{card.label}</span>
              <card.icon className={`w-4 h-4 text-${card.color}-400`} />
            </div>
            <div className="text-xl font-black text-white">{card.value}</div>
            {period !== 'all' && <ChangeIndicator value={card.change} />}
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Revenue Over Time</h3>
        {chartData.length === 0 ? (
          <p className="text-center text-gray-500 text-xs py-8">No data for this period</p>
        ) : (
          <div className="flex items-end gap-px h-40">
            {chartData.map((d, i) => (
              <div key={i} className="flex-1 group relative flex flex-col items-center justify-end">
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[8px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                  {fmt(d.revenue)} • {d.orders} orders<br />{d.date}
                </div>
                <div
                  className="w-full bg-emerald-500/60 hover:bg-emerald-400/80 rounded-t transition-all cursor-pointer min-h-[2px]"
                  style={{ height: `${Math.max((d.revenue / maxRevenue) * 100, 1)}%` }}
                />
              </div>
            ))}
          </div>
        )}
        {chartData.length > 0 && (
          <div className="flex justify-between mt-1.5">
            <span className="text-[8px] text-gray-500 font-bold">{chartData[0]?.date}</span>
            <span className="text-[8px] text-gray-500 font-bold">{chartData[chartData.length - 1]?.date}</span>
          </div>
        )}
      </div>

      {/* Bottom Grid: Vendors + Tags + Top Customers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Vendors */}
        <div className="bg-white/5 rounded-xl border border-white/10 p-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Top Vendors</h3>
          <div className="space-y-2">
            {topVendors.map((v, i) => (
              <div key={v.name} className="flex items-center gap-2">
                <span className="text-[9px] font-black text-gray-500 w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-[10px] font-bold text-white truncate max-w-[120px]">{v.name}</span>
                    <span className="text-[10px] font-black text-emerald-400">{fmt(v.revenue)}</span>
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${(v.revenue / maxVendorRevenue) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {topVendors.length === 0 && <p className="text-gray-500 text-[10px]">No data</p>}
          </div>
        </div>

        {/* Revenue by Tag */}
        <div className="bg-white/5 rounded-xl border border-white/10 p-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Revenue by Tag</h3>
          <div className="space-y-2">
            {revenueByTag.map(([tag, rev], i) => (
              <div key={tag} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-gray-500 w-4">{i + 1}</span>
                  <span className="text-[10px] font-bold text-indigo-300 truncate max-w-[120px]">{tag}</span>
                </div>
                <span className="text-[10px] font-black text-emerald-400">{fmt(rev)}</span>
              </div>
            ))}
            {revenueByTag.length === 0 && <p className="text-gray-500 text-[10px]">No data</p>}
          </div>
        </div>

        {/* Top Customers */}
        <div className="bg-white/5 rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Top Customers</h3>
            <button onClick={() => setShowTopCustomers(!showTopCustomers)} className="text-gray-400 hover:text-white"><ChevronDown className={`w-3 h-3 transition-transform ${showTopCustomers ? 'rotate-180' : ''}`} /></button>
          </div>
          <div className="space-y-2">
            {topCustomers.slice(0, showTopCustomers ? 20 : 5).map((c, i) => (
              <div key={c.email} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[9px] font-black text-gray-500 w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-white truncate max-w-[120px]">{c.name}</div>
                    <div className="text-[8px] text-gray-500">{c.orders} orders</div>
                  </div>
                </div>
                <span className="text-[10px] font-black text-emerald-400">{fmt(c.revenue)}</span>
              </div>
            ))}
            {topCustomers.length === 0 && <p className="text-gray-500 text-[10px]">No data</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RevenueDashboard;
