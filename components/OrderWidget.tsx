import React, { useState, useEffect } from 'react';
import { UnifiedOrder, DecoJob } from '../types';
import { 
    AlertTriangle, Link as LinkIcon, RefreshCw, ExternalLink, 
    CheckCircle2, Package, Clock, Search, Loader2, X, Plus
} from 'lucide-react';

interface OrderWidgetProps {
    order: UnifiedOrder;
    shopifyDomain: string;
    onManualLink: (orderIds: string[], jobId: string) => Promise<void>;
    onRefreshJob: (jobId: string) => Promise<void>;
    onSearchJob: (jobId: string) => Promise<DecoJob | null>;
    onItemJobLink: (orderNumber: string, itemId: string, jobId: string) => Promise<void>;
}

const OrderWidget: React.FC<OrderWidgetProps> = ({ 
    order, 
    shopifyDomain, 
    onManualLink, 
    onRefreshJob, 
    onSearchJob,
    onItemJobLink 
}) => {
    const [isLinking, setIsLinking] = useState(false);
    const [manualJobId, setManualJobId] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLink = async () => {
        if (!manualJobId) return;
        setIsSearching(true);
        setError(null);
        try {
            const job = await onSearchJob(manualJobId);
            if (job) {
                await onManualLink([order.shopify.id], manualJobId);
                setIsLinking(false);
                setManualJobId('');
            } else {
                setError("Job not found in DecoNetwork.");
            }
        } catch (e: any) {
            setError(e.message || "Failed to link job.");
        } finally {
            setIsSearching(false);
        }
    };

    const [mappingItemId, setMappingItemId] = useState<string | null>(null);

    const handleItemMap = async (itemId: string, decoItemId: string) => {
        try {
            setError(null);
            await onItemJobLink(order.shopify.orderNumber, itemId, decoItemId);
            setMappingItemId(null);
        } catch (e: any) {
            setError(e.message || "Failed to map item.");
        }
    };

    const decoJobId = order.decoJobId;
    const decoJob = order.deco;

    return (
        <div className="bg-white min-h-screen flex flex-col font-sans text-slate-900 p-4">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Stash Shop Sync</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-black tracking-tighter">ORDER #{order.shopify.orderNumber}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${
                            order.shopify.fulfillmentStatus === 'fulfilled' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                        }`}>
                            {order.shopify.fulfillmentStatus}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => onRefreshJob(decoJobId || '')}
                        disabled={!decoJobId}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all disabled:opacity-30"
                        title="Refresh Job Data"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {!decoJobId ? (
                <div className="flex-1 flex flex-col items-center justify-center py-8 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                        <LinkIcon className="w-6 h-6 text-slate-400" />
                    </div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-600 mb-2">No Deco Job Linked</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6 max-w-[200px]">
                        Link this order to a DecoNetwork job to track production progress.
                    </p>
                    
                    {isLinking ? (
                        <div className="w-full max-w-[240px] space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                <input 
                                    type="text" 
                                    placeholder="ENTER DECO JOB ID..." 
                                    value={manualJobId}
                                    onChange={(e) => setManualJobId(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    autoFocus
                                />
                            </div>
                            {error && <p className="text-[9px] font-black text-red-500 uppercase tracking-widest">{error}</p>}
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setIsLinking(false)}
                                    className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleLink}
                                    disabled={!manualJobId || isSearching}
                                    className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                                >
                                    {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                    Link Job
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button 
                            onClick={() => setIsLinking(true)}
                            className="px-8 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-indigo-600 transition-all flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Link Deco Job
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-indigo-600 rounded-2xl p-4 text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12">
                            <Package className="w-24 h-24" />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">DecoNetwork Job</span>
                                <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded">#{decoJobId}</span>
                            </div>
                            <h3 className="text-xl font-black tracking-tighter mb-4 truncate">{decoJob?.jobName || 'Loading...'}</h3>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
                                    <span className="block text-[8px] font-black uppercase tracking-widest opacity-60 mb-1">Status</span>
                                    <span className="block text-[10px] font-black uppercase tracking-widest truncate">{decoJob?.status || 'Unknown'}</span>
                                </div>
                                <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
                                    <span className="block text-[8px] font-black uppercase tracking-widest opacity-60 mb-1">Progress</span>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-white transition-all duration-1000" 
                                                style={{ width: `${decoJob ? (decoJob.itemsProduced / decoJob.totalItems) * 100 : 0}%` }}
                                            ></div>
                                        </div>
                                        <span className="text-[10px] font-black">{decoJob ? `${decoJob.itemsProduced}/${decoJob.totalItems}` : '0/0'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Line Item Mapping</h4>
                        <div className="space-y-2">
                            {order.shopify.items.map((item: any) => {
                                const linkedJobId = item.itemDecoJobId || decoJobId;
                                const isMapped = !!item.linkedDecoItemId;
                                
                                return (
                                    <div key={item.id} className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-black uppercase tracking-tight truncate mb-0.5">{item.name}</p>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">SKU: {item.sku || '-'}</span>
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">•</span>
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">QTY: {item.quantity}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2">
                                            {isMapped ? (
                                                <div className="flex flex-col items-end">
                                                    <div className="flex items-center gap-1">
                                                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                                                            item.decoShipped ? 'bg-emerald-100 text-emerald-700' : 
                                                            item.decoProduced ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                                                        }`}>
                                                            {item.decoStatus || 'Mapped'}
                                                        </span>
                                                        <button 
                                                            onClick={() => onItemJobLink(order.shopify.orderNumber, item.id, '')}
                                                            className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                                                            title="Unmap Item"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <span className="text-[7px] font-bold text-slate-400 uppercase mt-1">TRACKING ACTIVE</span>
                                                </div>
                                            ) : (
                                                <button 
                                                    onClick={() => setMappingItemId(item.id)}
                                                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all"
                                                    title="Map to Deco Item"
                                                >
                                                    <LinkIcon className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>

                                        {mappingItemId === item.id && (
                                            <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-20 p-3 flex flex-col rounded-xl border border-indigo-100 shadow-xl">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h5 className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Map to Deco Item</h5>
                                                    <button onClick={() => setMappingItemId(null)} className="p-1 hover:bg-slate-100 rounded">
                                                        <X className="w-3 h-3 text-slate-400" />
                                                    </button>
                                                </div>
                                                <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                                    {order.deco?.items.map((decoItem, idx) => {
                                                        const decoId = `${decoItem.vendorSku || decoItem.productCode || decoItem.name}@@@${idx}`;
                                                        return (
                                                            <button 
                                                                key={decoId}
                                                                onClick={() => handleItemMap(item.id, decoId)}
                                                                className="w-full text-left p-2 hover:bg-indigo-50 rounded-lg border border-transparent hover:border-indigo-100 transition-all group"
                                                            >
                                                                <p className="text-[10px] font-black uppercase tracking-tight truncate group-hover:text-indigo-700">{decoItem.name}</p>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{decoItem.vendorSku || decoItem.productCode || 'NO SKU'}</span>
                                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">•</span>
                                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{decoItem.status}</span>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                    <button 
                                                        onClick={() => handleItemMap(item.id, '__NO_MAP__')}
                                                        className="w-full text-left p-2 hover:bg-slate-100 rounded-lg border border-dashed border-slate-200 transition-all"
                                                    >
                                                        <p className="text-[10px] font-black uppercase tracking-tight text-slate-400">Mark as No Mapping Needed</p>
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                        <button 
                            onClick={() => {
                                if(window.confirm("Are you sure you want to unlink this job?")) {
                                    onManualLink([order.shopify.id], '');
                                }
                            }}
                            className="text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-600 transition-colors"
                        >
                            Unlink Job
                        </button>
                        <a 
                            href={`https://${shopifyDomain}/admin/apps/stash-shop-sync`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[9px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 flex items-center gap-1 transition-colors"
                        >
                            Open Full Dashboard <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderWidget;
