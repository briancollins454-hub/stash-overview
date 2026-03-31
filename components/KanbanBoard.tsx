import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import OrderTimeline from './OrderTimeline';
import { GripVertical, ChevronDown, ChevronRight, Package, Truck, AlertTriangle, Link2, ShoppingBag, CheckCircle2, Search, Eye } from 'lucide-react';

type KanbanColumn = 'new' | 'linked' | 'production' | 'ready' | 'shipped';

interface KanbanCard {
  order: UnifiedOrder;
  column: KanbanColumn;
}

interface Props {
  orders: UnifiedOrder[];
  shopifyDomain: string;
  onManualLink: (orderId: string, jobId: string) => void;
  onNavigateToJob: (jobId: string) => void;
}

const COLUMNS: { id: KanbanColumn; label: string; color: string; icon: React.ReactNode }[] = [
  { id: 'new', label: 'NEW', color: 'border-red-400 bg-red-50', icon: <ShoppingBag className="w-4 h-4 text-red-500" /> },
  { id: 'linked', label: 'LINKED', color: 'border-amber-400 bg-amber-50', icon: <Link2 className="w-4 h-4 text-amber-500" /> },
  { id: 'production', label: 'IN PRODUCTION', color: 'border-blue-400 bg-blue-50', icon: <Package className="w-4 h-4 text-blue-500" /> },
  { id: 'ready', label: 'READY TO SHIP', color: 'border-emerald-400 bg-emerald-50', icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> },
  { id: 'shipped', label: 'SHIPPED', color: 'border-gray-400 bg-gray-50', icon: <Truck className="w-4 h-4 text-gray-500" /> },
];

function getColumn(order: UnifiedOrder): KanbanColumn {
  if (order.shopify.fulfillmentStatus === 'fulfilled') return 'shipped';
  if (order.completionPercentage === 100 || order.isStockDispatchReady) return 'ready';
  if (order.decoJobId && order.completionPercentage > 0) return 'production';
  if (order.decoJobId) return 'linked';
  return 'new';
}

const KanbanBoard: React.FC<Props> = ({ orders, shopifyDomain, onManualLink, onNavigateToJob }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [draggedOrder, setDraggedOrder] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(null);
  const [linkJobId, setLinkJobId] = useState('');
  const [showLinkInput, setShowLinkInput] = useState<string | null>(null);

  const cards = useMemo(() => {
    let filtered = orders;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(o =>
        o.shopify.orderNumber.includes(lower) ||
        o.shopify.customerName.toLowerCase().includes(lower) ||
        (o.decoJobId && o.decoJobId.includes(lower))
      );
    }
    return filtered.map(order => ({ order, column: getColumn(order) }));
  }, [orders, searchTerm]);

  const columnCards = useMemo(() => {
    const map: Record<KanbanColumn, KanbanCard[]> = { new: [], linked: [], production: [], ready: [], shipped: [] };
    cards.forEach(card => map[card.column].push(card));
    return map;
  }, [cards]);

  const handleDragStart = (orderId: string) => {
    setDraggedOrder(orderId);
  };

  const handleDragOver = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault();
    setDragOverColumn(column);
  };

  const handleDrop = (column: KanbanColumn) => {
    if (draggedOrder && column === 'linked') {
      setShowLinkInput(draggedOrder);
    }
    setDraggedOrder(null);
    setDragOverColumn(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search Kanban..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold uppercase tracking-widest focus:ring-2 focus:ring-indigo-500/20 outline-none"
          />
        </div>
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{cards.length} orders</span>
      </div>

      <div className="grid grid-cols-5 gap-3 min-h-[600px]">
        {COLUMNS.map(col => (
          <div
            key={col.id}
            className={`rounded-xl border-2 ${col.color} ${dragOverColumn === col.id ? 'ring-2 ring-indigo-500 border-indigo-400' : ''} p-3 flex flex-col transition-all`}
            onDragOver={e => handleDragOver(e, col.id)}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={() => handleDrop(col.id)}
          >
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200/50">
              {col.icon}
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">{col.label}</span>
              <span className="ml-auto text-[10px] font-black text-gray-400 bg-white rounded-full px-2 py-0.5">{columnCards[col.id].length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[calc(100vh-300px)]">
              {columnCards[col.id].map(({ order }) => (
                <div
                  key={order.shopify.id}
                  draggable
                  onDragStart={() => handleDragStart(order.shopify.id)}
                  className={`bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-all ${draggedOrder === order.shopify.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="w-3 h-3 text-gray-300" />
                      <span className="text-xs font-black text-gray-800">#{order.shopify.orderNumber}</span>
                    </div>
                    <button onClick={() => setExpandedCard(expandedCard === order.shopify.id ? null : order.shopify.id)} className="p-0.5 hover:bg-gray-100 rounded">
                      {expandedCard === order.shopify.id ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                    </button>
                  </div>
                  <p className="text-[9px] font-bold text-gray-500 mt-1 truncate">{order.shopify.customerName}</p>
                  <p className="text-[9px] font-bold text-gray-400 mt-0.5">{order.clubName}</p>

                  {/* Progress bar */}
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${order.completionPercentage === 100 ? 'bg-emerald-500' : order.completionPercentage > 0 ? 'bg-indigo-500' : 'bg-gray-300'}`}
                      style={{ width: `${order.completionPercentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[8px] font-bold text-gray-400">{order.completionPercentage}%</span>
                    {order.daysRemaining < 0 && (
                      <span className="text-[8px] font-black text-red-500 flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" /> {Math.abs(order.daysRemaining)}d late
                      </span>
                    )}
                    {order.daysRemaining >= 0 && order.daysRemaining <= 3 && (
                      <span className="text-[8px] font-black text-amber-500">{order.daysRemaining}d left</span>
                    )}
                  </div>

                  {order.decoJobId && (
                    <button onClick={() => onNavigateToJob(order.decoJobId!)} className="mt-1.5 text-[8px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-widest">
                      Job #{order.decoJobId}
                    </button>
                  )}

                  {/* Inline link input for drag-to-linked */}
                  {showLinkInput === order.shopify.id && (
                    <div className="mt-2 flex gap-1 animate-in slide-in-from-top-1">
                      <input
                        type="text"
                        placeholder="Job ID"
                        value={linkJobId}
                        onChange={e => setLinkJobId(e.target.value)}
                        className="flex-1 px-2 py-1 text-[10px] font-bold border border-indigo-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter' && linkJobId.trim()) {
                            onManualLink(order.shopify.id, linkJobId.trim());
                            setShowLinkInput(null);
                            setLinkJobId('');
                          }
                          if (e.key === 'Escape') {
                            setShowLinkInput(null);
                            setLinkJobId('');
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          if (linkJobId.trim()) {
                            onManualLink(order.shopify.id, linkJobId.trim());
                            setShowLinkInput(null);
                            setLinkJobId('');
                          }
                        }}
                        className="px-2 py-1 bg-indigo-500 text-white rounded text-[9px] font-black uppercase"
                      >Link</button>
                    </div>
                  )}

                  {/* Expanded detail */}
                  {expandedCard === order.shopify.id && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 animate-in slide-in-from-top-1">
                      <OrderTimeline order={order} />
                      <div className="grid grid-cols-2 gap-2 text-[8px]">
                        <div>
                          <span className="font-black text-gray-400 uppercase">Items</span>
                          <span className="block font-bold text-gray-600">{order.shopify.items.length}</span>
                        </div>
                        <div>
                          <span className="font-black text-gray-400 uppercase">Total</span>
                          <span className="block font-bold text-gray-600">£{order.shopify.totalPrice}</span>
                        </div>
                        <div>
                          <span className="font-black text-gray-400 uppercase">SLA Target</span>
                          <span className="block font-bold text-gray-600">{order.slaTargetDate}</span>
                        </div>
                        <div>
                          <span className="font-black text-gray-400 uppercase">Status</span>
                          <span className="block font-bold text-gray-600">{order.productionStatus}</span>
                        </div>
                      </div>
                      {!order.decoJobId && col.id === 'new' && (
                        <button onClick={() => setShowLinkInput(order.shopify.id)} className="w-full mt-1 px-2 py-1.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1">
                          <Link2 className="w-3 h-3" /> Link to Job
                        </button>
                      )}
                      {shopifyDomain && (
                        <a href={`https://${shopifyDomain}/admin/orders/${order.shopify.id.split('/').pop()}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[8px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-widest">
                          <Eye className="w-3 h-3" /> View in Shopify
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KanbanBoard;
