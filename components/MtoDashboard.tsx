
import React, { useState, useMemo } from 'react';
import { UnifiedOrder } from '../types';
import MultiSelectFilter from './MultiSelectFilter';
import JobIdBadge from './JobIdBadge';
import {
    Scissors, AlertTriangle, ExternalLink, Filter, ArrowUp, ArrowDown, Search,
    CheckSquare, Square, X, Calendar as CalendarIcon, CheckCircle2,
    ChevronUp, ChevronDown, Copy, Pencil, Link as LinkIcon, Box, Cog, Truck, Hash, RefreshCw,
    User, ShoppingBag, Layers, Unlink, Link2
} from 'lucide-react';

interface MtoFlatItem {
    id: string; // Item GID
    name: string;
    sku: string;
    quantity: number;
    orderNumber: string;
    orderId: string;
    customerName: string;
    date: string;
    jobId?: string;
    tags: string[];
    fulfillmentStatus: string;
    itemStatus: string;
    clubName: string;
}

const getShopifyStatusBadge = (status: string) => {
    switch (status) {
        case 'fulfilled': return 'bg-emerald-50 border-emerald-200 text-emerald-700';
        case 'partial':
        case 'partially_fulfilled': return 'bg-orange-50 border-orange-200 text-orange-700';
        case 'unfulfilled':
        default: return 'bg-slate-100 border-slate-200 text-slate-600';
    }
};

interface MtoDashboardProps {
  orders: UnifiedOrder[];
  excludedTags: string[];
  shopifyDomain: string;
  onBulkScan?: (orderIds: string[]) => Promise<void>;
  onManualLink?: (orderId: string | string[], jobId: string) => Promise<void>;
  onItemJobLink?: (orderNumber: string, itemId: string, jobId: string, batchSku?: string) => Promise<void>;
  onRefreshJob?: (jobId: string) => Promise<void>;
  selectedFilterTags?: Set<string>;
}

type SortKey = 'date' | 'orderNumber' | 'item' | 'sku' | 'job';
type SortDirection = 'asc' | 'desc';
type LinkStatusFilter = 'all' | 'linked' | 'unlinked';

const MtoDashboard: React.FC<MtoDashboardProps> = ({ orders, excludedTags, shopifyDomain, onBulkScan, onManualLink, onItemJobLink, onRefreshJob, selectedFilterTags }) => {
  const [activeHeaderMenu, setActiveHeaderMenu] = useState<{ club: string, col: string } | null>(null);
  const [sortConfig, setSortConfig] = useState<{key: SortKey, dir: SortDirection} | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [linkJobId, setLinkJobId] = useState('');
  const [linkJobModalOpen, setLinkJobModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedClubs, setSelectedClubs] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [linkStatusFilter, setLinkStatusFilter] = useState<LinkStatusFilter>('all');

  const flatMtoItems = useMemo<MtoFlatItem[]>(() => {
    const items: MtoFlatItem[] = [];
    orders.forEach(o => {
      o.shopify.items.forEach(i => {
        if (i.name.toLowerCase().includes('mto')) {
          items.push({
            id: i.id,
            name: i.name,
            sku: i.sku,
            quantity: i.quantity,
            orderNumber: o.shopify.orderNumber,
            orderId: o.shopify.id,
            customerName: o.shopify.customerName,
            date: o.shopify.date,
            jobId: i.itemDecoJobId,
            tags: o.shopify.tags,
            fulfillmentStatus: o.shopify.fulfillmentStatus,
            itemStatus: i.itemStatus || 'unfulfilled',
            clubName: o.clubName
          });
        }
      });
    });
    return items;
  }, [orders]);

  const clubOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    const allTags = new Set<string>();

    // Get all possible tags from all orders to ensure visibility even if no MTO items
    orders.forEach(o => {
      const validTags = o.shopify.tags.filter(t => !excludedTags.includes(t));
      if (validTags.length === 0) {
        allTags.add('Other');
      } else {
        validTags.forEach(t => allTags.add(t));
      }
    });

    // Count unfulfilled MTO items per tag
    flatMtoItems.forEach(item => {
      if (item.fulfillmentStatus !== 'fulfilled') {
        const validTags = item.tags.filter(tag => !excludedTags.includes(tag));
        if (validTags.length === 0) {
            counts['Other'] = (counts['Other'] || 0) + 1;
        } else {
            validTags.forEach(tag => {
                counts[tag] = (counts[tag] || 0) + 1;
            });
        }
      }
    });

    const opts = Array.from(allTags).map((tag: string) => ({
      label: tag,
      count: counts[tag] || 0
    })).sort((a, b) => {
        if (a.label === 'Other') return 1;
        if (b.label === 'Other') return -1;
        return b.count - a.count || a.label.localeCompare(b.label);
    });
    
    return opts;
  }, [orders, flatMtoItems, excludedTags]);

  const filteredAndSortedItems = useMemo<MtoFlatItem[]>(() => {
      let result = [...flatMtoItems];
      if (search) {
          const lower = search.toLowerCase();
          result = result.filter(i => i.orderNumber.includes(lower) || i.customerName.toLowerCase().includes(lower) || (i.jobId && i.jobId.includes(lower)) || i.name.toLowerCase().includes(lower) || i.sku.toLowerCase().includes(lower));
      }
      
      const activeSelection = selectedFilterTags?.size ? selectedFilterTags : selectedClubs;
      if (activeSelection.size > 0) {
          result = result.filter(i => {
              const matchesTag = i.tags.some(t => activeSelection.has(t));
              const isOther = activeSelection.has('Other') && (i.tags.length === 0 || i.tags.every(t => excludedTags.includes(t)));
              return matchesTag || isOther;
          });
      }
      
      if (startDate && endDate) {
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          result = result.filter(i => {
              const d = new Date(i.date);
              return d >= start && d <= end;
          });
      }

      if (linkStatusFilter === 'linked') {
          result = result.filter(i => !!i.jobId);
      } else if (linkStatusFilter === 'unlinked') {
          result = result.filter(i => !i.jobId);
      }

      if (!showCompleted) result = result.filter(i => i.fulfillmentStatus !== 'fulfilled');
      
      if (sortConfig) {
          const { key, dir } = sortConfig;
          result.sort((a, b) => {
              let valA: any = '', valB: any = '';
              switch (key) {
                  case 'date': valA = new Date(a.date).getTime(); valB = new Date(b.date).getTime(); break;
                  case 'orderNumber': valA = parseInt(a.orderNumber) || 0; valB = parseInt(b.orderNumber) || 0; break;
                  case 'sku': valA = a.sku; valB = b.sku; break;
                  case 'item': valA = a.name; valB = b.name; break;
                  case 'job': valA = parseInt(a.jobId || '0') || 0; valB = parseInt(b.jobId || '0') || 0; break;
              }
              if (valA < valB) return dir === 'asc' ? -1 : 1;
              if (valA > valB) return dir === 'asc' ? 1 : -1;
              return 0;
          });
      } else {
          result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      }
      return result;
  }, [flatMtoItems, search, selectedClubs, selectedFilterTags, excludedTags, startDate, endDate, showCompleted, linkStatusFilter, sortConfig]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, MtoFlatItem[]> = {};
    const activeSelection = (selectedFilterTags?.size ? selectedFilterTags : selectedClubs);
    
    filteredAndSortedItems.forEach((item: MtoFlatItem) => {
      // TAG MULTICASTING: 
      // We look at all tags for the item, filtered against excluded list.
      const validTags = item.tags.filter(t => !excludedTags.includes(t));
      
      const targetGroups = validTags.length === 0 ? ['Other'] : validTags;

      targetGroups.forEach(groupName => {
          // If we have an active filter, only push to groups that are in the selection
          if (activeSelection.size > 0 && !activeSelection.has(groupName)) return;

          if (!groups[groupName]) groups[groupName] = [];
          groups[groupName].push(item);
      });
    });
    
    const entries = Object.entries(groups) as [string, MtoFlatItem[]][];
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [filteredAndSortedItems, selectedClubs, selectedFilterTags, excludedTags]);

  const handleBulkLink = async () => {
    if (linkJobId.length === 6 && onItemJobLink) {
      for (const itemId of Array.from(selectedItemIds)) {
          const item = flatMtoItems.find(i => i.id === itemId);
          if (item) {
              await onItemJobLink(item.orderNumber, item.id, linkJobId);
          }
      }
      setLinkJobModalOpen(false);
      setLinkJobId('');
      setSelectedItemIds(new Set());
    }
  };

  const handleToggleItem = (id: string, e: React.SyntheticEvent) => {
      e.stopPropagation();
      const next = new Set(selectedItemIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedItemIds(next);
  };

  const handleSelectGroup = (items: MtoFlatItem[], checked: boolean) => {
      const next = new Set(selectedItemIds);
      items.forEach(i => {
          if (checked) next.add(i.id);
          else next.delete(i.id);
      });
      setSelectedItemIds(next);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20" onClick={() => setActiveHeaderMenu(null)}>
        {linkJobModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={() => setLinkJobModalOpen(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-100 bg-purple-50 flex justify-between items-center">
                    <h3 className="font-bold text-purple-900 uppercase tracking-widest text-sm">Bulk Link MTO Items</h3>
                    <button onClick={() => setLinkJobModalOpen(false)}><X className="w-5 h-5 text-purple-400" /></button>
                </div>
                <div className="p-6">
                    <p className="text-sm text-gray-600 mb-4">Link {selectedItemIds.size} selected items to a single DecoNetwork Job.</p>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="block text-xs font-bold text-gray-700 uppercase tracking-widest">Job ID (6 Digits)</label>
                            <input type="text" autoFocus value={linkJobId} onChange={(e) => setLinkJobId(e.target.value.replace(/\D/g, '').substring(0,6))} placeholder="e.g. 285123" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-mono tracking-wide focus:ring-2 focus:ring-purple-500 outline-none" />
                        </div>
                        <button onClick={handleBulkLink} disabled={linkJobId.length !== 6} className="w-full bg-purple-600 text-white rounded-lg py-2.5 font-bold hover:bg-purple-700 disabled:opacity-50 transition-colors uppercase tracking-widest text-xs shadow-lg">Link Selected Items</button>
                    </div>
                </div>
            </div>
          </div>
        )}

        <div className="bg-purple-900 text-white p-8 rounded-xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
                <h2 className="text-2xl font-bold flex items-center gap-3 uppercase tracking-widest"><Scissors className="w-8 h-8" />MTO Production Hub</h2>
                <p className="text-purple-200 mt-2 font-bold uppercase tracking-widest text-[10px]">Granular line-item management for bespoke orders.</p>
            </div>
            <div className="bg-white/10 px-6 py-3 rounded-xl backdrop-blur-sm border border-white/10 flex flex-col items-center">
                <span className="text-3xl font-black">{flatMtoItems.filter(i => i.fulfillmentStatus !== 'fulfilled').length}</span>
                <span className="text-[9px] uppercase font-black tracking-widest opacity-80">Unique Pending Lines</span>
            </div>
        </div>

        <div className="bg-white border border-gray-200 p-4 rounded-xl flex flex-col xl:flex-row gap-4 items-center justify-between shadow-sm">
            <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
                <MultiSelectFilter 
                    title="Filter Tags" 
                    placeholder="Search clubs..." 
                    options={clubOptions} 
                    selectedValues={selectedClubs} 
                    onChange={setSelectedClubs} 
                    showZeroByDefault={true}
                />
                
                <div className="flex items-center bg-gray-50 border border-gray-300 rounded-lg p-1 shadow-sm">
                    <div className="flex items-center gap-2 px-2 border-r border-gray-200 mr-2">
                        <Layers className="w-4 h-4 text-purple-500" />
                        <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Job Link Status</span>
                    </div>
                    <div className="flex p-0.5">
                        <button onClick={() => setLinkStatusFilter('all')} className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-all ${linkStatusFilter === 'all' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>All</button>
                        <button onClick={() => setLinkStatusFilter('linked')} className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${linkStatusFilter === 'linked' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><Link2 className="w-3 h-3" /> Linked</button>
                        <button onClick={() => setLinkStatusFilter('unlinked')} className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${linkStatusFilter === 'unlinked' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}><Unlink className="w-3 h-3" /> Not Linked</button>
                    </div>
                </div>

                <div className="flex items-center bg-gray-50 border border-gray-300 rounded-lg p-1">
                    <div className="flex items-center gap-2 px-2 border-r border-gray-200 mr-2"><CalendarIcon className="w-4 h-4 text-gray-400" /><span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Order Date</span></div>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="text-xs border-none bg-transparent p-0 focus:ring-0 text-gray-700 w-24 outline-none font-bold" />
                    <span className="text-gray-400 mx-1">-</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="text-xs border-none bg-transparent p-0 focus:ring-0 text-gray-700 w-24 outline-none font-bold" />
                </div>
            </div>
            <div className="flex gap-3 items-center w-full xl:w-auto flex-1 justify-end">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="text" placeholder="Search Items, SKUs, Orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-gray-900 text-sm outline-none font-bold uppercase" />
                </div>
                <button onClick={() => setShowCompleted(!showCompleted)} className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap uppercase tracking-widest ${showCompleted ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-white text-gray-500 border-gray-300 hover:border-purple-300'}`}>{showCompleted ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />} Show Completed</button>
            </div>
        </div>

        {groupedItems.map(([clubName, clubItems]) => {
            const isGroupSelected = clubItems.length > 0 && clubItems.every(i => selectedItemIds.has(i.id));
            return (
            <div key={clubName} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <input type="checkbox" className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" checked={isGroupSelected} onChange={(e) => handleSelectGroup(clubItems, e.target.checked)} />
                        <h3 className="font-bold text-gray-800 uppercase tracking-widest">{clubName}</h3>
                        <span className="text-[10px] font-black bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full uppercase tracking-widest">{clubItems.length} Instances</span>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-white">
                            <tr className="text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                <th className="px-6 py-3 w-12"></th>
                                <th className="px-6 py-3">MTO Item Details</th>
                                <th className="px-6 py-3">Order Info</th>
                                <th className="px-6 py-3">Date</th>
                                <th className="px-6 py-3">Deco Job</th>
                                <th className="px-6 py-3">Shopify Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {clubItems.map((item) => (
                                <tr key={`${clubName}-${item.id}`} className={`hover:bg-purple-50/30 transition-colors cursor-pointer ${selectedItemIds.has(item.id) ? 'bg-purple-50/50' : ''}`} onClick={(e) => handleToggleItem(item.id, e)}>
                                    <td className="px-6 py-4 w-12 text-center" onClick={(e) => e.stopPropagation()}>
                                        <input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={(e) => handleToggleItem(item.id, e)} className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900 uppercase tracking-wide text-sm">{item.name}</div>
                                        <div className="text-[10px] text-purple-600 font-mono font-bold mt-1 uppercase tracking-widest">SKU: {item.sku} <span className="text-gray-400 mx-1">•</span> QTY: {item.quantity}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className={`flex items-center gap-2 group ${shopifyDomain ? 'cursor-pointer' : ''}`} onClick={(e) => { e.stopPropagation(); if (shopifyDomain) window.open(`https://${shopifyDomain}/admin/orders/${item.orderId.split('/').pop()}`, '_blank'); }}>
                                            <span className="font-black text-slate-900 hover:text-indigo-600 hover:underline">#{item.orderNumber}</span>
                                            <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-indigo-400" />
                                        </div>
                                        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-1 mt-1"><User className="w-2.5 h-2.5" /> {item.customerName}</div>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                            {item.tags.filter(t => !excludedTags.includes(t)).map(tag => (
                                                <span key={tag} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[8px] font-black uppercase tracking-widest border border-slate-200">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-xs font-bold text-gray-600 uppercase tracking-widest">{new Date(item.date).toLocaleDateString('en-GB')}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        {item.jobId ? (
                                            <JobIdBadge id={item.jobId} variant="purple" onEdit={(e) => { e.stopPropagation(); setLinkJobId(item.jobId!); setSelectedItemIds(new Set([item.id])); setLinkJobModalOpen(true); }} />
                                        ) : (
                                            <button onClick={(e) => { e.stopPropagation(); setSelectedItemIds(new Set([item.id])); setLinkJobModalOpen(true); }} className="px-2 py-1 bg-white border border-gray-200 rounded text-[9px] font-black text-gray-400 hover:text-purple-600 hover:border-purple-300 uppercase tracking-widest flex items-center gap-1"><Hash className="w-3" /> Individual Job</button>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black border uppercase tracking-widest ${getShopifyStatusBadge(item.fulfillmentStatus)}`}>{item.fulfillmentStatus}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            );
        })}

        {selectedItemIds.size > 0 && (
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-purple-900 text-white px-8 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-6 animate-in slide-in-from-bottom-8">
              <div className="flex flex-col">
                  <span className="font-black text-sm uppercase tracking-[0.2em]">{selectedItemIds.size} Unique Lines Selected</span>
                  <span className="text-[9px] text-purple-300 font-bold uppercase tracking-widest">Ready for batch linking</span>
              </div>
              <div className="h-8 w-px bg-purple-700"></div>
              <button onClick={() => setLinkJobModalOpen(true)} className="bg-white text-purple-900 px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-purple-50 transition-all flex items-center gap-2 shadow-lg"><LinkIcon className="w-4 h-4" /> Link to Job</button>
              <button className="text-xs hover:text-purple-200 font-bold uppercase tracking-widest" onClick={() => setSelectedItemIds(new Set())}>Clear</button>
          </div>
        )}
    </div>
  );
};
export default MtoDashboard;
