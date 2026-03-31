import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { PriorityFlag, loadPriorityFlags, setPriorityFlag, removePriorityFlag } from '../services/priorityService';
import { Flame, AlertTriangle, Clock, X, Plus, ChevronDown, ChevronRight, ExternalLink, Zap } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
  userEmail: string;
}

const PriorityQueue: React.FC<Props> = ({ orders, onNavigateToOrder, userEmail }) => {
  const [flags, setFlags] = useState<PriorityFlag[]>(() => loadPriorityFlags());
  const [showAddForm, setShowAddForm] = useState(false);
  const [addOrderNum, setAddOrderNum] = useState('');
  const [addLevel, setAddLevel] = useState<'urgent' | 'high'>('urgent');
  const [addDueDate, setAddDueDate] = useState('');
  const [addNote, setAddNote] = useState('');

  // Also detect tag-based rush orders
  const tagPriority = useMemo(() => {
    return orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled' &&
      o.shopify.tags.some(t => ['rush', 'urgent', 'priority', 'express'].includes(t.toLowerCase()))
    );
  }, [orders]);

  const priorityOrders = useMemo(() => {
    const flagMap = new Map(flags.map(f => [f.orderId, f]));
    const result: { order: UnifiedOrder; flag: PriorityFlag; source: 'manual' | 'tag' }[] = [];

    // Manual flags
    flags.forEach(f => {
      const order = orders.find(o => o.shopify.id === f.orderId || o.shopify.orderNumber === f.orderNumber);
      if (order && order.shopify.fulfillmentStatus !== 'fulfilled') {
        result.push({ order, flag: f, source: 'manual' });
      }
    });

    // Tag-based
    tagPriority.forEach(o => {
      if (!result.find(r => r.order.shopify.id === o.shopify.id)) {
        result.push({
          order: o,
          flag: { orderId: o.shopify.id, orderNumber: o.shopify.orderNumber, level: 'high', setAt: Date.now(), setBy: 'system' },
          source: 'tag',
        });
      }
    });

    // Sort: urgent first, then high, then by due date
    return result.sort((a, b) => {
      if (a.flag.level === 'urgent' && b.flag.level !== 'urgent') return -1;
      if (a.flag.level !== 'urgent' && b.flag.level === 'urgent') return 1;
      const dA = a.flag.dueDate || a.order.slaTargetDate || '';
      const dB = b.flag.dueDate || b.order.slaTargetDate || '';
      return dA.localeCompare(dB);
    });
  }, [orders, flags, tagPriority]);

  const handleAdd = () => {
    const order = orders.find(o => o.shopify.orderNumber === addOrderNum.replace('#', ''));
    if (!order) return;
    const updated = setPriorityFlag({
      orderId: order.shopify.id,
      orderNumber: order.shopify.orderNumber,
      level: addLevel,
      dueDate: addDueDate || undefined,
      note: addNote || undefined,
      setAt: Date.now(),
      setBy: userEmail,
    });
    setFlags(updated);
    setShowAddForm(false);
    setAddOrderNum('');
    setAddNote('');
    setAddDueDate('');
  };

  const handleRemove = (orderId: string) => {
    setFlags(removePriorityFlag(orderId));
  };

  const levelBadge = (level: string) => {
    if (level === 'urgent') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-black uppercase"><Flame className="w-2.5 h-2.5" /> Urgent</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase"><AlertTriangle className="w-2.5 h-2.5" /> High</span>;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-red-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Priority Queue</h3>
          {priorityOrders.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-black">{priorityOrders.length}</span>
          )}
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors flex items-center gap-1">
          <Plus className="w-3 h-3" /> Flag Order
        </button>
      </div>

      {showAddForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-red-50/50">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Order #</label>
              <input value={addOrderNum} onChange={e => setAddOrderNum(e.target.value)} placeholder="e.g. 1234" className="w-28 px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-red-500 outline-none" />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Level</label>
              <select value={addLevel} onChange={e => setAddLevel(e.target.value as 'urgent' | 'high')} className="px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-red-500 outline-none">
                <option value="urgent">🔥 Urgent</option>
                <option value="high">⚠️ High</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Due Date</label>
              <input type="date" value={addDueDate} onChange={e => setAddDueDate(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-red-500 outline-none" />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Note</label>
              <input value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Rush reason..." className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-red-500 outline-none" />
            </div>
            <button onClick={handleAdd} disabled={!addOrderNum} className="px-4 py-1.5 bg-red-500 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-red-600 disabled:opacity-50 transition-colors">Add</button>
            <button onClick={() => setShowAddForm(false)} className="px-2 py-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
        {priorityOrders.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Zap className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            <p className="text-xs font-bold uppercase tracking-widest">No priority orders</p>
            <p className="text-[9px] mt-1">Flag urgent orders or add "rush" / "priority" tags in Shopify</p>
          </div>
        ) : (
          priorityOrders.map(({ order, flag, source }) => (
            <div key={order.shopify.id} className={`px-4 py-3 flex items-center justify-between hover:bg-red-50/30 transition-colors ${flag.level === 'urgent' ? 'border-l-4 border-red-500' : 'border-l-4 border-amber-400'}`}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {levelBadge(flag.level)}
                <button onClick={() => onNavigateToOrder?.(order.shopify.orderNumber)} className="text-xs font-black text-gray-800 hover:text-indigo-600 transition-colors">
                  #{order.shopify.orderNumber}
                </button>
                <span className="text-[10px] font-bold text-gray-500 truncate">{order.shopify.customerName}</span>
                {order.clubName && <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">{order.clubName}</span>}
                <span className="text-[10px] font-bold text-gray-400">{order.completionPercentage}%</span>
                {flag.dueDate && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-gray-400">
                    <Clock className="w-2.5 h-2.5" /> Due {new Date(flag.dueDate).toLocaleDateString('en-GB')}
                  </span>
                )}
                {flag.note && <span className="text-[9px] italic text-gray-400 truncate max-w-[200px]">"{flag.note}"</span>}
                {source === 'tag' && <span className="text-[8px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded uppercase">Tag</span>}
              </div>
              <div className="flex items-center gap-1">
                {source === 'manual' && (
                  <button onClick={() => handleRemove(flag.orderId)} className="p-1 text-gray-300 hover:text-red-500 transition-colors" title="Remove priority">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PriorityQueue;
