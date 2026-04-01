import React, { useState, useMemo, useCallback } from 'react';
import { UnifiedOrder, ShopifyOrder } from '../types';
import { Package, CheckCircle2, Loader2, Truck, X, AlertTriangle, ChevronDown } from 'lucide-react';
import { fulfillShopifyOrder } from '../services/fulfillmentService';
import { ApiSettings } from './SettingsModal';

interface Props {
  orders: UnifiedOrder[];
  settings: ApiSettings;
  onFulfilled: (orderId: string) => void;
  onNavigateToOrder: (orderNumber: string) => void;
}

interface FulfillmentResult {
  orderId: string;
  orderNumber: string;
  success: boolean;
  error?: string;
}

const BatchFulfillment: React.FC<Props> = ({ orders, settings, onFulfilled, onNavigateToOrder }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [results, setResults] = useState<FulfillmentResult[]>([]);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingCompany, setTrackingCompany] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [filter, setFilter] = useState<'ready' | 'all'>('ready');

  // Orders that are ready to fulfill: unfulfilled with all stock ready or production complete
  const readyOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.shopify.fulfillmentStatus === 'fulfilled' || o.shopify.fulfillmentStatus === 'restocked') return false;
      if (filter === 'ready') {
        // Ready = all MTO items produced OR all stock items ready
        return o.isStockDispatchReady || o.completionPercentage >= 100;
      }
      return o.shopify.fulfillmentStatus === 'unfulfilled' || o.shopify.fulfillmentStatus === 'partial';
    }).sort((a, b) => {
      // Sort by completion % desc, then by date asc
      if (b.completionPercentage !== a.completionPercentage) return b.completionPercentage - a.completionPercentage;
      return new Date(a.shopify.date).getTime() - new Date(b.shopify.date).getTime();
    });
  }, [orders, filter]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === readyOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(readyOrders.map(o => o.shopify.id)));
    }
  }, [readyOrders, selectedIds]);

  const handleBatchFulfill = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsFulfilling(true);
    setResults([]);
    setShowResults(true);
    const batchResults: FulfillmentResult[] = [];

    for (const orderId of Array.from(selectedIds)) {
      const order = readyOrders.find(o => o.shopify.id === orderId);
      if (!order) continue;

      try {
        const result = await fulfillShopifyOrder(
          settings,
          orderId,
          trackingNumber || undefined,
          trackingCompany || undefined
        );
        batchResults.push({
          orderId,
          orderNumber: order.shopify.orderNumber,
          success: result.success,
          error: result.error
        });
        if (result.success) {
          onFulfilled(orderId);
        }
      } catch (e: any) {
        batchResults.push({
          orderId,
          orderNumber: order.shopify.orderNumber,
          success: false,
          error: e.message
        });
      }
      setResults([...batchResults]);
    }

    setIsFulfilling(false);
    setSelectedIds(new Set());
  }, [selectedIds, readyOrders, settings, trackingNumber, trackingCompany, onFulfilled]);

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-white">Batch Fulfillment</h2>
          <span className="px-2 py-0.5 rounded-full bg-white/10 text-[9px] font-black text-gray-300">
            {readyOrders.length} orders
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white/5 rounded border border-white/10">
            <button onClick={() => setFilter('ready')} className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all ${filter === 'ready' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white'}`}>Ready Only</button>
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all ${filter === 'all' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white'}`}>All Unfulfilled</button>
          </div>
        </div>
      </div>

      {/* Tracking Info (optional) */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-3 flex items-center gap-3">
        <Truck className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="flex-1 flex gap-2">
          <input
            value={trackingNumber}
            onChange={e => setTrackingNumber(e.target.value)}
            placeholder="Tracking number (optional — applies to all)"
            className="flex-1 bg-transparent border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white placeholder:text-gray-500 focus:border-blue-500/50 outline-none"
          />
          <input
            value={trackingCompany}
            onChange={e => setTrackingCompany(e.target.value)}
            placeholder="Carrier (e.g. Royal Mail)"
            className="w-40 bg-transparent border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white placeholder:text-gray-500 focus:border-blue-500/50 outline-none"
          />
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between bg-white/5 rounded-xl border border-white/10 p-3">
        <div className="flex items-center gap-3">
          <button onClick={toggleSelectAll} className="text-[9px] font-black uppercase tracking-wider text-gray-400 hover:text-white transition-colors">
            {selectedIds.size === readyOrders.length && readyOrders.length > 0 ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-[10px] font-bold text-gray-500">{selectedIds.size} selected</span>
        </div>
        <button
          onClick={handleBatchFulfill}
          disabled={selectedIds.size === 0 || isFulfilling}
          className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
        >
          {isFulfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Fulfill {selectedIds.size} Order{selectedIds.size !== 1 ? 's' : ''}
        </button>
      </div>

      {/* Results */}
      {showResults && results.length > 0 && (
        <div className="bg-white/5 rounded-xl border border-white/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Results</span>
              {successCount > 0 && <span className="text-[9px] font-black text-emerald-400">{successCount} succeeded</span>}
              {failCount > 0 && <span className="text-[9px] font-black text-red-400">{failCount} failed</span>}
            </div>
            <button onClick={() => { setShowResults(false); setResults([]); }} className="p-1 hover:bg-white/10 rounded"><X className="w-3 h-3 text-gray-400" /></button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {results.map(r => (
              <div key={r.orderId} className="flex items-center gap-2 text-[10px]">
                {r.success ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-red-400" />}
                <button onClick={() => onNavigateToOrder(r.orderNumber)} className="font-black text-indigo-300 hover:text-indigo-200">#{r.orderNumber}</button>
                {r.error && <span className="text-red-400 font-bold truncate">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order List */}
      {readyOrders.length === 0 ? (
        <div className="bg-white/5 rounded-xl border border-white/10 p-8 text-center">
          <Package className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-gray-400">No orders ready to fulfill</p>
          <p className="text-[10px] text-gray-500 mt-1">Orders will appear here when production is complete</p>
        </div>
      ) : (
        <div className="space-y-1">
          {readyOrders.map(o => {
            const isSelected = selectedIds.has(o.shopify.id);
            const itemCount = o.shopify.items.reduce((sum, i) => sum + i.quantity, 0);
            return (
              <div
                key={o.shopify.id}
                onClick={() => toggleSelect(o.shopify.id)}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                {/* Checkbox */}
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                  isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-600'
                }`}>
                  {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                </div>

                {/* Order Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); onNavigateToOrder(o.shopify.orderNumber); }} className="text-[11px] font-black text-indigo-300 hover:text-indigo-200">
                      #{o.shopify.orderNumber}
                    </button>
                    <span className="text-[10px] font-bold text-gray-400">{o.shopify.customerName}</span>
                    {o.clubName && <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-[8px] font-black text-indigo-300">{o.clubName}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[9px] text-gray-500 font-bold">{itemCount} items</span>
                    <span className="text-[9px] text-gray-500 font-bold">£{parseFloat(o.shopify.totalPrice).toFixed(2)}</span>
                    <span className="text-[9px] text-gray-500 font-bold">{new Date(o.shopify.date).toLocaleDateString('en-GB')}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="text-right shrink-0">
                  <div className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                    o.completionPercentage >= 100
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : o.completionPercentage >= 50
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                  }`}>
                    {o.completionPercentage >= 100 ? 'Ready' : `${Math.round(o.completionPercentage)}% complete`}
                  </div>
                  {o.decoJobId && <div className="text-[8px] text-gray-500 font-bold mt-0.5">Deco #{o.decoJobId}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BatchFulfillment;
