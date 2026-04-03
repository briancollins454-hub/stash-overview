import React, { useState, useMemo, useEffect } from 'react';
import { ApiSettings } from './SettingsModal';
import { DecoJob, UnifiedOrder } from '../types';
import { fetchSingleDecoJob, standardizeSize } from '../services/apiService';
import OrderMappingModal from './OrderMappingModal';
import MultiSelectFilter from './MultiSelectFilter';
import OrderTable from './OrderTable';
import { 
    Search, Loader2, AlertCircle, Shirt, 
    Truck, Check, X, Box, User, ClipboardList, LayoutList, ChevronLeft,
    ChevronDown, ChevronUp, Link as LinkIcon, ShoppingBag, ExternalLink, RefreshCw, Cog,
    Calendar, Clock, Target, CheckCircle2, History, ClipboardCheck, PieChart as PieChartIcon
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface DecoDashboardProps {
    apiSettings: ApiSettings;
    orders: UnifiedOrder[];
    excludedTags: string[];
    onManualLink?: (orderId: string | string[], jobId: string) => Promise<void>;
    onConfirmMatch?: (itemKey: string, decoId: string) => void;
    onRefreshJob?: (jobId: string) => Promise<void>;
    onSearchJob?: (jobId: string) => Promise<DecoJob | null>;
    onBulkMatch?: (mappings: { itemKey: string, decoId: string }[], learnedPatterns?: Record<string, string>) => void;
    initialSearchId?: string | null;
    onClearInitialSearch?: () => void;
    onTimelineScan?: (id: string) => void;
    onBulkScan?: (ids: string[]) => void;
    onNavigateToJob?: (jobId: string) => void;
    sortOption?: string;
    onSortChange?: (option: string) => void;
    selectedFilterTags?: Set<string>;
    selectedOrderIds: Set<string>;
    onSelectionChange: (ids: Set<string>) => void;
    productMappings?: Record<string, string>;
    confirmedMatches?: Record<string, string>;
    eanIndex?: Map<string, string>;
}

const parseItemName = (name: string) => {
    const parts = name.split(' - ');
    if (parts.length >= 3) {
        const size = parts.pop() || '';
        const color = parts.pop() || '';
        const details = parts.join(' - ');
        return { details, color, size };
    } else if (parts.length === 2) {
        const size = parts.pop() || '';
        const details = parts.join(' - ');
        return { details, color: '-', size };
    }
    return { details: name, color: '-', size: '-' };
};

const getProductionStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'not ordered') return 'bg-red-50 text-red-800 border-red-200';
    if (s === 'unknown') return 'bg-gray-50 text-gray-400 border-gray-200 italic font-medium';
    if (s === 'awaiting processing') return 'bg-gray-100 text-gray-600 border-gray-200';
    if (s === 'cancelled' || s === 'on hold') return 'bg-red-100 text-red-700 border-red-300';
    if (s.includes('awaiting stock')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (s.includes('quote') || s.includes('artwork') || s.includes('po')) return 'bg-orange-50 text-orange-800 border-orange-200';
    if (s.includes('production') || s.includes('order') || s.includes('quality') || s.includes('process')) return 'bg-blue-50 text-blue-800 border-blue-200';
    if (s.includes('shipped') || s.includes('completed') || s.includes('ready')) return 'bg-green-100 text-green-800 border-green-200';
    if (s.includes('identified') || s.includes('linked')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
};

const StatusCell = ({ type, status }: { type: 'ordered' | 'received' | 'produced' | 'shipped', status: number }) => {
    let tickColor = 'text-gray-300';
    let showTick = true;
    switch (type) {
        case 'ordered': tickColor = status >= 20 ? 'text-green-500' : 'text-gray-300'; break;
        case 'received': tickColor = status >= 60 ? 'text-green-500' : status >= 40 ? 'text-orange-500' : 'text-gray-300'; break;
        case 'produced': tickColor = status >= 80 ? 'text-green-500' : status >= 60 ? 'text-orange-500' : 'text-gray-300'; break;
        case 'shipped': tickColor = status >= 80 ? 'text-green-500' : status >= 60 ? 'text-orange-500' : 'text-gray-300'; break;
    }
    if (status === 0) showTick = false;
    return <div className="flex items-center justify-center h-full">{showTick ? <Check className={`w-5 h-5 ${tickColor} stroke-[3]`} /> : <span className="w-5 h-5 block"></span>}</div>;
};

const DecoDashboard: React.FC<DecoDashboardProps> = ({ 
    apiSettings, orders, excludedTags, onManualLink, onConfirmMatch, onRefreshJob, onSearchJob, onBulkMatch, initialSearchId, onClearInitialSearch,
    onTimelineScan, onBulkScan, onNavigateToJob, sortOption, onSortChange, selectedFilterTags,
    selectedOrderIds, onSelectionChange, productMappings, confirmedMatches, eanIndex
}) => {
    const [viewMode, setViewMode] = useState<'search' | 'list'>('search');
    const [searchId, setSearchId] = useState('');
    const [jobData, setJobData] = useState<DecoJob | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedClubs, setSelectedClubs] = useState<Set<string>>(new Set());
    const [manualMapOpen, setManualMapOpen] = useState(false);
    const [bulkMapOrders, setBulkMapOrders] = useState<any[]>([]);
    const [bulkMapJobId, setBulkMapJobId] = useState<string>('');

    useEffect(() => {
        if (initialSearchId) {
            setSearchId(initialSearchId);
            handleSearch(initialSearchId);
            if (onClearInitialSearch) onClearInitialSearch();
        }
    }, [initialSearchId]);

    const groupedLinkedOrders = useMemo(() => {
        const linked = orders.filter(o => {
            const hasOrderLink = !!o.decoJobId;
            const hasItemLink = o.shopify.items.some(i => !!i.itemDecoJobId);
            const isNotFulfilled = o.shopify.fulfillmentStatus !== 'fulfilled';
            return (hasOrderLink || hasItemLink) && isNotFulfilled;
        });

        const groups: { [key: string]: UnifiedOrder[] } = {};
        const activeSelection = selectedFilterTags?.size ? selectedFilterTags : selectedClubs;
        
        linked.forEach(o => {
            // TAG MULTICASTING LOGIC:
            const validTags = o.shopify.tags.filter(t => !excludedTags.includes(t));
            const targetGroups = validTags.length === 0 ? ['Other'] : validTags;

            targetGroups.forEach(tag => {
                // Apply UI filter selection
                if (activeSelection.size > 0 && !activeSelection.has(tag)) return;
                
                if (!groups[tag]) groups[tag] = [];
                groups[tag].push(o);
            });
        });
        return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    }, [orders, selectedClubs, selectedFilterTags, excludedTags]);

    const clubOptions = useMemo(() => {
        const counts: {[key: string]: number} = {};
        const tags = new Set<string>();
        orders.forEach(o => {
            const hasLink = o.decoJobId || o.shopify.items.some(i => !!i.itemDecoJobId);
            if (hasLink) {
                o.shopify.tags.forEach(t => {
                    if (excludedTags.includes(t)) return;
                    tags.add(t);
                    if (o.shopify.fulfillmentStatus !== 'fulfilled') {
                        counts[t] = (counts[t] || 0) + 1;
                    }
                });
            }
        });
        return Array.from(tags).sort().map(tag => ({ label: tag, count: counts[tag] || 0 }));
    }, [orders, excludedTags]);

    const linkedShopifyOrders = useMemo(() => {
        if (!jobData) return [];
        const targetJobId = String(jobData.jobNumber).trim();
        
        return orders
            .filter(o => {
                const orderLevelMatch = o.decoJobId && String(o.decoJobId).trim() === targetJobId;
                const itemLevelMatch = o.shopify.items.some(i => i.itemDecoJobId && String(i.itemDecoJobId).trim() === targetJobId);
                return orderLevelMatch || itemLevelMatch;
            })
            .map(o => ({
                ...o,
                deco: jobData,
                productionStatus: jobData.status, 
                productionDueDate: jobData.productionDueDate 
            }));
    }, [orders, jobData]);

    const smartStatus = useMemo(() => {
        if (!jobData) return null;
        const allShipped = jobData.items.every(i => i.shippingStatus >= 80);
        const allProduced = jobData.items.every(i => i.productionStatus >= 80);
        const anyProduced = jobData.items.some(i => i.productionStatus >= 80);
        const anyReceived = jobData.items.some(i => i.procurementStatus >= 60);
        let status = jobData.status;
        let isCalculated = false;
        if (allShipped && status !== 'Shipped') { status = 'Shipped'; isCalculated = true; }
        else if (allProduced && status !== 'Completed' && status !== 'Shipped') { status = 'Completed'; isCalculated = true; }
        else if ((anyProduced || anyReceived) && (status === 'Order' || status === 'Quote')) { status = 'Production'; isCalculated = true; }
        return { label: status, isCalculated };
    }, [jobData]);

    const handleSearch = async (overrideId?: string) => {
        const idToSearch = overrideId || searchId;
        if (!idToSearch) return;
        setLoading(true); setError(null); setJobData(null);
        if (viewMode === 'list') setViewMode('search');
        if (overrideId) setSearchId(idToSearch);
        try {
            const job = await fetchSingleDecoJob(apiSettings, idToSearch);
            if (job) setJobData(job);
            else setError(`Job #${idToSearch} not found.`);
        } catch (e: any) { setError(e.message || "Failed to fetch job."); }
        finally { setLoading(false); }
    };

    const handleManualMap = () => {
        if (linkedShopifyOrders.length > 0) {
            setBulkMapOrders(linkedShopifyOrders.map(u => u.shopify));
            setBulkMapJobId(linkedShopifyOrders[0].decoJobId || jobData?.jobNumber || '');
            setManualMapOpen(true);
        } else if (jobData) {
            setBulkMapJobId(jobData.jobNumber);
            setManualMapOpen(true);
        } else {
            alert("Search for a Job ID first to map items.");
        }
    };

    const statusDistribution = useMemo(() => {
        const counts: { [key: string]: number } = {};
        orders.forEach(o => {
            const hasLink = o.decoJobId || o.shopify.items.some(i => !!i.itemDecoJobId);
            if (hasLink && o.shopify.fulfillmentStatus !== 'fulfilled') {
                const status = o.productionStatus || 'Unknown';
                counts[status] = (counts[status] || 0) + 1;
            }
        });
        
        const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#6366F1', '#8B5CF6', '#EC4899'];
        return Object.entries(counts)
            .map(([name, value], index) => ({ 
                name, 
                value,
                color: COLORS[index % COLORS.length]
            }))
            .sort((a, b) => b.value - a.value);
    }, [orders]);

    return (
        <div className="w-full max-w-[1400px] mx-auto min-h-[80vh] flex flex-col items-center p-4">
            {manualMapOpen && onSearchJob && onBulkMatch && (
                <OrderMappingModal 
                  isOpen={manualMapOpen} 
                  onClose={() => setManualMapOpen(false)} 
                  orders={bulkMapOrders} 
                  currentDecoJobId={bulkMapJobId} 
                  onSearchJob={onSearchJob} 
                  onSaveMappings={(mappings, jobId, learnedPatterns) => onBulkMatch(mappings, learnedPatterns)}
                  productMappings={productMappings || {}}
                  confirmedMatches={confirmedMatches || {}}
                  itemJobLinks={{}}
                  eanIndex={eanIndex}
                />
            )}
            <div className={`transition-all duration-500 w-full max-w-4xl flex flex-col md:flex-row gap-3 mb-6 ${jobData || viewMode === 'list' ? 'mt-0' : 'mt-32'}`}>
                <div className="flex-1 bg-white p-2 rounded-xl shadow-md flex items-center border border-gray-200">
                    <Search className="w-5 h-5 text-gray-400 ml-3" />
                    <input type="text" placeholder="Enter Deco Job Number..." value={searchId} onChange={(e) => setSearchId(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} className="flex-1 px-4 py-3 outline-none text-lg text-slate-700 placeholder-slate-400 bg-transparent font-bold" />
                    <button onClick={() => handleSearch()} disabled={loading || !searchId} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50 uppercase tracking-widest text-sm">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}</button>
                </div>
                <div className="flex gap-2">
                    {viewMode === 'list' && <MultiSelectFilter title="Filter Tags" options={clubOptions} selectedValues={selectedClubs} onChange={setSelectedClubs} />}
                    <button onClick={() => setViewMode(viewMode === 'search' ? 'list' : 'search')} className={`px-4 py-2 rounded-xl font-bold shadow-md border flex items-center gap-2 transition-all whitespace-nowrap uppercase tracking-widest text-xs ${viewMode === 'list' ? 'bg-gray-800 text-white border-gray-900' : 'bg-white text-slate-700 border-gray-200'}`}>{viewMode === 'list' ? <ChevronLeft className="w-5 h-5" /> : <LayoutList className="w-5 h-5" />}{viewMode === 'list' ? 'Back' : 'Browse Jobs'}</button>
                </div>
            </div>

            {error && <div className="w-full max-w-2xl mb-6 p-4 bg-red-100 border border-red-200 text-red-700 rounded-lg flex items-center gap-2 font-bold uppercase tracking-wide"><AlertCircle className="w-5 h-5" /> {error}</div>}

            {viewMode === 'list' && (
                <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4">
                    {/* Analytics Summary */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col">
                            <div className="flex items-center gap-2 mb-4">
                                <PieChartIcon className="w-5 h-5 text-indigo-600" />
                                <h3 className="font-bold text-slate-800 uppercase tracking-widest text-sm">Production Status Distribution</h3>
                            </div>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={statusDistribution}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {statusDistribution.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                            itemStyle={{ fontWeight: 'bold', fontSize: '12px', textTransform: 'uppercase' }}
                                        />
                                        <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', paddingLeft: '20px' }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                        <div className="bg-indigo-600 p-6 rounded-xl shadow-lg text-white flex flex-col justify-center items-center text-center">
                            <ClipboardCheck className="w-12 h-12 mb-4 opacity-50" />
                            <h4 className="text-4xl font-bold mb-1">{orders.filter(o => (o.decoJobId || o.shopify.items.some(i => !!i.itemDecoJobId)) && o.shopify.fulfillmentStatus !== 'fulfilled').length}</h4>
                            <p className="text-xs font-bold uppercase tracking-widest opacity-80">Active Linked Orders</p>
                            <div className="mt-6 w-full h-px bg-white/20"></div>
                            <div className="mt-6 grid grid-cols-2 gap-4 w-full">
                                <div>
                                    <p className="text-2xl font-bold">{orders.filter(o => o.productionStatus?.toLowerCase().includes('shipped')).length}</p>
                                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Shipped</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{orders.filter(o => o.productionStatus?.toLowerCase().includes('production')).length}</p>
                                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">In Prod</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {groupedLinkedOrders.length === 0 ? <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center text-slate-400 italic font-bold uppercase tracking-widest text-xs">No linked jobs found matching the selection.</div> : groupedLinkedOrders.map(([club, clubOrders]) => (
                        <div key={club} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center"><h3 className="font-bold text-lg text-slate-800 uppercase tracking-widest">{club}</h3><span className="bg-gray-200 text-slate-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">{clubOrders.length} Instances</span></div>
                            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-white border-b border-gray-100 text-slate-500 uppercase text-[10px]"><tr><th className="px-6 py-3 font-bold tracking-widest">Order #</th><th className="px-6 py-3 font-bold tracking-widest">Customer</th><th className="px-6 py-3 font-bold tracking-widest">Linked Deco Job(s)</th><th className="px-6 py-3 font-bold tracking-widest">Shopify Progress</th></tr></thead><tbody className="divide-y divide-gray-100">{clubOrders.map(order => {
                                const allJobs = Array.from(new Set([
                                    order.decoJobId,
                                    ...order.shopify.items.map(i => i.itemDecoJobId)
                                ].filter(Boolean)));

                                return (
                                <tr key={`${club}-${order.shopify.id}`} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => handleSearch(allJobs[0])}>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900">#{order.shopify.orderNumber}</div>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {order.shopify.tags
                                                .filter(tag => !excludedTags.includes(tag))
                                                .map(tag => (
                                                    <span key={tag} className="px-1 py-0.5 bg-slate-100 text-slate-500 rounded text-[7px] font-black uppercase tracking-tighter border border-slate-200/50">
                                                        {tag}
                                                    </span>
                                                ))
                                            }
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 font-bold uppercase tracking-wide text-slate-800">{order.shopify.customerName}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-wrap gap-1.5">
                                            {allJobs.map(jobId => (
                                                <div key={jobId} className="flex flex-col gap-0.5">
                                                    <span className="font-mono text-blue-700 font-bold tracking-widest text-xs">#{jobId}</span>
                                                </div>
                                            ))}
                                            {allJobs.length === 0 && <span className="text-gray-400 italic text-[10px]">N/A</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4"><div className="flex flex-col items-start"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${order.shopify.fulfillmentStatus === 'fulfilled' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>{order.shopify.fulfillmentStatus}</span><span className="text-[10px] text-indigo-600 font-bold mt-1 uppercase tracking-widest">{order.completionPercentage}% Ready</span></div></td>
                                </tr>
                            )})}</tbody></table></div>
                        </div>
                    ))}
                </div>
            )}

            {viewMode === 'search' && jobData && (
                <div className="w-full space-y-6">
                    <div className="bg-white shadow-lg border border-gray-200 rounded-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                        <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div className="flex gap-4">
                                <div className="bg-indigo-600 p-3 rounded-lg text-white shadow-sm"><Shirt className="w-8 h-8" /></div>
                                <div>
                                    <div className="flex items-center gap-3"><h1 className="text-2xl font-bold text-slate-900 uppercase tracking-widest">Job #{jobData.jobNumber}</h1><div className="flex items-center gap-2"><span className={`px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-widest flex items-center gap-1.5 shadow-sm ${getProductionStatusBadge(smartStatus?.label || jobData.status)}`}>{smartStatus?.isCalculated && <History className="w-3.5 h-3.5" />}{smartStatus?.label || jobData.status}</span></div></div>
                                    <h2 className="text-lg text-indigo-700 font-bold uppercase tracking-widest mt-1">{jobData.jobName}</h2>
                                    <p className="text-slate-500 text-xs font-bold flex items-center gap-1 mt-1 uppercase tracking-widest"><User className="w-3" /> {jobData.customerName}</p>
                                </div>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1">
                                <button onClick={handleManualMap} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-xs hover:bg-indigo-700 transition-all shadow-sm whitespace-nowrap uppercase tracking-widest"><LinkIcon className="w-4 h-4" /> Map Items</button>
                                <button onClick={() => jobData.jobNumber && onRefreshJob?.(jobData.jobNumber)} className="p-2 bg-white border border-gray-300 rounded-lg text-slate-500 hover:text-indigo-600 transition-colors"><RefreshCw className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50/50 border-b border-gray-200 grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div className="flex items-center gap-3"><Calendar className="w-4 h-4 text-slate-400" /><div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Order Date</p><p className="text-xs font-bold text-slate-700 uppercase tracking-tight">{jobData.dateOrdered ? new Date(jobData.dateOrdered).toLocaleDateString('en-GB') : '-'}</p></div></div>
                            <div className="flex items-center gap-3"><Clock className="w-4 h-4 text-indigo-400" /><div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Production Date</p><p className="text-xs font-bold text-slate-700 uppercase tracking-tight">{jobData.productionDueDate ? new Date(jobData.productionDueDate).toLocaleDateString('en-GB') : '-'}</p></div></div>
                            <div className="flex items-center gap-3"><Target className="w-4 h-4 text-orange-400" /><div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Due Date</p><p className="text-xs font-bold text-slate-700 uppercase tracking-tight">{jobData.dateDue ? new Date(jobData.dateDue).toLocaleDateString('en-GB') : '-'}</p></div></div>
                            <div className="flex items-center gap-3"><Truck className="w-4 h-4 text-emerald-400" /><div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Shipping Date</p><p className="text-xs font-bold text-slate-700 uppercase tracking-tight">{jobData.dateShipped ? new Date(jobData.dateShipped).toLocaleDateString('en-GB') : '-'}</p></div></div>
                            <div className="flex items-center gap-3"><CheckCircle2 className="w-4 h-4 text-blue-400" /><div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Completion</p><p className="text-xs font-bold text-slate-700 uppercase tracking-tight">{jobData.itemsProduced} / {jobData.totalItems} Items</p></div></div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-[10px] border-collapse">
                                <thead><tr className="bg-gray-100 border-b border-gray-300 text-slate-600 font-bold uppercase tracking-widest"><th className="p-3 w-28">SKU</th><th className="p-3 w-32">EAN</th><th className="p-3">Details</th><th className="p-3 w-28 text-center">Color</th><th className="p-3 w-24 text-center">Size x Qty</th><th className="p-3 w-20 text-center">Ord</th><th className="p-3 w-20 text-center">Rcvd</th><th className="p-3 w-20 text-center">Prod</th><th className="p-3 w-20 text-center">Ship</th><th className="p-3 w-32 text-center">Status</th></tr></thead>
                                <tbody className="text-slate-900 bg-white">{jobData.items.map((item, idx) => {
                                    const { details, color, size } = parseItemName(item.name);
                                    return (
                                        <tr key={idx} className="border-b border-gray-200 hover:bg-blue-50/50">
                                            <td className="p-3 font-mono text-slate-600 font-bold uppercase tracking-wider text-[10px]">{item.productCode || item.vendorSku}</td>
                                            <td className="p-3 font-mono text-indigo-600 font-bold uppercase tracking-wider text-[10px]">{item.ean || '-'}</td>
                                            <td className="p-3 font-bold text-slate-900 uppercase tracking-wide">{details}</td>
                                            <td className="p-3 text-center"><div className={`inline-block px-3 py-1 rounded font-bold uppercase tracking-widest text-[9px] border shadow-sm ${color.toLowerCase().includes('black') ? 'bg-black text-white' : 'bg-gray-100'}`}>{color}</div></td>
                                            <td className="p-3 text-center font-bold text-sm text-slate-900"><span>{size}</span><span className="text-slate-400 mx-1">x</span><span>{item.quantity}</span></td>
                                            <td className="p-3"><StatusCell type="ordered" status={item.procurementStatus} /></td>
                                            <td className="p-3"><StatusCell type="received" status={item.procurementStatus} /></td>
                                            <td className="p-3"><StatusCell type="produced" status={item.productionStatus} /></td>
                                            <td className="p-3"><StatusCell type="shipped" status={item.shippingStatus} /></td>
                                            <td className="p-3 text-center"><span className={`px-2 py-1 rounded-full text-[9px] font-bold uppercase border tracking-widest ${item.shippingStatus >= 80 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-slate-600 border-gray-200'}`}>{item.status}</span></td>
                                        </tr>
                                    );
                                })}</tbody>
                            </table>
                        </div>
                    </div>

                    {linkedShopifyOrders.length > 0 && (
                        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                            <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
                                <ShoppingBag className="w-5 h-5 text-indigo-600" />
                                <h3 className="font-bold text-indigo-900 uppercase tracking-widest text-sm">Linked Shopify Orders ({linkedShopifyOrders.length})</h3>
                            </div>
                            <div className="p-4 bg-gray-50/10">
                                <OrderTable 
                                    orders={linkedShopifyOrders}
                                    excludedTags={excludedTags}
                                    shopifyDomain={apiSettings.shopifyDomain}
                                    sortOption={sortOption || 'date_desc'}
                                    onSortChange={onSortChange || (() => {})}
                                    onConfirmMatch={onConfirmMatch}
                                    onRefreshJob={onRefreshJob}
                                    onSearchJob={onSearchJob}
                                    onBulkMatch={onBulkMatch}
                                    onTimelineScan={onTimelineScan}
                                    onBulkScan={onBulkScan}
                                    onManualLink={onManualLink ? (ids, jId) => onManualLink(ids, jId) : undefined}
                                    onNavigateToJob={onNavigateToJob}
                                    selectedOrderIds={selectedOrderIds}
                                    onSelectionChange={onSelectionChange}
                                    eanIndex={eanIndex}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DecoDashboard;