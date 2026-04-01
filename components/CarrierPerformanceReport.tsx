import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { Truck, Clock, DollarSign, AlertTriangle, TrendingUp, TrendingDown, Package, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type Period = '30d' | '90d' | '365d' | 'all';

interface CarrierStats {
  carrier: string;
  carrierCode: string;
  shipments: number;
  totalCost: number;
  avgCost: number;
  avgDeliveryDays: number | null;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
  onTimeCount: number;
  lateCount: number;
  onTimeRate: number;
  services: Map<string, ServiceStats>;
}

interface ServiceStats {
  service: string;
  shipments: number;
  totalCost: number;
  avgCost: number;
  avgDeliveryDays: number | null;
}

const CarrierPerformanceReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [period, setPeriod] = useState<Period>('90d');
  const [expandedCarrier, setExpandedCarrier] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'shipments' | 'cost' | 'speed'>('shipments');

  const periodDays: Record<Period, number> = { '30d': 30, '90d': 90, '365d': 365, 'all': 99999 };

  const stats = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);

    const shippedOrders = orders.filter(o => {
      if (!o.shipStationTracking?.shipDate) return false;
      return new Date(o.shipStationTracking.shipDate) >= cutoff;
    });

    const carrierMap = new Map<string, CarrierStats>();

    for (const o of shippedOrders) {
      const t = o.shipStationTracking!;
      const code = t.carrierCode || t.carrier || 'unknown';
      const name = t.carrier || code;

      if (!carrierMap.has(code)) {
        carrierMap.set(code, {
          carrier: name, carrierCode: code, shipments: 0,
          totalCost: 0, avgCost: 0, avgDeliveryDays: null,
          minDeliveryDays: null, maxDeliveryDays: null,
          onTimeCount: 0, lateCount: 0, onTimeRate: 0,
          services: new Map()
        });
      }

      const cs = carrierMap.get(code)!;
      cs.shipments++;
      cs.totalCost += t.shippingCost || 0;

      // Calculate delivery duration: order date → ship date
      const orderDate = new Date(o.shopify.date);
      const shipDate = new Date(t.shipDate);
      const deliveryDays = Math.max(0, Math.round((shipDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24)));

      if (cs.minDeliveryDays === null || deliveryDays < cs.minDeliveryDays) cs.minDeliveryDays = deliveryDays;
      if (cs.maxDeliveryDays === null || deliveryDays > cs.maxDeliveryDays) cs.maxDeliveryDays = deliveryDays;

      // On-time = shipped within SLA target
      const slaDate = o.slaTargetDate ? new Date(o.slaTargetDate) : null;
      if (slaDate && shipDate <= slaDate) cs.onTimeCount++;
      else if (slaDate) cs.lateCount++;

      // Accumulate for average
      cs.avgDeliveryDays = ((cs.avgDeliveryDays || 0) * (cs.shipments - 1) + deliveryDays) / cs.shipments;

      // Service breakdown — use carrierCode as key since we don't have serviceCode on tracking
      // We'll just track service-level if available from order data
      const serviceKey = code; // One entry per carrier in service breakdown for now
      if (!cs.services.has(serviceKey)) {
        cs.services.set(serviceKey, { service: name, shipments: 0, totalCost: 0, avgCost: 0, avgDeliveryDays: null });
      }
      const svc = cs.services.get(serviceKey)!;
      svc.shipments++;
      svc.totalCost += t.shippingCost || 0;
      svc.avgDeliveryDays = ((svc.avgDeliveryDays || 0) * (svc.shipments - 1) + deliveryDays) / svc.shipments;
    }

    // Finalize averages
    const result: CarrierStats[] = [];
    for (const cs of carrierMap.values()) {
      cs.avgCost = cs.shipments > 0 ? cs.totalCost / cs.shipments : 0;
      const totalRated = cs.onTimeCount + cs.lateCount;
      cs.onTimeRate = totalRated > 0 ? (cs.onTimeCount / totalRated) * 100 : 0;
      for (const svc of cs.services.values()) {
        svc.avgCost = svc.shipments > 0 ? svc.totalCost / svc.shipments : 0;
      }
      result.push(cs);
    }

    return result;
  }, [orders, period]);

  const sortedStats = useMemo(() => {
    const sorted = [...stats];
    if (sortBy === 'shipments') sorted.sort((a, b) => b.shipments - a.shipments);
    else if (sortBy === 'cost') sorted.sort((a, b) => a.avgCost - b.avgCost);
    else sorted.sort((a, b) => (a.avgDeliveryDays || 999) - (b.avgDeliveryDays || 999));
    return sorted;
  }, [stats, sortBy]);

  const totals = useMemo(() => {
    const total = stats.reduce((acc, c) => ({
      shipments: acc.shipments + c.shipments,
      cost: acc.cost + c.totalCost,
      onTime: acc.onTime + c.onTimeCount,
      late: acc.late + c.lateCount,
    }), { shipments: 0, cost: 0, onTime: 0, late: 0 });

    return {
      ...total,
      avgCost: total.shipments > 0 ? total.cost / total.shipments : 0,
      onTimeRate: (total.onTime + total.late) > 0 ? (total.onTime / (total.onTime + total.late)) * 100 : 0,
    };
  }, [stats]);

  const maxShipments = Math.max(...stats.map(s => s.shipments), 1);

  if (stats.length === 0) {
    return (
      <div className="bg-[#0d1117] rounded-2xl border border-white/10 p-6">
        <h2 className="text-sm font-black text-white flex items-center gap-2 mb-3"><Truck className="w-4 h-4 text-blue-400" /> Carrier Performance</h2>
        <p className="text-[10px] text-gray-500">No shipped orders in this period</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] rounded-2xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-black text-white flex items-center gap-2"><Truck className="w-4 h-4 text-blue-400" /> Carrier Performance</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-white/5 rounded-lg overflow-hidden border border-white/10">
            {(['shipments', 'cost', 'speed'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className={`px-2 py-1 text-[8px] font-black uppercase tracking-wider transition-all ${sortBy === s ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {s === 'shipments' ? 'Volume' : s === 'cost' ? 'Cost' : 'Speed'}
              </button>
            ))}
          </div>
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
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Total Shipments</p>
          <p className="text-lg font-black text-white">{totals.shipments.toLocaleString()}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Total Spend</p>
          <p className="text-lg font-black text-white">£{totals.cost.toFixed(2)}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">Avg Cost / Shipment</p>
          <p className="text-lg font-black text-white">£{totals.avgCost.toFixed(2)}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-1">On-Time Rate</p>
          <p className={`text-lg font-black ${totals.onTimeRate >= 90 ? 'text-emerald-400' : totals.onTimeRate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
            {totals.onTimeRate.toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Carrier Rows */}
      <div className="space-y-2">
        {sortedStats.map(cs => {
          const isExpanded = expandedCarrier === cs.carrierCode;
          return (
            <div key={cs.carrierCode} className="bg-white/[0.03] rounded-xl border border-white/10 overflow-hidden">
              <div
                onClick={() => setExpandedCarrier(isExpanded ? null : cs.carrierCode)}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-white/[0.03] transition-all"
              >
                <Truck className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-black text-white">{cs.carrier}</span>
                    <span className="text-[9px] font-bold text-gray-500">{cs.shipments} shipment{cs.shipments !== 1 ? 's' : ''}</span>
                  </div>
                  {/* Volume bar */}
                  <div className="mt-1.5 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500/60 rounded-full transition-all" style={{ width: `${(cs.shipments / maxShipments) * 100}%` }} />
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase text-gray-500">Avg Cost</p>
                    <p className="text-[11px] font-black text-white">£{cs.avgCost.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase text-gray-500">Avg Days</p>
                    <p className="text-[11px] font-black text-white">{cs.avgDeliveryDays !== null ? cs.avgDeliveryDays.toFixed(1) : '-'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black uppercase text-gray-500">On-Time</p>
                    <p className={`text-[11px] font-black ${cs.onTimeRate >= 90 ? 'text-emerald-400' : cs.onTimeRate >= 70 ? 'text-amber-400' : cs.onTimeRate > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {(cs.onTimeCount + cs.lateCount) > 0 ? `${cs.onTimeRate.toFixed(0)}%` : '-'}
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-white/10 p-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[7px] font-black uppercase tracking-widest text-gray-500">Total Spend</p>
                      <p className="text-sm font-black text-white mt-0.5">£{cs.totalCost.toFixed(2)}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[7px] font-black uppercase tracking-widest text-gray-500">Avg Cost</p>
                      <p className="text-sm font-black text-white mt-0.5">£{cs.avgCost.toFixed(2)}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[7px] font-black uppercase tracking-widest text-gray-500">Fastest</p>
                      <p className="text-sm font-black text-emerald-400 mt-0.5">{cs.minDeliveryDays !== null ? `${cs.minDeliveryDays}d` : '-'}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[7px] font-black uppercase tracking-widest text-gray-500">Slowest</p>
                      <p className="text-sm font-black text-red-400 mt-0.5">{cs.maxDeliveryDays !== null ? `${cs.maxDeliveryDays}d` : '-'}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[7px] font-black uppercase tracking-widest text-gray-500">On-Time / Late</p>
                      <p className="text-sm font-black text-white mt-0.5">
                        <span className="text-emerald-400">{cs.onTimeCount}</span>
                        <span className="text-gray-600 mx-1">/</span>
                        <span className="text-red-400">{cs.lateCount}</span>
                      </p>
                    </div>
                  </div>

                  {/* Recent shipments for this carrier */}
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-2">Recent Shipments</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {orders
                        .filter(o => o.shipStationTracking && (o.shipStationTracking.carrierCode || o.shipStationTracking.carrier) === cs.carrierCode)
                        .sort((a, b) => new Date(b.shipStationTracking!.shipDate).getTime() - new Date(a.shipStationTracking!.shipDate).getTime())
                        .slice(0, 10)
                        .map(o => {
                          const days = Math.round((new Date(o.shipStationTracking!.shipDate).getTime() - new Date(o.shopify.date).getTime()) / 86400000);
                          return (
                            <div key={o.shopify.id} className="flex items-center justify-between text-[10px] py-1 border-b border-white/5">
                              <button onClick={() => onNavigateToOrder?.(o.shopify.orderNumber)} className="text-indigo-300 hover:text-indigo-200 font-bold">
                                #{o.shopify.orderNumber}
                              </button>
                              <span className="text-gray-500">{o.shopify.customerName}</span>
                              <span className="text-gray-400">{new Date(o.shipStationTracking!.shipDate).toLocaleDateString('en-GB')}</span>
                              <span className="font-bold text-gray-300">£{o.shipStationTracking!.shippingCost.toFixed(2)}</span>
                              <span className={`font-bold ${days <= 3 ? 'text-emerald-400' : days <= 7 ? 'text-amber-400' : 'text-red-400'}`}>{days}d</span>
                            </div>
                          );
                        })
                      }
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

export default CarrierPerformanceReport;
