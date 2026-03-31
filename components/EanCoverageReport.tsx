import React, { useMemo, useState, useCallback } from 'react';
import { UnifiedOrder } from '../types';
import { ApiSettings } from './SettingsModal';
import { updateShopifyVariantBarcode } from '../services/apiService';
import { saveReferenceProducts } from '../services/syncService';
import { BarChart3, AlertTriangle, CheckCircle2, Search, ChevronDown, ChevronUp, ArrowRightLeft, Upload, Loader2, ArrowRight } from 'lucide-react';

interface EanCoverageReportProps {
  orders: UnifiedOrder[];
  settings: ApiSettings;
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface ItemEanInfo {
  sku: string;
  name: string;
  shopifyEan: string;
  decoEan: string;
  hasShopifyEan: boolean;
  hasDecoEan: boolean;
  bothMatch: boolean;
  orderNumbers: string[];
  totalQty: number;
  variantIds: string[]; // All Shopify variant GIDs for this SKU
  vendor: string;
  canPushToShopify: boolean; // Has Deco EAN + Shopify variant ID but no Shopify EAN
}

const EanCoverageReport: React.FC<EanCoverageReportProps> = ({ orders, settings, onNavigateToOrder }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'missing_shopify' | 'missing_deco' | 'missing_both' | 'mismatch' | 'matched' | 'pushable'>('missing_shopify');
  const [isExpanded, setIsExpanded] = useState(true);
  const [syncing, setSyncing] = useState<Record<string, 'pending' | 'success' | 'error'>>({});
  const [batchSyncing, setBatchSyncing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, errors: 0 });

  const report = useMemo(() => {
    const skuMap = new Map<string, ItemEanInfo>();

    // PASS 1: Build a global Deco EAN index from ALL sources
    // This means if ANY order's deco job has an EAN for a vendorSku/productCode, we know it
    const decoEanIndex = new Map<string, string>(); // key (sku/vendorSku lowercase) → ean
    for (const order of orders) {
      // From order-level deco job
      if (order.deco?.items) {
        for (const d of order.deco.items) {
          if (d.ean && d.ean !== '-' && d.ean !== '') {
            if (d.vendorSku) decoEanIndex.set(d.vendorSku.toLowerCase(), d.ean);
            if (d.productCode) decoEanIndex.set(d.productCode.toLowerCase(), d.ean);
          }
        }
      }
      // From per-item cached deco data (itemDecoData)
      for (const item of order.shopify.items) {
        if (item.itemDecoData?.items) {
          for (const d of item.itemDecoData.items) {
            if (d.ean && d.ean !== '-' && d.ean !== '') {
              if (d.vendorSku) decoEanIndex.set(d.vendorSku.toLowerCase(), d.ean);
              if (d.productCode) decoEanIndex.set(d.productCode.toLowerCase(), d.ean);
            }
          }
        }
      }
    }

    // PASS 2: Build SKU report with cross-referenced EANs
    for (const order of orders) {
      for (const item of order.shopify.items) {
        if (!item.sku) continue;
        const key = item.sku.toLowerCase();
        const shopifyEan = (item.ean && item.ean !== '-') ? item.ean : '';
        const variantId = item.variantId || '';

        // Find Deco EAN from multiple sources
        let decoEan = '';

        // Source 1: Linked deco item on this order's deco job
        if (item.linkedDecoItemId && order.deco?.items) {
          const linkedParts = item.linkedDecoItemId.split('@@@');
          const linkedId = linkedParts[0];
          if (linkedId && linkedId !== '__NO_MAP__') {
            const decoItem = order.deco.items.find(d =>
              d.vendorSku === linkedId || d.productCode === linkedId || d.name === linkedId
            );
            if (decoItem?.ean && decoItem.ean !== '-' && decoItem.ean !== '') {
              decoEan = decoItem.ean;
            }
          }
        }

        // Source 2: Per-item cached deco data
        if (!decoEan && item.itemDecoData?.items) {
          for (const d of item.itemDecoData.items) {
            if (d.ean && d.ean !== '-' && d.ean !== '') {
              decoEan = d.ean;
              break;
            }
          }
        }

        // Source 3: Global Deco EAN index (cross-order lookup by SKU)
        if (!decoEan) {
          decoEan = decoEanIndex.get(key) || '';
        }

        const existing = skuMap.get(key);
        if (existing) {
          if (!existing.shopifyEan && shopifyEan) existing.shopifyEan = shopifyEan;
          if (!existing.decoEan && decoEan) existing.decoEan = decoEan;
          if (variantId && !existing.variantIds.includes(variantId)) existing.variantIds.push(variantId);
          existing.hasShopifyEan = !!existing.shopifyEan;
          existing.hasDecoEan = !!existing.decoEan;
          existing.bothMatch = existing.hasShopifyEan && existing.hasDecoEan && existing.shopifyEan === existing.decoEan;
          existing.canPushToShopify = !existing.hasShopifyEan && existing.hasDecoEan && existing.variantIds.length > 0;
          if (!existing.orderNumbers.includes(order.shopify.orderNumber)) {
            existing.orderNumbers.push(order.shopify.orderNumber);
          }
          existing.totalQty += item.quantity;
        } else {
          const hasS = !!shopifyEan;
          const hasD = !!decoEan;
          const vIds = variantId ? [variantId] : [];
          skuMap.set(key, {
            sku: item.sku,
            name: item.name,
            shopifyEan: shopifyEan,
            decoEan: decoEan,
            hasShopifyEan: hasS,
            hasDecoEan: hasD,
            bothMatch: hasS && hasD && shopifyEan === decoEan,
            orderNumbers: [order.shopify.orderNumber],
            totalQty: item.quantity,
            variantIds: vIds,
            vendor: item.vendor || '',
            canPushToShopify: !hasS && hasD && vIds.length > 0,
          });
        }
      }
    }

    const items = Array.from(skuMap.values());
    const total = items.length;
    const withShopify = items.filter(i => i.hasShopifyEan).length;
    const withDeco = items.filter(i => i.hasDecoEan).length;
    const matched = items.filter(i => i.bothMatch).length;
    const mismatched = items.filter(i => i.hasShopifyEan && i.hasDecoEan && !i.bothMatch).length;
    const missingBoth = items.filter(i => !i.hasShopifyEan && !i.hasDecoEan).length;
    const pushable = items.filter(i => i.canPushToShopify).length;

    return { items, total, withShopify, withDeco, matched, mismatched, missingBoth, pushable };
  }, [orders]);

  const filtered = useMemo(() => {
    let items = report.items;
    if (filterMode === 'missing_shopify') items = items.filter(i => !i.hasShopifyEan);
    else if (filterMode === 'missing_deco') items = items.filter(i => !i.hasDecoEan);
    else if (filterMode === 'missing_both') items = items.filter(i => !i.hasShopifyEan && !i.hasDecoEan);
    else if (filterMode === 'mismatch') items = items.filter(i => i.hasShopifyEan && i.hasDecoEan && !i.bothMatch);
    else if (filterMode === 'matched') items = items.filter(i => i.bothMatch);
    else if (filterMode === 'pushable') items = items.filter(i => i.canPushToShopify);

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      items = items.filter(i => i.sku.toLowerCase().includes(s) || i.name.toLowerCase().includes(s) || i.shopifyEan.includes(s) || i.decoEan.includes(s));
    }

    return items.sort((a, b) => b.orderNumbers.length - a.orderNumbers.length);
  }, [report, filterMode, searchTerm]);

  const shopifyPct = report.total > 0 ? Math.round((report.withShopify / report.total) * 100) : 0;
  const decoPct = report.total > 0 ? Math.round((report.withDeco / report.total) * 100) : 0;
  const matchPct = report.total > 0 ? Math.round((report.matched / report.total) * 100) : 0;

  // Push a single Deco EAN → Shopify variant barcode
  const pushSingleToShopify = useCallback(async (item: ItemEanInfo) => {
    if (!item.canPushToShopify || !item.decoEan || item.variantIds.length === 0) return;
    const key = item.sku.toLowerCase();
    setSyncing(prev => ({ ...prev, [key]: 'pending' }));
    try {
      // Update all variants with this SKU (handles multi-size same SKU edge case)
      for (const vid of item.variantIds) {
        const result = await updateShopifyVariantBarcode(settings, vid, item.decoEan);
        if (!result.success) throw new Error(result.error);
      }
      setSyncing(prev => ({ ...prev, [key]: 'success' }));
    } catch {
      setSyncing(prev => ({ ...prev, [key]: 'error' }));
    }
  }, [settings]);

  // Batch push all pushable items
  const batchPushToShopify = useCallback(async () => {
    const pushable = report.items.filter(i => i.canPushToShopify);
    if (pushable.length === 0) return;
    if (!confirm(`Push ${pushable.length} Deco EAN(s) to Shopify variant barcodes?\n\nThis will update product data in Shopify.`)) return;

    setBatchSyncing(true);
    setBatchProgress({ done: 0, total: pushable.length, errors: 0 });
    let errors = 0;

    for (let idx = 0; idx < pushable.length; idx++) {
      const item = pushable[idx];
      const key = item.sku.toLowerCase();
      setSyncing(prev => ({ ...prev, [key]: 'pending' }));
      try {
        for (const vid of item.variantIds) {
          const result = await updateShopifyVariantBarcode(settings, vid, item.decoEan);
          if (!result.success) throw new Error(result.error);
        }
        setSyncing(prev => ({ ...prev, [key]: 'success' }));
      } catch {
        setSyncing(prev => ({ ...prev, [key]: 'error' }));
        errors++;
      }
      setBatchProgress({ done: idx + 1, total: pushable.length, errors });
    }

    // Also save matched EANs to reference products table
    try {
      const refs = report.items
        .filter(i => i.hasShopifyEan || i.hasDecoEan)
        .map(i => ({
          ean: i.shopifyEan || i.decoEan,
          vendor: i.vendor,
          productCode: i.sku,
          description: i.name,
          colour: '',
          size: '',
        }))
        .filter(r => r.ean && r.ean !== '-');
      if (refs.length > 0) await saveReferenceProducts(settings, refs);
    } catch { /* non-critical */ }

    setBatchSyncing(false);
  }, [report.items, settings]);

  // Save all known EANs to master reference table
  const saveToReferenceTable = useCallback(async () => {
    const refs = report.items
      .filter(i => i.hasShopifyEan || i.hasDecoEan)
      .map(i => ({
        ean: i.shopifyEan || i.decoEan,
        vendor: i.vendor,
        productCode: i.sku,
        description: i.name,
        colour: '',
        size: '',
      }))
      .filter(r => r.ean && r.ean !== '-');
    if (refs.length === 0) return;
    try {
      await saveReferenceProducts(settings, refs);
      alert(`Saved ${refs.length} EAN references to master table.`);
    } catch (e: any) {
      alert(`Error saving references: ${e.message}`);
    }
  }, [report.items, settings]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="font-bold text-gray-900 uppercase tracking-widest text-sm">EAN / Barcode Coverage</h3>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wide">{report.total} unique SKUs across {orders.length} orders</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-6 text-xs font-bold uppercase tracking-widest">
            <span className={shopifyPct >= 80 ? 'text-green-600' : shopifyPct >= 50 ? 'text-amber-600' : 'text-red-600'}>Shopify: {shopifyPct}%</span>
            <span className={decoPct >= 80 ? 'text-green-600' : decoPct >= 50 ? 'text-amber-600' : 'text-red-600'}>Deco: {decoPct}%</span>
            <span className={matchPct >= 80 ? 'text-green-600' : matchPct >= 50 ? 'text-amber-600' : 'text-red-600'}>Matched: {matchPct}%</span>
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="p-6 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg border border-gray-200 text-center">
              <div className="text-lg font-bold text-gray-900">{report.total}</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Unique SKUs</div>
            </div>
            <div className="p-3 rounded-lg border border-green-200 bg-green-50 text-center">
              <div className="text-lg font-bold text-green-700">{report.withShopify}</div>
              <div className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Shopify EAN</div>
            </div>
            <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-center">
              <div className="text-lg font-bold text-blue-700">{report.withDeco}</div>
              <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Deco EAN</div>
            </div>
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-center">
              <div className="text-lg font-bold text-emerald-700">{report.matched}</div>
              <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Both Match</div>
            </div>
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-center">
              <div className="text-lg font-bold text-red-700">{report.missingBoth}</div>
              <div className="text-[10px] font-bold text-red-600 uppercase tracking-widest">Missing Both</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {([
                ['all', 'All'],
                ['pushable', `Pushable (${report.pushable})`],
                ['missing_shopify', 'No Shopify'],
                ['missing_deco', 'No Deco'],
                ['missing_both', 'No Either'],
                ['mismatch', 'Mismatch'],
                ['matched', 'Matched'],
              ] as [string, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setFilterMode(key as typeof filterMode)}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${filterMode === key ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                >{label}</button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search SKU, name, or EAN..." className="w-full pl-9 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg font-bold text-gray-900" />
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{filtered.length} results</span>
          </div>

          {/* Sync Actions Bar */}
          {report.pushable > 0 && (
            <div className="flex items-center gap-4 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
              <ArrowRightLeft className="w-5 h-5 text-indigo-600 shrink-0" />
              <div className="flex-1">
                <span className="text-xs font-bold text-indigo-900 uppercase tracking-widest">
                  {report.pushable} SKU{report.pushable !== 1 ? 's' : ''} can be auto-filled
                </span>
                <span className="text-[10px] text-indigo-600 ml-2">Deco has EAN → push to Shopify barcode</span>
              </div>
              {batchSyncing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest">
                    {batchProgress.done}/{batchProgress.total}{batchProgress.errors > 0 ? ` (${batchProgress.errors} failed)` : ''}
                  </span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={batchPushToShopify}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" /> Push All to Shopify
                  </button>
                  <button onClick={saveToReferenceTable}
                    className="px-3 py-1.5 bg-white text-indigo-700 border border-indigo-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-100 transition-colors">
                    Save to Reference Table
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase tracking-widest">SKU</th>
                  <th className="px-3 py-2 text-left font-bold text-gray-500 uppercase tracking-widest">Product Name</th>
                  <th className="px-3 py-2 text-center font-bold text-gray-500 uppercase tracking-widest">Shopify EAN</th>
                  <th className="px-3 py-2 text-center font-bold text-gray-500 uppercase tracking-widest">Deco EAN</th>
                  <th className="px-3 py-2 text-center font-bold text-gray-500 uppercase tracking-widest">Status</th>
                  <th className="px-3 py-2 text-center font-bold text-gray-500 uppercase tracking-widest">Action</th>
                  <th className="px-3 py-2 text-center font-bold text-gray-500 uppercase tracking-widest">Orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.slice(0, 200).map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 font-mono font-bold text-gray-700 whitespace-nowrap">{item.sku}</td>
                    <td className="px-3 py-2 text-gray-800 max-w-[300px] truncate" title={item.name}>{item.name}</td>
                    <td className="px-3 py-2 text-center font-mono">
                      {item.hasShopifyEan 
                        ? <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">{item.shopifyEan}</span>
                        : <span className="text-red-500 font-bold">MISSING</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {item.hasDecoEan 
                        ? <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{item.decoEan}</span>
                        : <span className="text-red-500 font-bold">MISSING</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-center">
                      {item.bothMatch ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="w-3.5 h-3.5" /> MATCH</span>
                      ) : item.hasShopifyEan && item.hasDecoEan ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-bold"><AlertTriangle className="w-3.5 h-3.5" /> MISMATCH</span>
                      ) : (
                        <span className="text-gray-400 font-bold">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {syncing[item.sku.toLowerCase()] === 'success' ? (
                        <span className="text-emerald-600 font-bold text-[10px] uppercase tracking-widest">Done</span>
                      ) : syncing[item.sku.toLowerCase()] === 'pending' ? (
                        <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin mx-auto" />
                      ) : syncing[item.sku.toLowerCase()] === 'error' ? (
                        <span className="text-red-500 font-bold text-[10px] uppercase tracking-widest">Failed</span>
                      ) : item.canPushToShopify ? (
                        <button onClick={() => pushSingleToShopify(item)}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 hover:bg-indigo-100 text-[9px] font-bold uppercase tracking-widest transition-colors"
                          title={`Push Deco EAN ${item.decoEan} → Shopify`}>
                          <ArrowRight className="w-3 h-3" /> Push
                        </button>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-wrap gap-1 justify-center">
                        {item.orderNumbers.slice(0, 3).map(n => (
                          <button key={n} onClick={() => onNavigateToOrder?.(n)}
                            className="text-[9px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 hover:border-indigo-400 transition-colors">
                            #{n}
                          </button>
                        ))}
                        {item.orderNumbers.length > 3 && <span className="text-[9px] text-gray-400 font-bold">+{item.orderNumbers.length - 3}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-8 text-gray-400 font-bold uppercase tracking-widest text-xs">
                {searchTerm ? 'No matching items found' : 'No items in this category'}
              </div>
            )}
            {filtered.length > 200 && (
              <div className="text-center py-3 text-xs text-gray-400 font-bold uppercase tracking-widest border-t border-gray-100">
                Showing first 200 of {filtered.length} results
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EanCoverageReport;
