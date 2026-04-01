import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { Users, ChevronDown, ChevronUp, Clock, Package, AlertTriangle, BarChart3 } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface StaffMember {
  name: string;
  activeItems: number;
  completedItems: number;
  totalQuantity: number;
  overdueItems: number;
  avgCompletionPct: number;
  jobs: Array<{ orderNumber: string; itemName: string; quantity: number; status: string; dueDate?: string; isOverdue: boolean }>;
}

const StaffWorkloadDashboard: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const { staff, hasData, summary } = useMemo(() => {
    const map = new Map<string, StaffMember>();
    const now = new Date();

    for (const o of orders) {
      if (!o.deco?.items) continue;
      const dueDate = o.deco.dateDue || o.deco.productionDueDate;

      for (const item of o.deco.items) {
        const assignee = item.assignedTo || 'Unassigned';
        if (!map.has(assignee)) {
          map.set(assignee, { name: assignee, activeItems: 0, completedItems: 0, totalQuantity: 0, overdueItems: 0, avgCompletionPct: 0, jobs: [] });
        }

        const s = map.get(assignee)!;
        const isComplete = item.isProduced;
        const isOverdue = dueDate ? new Date(dueDate) < now && !isComplete : false;

        if (isComplete) s.completedItems++;
        else s.activeItems++;
        s.totalQuantity += item.quantity;
        if (isOverdue) s.overdueItems++;

        s.jobs.push({
          orderNumber: o.shopify.orderNumber,
          itemName: item.name,
          quantity: item.quantity,
          status: item.status || (isComplete ? 'Produced' : item.isReceived ? 'Received' : 'Pending'),
          dueDate,
          isOverdue,
        });
      }
    }

    const staffList = Array.from(map.values())
      .filter(s => showCompleted || s.activeItems > 0 || s.name === 'Unassigned')
      .sort((a, b) => b.activeItems - a.activeItems);

    // Calculate avg completion across staff
    for (const s of staffList) {
      const total = s.activeItems + s.completedItems;
      s.avgCompletionPct = total > 0 ? (s.completedItems / total) * 100 : 0;
    }

    const totalActive = staffList.reduce((s, st) => s + st.activeItems, 0);
    const totalOverdue = staffList.reduce((s, st) => s + st.overdueItems, 0);
    const assignedStaff = staffList.filter(s => s.name !== 'Unassigned').length;

    return {
      staff: staffList,
      hasData: staffList.some(s => s.name !== 'Unassigned'),
      summary: { totalActive, totalOverdue, assignedStaff }
    };
  }, [orders, showCompleted]);

  const maxActive = Math.max(...staff.map(s => s.activeItems), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Staff Workload</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Production operator assignments &amp; load balancing</p>
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} className="rounded" />
            Show completed
          </label>
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No staff assignment data available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Workload data appears when DecoNetwork workflow items include operator assignments</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 p-6">
            <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-cyan-900 dark:text-cyan-100">{summary.assignedStaff}</p>
              <p className="text-xs text-cyan-600 dark:text-cyan-400">Active Staff</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{summary.totalActive}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">Active Items</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${summary.totalOverdue > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <p className={`text-2xl font-bold ${summary.totalOverdue > 0 ? 'text-red-900 dark:text-red-100' : 'text-emerald-900 dark:text-emerald-100'}`}>{summary.totalOverdue}</p>
              <p className={`text-xs ${summary.totalOverdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Overdue</p>
            </div>
          </div>

          {/* Staff Rows */}
          <div className="px-6 pb-6 space-y-2">
            {staff.map(s => (
              <div key={s.name} className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => setExpandedStaff(expandedStaff === s.name ? null : s.name)}
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                    {s.name === 'Unassigned' ? '?' : s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{s.activeItems} active · {s.completedItems} done · {s.totalQuantity} total qty</p>
                  </div>
                  {s.overdueItems > 0 && (
                    <span className="flex items-center gap-0.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full">
                      <AlertTriangle className="w-3 h-3" /> {s.overdueItems} overdue
                    </span>
                  )}
                  <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${(s.activeItems / maxActive) * 100}%` }} />
                  </div>
                  {expandedStaff === s.name ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {expandedStaff === s.name && (
                  <div className="border-t dark:border-gray-700 max-h-64 overflow-y-auto">
                    {s.jobs.filter(j => showCompleted || j.status !== 'Produced').map((j, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 dark:border-gray-700/50 text-xs">
                        <div className="flex items-center gap-2">
                          <button onClick={() => onNavigateToOrder?.(j.orderNumber)}
                            className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">#{j.orderNumber}</button>
                          <span className="text-gray-600 dark:text-gray-300 truncate max-w-[200px]">{j.itemName}</span>
                          <span className="text-gray-400">×{j.quantity}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {j.isOverdue && <AlertTriangle className="w-3 h-3 text-red-500" />}
                          {j.dueDate && <span className="text-gray-400">{new Date(j.dueDate).toLocaleDateString('en-GB')}</span>}
                          <span className={`px-2 py-0.5 rounded-full ${j.status === 'Produced' ? 'bg-emerald-100 text-emerald-700' : j.status === 'Received' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                            {j.status}
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

export default StaffWorkloadDashboard;
