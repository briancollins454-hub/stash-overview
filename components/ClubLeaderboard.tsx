import React, { useMemo, useState } from 'react';
import { UnifiedOrder } from '../types';
import { Trophy, TrendingUp, ChevronDown, ChevronUp, Eye, BarChart3 } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface ClubStats {
  name: string;
  orderCount: number;
  totalRevenue: number;
  totalItems: number;
  fulfilledCount: number;
  avgTurnaround: number | null;
  avgOrderValue: number;
  latestOrder: string;
  fulfillmentRate: number;
}

const ClubLeaderboard: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [sortBy, setSortBy] = useState<'revenue' | 'orders' | 'items' | 'turnaround'>('revenue');
  const [expandedClub, setExpandedClub] = useState<string | null>(null);

  const clubs = useMemo<ClubStats[]>(() => {
    const map = new Map<string, UnifiedOrder[]>();
    orders.forEach(o => {
      const club = o.clubName || 'No Club';
      if (!map.has(club)) map.set(club, []);
      map.get(club)!.push(o);
    });

    return Array.from(map.entries()).map(([name, clubOrders]) => {
      const totalRevenue = clubOrders.reduce((s, o) => s + (parseFloat(o.shopify.totalPrice) || 0), 0);
      const totalItems = clubOrders.reduce((s, o) => s + o.shopify.items.reduce((si, i) => si + i.quantity, 0), 0);
      const fulfilled = clubOrders.filter(o => o.shopify.fulfillmentStatus === 'fulfilled');
      const turnarounds = clubOrders.filter(o => o.fulfillmentDuration && o.fulfillmentDuration > 0).map(o => o.fulfillmentDuration!);
      const avgTurnaround = turnarounds.length > 0 ? turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length : null;
      const latestOrder = clubOrders.reduce((latest, o) => o.shopify.date > latest ? o.shopify.date : latest, '');

      return {
        name,
        orderCount: clubOrders.length,
        totalRevenue,
        totalItems,
        fulfilledCount: fulfilled.length,
        avgTurnaround,
        avgOrderValue: clubOrders.length > 0 ? totalRevenue / clubOrders.length : 0,
        latestOrder,
        fulfillmentRate: clubOrders.length > 0 ? (fulfilled.length / clubOrders.length) * 100 : 0,
      };
    }).sort((a, b) => {
      if (sortBy === 'revenue') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'orders') return b.orderCount - a.orderCount;
      if (sortBy === 'items') return b.totalItems - a.totalItems;
      if (sortBy === 'turnaround') {
        if (a.avgTurnaround === null) return 1;
        if (b.avgTurnaround === null) return -1;
        return a.avgTurnaround - b.avgTurnaround;
      }
      return 0;
    });
  }, [orders, sortBy]);

  const clubOrders = useMemo(() => {
    if (!expandedClub) return [];
    return orders.filter(o => (o.clubName || 'No Club') === expandedClub).sort((a, b) => b.shopify.date.localeCompare(a.shopify.date));
  }, [orders, expandedClub]);

  const medalColor = (idx: number) => {
    if (idx === 0) return 'text-amber-500';
    if (idx === 1) return 'text-gray-400';
    if (idx === 2) return 'text-orange-600';
    return 'text-gray-300';
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Club Leaderboard</h3>
          <span className="text-[9px] font-bold text-gray-400">({clubs.length} clubs)</span>
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
          <option value="revenue">By Revenue</option>
          <option value="orders">By Order Count</option>
          <option value="items">By Item Count</option>
          <option value="turnaround">By Turnaround (fastest)</option>
        </select>
      </div>

      <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
        {clubs.map((club, idx) => (
          <div key={club.name}>
            <button onClick={() => setExpandedClub(expandedClub === club.name ? null : club.name)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
              <span className={`text-sm font-black w-6 text-center ${medalColor(idx)}`}>
                {idx < 3 ? ['🥇', '🥈', '🥉'][idx] : `${idx + 1}`}
              </span>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-gray-800">{club.name}</span>
                  <span className="text-[9px] font-bold text-gray-400">{club.orderCount} orders</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Revenue</p>
                  <p className="text-xs font-black text-emerald-600">£{club.totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">AOV</p>
                  <p className="text-xs font-black text-gray-700">£{club.avgOrderValue.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Items</p>
                  <p className="text-xs font-black text-gray-700">{club.totalItems}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Turnaround</p>
                  <p className="text-xs font-black text-gray-700">{club.avgTurnaround !== null ? `${club.avgTurnaround.toFixed(1)}d` : '—'}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Fulfilled</p>
                  <p className="text-xs font-black text-gray-700">{club.fulfillmentRate.toFixed(0)}%</p>
                </div>
                {expandedClub === club.name ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
              </div>
            </button>
            {expandedClub === club.name && (
              <div className="px-4 pb-3 pl-12">
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-3 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Order</th>
                        <th className="px-3 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Customer</th>
                        <th className="px-3 py-1.5 text-left font-black uppercase tracking-widest text-gray-500">Date</th>
                        <th className="px-3 py-1.5 text-right font-black uppercase tracking-widest text-gray-500">Revenue</th>
                        <th className="px-3 py-1.5 text-center font-black uppercase tracking-widest text-gray-500">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clubOrders.slice(0, 20).map(o => (
                        <tr key={o.shopify.id} className="border-t border-gray-50 hover:bg-indigo-50/50 transition-colors cursor-pointer" onClick={() => onNavigateToOrder?.(o.shopify.orderNumber)}>
                          <td className="px-3 py-1.5 font-black text-gray-800 hover:text-indigo-600">#{o.shopify.orderNumber}</td>
                          <td className="px-3 py-1.5 font-bold text-gray-600 truncate max-w-[120px]">{o.shopify.customerName}</td>
                          <td className="px-3 py-1.5 font-bold text-gray-500">{new Date(o.shopify.date).toLocaleDateString('en-GB')}</td>
                          <td className="px-3 py-1.5 text-right font-black text-gray-800">£{parseFloat(o.shopify.totalPrice).toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${o.shopify.fulfillmentStatus === 'fulfilled' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {o.shopify.fulfillmentStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {clubOrders.length > 20 && <p className="text-[9px] text-center text-gray-400 py-2">+ {clubOrders.length - 20} more orders</p>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClubLeaderboard;
