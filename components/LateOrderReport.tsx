import React, { useMemo, useState } from 'react';
import { UnifiedOrder } from '../types';
import { AlertTriangle, Clock, Download, Eye, Filter, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

type LateCriteria = 'unlinked_3d' | 'overdue_sla' | 'stuck_production' | 'all';

interface LateOrder {
  order: UnifiedOrder;
  reason: string;
  severity: 'critical' | 'warning';
  daysLate: number;
}

const LateOrderReport: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [criteria, setCriteria] = useState<LateCriteria>('all');
  const [showAll, setShowAll] = useState(false);

  const lateOrders = useMemo<LateOrder[]>(() => {
    const now = Date.now();
    const results: LateOrder[] = [];

    orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled').forEach(o => {
      const orderAge = Math.floor((now - new Date(o.shopify.date).getTime()) / (1000 * 60 * 60 * 24));

      // Unlinked for 3+ days
      if (!o.decoJobId && orderAge >= 3) {
        results.push({
          order: o,
          reason: `Unlinked for ${orderAge} days`,
          severity: orderAge >= 7 ? 'critical' : 'warning',
          daysLate: orderAge,
        });
      }

      // Past SLA target
      if (o.slaTargetDate) {
        const target = new Date(o.slaTargetDate).getTime();
        if (now > target) {
          const daysOver = Math.floor((now - target) / (1000 * 60 * 60 * 24));
          results.push({
            order: o,
            reason: `${daysOver} day(s) past SLA target`,
            severity: daysOver >= 5 ? 'critical' : 'warning',
            daysLate: daysOver,
          });
        }
      }

      // Stuck in production (linked, <100% complete, 10+ days old)
      if (o.decoJobId && o.completionPercentage < 100 && o.daysInProduction >= 10) {
        results.push({
          order: o,
          reason: `In production ${o.daysInProduction} days, ${o.completionPercentage}% complete`,
          severity: o.daysInProduction >= 15 ? 'critical' : 'warning',
          daysLate: o.daysInProduction,
        });
      }
    });

    // Deduplicate by order ID (keep the worst severity)
    const byOrder = new Map<string, LateOrder>();
    results.forEach(r => {
      const existing = byOrder.get(r.order.shopify.id);
      if (!existing || r.severity === 'critical') {
        byOrder.set(r.order.shopify.id, r);
      }
    });

    return Array.from(byOrder.values()).sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.daysLate - a.daysLate;
    });
  }, [orders]);

  const filtered = useMemo(() => {
    if (criteria === 'all') return lateOrders;
    if (criteria === 'unlinked_3d') return lateOrders.filter(l => l.reason.includes('Unlinked'));
    if (criteria === 'overdue_sla') return lateOrders.filter(l => l.reason.includes('SLA'));
    if (criteria === 'stuck_production') return lateOrders.filter(l => l.reason.includes('production'));
    return lateOrders;
  }, [lateOrders, criteria]);

  const displayed = showAll ? filtered : filtered.slice(0, 25);

  const exportCSV = () => {
    const header = 'Order,Customer,Club,Days Late,Reason,Severity,Completion %\n';
    const rows = filtered.map(l =>
      `"#${l.order.shopify.orderNumber}","${l.order.shopify.customerName}","${l.order.clubName}",${l.daysLate},"${l.reason}","${l.severity}",${l.order.completionPercentage}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `late-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => ({
    critical: lateOrders.filter(l => l.severity === 'critical').length,
    warning: lateOrders.filter(l => l.severity === 'warning').length,
    unlinked: lateOrders.filter(l => l.reason.includes('Unlinked')).length,
    overdueSla: lateOrders.filter(l => l.reason.includes('SLA')).length,
    stuck: lateOrders.filter(l => l.reason.includes('production')).length,
  }), [lateOrders]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Late Order Report</h3>
          {lateOrders.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-black">{lateOrders.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={criteria} onChange={e => setCriteria(e.target.value as LateCriteria)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="all">All Issues ({lateOrders.length})</option>
            <option value="unlinked_3d">Unlinked 3+ Days ({stats.unlinked})</option>
            <option value="overdue_sla">Past SLA ({stats.overdueSla})</option>
            <option value="stuck_production">Stuck Production ({stats.stuck})</option>
          </select>
          <button onClick={exportCSV} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-colors flex items-center gap-1">
            <Download className="w-3 h-3" /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary badges */}
      <div className="px-4 py-2 border-b border-gray-50 flex items-center gap-3">
        <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-[9px] font-black">🔴 {stats.critical} Critical</span>
        <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black">🟡 {stats.warning} Warning</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500 w-10"></th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Order</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Customer</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Club</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Issue</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Days</th>
              <th className="px-4 py-2 text-center font-black uppercase tracking-widest text-gray-500">Completion</th>
              <th className="px-4 py-2 text-left font-black uppercase tracking-widest text-gray-500">Job</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(l => (
              <tr
                key={l.order.shopify.id}
                className={`border-t border-gray-50 hover:bg-indigo-50/50 transition-colors cursor-pointer ${l.severity === 'critical' ? 'bg-red-50/30' : ''}`}
                onClick={() => onNavigateToOrder?.(l.order.shopify.orderNumber)}
              >
                <td className="px-4 py-2 text-center">{l.severity === 'critical' ? '🔴' : '🟡'}</td>
                <td className="px-4 py-2 font-black text-gray-800 hover:text-indigo-600">#{l.order.shopify.orderNumber}</td>
                <td className="px-4 py-2 font-bold text-gray-600 truncate max-w-[120px]">{l.order.shopify.customerName}</td>
                <td className="px-4 py-2 font-bold text-indigo-500">{l.order.clubName || '-'}</td>
                <td className="px-4 py-2 font-bold text-gray-700">{l.reason}</td>
                <td className="px-4 py-2 text-center font-black text-red-600">{l.daysLate}</td>
                <td className="px-4 py-2 text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${l.order.completionPercentage === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${l.order.completionPercentage}%` }} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-500">{l.order.completionPercentage}%</span>
                  </div>
                </td>
                <td className="px-4 py-2 font-mono text-indigo-500">{l.order.decoJobId || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Clock className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
          <p className="text-xs font-bold uppercase tracking-widest">No late orders — everything on track! 🎉</p>
        </div>
      )}

      {filtered.length > 25 && (
        <div className="px-4 py-2 border-t border-gray-100 text-center">
          <button onClick={() => setShowAll(!showAll)} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest flex items-center gap-1 mx-auto">
            {showAll ? <><ChevronUp className="w-3 h-3" /> Show Less</> : <><ChevronDown className="w-3 h-3" /> Show All ({filtered.length})</>}
          </button>
        </div>
      )}
    </div>
  );
};

export default LateOrderReport;
