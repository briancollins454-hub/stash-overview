import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { CalendarClock, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, Target } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface TrackedItem {
  orderNumber: string;
  customerName: string;
  itemName: string;
  quantity: number;
  estimatedCompletion: string;
  dateDue?: string;
  isComplete: boolean;
  isOverdue: boolean;
  daysRemaining: number;
  status: string;
}

const CompletionTracker: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'overdue' | 'upcoming' | 'complete'>('all');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const { items, summary, hasData } = useMemo(() => {
    const now = new Date();
    const all: TrackedItem[] = [];

    for (const o of orders) {
      if (!o.deco?.items) continue;
      for (const item of o.deco.items) {
        const estCompletion = item.estimatedCompletion || o.deco.dateDue || o.deco.productionDueDate;
        if (!estCompletion) continue;

        const estDate = new Date(estCompletion);
        const isComplete = item.isProduced;
        const daysRemaining = Math.round((estDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const isOverdue = !isComplete && daysRemaining < 0;

        all.push({
          orderNumber: o.shopify.orderNumber,
          customerName: o.shopify.customerName,
          itemName: item.name,
          quantity: item.quantity,
          estimatedCompletion: estCompletion,
          dateDue: o.deco.dateDue,
          isComplete,
          isOverdue,
          daysRemaining,
          status: item.status || (isComplete ? 'Produced' : item.isReceived ? 'Received' : 'Pending'),
        });
      }
    }

    all.sort((a, b) => a.daysRemaining - b.daysRemaining);

    const overdue = all.filter(i => i.isOverdue).length;
    const upcoming = all.filter(i => !i.isComplete && !i.isOverdue && i.daysRemaining <= 3).length;
    const complete = all.filter(i => i.isComplete).length;
    const onTrack = all.filter(i => !i.isComplete && !i.isOverdue && i.daysRemaining > 3).length;

    return {
      items: all,
      summary: { total: all.length, overdue, upcoming, complete, onTrack },
      hasData: all.length > 0
    };
  }, [orders]);

  const filtered = useMemo(() => {
    if (filterStatus === 'overdue') return items.filter(i => i.isOverdue);
    if (filterStatus === 'upcoming') return items.filter(i => !i.isComplete && !i.isOverdue && i.daysRemaining <= 3);
    if (filterStatus === 'complete') return items.filter(i => i.isComplete);
    return items;
  }, [items, filterStatus]);

  // Group by order
  const grouped = useMemo(() => {
    const map = new Map<string, TrackedItem[]>();
    for (const item of filtered) {
      if (!map.has(item.orderNumber)) map.set(item.orderNumber, []);
      map.get(item.orderNumber)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Completion Tracker</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Estimated completion vs production due dates</p>
            </div>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <CalendarClock className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No completion estimates available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Tracking appears when orders have due dates or estimated completion times</p>
        </div>
      ) : (
        <>
          {/* Status Filter Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-6">
            {[
              { key: 'all' as const, label: 'Total', count: summary.total, icon: Target, color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' },
              { key: 'overdue' as const, label: 'Overdue', count: summary.overdue, icon: AlertTriangle, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
              { key: 'upcoming' as const, label: 'Due Soon', count: summary.upcoming, icon: Clock, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
              { key: 'complete' as const, label: 'Complete', count: summary.complete, icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
            ].map(({ key, label, count, icon: Icon, color }) => (
              <button key={key} onClick={() => setFilterStatus(key)}
                className={`rounded-xl p-4 text-center transition-all ${filterStatus === key ? `ring-2 ring-offset-2 dark:ring-offset-gray-800 ring-indigo-500 ${color}` : color} hover:opacity-90`}>
                <Icon className="w-5 h-5 mx-auto mb-1" />
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs font-medium">{label}</p>
              </button>
            ))}
          </div>

          {/* Timeline List */}
          <div className="px-6 pb-6 space-y-2">
            {grouped.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-6">No items match this filter</div>
            ) : grouped.slice(0, 40).map(([orderNum, items]) => (
              <div key={orderNum} className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => setExpandedGroup(expandedGroup === orderNum ? null : orderNum)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); onNavigateToOrder?.(orderNum); }}
                      className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline text-sm">#{orderNum}</button>
                    <span className="text-xs text-gray-400">{items[0].customerName}</span>
                    {items.some(i => i.isOverdue) && (
                      <span className="inline-flex items-center gap-0.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> overdue
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                    {expandedGroup === orderNum ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {expandedGroup === orderNum && (
                  <div className="border-t dark:border-gray-700">
                    {items.map((item, i) => (
                      <div key={i} className={`flex items-center justify-between px-4 py-2.5 border-b last:border-b-0 dark:border-gray-700/50 text-xs ${item.isOverdue ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                        <div>
                          <span className="text-gray-700 dark:text-gray-300">{item.itemName}</span>
                          <span className="text-gray-400 ml-1">×{item.quantity}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-mono ${item.isOverdue ? 'text-red-600 font-semibold' : item.daysRemaining <= 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                            {item.isComplete ? '✓ Done' : item.daysRemaining === 0 ? 'Due today' : item.daysRemaining > 0 ? `${item.daysRemaining}d left` : `${Math.abs(item.daysRemaining)}d late`}
                          </span>
                          <span className="text-gray-400">{new Date(item.estimatedCompletion).toLocaleDateString('en-GB')}</span>
                          <span className={`px-2 py-0.5 rounded-full ${item.isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{item.status}</span>
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

export default CompletionTracker;
