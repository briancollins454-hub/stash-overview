import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { UnifiedOrder } from '../types';
import {
  Package, CheckCircle2, Loader2, Truck, X, AlertTriangle, ChevronDown,
  ChevronUp, Printer, MapPin, Phone, Mail, ExternalLink, Tag, ShoppingBag,
  Search, RotateCcw, AlertCircle
} from 'lucide-react';
import {
  fetchShipStationOrder, createShipStationLabel, fetchShipStationCarriers,
  getCarrierName, getTrackingUrl, validateShipStationAddress,
  ShipStationOrder, ShipStationLabelResult
} from '../services/shipstationService';
import { printOrderSheet, printOrderSheets } from '../utils/printOrderSheet';
import { ApiSettings } from './SettingsModal';

interface Props {
  orders: UnifiedOrder[];
  settings: ApiSettings;
  onFulfilled: (orderId: string) => void;
  onNavigateToOrder: (orderNumber: string) => void;
}

interface CarrierOption {
  code: string;
  name: string;
  services: Array<{ code: string; name: string }>;
}

const BatchFulfillment: React.FC<Props> = ({ orders, settings, onFulfilled, onNavigateToOrder }) => {
  const [filter, setFilter] = useState<'ready' | 'all'>('ready');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ShipStation state per expanded order
  const [ssOrder, setSsOrder] = useState<ShipStationOrder | null>(null);
  const [ssLoading, setSsLoading] = useState(false);
  const [ssError, setSsError] = useState<string | null>(null);

  // Label creation
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [carriersLoaded, setCarriersLoaded] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [weight, setWeight] = useState({ value: 250, units: 'grams' as const });
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [labelResult, setLabelResult] = useState<ShipStationLabelResult | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  // Confirmation modal (single order)
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Batch ship state
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const [batchShipping, setBatchShipping] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; orderNumber: string; status: string }>({ current: 0, total: 0, orderNumber: '', status: '' });
  const [batchResults, setBatchResults] = useState<Array<{ orderNumber: string; success: boolean; trackingNumber?: string; error?: string; orderId?: string }>>([]);
  const [showBatchResults, setShowBatchResults] = useState(false);

  // Address warnings — computed from order data, no API call needed for basic checks
  const getAddressWarnings = useCallback((o: UnifiedOrder): string[] => {
    const warnings: string[] = [];
    const addr = o.shopify.shippingAddress;
    if (!addr) {
      warnings.push('No shipping address');
      return warnings;
    }
    if (!addr.name || addr.name.trim().length < 2) warnings.push('Missing recipient name');
    if (!addr.address1 || addr.address1.trim().length < 3) warnings.push('Missing street address');
    if (!addr.city || addr.city.trim().length < 2) warnings.push('Missing city');
    if (!addr.zip || addr.zip.trim().length < 3) warnings.push('Missing or short postcode');
    if (!addr.country || addr.country.trim().length < 2) warnings.push('Missing country');
    if (!addr.phone) warnings.push('No phone number');
    return warnings;
  }, []);

  // Ready orders
  const readyOrders = useMemo(() => {
    let filtered = orders.filter(o => {
      if (o.shopify.fulfillmentStatus === 'fulfilled' || o.shopify.fulfillmentStatus === 'restocked') return false;
      if (filter === 'ready') {
        return o.isStockDispatchReady || o.completionPercentage >= 100;
      }
      return o.shopify.fulfillmentStatus === 'unfulfilled' || o.shopify.fulfillmentStatus === 'partial';
    });

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(o =>
        o.shopify.orderNumber.toLowerCase().includes(term) ||
        o.shopify.customerName.toLowerCase().includes(term) ||
        (o.clubName && o.clubName.toLowerCase().includes(term))
      );
    }

    return filtered.sort((a, b) => {
      if (b.completionPercentage !== a.completionPercentage) return b.completionPercentage - a.completionPercentage;
      return new Date(a.shopify.date).getTime() - new Date(b.shopify.date).getTime();
    });
  }, [orders, filter, searchTerm]);

  // Load carriers once
  useEffect(() => {
    if (carriersLoaded) return;
    fetchShipStationCarriers(settings).then(c => {
      setCarriers(c);
      setCarriersLoaded(true);
      // Default to first carrier/service
      if (c.length > 0) {
        setSelectedCarrier(c[0].code);
        if (c[0].services.length > 0) setSelectedService(c[0].services[0].code);
      }
    }).catch(() => setCarriersLoaded(true));
  }, [settings, carriersLoaded]);

  // When expanding an order, look it up in ShipStation
  const handleExpand = useCallback(async (orderId: string, orderNumber: string) => {
    if (expandedId === orderId) {
      setExpandedId(null);
      setSsOrder(null);
      setSsError(null);
      setLabelResult(null);
      setLabelError(null);
      return;
    }

    setExpandedId(orderId);
    setSsOrder(null);
    setSsError(null);
    setLabelResult(null);
    setLabelError(null);
    setSsLoading(true);

    try {
      const order = await fetchShipStationOrder(settings, orderNumber);
      setSsOrder(order);
      if (!order) setSsError('Order not found in ShipStation — it may not have imported yet');
      else {
        // Pre-fill carrier/service from ShipStation order if set
        if (order.carrierCode) setSelectedCarrier(order.carrierCode);
        if (order.serviceCode) setSelectedService(order.serviceCode);
        if (order.weight) setWeight(order.weight);
      }
    } catch (e: any) {
      setSsError(e.message);
    } finally {
      setSsLoading(false);
    }
  }, [expandedId, settings]);

  // Create label
  const handleCreateLabel = useCallback(async () => {
    if (!ssOrder || !selectedCarrier || !selectedService) return;
    setShowConfirmation(false);
    setIsCreatingLabel(true);
    setLabelError(null);

    try {
      const result = await createShipStationLabel(
        settings,
        ssOrder.orderId,
        selectedCarrier,
        selectedService,
        weight
      );
      setLabelResult(result);
      // Open label PDF in new tab for printing
      if (result.labelData) {
        const byteChars = atob(result.labelData);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
      // Refresh order in parent (ShipStation will push fulfillment to Shopify)
      if (expandedId) onFulfilled(expandedId);
    } catch (e: any) {
      setLabelError(e.message);
    } finally {
      setIsCreatingLabel(false);
    }
  }, [ssOrder, selectedCarrier, selectedService, weight, settings, expandedId, onFulfilled]);

  const currentCarrier = carriers.find(c => c.code === selectedCarrier);
  const currentServices = currentCarrier?.services || [];

  // Toggle selection
  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === readyOrders.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(readyOrders.map(o => o.shopify.id)));
  }, [readyOrders, selectedIds]);

  // Batch print selected orders
  const handleBatchPrint = useCallback(() => {
    const selected = readyOrders.filter(o => selectedIds.has(o.shopify.id));
    printOrderSheets(selected);
  }, [readyOrders, selectedIds]);

  // Print single order
  const handlePrintPackingSlip = useCallback((o: UnifiedOrder) => {
    printOrderSheet(o);
  }, []);

  // Batch Print + Ship: print packing slips, create labels for all selected, auto-fulfill via ShipStation
  const handleBatchShip = useCallback(async () => {
    const selected = readyOrders.filter(o => selectedIds.has(o.shopify.id) && o.shopify.fulfillmentStatus !== 'fulfilled');
    if (selected.length === 0) return;

    setShowBatchConfirm(false);
    setBatchShipping(true);
    setBatchResults([]);
    setShowBatchResults(true);

    // Step 1: Print all packing slips
    setBatchProgress({ current: 0, total: selected.length, orderNumber: '', status: 'Printing packing slips...' });
    printOrderSheets(selected);

    // Step 2: Create labels one by one
    const results: Array<{ orderNumber: string; success: boolean; trackingNumber?: string; error?: string; orderId?: string }> = [];

    for (let i = 0; i < selected.length; i++) {
      const order = selected[i];
      setBatchProgress({ current: i + 1, total: selected.length, orderNumber: order.shopify.orderNumber, status: 'Creating label...' });

      // Check address before attempting label
      const addrWarnings = getAddressWarnings(order);
      let hasBlockingWarning = addrWarnings.some(w => w !== 'No phone number');

      // Look up order in ShipStation (needed for label creation anyway)
      let ssOrd: ShipStationOrder | null = null;
      try {
        ssOrd = await fetchShipStationOrder(settings, order.shopify.orderNumber);
      } catch { /* handled below */ }

      // If Shopify address missing but ShipStation has it, re-check with SS address
      if (hasBlockingWarning && !order.shopify.shippingAddress && ssOrd?.shipTo) {
        const sa = ssOrd.shipTo;
        const ssWarnings: string[] = [];
        if (!sa.name || sa.name.trim().length < 2) ssWarnings.push('Missing recipient name');
        if (!sa.street1 || sa.street1.trim().length < 3) ssWarnings.push('Missing street address');
        if (!sa.city || sa.city.trim().length < 2) ssWarnings.push('Missing city');
        if (!sa.postalCode || sa.postalCode.trim().length < 3) ssWarnings.push('Missing or short postcode');
        if (!sa.country || sa.country.trim().length < 2) ssWarnings.push('Missing country');
        hasBlockingWarning = ssWarnings.some(w => w !== 'No phone number');
        if (hasBlockingWarning) {
          results.push({ orderNumber: order.shopify.orderNumber, success: false, error: 'Address issue: ' + ssWarnings.filter(w => w !== 'No phone number').join(', '), orderId: order.shopify.id });
          setBatchResults([...results]);
          continue;
        }
      } else if (hasBlockingWarning) {
        results.push({ orderNumber: order.shopify.orderNumber, success: false, error: 'Address issue: ' + addrWarnings.filter(w => w !== 'No phone number').join(', '), orderId: order.shopify.id });
        setBatchResults([...results]);
        continue;
      }

      try {
        if (!ssOrd) {
          results.push({ orderNumber: order.shopify.orderNumber, success: false, error: 'Not found in ShipStation', orderId: order.shopify.id });
          continue;
        }

        // Use order's carrier/service if set, otherwise use defaults
        const carrier = ssOrd.carrierCode || selectedCarrier;
        const service = ssOrd.serviceCode || selectedService;
        const wt = ssOrd.weight || weight;

        if (!carrier || !service) {
          results.push({ orderNumber: order.shopify.orderNumber, success: false, error: 'No carrier/service configured', orderId: order.shopify.id });
          continue;
        }

        // Create the label
        const result = await createShipStationLabel(settings, ssOrd.orderId, carrier, service, wt);
        results.push({ orderNumber: order.shopify.orderNumber, success: true, trackingNumber: result.trackingNumber, orderId: order.shopify.id });

        // Open label PDF
        if (result.labelData) {
          const byteChars = atob(result.labelData);
          const byteNums = new Array(byteChars.length);
          for (let j = 0; j < byteChars.length; j++) byteNums[j] = byteChars.charCodeAt(j);
          const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        }

        // Notify parent to refresh
        onFulfilled(order.shopify.id);
      } catch (e: any) {
        results.push({ orderNumber: order.shopify.orderNumber, success: false, error: e.message, orderId: order.shopify.id });
      }

      setBatchResults([...results]);
    }

    setBatchProgress({ current: selected.length, total: selected.length, orderNumber: '', status: 'Complete' });
    setBatchShipping(false);
  }, [readyOrders, selectedIds, settings, selectedCarrier, selectedService, weight, onFulfilled, getAddressWarnings]);

  // Retry only the failed orders from the last batch
  const handleRetryFailed = useCallback(async () => {
    const failedOrderNumbers = batchResults.filter(r => !r.success).map(r => r.orderNumber);
    if (failedOrderNumbers.length === 0) return;

    const failedOrders = readyOrders.filter(o => failedOrderNumbers.includes(o.shopify.orderNumber));
    if (failedOrders.length === 0) return;

    setBatchShipping(true);
    // Keep successful results, clear failed ones
    const keptResults = batchResults.filter(r => r.success);
    const newResults = [...keptResults];
    setBatchResults(newResults);

    for (let i = 0; i < failedOrders.length; i++) {
      const order = failedOrders[i];
      setBatchProgress({ current: i + 1, total: failedOrders.length, orderNumber: order.shopify.orderNumber, status: 'Retrying...' });

      try {
        const ssOrd = await fetchShipStationOrder(settings, order.shopify.orderNumber);
        if (!ssOrd) {
          newResults.push({ orderNumber: order.shopify.orderNumber, success: false, error: 'Not found in ShipStation', orderId: order.shopify.id });
          setBatchResults([...newResults]);
          continue;
        }

        const carrier = ssOrd.carrierCode || selectedCarrier;
        const service = ssOrd.serviceCode || selectedService;
        const wt = ssOrd.weight || weight;

        if (!carrier || !service) {
          newResults.push({ orderNumber: order.shopify.orderNumber, success: false, error: 'No carrier/service configured', orderId: order.shopify.id });
          setBatchResults([...newResults]);
          continue;
        }

        const result = await createShipStationLabel(settings, ssOrd.orderId, carrier, service, wt);
        newResults.push({ orderNumber: order.shopify.orderNumber, success: true, trackingNumber: result.trackingNumber, orderId: order.shopify.id });

        if (result.labelData) {
          const byteChars = atob(result.labelData);
          const byteNums = new Array(byteChars.length);
          for (let j = 0; j < byteChars.length; j++) byteNums[j] = byteChars.charCodeAt(j);
          const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
          window.open(URL.createObjectURL(blob), '_blank');
        }

        onFulfilled(order.shopify.id);
      } catch (e: any) {
        newResults.push({ orderNumber: order.shopify.orderNumber, success: false, error: e.message, orderId: order.shopify.id });
      }

      setBatchResults([...newResults]);
    }

    setBatchProgress({ current: failedOrders.length, total: failedOrders.length, orderNumber: '', status: 'Complete' });
    setBatchShipping(false);
  }, [batchResults, readyOrders, settings, selectedCarrier, selectedService, weight, onFulfilled]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-blue-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-white">Ready to Ship</h2>
          <span className="px-2 py-0.5 rounded-full bg-white/10 text-[9px] font-black text-gray-300">
            {readyOrders.length} orders
          </span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search orders..."
              className="w-full sm:w-44 bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-[10px] font-bold text-white placeholder:text-gray-500 focus:border-blue-500/50 outline-none"
            />
          </div>
          <div className="flex bg-white/5 rounded border border-white/10">
            <button onClick={() => setFilter('ready')} className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${filter === 'ready' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white'}`}>Ready Only</button>
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${filter === 'all' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white'}`}>All Unfulfilled</button>
          </div>
        </div>
      </div>

      {/* Batch Action Bar */}
      <div className="flex items-center justify-between bg-white/5 rounded-xl border border-white/10 p-3">
        <div className="flex items-center gap-3">
          <button onClick={toggleSelectAll} className="text-[9px] font-black uppercase tracking-wider text-gray-400 hover:text-white transition-colors">
            {selectedIds.size === readyOrders.length && readyOrders.length > 0 ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-[10px] font-bold text-gray-500">{selectedIds.size} selected</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleBatchPrint}
            disabled={selectedIds.size === 0}
            className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/15 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> Print {selectedIds.size} Packing Slip{selectedIds.size !== 1 ? 's' : ''}
          </button>
          <button
            onClick={() => setShowBatchConfirm(true)}
            disabled={selectedIds.size === 0 || batchShipping}
            className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            {batchShipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
            Print & Ship {selectedIds.size} Order{selectedIds.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>

      {/* Batch Ship Confirmation */}
      {showBatchConfirm && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-black text-amber-300 mb-1">Confirm Batch Ship</p>
              <p className="text-[10px] text-amber-200/80 font-bold leading-relaxed">
                This will print packing slips and create shipping labels for {readyOrders.filter(o => selectedIds.has(o.shopify.id) && o.shopify.fulfillmentStatus !== 'fulfilled').length} orders using the default carrier/service from ShipStation.
                Each label will charge your ShipStation account and auto-fulfil the order on Shopify.
              </p>
              {(() => {
                const addrIssueCount = readyOrders.filter(o => selectedIds.has(o.shopify.id) && o.shopify.fulfillmentStatus !== 'fulfilled' && getAddressWarnings(o).some(w => w !== 'No phone number')).length;
                return addrIssueCount > 0 ? (
                  <p className="text-[10px] text-red-400 font-bold mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {addrIssueCount} order{addrIssueCount !== 1 ? 's have' : ' has'} address issues and will be skipped
                  </p>
                ) : null;
              })()}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[8px] font-black uppercase text-gray-500 block mb-1">Default Carrier</label>
              <select
                value={selectedCarrier}
                onChange={e => {
                  setSelectedCarrier(e.target.value);
                  const c = carriers.find(c => c.code === e.target.value);
                  if (c?.services.length) setSelectedService(c.services[0].code);
                }}
                className="w-full bg-white/10 border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white outline-none"
              >
                {carriers.map(c => <option key={c.code} value={c.code} className="bg-gray-800">{c.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[8px] font-black uppercase text-gray-500 block mb-1">Default Service</label>
              <select
                value={selectedService}
                onChange={e => setSelectedService(e.target.value)}
                className="w-full bg-white/10 border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white outline-none"
              >
                {currentServices.map(s => <option key={s.code} value={s.code} className="bg-gray-800">{s.name}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="text-[8px] font-black uppercase text-gray-500 block mb-1">Weight (g)</label>
              <input
                type="number"
                value={weight.value}
                onChange={e => setWeight({ value: Number(e.target.value), units: 'grams' })}
                className="w-full bg-white/10 border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleBatchShip} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white transition-all flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" /> Yes, Print & Ship All
            </button>
            <button onClick={() => setShowBatchConfirm(false)} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/15 text-gray-300 transition-all">Cancel</button>
          </div>
        </div>
      )}

      {/* Batch Progress / Results */}
      {showBatchResults && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-white flex items-center gap-1.5">
              {batchShipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              {batchShipping ? `Shipping ${batchProgress.current}/${batchProgress.total}...` : 'Batch Ship Complete'}
            </h4>
            <div className="flex items-center gap-2">
              {!batchShipping && batchResults.some(r => !r.success) && (
                <button
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-all flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3 h-3" /> Retry {batchResults.filter(r => !r.success).length} Failed
                </button>
              )}
              {!batchShipping && (
                <button onClick={() => { setShowBatchResults(false); setBatchResults([]); }} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          </div>
          {/* Summary counts */}
          {!batchShipping && batchResults.length > 0 && (
            <div className="flex items-center gap-4">
              <span className="text-[9px] font-black text-emerald-400">{batchResults.filter(r => r.success).length} succeeded</span>
              {batchResults.some(r => !r.success) && <span className="text-[9px] font-black text-red-400">{batchResults.filter(r => !r.success).length} failed</span>}
            </div>
          )}
          {batchShipping && (
            <div>
              <div className="w-full bg-white/10 rounded-full h-1.5 mb-2">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
              </div>
              <p className="text-[9px] text-gray-400 font-bold">#{batchProgress.orderNumber} — {batchProgress.status}</p>
            </div>
          )}
          {batchResults.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {batchResults.map((r, idx) => (
                <div key={idx} className={`flex items-center justify-between text-[10px] font-bold px-2 py-1 rounded ${r.success ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                  <span>#{r.orderNumber}</span>
                  <span>{r.success ? `✓ ${r.trackingNumber}` : `✗ ${r.error}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Order List */}
      {readyOrders.length === 0 ? (
        <div className="bg-white/5 rounded-xl border border-white/10 p-8 text-center">
          <Package className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-gray-400">No orders ready to ship</p>
          <p className="text-[10px] text-gray-500 mt-1">Orders appear here when production is complete</p>
        </div>
      ) : (
        <div className="space-y-2">
          {readyOrders.map(o => {
            const isExpanded = expandedId === o.shopify.id;
            // Use ShipStation's shipTo as fallback when Shopify address is missing
            const shopifyAddr = o.shopify.shippingAddress;
            const ssAddr = isExpanded && ssOrder?.shipTo ? {
              name: ssOrder.shipTo.name || '',
              address1: ssOrder.shipTo.street1 || '',
              address2: ssOrder.shipTo.street2 || '',
              city: ssOrder.shipTo.city || '',
              province: ssOrder.shipTo.state || '',
              zip: ssOrder.shipTo.postalCode || '',
              country: ssOrder.shipTo.country || '',
              phone: ssOrder.shipTo.phone || ''
            } : undefined;
            const addr = shopifyAddr || ssAddr;
            const addrFromSS = !shopifyAddr && !!ssAddr;
            const itemCount = o.shopify.items.reduce((sum, i) => sum + i.quantity, 0);
            const hasTracking = !!o.shipStationTracking?.trackingNumber;
            const isPartial = o.shopify.fulfillmentStatus === 'partial';
            const isFullyShipped = hasTracking && !isPartial;
            // Recalculate address warnings using fallback address if available
            const addrWarnings = addr && addrFromSS ? (() => {
              const w: string[] = [];
              if (!addr.name || addr.name.trim().length < 2) w.push('Missing recipient name');
              if (!addr.address1 || addr.address1.trim().length < 3) w.push('Missing street address');
              if (!addr.city || addr.city.trim().length < 2) w.push('Missing city');
              if (!addr.zip || addr.zip.trim().length < 3) w.push('Missing or short postcode');
              if (!addr.country || addr.country.trim().length < 2) w.push('Missing country');
              if (!addr.phone) w.push('No phone number');
              return w;
            })() : getAddressWarnings(o);
            const hasAddrWarning = addrWarnings.length > 0 && addrWarnings.some(w => w !== 'No phone number');

            return (
              <div key={o.shopify.id} className={`rounded-xl border transition-all ${isExpanded ? 'bg-white/[0.07] border-blue-500/30' : 'bg-white/5 border-white/10 hover:border-white/20'}`}>
                {/* Order Row */}
                <div
                  onClick={() => handleExpand(o.shopify.id, o.shopify.orderNumber)}
                  className={`flex items-center gap-3 p-3 cursor-pointer ${selectedIds.has(o.shopify.id) ? 'bg-blue-500/5' : ''}`}
                >
                  {/* Checkbox */}
                  <div
                    onClick={(e) => toggleSelect(o.shopify.id, e)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer ${selectedIds.has(o.shopify.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-600 hover:border-gray-400'}`}
                  >
                    {selectedIds.has(o.shopify.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={e => { e.stopPropagation(); onNavigateToOrder(o.shopify.orderNumber); }} className="text-[11px] font-black text-indigo-300 hover:text-indigo-200">
                        #{o.shopify.orderNumber}
                      </button>
                      <span className="text-[10px] font-bold text-gray-400">{o.shopify.customerName}</span>
                      {o.clubName && <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-[8px] font-black text-indigo-300">{o.clubName}</span>}
                      {hasTracking && isPartial && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-[8px] font-black text-amber-400 flex items-center gap-1"><Package className="w-2.5 h-2.5" /> Partial</span>}
                      {isFullyShipped && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-[8px] font-black text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Shipped</span>}
                      {hasAddrWarning && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-[8px] font-black text-red-400 flex items-center gap-1" title={addrWarnings.join(', ')}><AlertCircle className="w-2.5 h-2.5" /> Address</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[9px] text-gray-500 font-bold">{itemCount} items</span>
                      <span className="text-[9px] text-gray-500 font-bold">£{parseFloat(o.shopify.totalPrice).toFixed(2)}</span>
                      <span className="text-[9px] text-gray-500 font-bold">{new Date(o.shopify.date).toLocaleDateString('en-GB')}</span>
                      {addr && <span className="text-[9px] text-gray-500 font-bold hidden sm:inline">{addr.city}, {addr.zip}</span>}
                    </div>
                  </div>

                  {/* Status + Expand */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                      o.completionPercentage >= 100
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : o.completionPercentage >= 50
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-red-500/20 text-red-400'
                    }`}>
                      {o.completionPercentage >= 100 ? 'Ready' : `${Math.round(o.completionPercentage)}%`}
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-white/10 p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Shipping Address */}
                      <div className="bg-white/5 rounded-lg p-3">
                        <h4 className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Ship To</h4>
                        {addr ? (
                          <div className="text-[11px] text-white font-bold leading-relaxed">
                            {addrFromSS && <p className="text-[9px] text-amber-400 font-black mb-1">via ShipStation (not in Shopify cache)</p>}
                            <p>{addr.name}</p>
                            <p>{addr.address1}</p>
                            {addr.address2 && <p>{addr.address2}</p>}
                            <p>{addr.city}{addr.province ? `, ${addr.province}` : ''}</p>
                            <p>{addr.zip}</p>
                            <p className="text-gray-400">{addr.country}</p>
                            {addr.phone && <p className="flex items-center gap-1 mt-1 text-gray-400"><Phone className="w-3 h-3" /> {addr.phone}</p>}
                          </div>
                        ) : (
                          <p className="text-[10px] text-red-400 font-bold">{ssLoading ? 'Loading address from ShipStation...' : 'No shipping address on file'}</p>
                        )}
                        {addrWarnings.length > 0 && (
                          <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded p-2 space-y-0.5">
                            {addrWarnings.map((w, i) => (
                              <p key={i} className="text-[9px] font-bold text-red-400 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5 shrink-0" /> {w}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Order Items */}
                      <div className="bg-white/5 rounded-lg p-3">
                        <h4 className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1.5"><ShoppingBag className="w-3 h-3" /> Items ({itemCount})</h4>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {o.shopify.items.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold text-white truncate">{item.title}</p>
                                {item.variantTitle && <p className="text-[9px] text-gray-500">{item.variantTitle}</p>}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-[9px] font-black text-gray-400">×{item.quantity}</span>
                                <span className="text-[10px] font-bold text-gray-300">£{parseFloat(item.price).toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-white/10 mt-2 pt-2 flex justify-between">
                          <span className="text-[9px] font-black uppercase text-gray-400">Total</span>
                          <span className="text-[11px] font-black text-white">£{parseFloat(o.shopify.totalPrice).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handlePrintPackingSlip(o)}
                        className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/15 text-white transition-all flex items-center gap-1.5"
                      >
                        <Printer className="w-3.5 h-3.5" /> Print Packing Slip
                      </button>
                      <a
                        href={`https://ship8.shipstation.com/orders/all-orders-search-result?quickSearch=${o.shopify.orderNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/15 text-white transition-all flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open in ShipStation
                      </a>
                      {o.shipStationTracking?.trackingNumber && (
                        <a
                          href={getTrackingUrl(o.shipStationTracking.carrier, o.shipStationTracking.trackingNumber) || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-all flex items-center gap-1.5"
                        >
                          <Package className="w-3.5 h-3.5" /> Track: {o.shipStationTracking.trackingNumber}
                        </a>
                      )}
                    </div>

                    {/* ShipStation Label Section — show for orders without tracking OR partially fulfilled */}
                    {(!hasTracking || isPartial) && (
                      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 space-y-3">
                        <h4 className="text-[9px] font-black uppercase tracking-widest text-blue-300 flex items-center gap-1.5"><Tag className="w-3 h-3" /> Create Shipping Label</h4>

                        {ssLoading ? (
                          <div className="flex items-center gap-2 text-[10px] text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up in ShipStation...</div>
                        ) : ssError ? (
                          <div className="flex items-center gap-2 text-[10px] text-amber-400"><AlertTriangle className="w-3.5 h-3.5" /> {ssError}</div>
                        ) : ssOrder ? (
                          <>
                            <div className="flex flex-wrap gap-2">
                              {/* Carrier select */}
                              <div className="flex-1 min-w-[140px]">
                                <label className="text-[8px] font-black uppercase text-gray-500 block mb-1">Carrier</label>
                                <select
                                  value={selectedCarrier}
                                  onChange={e => {
                                    setSelectedCarrier(e.target.value);
                                    const c = carriers.find(c => c.code === e.target.value);
                                    if (c?.services.length) setSelectedService(c.services[0].code);
                                  }}
                                  className="w-full bg-white/10 border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white outline-none"
                                >
                                  {carriers.map(c => <option key={c.code} value={c.code} className="bg-gray-800">{c.name}</option>)}
                                </select>
                              </div>
                              {/* Service select */}
                              <div className="flex-1 min-w-[160px]">
                                <label className="text-[8px] font-black uppercase text-gray-500 block mb-1">Service</label>
                                <select
                                  value={selectedService}
                                  onChange={e => setSelectedService(e.target.value)}
                                  className="w-full bg-white/10 border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white outline-none"
                                >
                                  {currentServices.map(s => <option key={s.code} value={s.code} className="bg-gray-800">{s.name}</option>)}
                                </select>
                              </div>
                              {/* Weight */}
                              <div className="w-24">
                                <label className="text-[8px] font-black uppercase text-gray-500 block mb-1">Weight (g)</label>
                                <input
                                  type="number"
                                  value={weight.value}
                                  onChange={e => setWeight({ value: Number(e.target.value), units: 'grams' })}
                                  className="w-full bg-white/10 border border-white/10 rounded px-2 py-1.5 text-[10px] font-bold text-white outline-none"
                                />
                              </div>
                            </div>

                            {/* Confirmation */}
                            {showConfirmation ? (
                              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                                <p className="text-[10px] text-amber-300 font-bold mb-2">
                                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                                  This will create a shipping label, charge your ShipStation account, and mark order #{o.shopify.orderNumber} as fulfilled on Shopify. Continue?
                                </p>
                                <div className="flex gap-2">
                                  <button onClick={handleCreateLabel} disabled={isCreatingLabel} className="px-3 py-1.5 rounded text-[10px] font-black uppercase bg-blue-500 hover:bg-blue-600 text-white transition-all flex items-center gap-1.5 disabled:opacity-50">
                                    {isCreatingLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                                    Yes, Create + Print Label
                                  </button>
                                  <button onClick={() => setShowConfirmation(false)} className="px-3 py-1.5 rounded text-[10px] font-black uppercase bg-white/10 hover:bg-white/15 text-gray-300 transition-all">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setShowConfirmation(true)}
                                disabled={!selectedCarrier || !selectedService || isCreatingLabel}
                                className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                              >
                                <Printer className="w-3.5 h-3.5" /> Create + Print Label
                              </button>
                            )}
                          </>
                        ) : null}

                        {/* Label Result */}
                        {labelResult && (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <span className="text-[10px] font-black text-emerald-400 uppercase">Label Created</span>
                            </div>
                            <p className="text-[10px] text-gray-300 font-bold">Tracking: {labelResult.trackingNumber}</p>
                            <p className="text-[10px] text-gray-300 font-bold">Cost: £{labelResult.shipmentCost?.toFixed(2)}</p>
                            <p className="text-[9px] text-gray-500 mt-1">Label PDF opened in new tab. ShipStation will update Shopify automatically.</p>
                          </div>
                        )}

                        {labelError && (
                          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-red-400 font-bold">{labelError}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BatchFulfillment;
