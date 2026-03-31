import React, { useState, useEffect } from 'react';
import { ShopifyOrder, DecoJob, DecoItem } from '../types';
import { standardizeSize, isEligibleForMapping } from '../services/apiService';
import { suggestMapping } from '../services/geminiService';
import { Search, Loader2, Save, X, CheckCircle2, AlertCircle, Box, Cog, Truck, ArrowRight, Trash2, ShieldOff, Sparkles, Info, Layers, Wand2 } from 'lucide-react';

interface OrderMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: ShopifyOrder; 
  orders?: ShopifyOrder[]; 
  currentDecoJobId?: string;
  confirmedMatches: Record<string, string>;
  productMappings: Record<string, string>;
  itemJobLinks: Record<string, string>;
  onSearchJob: (jobId: string) => Promise<DecoJob | null>;
  onSaveMappings: (mappings: { itemKey: string, decoId: string }[], jobId: string, learnedPatterns?: Record<string, string>) => void;
}

const getShopifyPattern = (item: any) => {
    const parts = item.name.split(' - ');
    const size = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : '-';
    const baseName = parts.length > 1 ? parts.slice(0, -1).join(' - ').trim().toLowerCase() : item.name.trim().toLowerCase();
    const sku = (item.sku || '').trim().toLowerCase();
    const props = (item.properties || []).map((p: any) => `${p.name}:${p.value}`).sort().join(',');
    return `${baseName}|${sku}|${size}|${props}`;
};

const getDecoPattern = (item: DecoItem) => {
    const parts = item.name.split(' - ');
    const size = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : '-';
    const baseName = parts.length > 1 ? parts.slice(0, -1).join(' - ').trim().toLowerCase() : item.name.trim().toLowerCase();
    const pCode = (item.productCode || '').trim().toLowerCase();
    const vSku = (item.vendorSku || '').trim().toLowerCase();
    return `${baseName}|${pCode}|${vSku}|${size}`;
};

const parseItemName = (name: string) => {
    const parts = name.split(' - ');
    if (parts.length > 1) {
        const lastPart = parts[parts.length - 1].trim();
        if (lastPart.length <= 4 || ['small','medium','large','one size','junior','senior'].some(s => lastPart.toLowerCase().includes(s))) {
             const size = parts.pop() || '';
             const details = parts.join(' - ');
             return { details, color: '-', size };
        }
    }
    return { details: name, color: '-', size: '-' };
};

const OrderMappingModal: React.FC<OrderMappingModalProps> = ({
  isOpen, onClose, order, orders, currentDecoJobId, confirmedMatches, productMappings, itemJobLinks, onSearchJob, onSaveMappings
}) => {
  const [searchId, setSearchId] = useState(currentDecoJobId || '');
  const [isLoading, setIsLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [decoJob, setDecoJob] = useState<DecoJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<{[key: string]: string}>({});
  const [mirroredKeys, setMirroredKeys] = useState<Set<string>>(new Set());

  const targetOrders = orders || (order ? [order] : []);

  useEffect(() => {
      if (isOpen) {
          setSearchId(currentDecoJobId || '');
          setDecoJob(null);
          setMappings({});
          setMirroredKeys(new Set());
          setError(null);
          if (currentDecoJobId) {
              handleSearch(currentDecoJobId);
          }
      }
  }, [isOpen, currentDecoJobId]);

  useEffect(() => {
      if (isOpen && targetOrders.length > 0) {
          setMappings(prev => {
              // Only pre-fill if we don't have any mappings yet for this session
              // This prevents background updates to targetOrders from wiping out unsaved user changes
              if (Object.keys(prev).length > 0) return prev;
              
              const preFilled: {[key: string]: string} = {};
              targetOrders.forEach(o => {
                  o.items.forEach(item => {
                      if (item.linkedDecoItemId) {
                          preFilled[item.id] = item.linkedDecoItemId;
                      }
                  });
              });
              return preFilled;
          });
      }
  }, [isOpen, targetOrders]);

  const handleSearch = async (idToSearch?: string) => {
      const id = idToSearch || searchId;
      if (!id) return;
      setIsLoading(true);
      setError(null);
      try {
          const job = await onSearchJob(id);
          if (job) {
              setDecoJob(job);
              
              // Auto-map based on learned patterns
              setMappings(prev => {
                  const next = { ...prev };
                  let autoMappedCount = 0;
                  
                  targetOrders.forEach(o => {
                      o.items.forEach(sItem => {
                          if (next[sItem.id]) return;
                          
                          const sPattern = getShopifyPattern(sItem);
                          const dPattern = productMappings[sPattern];
                          
                          if (dPattern) {
                              const match = job.items.find(d => getDecoPattern(d) === dPattern);
                              if (match) {
                                  const decoId = match.vendorSku || match.productCode || match.name;
                                  const idx = job.items.indexOf(match);
                                  next[sItem.id] = `${decoId}@@@${idx}`;
                                  autoMappedCount++;
                              }
                          }
                      });
                  });
                  
                  return next;
              });
          }
          else setError("Job not found");
      } catch (e) {
          setError("Search failed");
      } finally {
          setIsLoading(false);
      }
  };

  const handleAiSuggest = async () => {
    if (!decoJob || targetOrders.length === 0) return;
    
    setIsAiLoading(true);
    try {
      const allShopifyItems = targetOrders.flatMap(o => 
        o.items.filter(item => isEligibleForMapping(item.name, item.productType) && item.itemStatus !== 'fulfilled')
      );

      // 1. Instant Local Match for clear-cut cases
      const nextMappings = { ...mappings };
      const remainingItems: any[] = [];
      let localMatchCount = 0;

      allShopifyItems.forEach(sItem => {
        if (nextMappings[sItem.id]) return; // Skip if already mapped

        const exactMatch = decoJob.items.find(d => {
          const dSku = (d.vendorSku || d.productCode || '').toLowerCase();
          const sSku = (sItem.sku || '').toLowerCase();
          return (sSku && dSku === sSku) || (d.name.toLowerCase() === sItem.name.toLowerCase());
        });

        if (exactMatch) {
          const decoId = exactMatch.vendorSku || exactMatch.productCode || exactMatch.name;
          const idx = decoJob.items.indexOf(exactMatch);
          nextMappings[sItem.id] = `${decoId}@@@${idx}`;
          localMatchCount++;
        } else {
          remainingItems.push(sItem);
        }
      });

      // Apply local matches immediately for instant feedback
      if (localMatchCount > 0) {
        setMappings({ ...nextMappings });
      }

      if (remainingItems.length === 0) {
        setIsAiLoading(false);
        return;
      }
      
      // 2. AI Match for fuzzy/complex cases
      const suggestions = await suggestMapping(remainingItems, decoJob.items);
      
      const aiMappings = { ...nextMappings };
      suggestions.forEach(s => {
        const decoItem = decoJob.items.find(d => d.name === s.decoItemName);
        if (decoItem && s.confidence > 0.7 && !aiMappings[s.shopifyItemId]) {
          const decoId = decoItem.vendorSku || decoItem.productCode || decoItem.name;
          const idx = decoJob.items.indexOf(decoItem);
          aiMappings[s.shopifyItemId] = `${decoId}@@@${idx}`;
        }
      });
      
      setMappings(aiMappings);
    } catch (e) {
      console.error("AI Suggest Error:", e);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSelect = (itemKey: string, decoId: string) => {
      const nextMappings = { ...mappings, [itemKey]: decoId };
      const nextMirrored = new Set(mirroredKeys);

      // Find the source item to get its signature for mirroring
      let sourceItem: any = null;
      for (const o of targetOrders) {
          const match = o.items.find(i => i.id === itemKey);
          if (match) {
              sourceItem = match;
              break;
          }
      }

      if (sourceItem) {
          const signature = `${sourceItem.sku}-${sourceItem.name}-${sourceItem.ean || ''}`;
          
          targetOrders.forEach(o => {
              o.items.forEach(item => {
                  // Mirror to identical items
                  if (item.id !== itemKey && isEligibleForMapping(item.name, item.productType) && item.itemStatus !== 'fulfilled') {
                      const itemSig = `${item.sku}-${item.name}-${item.ean || ''}`;
                      if (itemSig === signature) {
                          // If we are setting a mapping, overwrite even if already mapped (to ensure consistency across identical items)
                          // If we are clearing a mapping (decoId === ''), clear it for the whole group
                          nextMappings[item.id] = decoId;
                          if (decoId) nextMirrored.add(item.id);
                          else nextMirrored.delete(item.id);
                      }
                  }
              });
          });
      }

      if (!decoId) {
          nextMirrored.delete(itemKey);
      }

      setMappings(nextMappings);
      setMirroredKeys(nextMirrored);
  };

  const handleSave = () => {
      if (!decoJob) return;
      
      const learnedPatterns: Record<string, string> = {};
      const results = Object.entries(mappings).map(([key, value]) => {
          // Identify the shopify item and deco item to learn the pattern
          let sItem: any = null;
          for (const o of targetOrders) {
              const match = o.items.find(i => i.id === key);
              if (match) {
                  sItem = match;
                  break;
              }
          }

          if (sItem && value && value !== '__NO_MAP__') {
              const [sku, idxStr] = value.split('@@@');
              const idx = parseInt(idxStr);
              const dItem = decoJob.items[idx];
              if (dItem) {
                  const sPattern = getShopifyPattern(sItem);
                  const dPattern = getDecoPattern(dItem);
                  learnedPatterns[sPattern] = dPattern;
              }
          }

          return {
              itemKey: key,
              decoId: value
          };
      });

      onSaveMappings(results, decoJob.jobNumber, learnedPatterns);
      onClose();
  };

  const StatusGrid = ({ item }: { item: DecoItem }) => (
      <div className="flex items-center gap-2 text-[10px] bg-gray-50 px-2 py-1 rounded border border-gray-200">
          <div className="flex flex-col items-center" title="Received"><Box className="w-3 h-3 text-gray-400 mb-0.5" />{item.isReceived ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-300" />}</div>
          <div className="w-px h-6 bg-gray-200 mx-1"></div>
          <div className="flex flex-col items-center" title="Produced"><Cog className="w-3 h-3 text-gray-400 mb-0.5" />{item.isProduced ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-300" />}</div>
          <div className="w-px h-6 bg-gray-200 mx-1"></div>
          <div className="flex flex-col items-center" title="Shipped"><Truck className="w-3 h-3 text-gray-400 mb-0.5" />{item.isShipped ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-300" />}</div>
      </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
          <div>
              <h3 className="font-bold text-indigo-900 text-lg uppercase tracking-widest">Map Order Items</h3>
              <p className="text-xs text-indigo-600 font-bold uppercase tracking-wider">Linking Shopify items to DecoNetwork Batch #{decoJob?.jobNumber || '...'}</p>
          </div>
          <button onClick={onClose}><X className="w-6 h-6 text-indigo-400 hover:text-indigo-600" /></button>
        </div>

        <div className="p-4 bg-white border-b border-gray-200 flex gap-3 items-center">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input type="text" value={searchId} onChange={(e) => setSearchId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Search Deco Job ID..." className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <button onClick={() => handleSearch()} disabled={isLoading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 uppercase tracking-widest">{isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch Job'}</button>
            {decoJob && (
              <button 
                onClick={handleAiSuggest} 
                disabled={isAiLoading} 
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-sm font-bold hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 flex items-center gap-2 uppercase tracking-widest shadow-md transition-all hover:scale-105 active:scale-95"
              >
                {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                AI Suggest
              </button>
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
            {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg flex items-center gap-2 text-sm font-bold uppercase tracking-wide"><AlertCircle className="w-4 h-4" /> {error}</div>}
            {decoJob ? (
                <div className="space-y-6">
                    <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                        <div>
                            <h4 className="font-bold text-gray-900 uppercase tracking-widest">{decoJob.jobName}</h4>
                            <p className="text-sm text-gray-500 font-bold uppercase tracking-wide">{decoJob.customerName} • {decoJob.items.length} Items in this Deco Job</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100 text-[10px] font-black text-indigo-600 uppercase tracking-widest">
                                <Sparkles className="w-3 h-3" /> Mirror Mapping Active
                            </div>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-widest ${decoJob.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{decoJob.status}</span>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase w-24 tracking-widest">Order #</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Shopify Item</th>
                                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase w-8 tracking-widest"></th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Link to Item in Job #{decoJob.jobNumber}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {targetOrders.map((o) => (
                                    o.items.filter(item => isEligibleForMapping(item.name, item.productType) && item.itemStatus !== 'fulfilled').map((sItem) => {
                                        const itemKey = sItem.id;
                                        const rawSelectedId = mappings[itemKey] || '';
                                        const isNoMap = rawSelectedId === '__NO_MAP__';
                                        const isMirrored = mirroredKeys.has(itemKey);
                                        
                                        // Find the deco item. Try unique ID first (SKU@@@index), then fallback to SKU.
                                        let selectedDeco = null;
                                        let displaySelectedId = rawSelectedId;

                                        if (!isNoMap && rawSelectedId) {
                                            if (rawSelectedId.includes('@@@')) {
                                                const [sku, idxStr] = rawSelectedId.split('@@@');
                                                const idx = parseInt(idxStr);
                                                if (decoJob.items[idx]) {
                                                    const d = decoJob.items[idx];
                                                    const dId = d.vendorSku || d.productCode || d.name;
                                                    if (dId === sku) {
                                                        selectedDeco = d;
                                                    }
                                                }
                                            }
                                            
                                            if (!selectedDeco) {
                                                // Fallback to SKU matching for legacy or AI mappings
                                                selectedDeco = decoJob.items.find(d => (d.vendorSku || d.productCode || d.name) === rawSelectedId.split('@@@')[0]);
                                                if (selectedDeco) {
                                                    // If we found it via SKU, we should ideally find the index too so the select value matches an option
                                                    const idx = decoJob.items.indexOf(selectedDeco);
                                                    displaySelectedId = `${rawSelectedId.split('@@@')[0]}@@@${idx}`;
                                                }
                                            }
                                        }
                                        const isMapped = !!rawSelectedId;
                                        
                                        // CROSS-JOB DETECTION: 
                                        // Is this item mapped to something, but that thing is NOT in the current Deco Job?
                                        const isMappedToOtherBatch = isMapped && !isNoMap && !selectedDeco;
                                        const otherBatchId = sItem.itemDecoJobId && sItem.itemDecoJobId !== decoJob.jobNumber ? sItem.itemDecoJobId : null;

                                        const { details, size: sSize } = parseItemName(sItem.name);
                                        const sortedDecoItems = [...decoJob.items].sort((a, b) => {
                                            const aId = (a.vendorSku || a.productCode || a.name || '').toLowerCase();
                                            const bId = (b.vendorSku || b.productCode || b.name || '').toLowerCase();
                                            const sSku = (sItem.sku || '').toLowerCase();
                                            
                                            // 1. Exact SKU/ID match
                                            const aSkuMatch = aId === sSku;
                                            const bSkuMatch = bId === sSku;
                                            if (aSkuMatch && !bSkuMatch) return -1;
                                            if (!aSkuMatch && bSkuMatch) return 1;

                                            // 2. Name similarity (fuzzy-ish)
                                            const aName = a.name.toLowerCase();
                                            const bName = b.name.toLowerCase();
                                            const sName = sItem.name.toLowerCase();
                                            const aNameMatch = aName.includes(sName) || sName.includes(aName);
                                            const bNameMatch = bName.includes(sName) || sName.includes(bName);
                                            if (aNameMatch && !bNameMatch) return -1;
                                            if (!aNameMatch && bNameMatch) return 1;

                                            // 3. Size match
                                            const aSize = standardizeSize(parseItemName(a.name).size);
                                            const bSize = standardizeSize(parseItemName(b.name).size);
                                            const normSSize = standardizeSize(sSize);
                                            if (normSSize && aSize === normSSize && bSize !== normSSize) return -1;
                                            if (normSSize && aSize !== normSSize && bSize === normSSize) return 1;
                                            
                                            return 0;
                                        });
                                        
                                        return (
                                            <tr key={itemKey} className={`hover:bg-gray-50 transition-colors ${isMapped ? (isNoMap ? 'bg-slate-50' : 'bg-green-50/50') : ''}`}>
                                                <td className="px-4 py-3 align-top font-bold text-xs text-gray-700">#{o.orderNumber}</td>
                                                <td className="px-4 py-3 w-5/12 align-top">
                                                    <div className="text-sm font-bold text-gray-900 uppercase tracking-wide">{details}</div>
                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 font-bold uppercase tracking-widest">{sSize}</span>
                                                        <span className="text-[10px] text-gray-400 font-bold self-center uppercase tracking-widest">SKU: {sItem.sku}</span>
                                                        {isMappedToOtherBatch && (
                                                            <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded border border-purple-200 font-black uppercase tracking-widest flex items-center gap-1 shadow-sm">
                                                                <Layers className="w-3 h-3" /> Batch #{otherBatchId || 'Previous'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-3 text-center align-middle"><ArrowRight className={`w-4 h-4 ${isMapped ? 'text-green-500' : 'text-gray-300'}`} /></td>
                                                <td className="px-4 py-3 w-5/12 align-top">
                                                    <div className="space-y-2">
                                                        <div className="flex gap-2">
                                                            <select 
                                                                value={selectedDeco ? displaySelectedId : (isNoMap ? '__NO_MAP__' : '')} 
                                                                onChange={(e) => handleSelect(itemKey, e.target.value)} 
                                                                className={`w-full text-xs border rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500 font-bold uppercase tracking-wide ${isMapped && !isMappedToOtherBatch ? (isNoMap ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-green-300 bg-green-50 text-green-900') : 'border-gray-300 bg-white text-gray-600'}`}
                                                            >
                                                                <option value="">-- Select Matching Item --</option>
                                                                <option value="__NO_MAP__" className="italic font-bold text-indigo-600">-- NO MAP REQUIRED --</option>
                                                                {isMappedToOtherBatch && (
                                                                    <option value={rawSelectedId} disabled className="bg-purple-50 text-purple-900">
                                                                        [PREVIOUS MAPPING]: {rawSelectedId.split('@@@')[0]}
                                                                    </option>
                                                                )}
                                                                {sortedDecoItems.map((dItem, dIdx) => {
                                                                    const dId = dItem.vendorSku || dItem.productCode || dItem.name;
                                                                    const uniqueId = `${dId}@@@${decoJob.items.indexOf(dItem)}`;
                                                                    return <option key={dIdx} value={uniqueId}>{dItem.name} {dItem.ean ? `[EAN: ${dItem.ean}]` : ''}</option>;
                                                                })}
                                                            </select>
                                                            {isMapped && <button onClick={() => handleSelect(itemKey, '')} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-200 rounded-lg transition-colors" title="Unlink Item"><Trash2 className="w-4 h-4" /></button>}
                                                        </div>
                                                        <div className="flex justify-between items-center h-8">
                                                            {isNoMap ? (
                                                                <span className="text-[9px] text-slate-500 font-black flex items-center gap-1 uppercase tracking-widest animate-in fade-in"><ShieldOff className="w-3 h-3" /> Map Exempt</span>
                                                            ) : selectedDeco ? (
                                                                <div className="flex justify-between items-center w-full animate-in fade-in">
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] text-green-700 font-bold flex items-center gap-1 uppercase tracking-widest"><CheckCircle2 className="w-3 h-3" /> Mapped</span>
                                                                            {isMirrored && <span className="text-[8px] px-1.5 py-0.5 bg-indigo-600 text-white rounded font-black uppercase tracking-tighter flex items-center gap-1 animate-pulse"><Sparkles className="w-2 h-2" /> Mirrored</span>}
                                                                        </div>
                                                                        {selectedDeco.ean && <span className="text-[8px] text-indigo-500 font-bold uppercase tracking-widest">EAN: {selectedDeco.ean}</span>}
                                                                    </div>
                                                                    <StatusGrid item={selectedDeco} />
                                                                </div>
                                                            ) : isMappedToOtherBatch ? (
                                                                <div className="flex items-center gap-2 text-purple-600 font-black uppercase tracking-widest text-[9px]">
                                                                    <Layers className="w-3 h-3" /> Assigned to different Production Batch
                                                                </div>
                                                            ) : <div className="text-[9px] text-gray-400 italic pl-1 font-bold uppercase tracking-widest">Select to see status</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : <div className="flex flex-col items-center justify-center h-64 text-gray-400"><Search className="w-12 h-12 mb-4 opacity-20" /><p className="font-bold uppercase tracking-widest">Search for a Deco Job ID to start mapping.</p></div>}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
            <div className="text-[10px] text-indigo-600 font-black uppercase tracking-widest flex items-center gap-2">
                <Info className="w-4 h-4" /> Tip: Already mapped items are preserved even if they belong to a different Batch ID.
            </div>
            <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 uppercase tracking-widest">Cancel</button>
                <button onClick={handleSave} disabled={!decoJob} className="px-6 py-2 text-sm font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm uppercase tracking-widest"><Save className="w-4 h-4" /> Save Batch</button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default OrderMappingModal;