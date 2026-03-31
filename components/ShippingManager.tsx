import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { loadShippingLabels, addShippingLabel, updateShippingLabel, deleteShippingLabel, ShippingLabel, CARRIER_LABELS, CARRIER_TRACKING_URLS } from '../services/shippingService';
import { Tag, Plus, X, Trash2, ExternalLink, Printer, Check, Package, Truck, Copy } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
  onFulfillWithTracking?: (orderId: string, trackingNumber: string) => void;
}

const ShippingManager: React.FC<Props> = ({ orders, onNavigateToOrder, onFulfillWithTracking }) => {
  const [labels, setLabels] = useState<ShippingLabel[]>(() => loadShippingLabels());
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ShippingLabel['status'] | 'all'>('all');

  // Form state
  const [formOrderNum, setFormOrderNum] = useState('');
  const [formCarrier, setFormCarrier] = useState<ShippingLabel['carrier']>('royal_mail');
  const [formService, setFormService] = useState('');
  const [formTracking, setFormTracking] = useState('');
  const [formWeight, setFormWeight] = useState('');

  const matchedOrder = useMemo(() => {
    const num = formOrderNum.replace('#', '');
    return orders.find(o => o.shopify.orderNumber === num);
  }, [orders, formOrderNum]);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return labels;
    return labels.filter(l => l.status === filterStatus);
  }, [labels, filterStatus]);

  const stats = useMemo(() => ({
    total: labels.length,
    created: labels.filter(l => l.status === 'created').length,
    printed: labels.filter(l => l.status === 'printed').length,
    dispatched: labels.filter(l => l.status === 'dispatched').length,
  }), [labels]);

  // Ready to ship orders (100% complete or stock dispatch ready, not yet fulfilled)
  const readyToShip = useMemo(() => {
    return orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled' &&
      (o.completionPercentage === 100 || o.isStockDispatchReady)
    );
  }, [orders]);

  const handleAdd = () => {
    if (!matchedOrder || !formTracking) return;
    const address = matchedOrder.shopify.customerName; // In real app, would include full address from Shopify
    const updated = addShippingLabel({
      orderId: matchedOrder.shopify.id,
      orderNumber: matchedOrder.shopify.orderNumber,
      carrier: formCarrier,
      service: formService || CARRIER_LABELS[formCarrier],
      trackingNumber: formTracking,
      weight: formWeight ? parseFloat(formWeight) : undefined,
      recipientName: matchedOrder.shopify.customerName,
      recipientAddress: address,
    });
    setLabels(updated);
    setShowForm(false);
    setFormOrderNum(''); setFormTracking(''); setFormWeight(''); setFormService('');
  };

  const handleStatusChange = (id: string, status: ShippingLabel['status']) => {
    const updates: Partial<ShippingLabel> = { status };
    if (status === 'printed') updates.printedAt = Date.now();
    if (status === 'dispatched') updates.dispatchedAt = Date.now();
    setLabels(updateShippingLabel(id, updates));
  };

  const handleFulfill = (label: ShippingLabel) => {
    if (onFulfillWithTracking) {
      // Extract numeric order ID from GID
      const numericId = label.orderId.split('/').pop() || label.orderId;
      onFulfillWithTracking(numericId, label.trackingNumber);
      handleStatusChange(label.id, 'dispatched');
    }
  };

  const handleDelete = (id: string) => {
    setLabels(deleteShippingLabel(id));
  };

  const copyTracking = (tracking: string) => {
    navigator.clipboard.writeText(tracking);
  };

  const statusColor = (status: ShippingLabel['status']) => {
    return {
      created: 'bg-blue-100 text-blue-700',
      printed: 'bg-amber-100 text-amber-700',
      dispatched: 'bg-emerald-100 text-emerald-700',
    }[status];
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-teal-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Shipping Labels</h3>
          {readyToShip.length > 0 && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black">{readyToShip.length} ready to ship</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="text-[10px] font-bold border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="all">All ({labels.length})</option>
            <option value="created">Created ({stats.created})</option>
            <option value="printed">Printed ({stats.printed})</option>
            <option value="dispatched">Dispatched ({stats.dispatched})</option>
          </select>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-teal-600 transition-colors flex items-center gap-1">
            <Plus className="w-3 h-3" /> Create Label
          </button>
        </div>
      </div>

      {/* Quick ship suggestions */}
      {readyToShip.length > 0 && !showForm && (
        <div className="px-4 py-2 border-b border-gray-50 bg-emerald-50/50">
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mb-1">Ready to Ship</p>
          <div className="flex flex-wrap gap-1">
            {readyToShip.slice(0, 8).map(o => (
              <button key={o.shopify.id} onClick={() => { setFormOrderNum(o.shopify.orderNumber); setShowForm(true); }} className="px-2 py-1 bg-white border border-emerald-200 rounded text-[9px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors">
                #{o.shopify.orderNumber} — {o.shopify.customerName}
              </button>
            ))}
            {readyToShip.length > 8 && <span className="text-[9px] text-emerald-500 px-2 py-1">+{readyToShip.length - 8} more</span>}
          </div>
        </div>
      )}

      {showForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-teal-50/50">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Order #</label>
              <input value={formOrderNum} onChange={e => setFormOrderNum(e.target.value)} placeholder="e.g. 1234" className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-teal-500 outline-none" />
              {formOrderNum && !matchedOrder && <p className="text-[8px] text-red-500 mt-0.5">Order not found</p>}
              {matchedOrder && <p className="text-[8px] text-emerald-500 mt-0.5">{matchedOrder.shopify.customerName}</p>}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Carrier</label>
              <select value={formCarrier} onChange={e => setFormCarrier(e.target.value as ShippingLabel['carrier'])} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-teal-500 outline-none">
                {Object.entries(CARRIER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Tracking #</label>
              <input value={formTracking} onChange={e => setFormTracking(e.target.value)} placeholder="Tracking number" className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-gray-500 tracking-widest block mb-1">Weight (kg)</label>
              <input type="number" step="0.1" value={formWeight} onChange={e => setFormWeight(e.target.value)} placeholder="Optional" className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-bold focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleAdd} disabled={!matchedOrder || !formTracking} className="px-4 py-1.5 bg-teal-500 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-teal-600 disabled:opacity-50 transition-colors">Save</button>
              <button onClick={() => setShowForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2" />
            <p className="text-xs font-bold uppercase tracking-widest">No shipping labels yet</p>
          </div>
        ) : filtered.map(l => (
          <div key={l.id} className={`px-4 py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors ${l.status === 'created' ? 'border-l-4 border-blue-400' : l.status === 'printed' ? 'border-l-4 border-amber-400' : 'border-l-4 border-emerald-400'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => onNavigateToOrder?.(l.orderNumber)} className="text-xs font-black text-gray-800 hover:text-indigo-600 transition-colors">
                  #{l.orderNumber}
                </button>
                <span className="text-[10px] font-bold text-gray-500">{l.recipientName}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${statusColor(l.status)}`}>{l.status}</span>
                <span className="text-[9px] font-bold text-gray-400">{CARRIER_LABELS[l.carrier]}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-[10px] text-gray-700">{l.trackingNumber}</span>
                <button onClick={() => copyTracking(l.trackingNumber)} className="text-gray-300 hover:text-gray-600"><Copy className="w-3 h-3" /></button>
                {l.trackingUrl && (
                  <a href={l.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {l.weight && <span className="text-[9px] text-gray-400">{l.weight}kg</span>}
              </div>
              <p className="text-[8px] text-gray-400 mt-0.5">
                Created {new Date(l.createdAt).toLocaleDateString('en-GB')}
                {l.dispatchedAt && ` • Dispatched ${new Date(l.dispatchedAt).toLocaleDateString('en-GB')}`}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {l.status === 'created' && (
                <button onClick={() => handleStatusChange(l.id, 'printed')} className="px-2 py-1 text-[9px] font-bold bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors flex items-center gap-1">
                  <Printer className="w-3 h-3" /> Printed
                </button>
              )}
              {l.status === 'printed' && onFulfillWithTracking && (
                <button onClick={() => handleFulfill(l)} className="px-2 py-1 text-[9px] font-bold bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors flex items-center gap-1">
                  <Truck className="w-3 h-3" /> Fulfill & Dispatch
                </button>
              )}
              {l.status === 'printed' && !onFulfillWithTracking && (
                <button onClick={() => handleStatusChange(l.id, 'dispatched')} className="px-2 py-1 text-[9px] font-bold bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors flex items-center gap-1">
                  <Check className="w-3 h-3" /> Dispatched
                </button>
              )}
              <button onClick={() => handleDelete(l.id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors" title="Delete"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ShippingManager;
