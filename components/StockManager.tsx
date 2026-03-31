
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { UnifiedOrder, PhysicalStockItem, ReturnStockItem, ShopifyOrder, ReferenceProduct } from '../types';
import { 
    Barcode, Undo2, LayoutGrid, Search, Plus, Trash2, 
    CheckCircle2, AlertCircle, ShoppingBag, ArrowRight,
    ArrowUpRight, Package, Box, Filter, Boxes, Copy, Mail, Check, MessageSquare, Eye, Edit, Save, X, Settings2,
    ShieldCheck, Zap, ChevronDown, Sparkles, Upload, FileJson, Table, Database, RefreshCw,
    User, Maximize, Loader2, FileType, CheckSquare, Layers
  } from 'lucide-react';

interface StockManagerProps {
  physicalStock: PhysicalStockItem[];
  setPhysicalStock: (updater: (prev: PhysicalStockItem[]) => PhysicalStockItem[]) => void;
  returnStock: ReturnStockItem[];
  setReturnStock: (updater: (prev: ReturnStockItem[]) => ReturnStockItem[]) => void;
  referenceProducts: ReferenceProduct[];
  setReferenceProducts: (products: ReferenceProduct[]) => void;
  orders: UnifiedOrder[];
  availableTags: string[];
}

// Robust CSV Parser that handles commas inside quotes
const parseCsvLine = (text: string) => {
    const re = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    return text.split(re).map(cell => cell.trim().replace(/^"|$/g, ''));
};

const StockManager: React.FC<StockManagerProps> = ({ 
    physicalStock, setPhysicalStock, returnStock, setReturnStock, referenceProducts, setReferenceProducts, orders, availableTags 
}) => {
    const [activeSubTab, setActiveSubTab] = useState<'dashboard' | 'upload' | 'view' | 'returns' | 'master'>('dashboard');
    
    // --- Add Stock State ---
    const [eanInput, setEanInput] = useState('');
    const [vendorInput, setVendorInput] = useState('');
    const [codeInput, setCodeInput] = useState('');
    const [descInput, setDescInput] = useState(''); 
    const [colourInput, setColourInput] = useState('');
    const [sizeInput, setSizeInput] = useState('');
    const [qtyInput, setQtyInput] = useState(1);
    const [isEmbellished, setIsEmbellished] = useState(false);
    const [clubNameInput, setClubNameInput] = useState('');
    const [showTagSelector, setShowTagSelector] = useState(false);
    const [autoFillSource, setAutoFillSource] = useState<'history' | 'master' | null>(null);
    const tagSelectorRef = useRef<HTMLDivElement>(null);

    // --- Master Data State ---
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [csvSampleRows, setCsvSampleRows] = useState<string[][]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({
        ean: '', vendor: '', productCode: '', description: '', colour: '', size: ''
    });
    const [isProcessingCsv, setIsProcessingCsv] = useState(false);

    // --- View Stock State ---
    const [stockSearch, setStockSearch] = useState('');
    const [viewFilter, setViewFilter] = useState<'all' | 'plain' | 'embellished'>('all');
    const [editingStockId, setEditingStockId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<Partial<PhysicalStockItem>>({});

    // --- Allocation Feedback State ---
    const [allocatedPairs, setAllocatedPairs] = useState<Set<string>>(new Set());

    // --- Returns State ---
    const [orderSearch, setOrderSearch] = useState('');
    const [foundOrder, setFoundOrder] = useState<ShopifyOrder | null>(null);

    // Smart Auto-population logic
    useEffect(() => {
        if (eanInput.length >= 8) {
            const masterMatch = referenceProducts.find(p => p.ean === eanInput);
            if (masterMatch) {
                setVendorInput(masterMatch.vendor || '');
                setCodeInput(masterMatch.productCode || '');
                setDescInput(masterMatch.description || '');
                setColourInput(masterMatch.colour || '');
                setSizeInput(masterMatch.size || '');
                setAutoFillSource('master');
                setTimeout(() => setAutoFillSource(null), 3000);
                return;
            }

            const histMatch = physicalStock.find(item => item.ean === eanInput);
            if (histMatch) {
                setVendorInput(histMatch.vendor || '');
                setCodeInput(histMatch.productCode || '');
                setDescInput(histMatch.description || '');
                setColourInput(histMatch.colour || '');
                setSizeInput(histMatch.size || '');
                setIsEmbellished(histMatch.isEmbellished);
                setClubNameInput(histMatch.clubName || '');
                setAutoFillSource('history');
                setTimeout(() => setAutoFillSource(null), 3000);
            }
        }
    }, [eanInput, physicalStock, referenceProducts]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setCsvFile(file);

        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== 'string') return;
            const text: string = result;
            const lines: string[] = text.split('\n').filter(l => l.trim() !== '');
            if (lines.length > 0) {
                const headers = parseCsvLine(lines[0] || '');
                setCsvHeaders(headers);
                
                const samples = lines.slice(1, 4).map((l: string) => parseCsvLine(l || ''));
                setCsvSampleRows(samples);
                
                const newMapping = { ean: '', vendor: '', productCode: '', description: '', colour: '', size: '' };
                headers.forEach(h => {
                    const low = h.toLowerCase();
                    if (low.includes('ean') || low.includes('barcode') || low.includes('upc') || low.includes('gtin')) newMapping.ean = h;
                    if (low.includes('vendor') || low.includes('supplier') || low.includes('brand')) newMapping.vendor = h;
                    if (low.includes('sku') || low.includes('code') || low.includes('ref')) newMapping.productCode = h;
                    if (low.includes('name') || low.includes('description') || low.includes('title') || low.includes('item')) newMapping.description = h;
                    if (low.includes('color') || low.includes('colour') || low.includes('shade')) newMapping.colour = h;
                    if (low.includes('size')) newMapping.size = h;
                });
                setMapping(newMapping);
            }
        };
        reader.readAsText(file);
    };

    const processMasterCsv = async () => {
        if (!csvFile || !mapping.ean) return;
        setIsProcessingCsv(true);
        try {
            const text: string = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const res = reader.result;
                    if (typeof res === 'string') {
                        resolve(res);
                    } else {
                        reject(new Error("Failed to read file as string"));
                    }
                };
                reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
                reader.readAsText(csvFile as File);
            });
            
            const lines: string[] = text.split('\n').filter(l => l.trim() !== '');
            if (lines.length === 0) {
                setIsProcessingCsv(false);
                return;
            }
            
            // Fix: Ensured index access is safe and typed correctly for CSV parsing on line 161 (offset by comments)
            const headers = parseCsvLine(lines[0] || '');
            
            const colIndices: Record<string, number> = {};
            // Fix: Explicitly cast to [string, string][] to ensure 'val' is recognized as a string by headers.indexOf()
            (Object.entries(mapping) as [string, string][]).forEach(([key, val]) => {
                colIndices[key] = headers.indexOf(val);
            });

            const products: ReferenceProduct[] = [];
            for (let i = 1; i < lines.length; i++) {
                const cells = parseCsvLine(lines[i] || '');
                if (cells.length < headers.length) continue;

                // Access colIndices with string keys
                const eanIndex = colIndices['ean'];
                const ean = (eanIndex !== undefined && eanIndex !== -1) ? cells[eanIndex] : '';
                if (!ean) continue;

                products.push({
                    ean,
                    vendor: (colIndices['vendor'] !== undefined && colIndices['vendor'] !== -1) ? cells[colIndices['vendor']] : '',
                    productCode: (colIndices['productCode'] !== undefined && colIndices['productCode'] !== -1) ? cells[colIndices['productCode']] : '',
                    description: (colIndices['description'] !== undefined && colIndices['description'] !== -1) ? cells[colIndices['description']] : '',
                    colour: (colIndices['colour'] !== undefined && colIndices['colour'] !== -1) ? cells[colIndices['colour']] : '',
                    size: (colIndices['size'] !== undefined && colIndices['size'] !== -1) ? cells[colIndices['size']] : ''
                });
            }

            setReferenceProducts(products);
            alert(`Import Successful! ${products.length} products merged into Global Master library.`);
            
            setCsvFile(null);
            setCsvHeaders([]);
            setCsvSampleRows([]);
            setMapping({ ean: '', vendor: '', productCode: '', description: '', colour: '', size: '' });
        // Fix: Explicitly typing catch variable as any to avoid 'unknown' narrowing issues
        } catch (err: any) {
            const errorMsg = err?.message || String(err);
            alert(`Sync Failed: ${errorMsg}`);
        } finally {
            setIsProcessingCsv(false);
        }
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (tagSelectorRef.current && !tagSelectorRef.current.contains(event.target as Node)) {
                setShowTagSelector(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredTags = useMemo(() => {
        if (!clubNameInput) return availableTags;
        const lower = clubNameInput.toLowerCase();
        return availableTags.filter(tag => tag.toLowerCase().includes(lower));
    }, [availableTags, clubNameInput]);

    const handleAddPhysical = (e: React.FormEvent) => {
        e.preventDefault();
        if (!eanInput || !descInput) return;
        
        const newItem: PhysicalStockItem = {
            id: `stock_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            ean: eanInput.trim(),
            vendor: vendorInput.trim(),
            productCode: codeInput.trim(),
            description: descInput.trim(),
            colour: colourInput.trim(),
            size: sizeInput.trim(),
            quantity: qtyInput,
            isEmbellished: isEmbellished,
            clubName: isEmbellished ? clubNameInput.trim() : undefined,
            addedAt: Date.now()
        };
        
        setPhysicalStock(prev => [newItem, ...prev]);
        setEanInput(''); setVendorInput(''); setCodeInput(''); setDescInput(''); setColourInput(''); setSizeInput(''); setQtyInput(1); setIsEmbellished(false); setClubNameInput('');
    };

    const handleStartEdit = (item: PhysicalStockItem) => {
        setEditingStockId(item.id);
        setEditValues({ ...item });
    };

    const handleSaveEdit = () => {
        if (!editingStockId) return;
        setPhysicalStock(prev => prev.map(item => 
            item.id === editingStockId ? { ...item, ...editValues } as PhysicalStockItem : item
        ));
        setEditingStockId(null);
        setEditValues({});
    };

    const aggregatedStock = useMemo(() => {
        const groups: Record<string, PhysicalStockItem> = {};
        physicalStock.forEach(item => {
            if (viewFilter === 'plain' && item.isEmbellished) return;
            if (viewFilter === 'embellished' && !item.isEmbellished) return;
            const key = `${item.ean}-${item.isEmbellished}-${item.isEmbellished ? item.clubName : 'plain'}-${item.size}-${item.colour}`;
            if (groups[key]) groups[key] = { ...groups[key], quantity: groups[key].quantity + item.quantity };
            else groups[key] = { ...item };
        });
        let result = Object.values(groups);
        if (stockSearch) {
            const lower = stockSearch.toLowerCase();
            result = result.filter(i => 
                i.ean.includes(lower) || 
                i.description.toLowerCase().includes(lower) || 
                i.vendor.toLowerCase().includes(lower) || 
                (i.clubName && i.clubName.toLowerCase().includes(lower))
            );
        }
        return result.sort((a, b) => b.addedAt - a.addedAt);
    }, [physicalStock, stockSearch, viewFilter]);

    const stockAllocations = useMemo(() => {
        const unfulfilledOrders = orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled');
        const physicalMatches = physicalStock.filter(ps => ps.quantity > 0).map(ps => {
            const matches = unfulfilledOrders.filter(uo => {
                const hasEanMatch = uo.shopify.items.some(i => i.ean === ps.ean && i.itemStatus !== 'fulfilled');
                if (!hasEanMatch) return false;
                if (ps.isEmbellished) {
                    return uo.shopify.tags.some(tag => tag.toLowerCase() === ps.clubName?.toLowerCase());
                }
                return true; 
            });
            return { stockItem: ps, source: 'ean' as const, matchingOrders: matches };
        }).filter(m => m.matchingOrders.length > 0);

        const returnMatches = returnStock.map(rs => {
            const matches = unfulfilledOrders.filter(uo => 
                uo.shopify.items.some(i => 
                    i.name === rs.itemName && 
                    i.ean === rs.ean && 
                    i.itemStatus !== 'fulfilled'
                )
            );
            return { stockItem: rs, source: 'return' as const, matchingOrders: matches };
        }).filter(m => m.matchingOrders.length > 0);

        return [...physicalMatches, ...returnMatches];
    }, [orders, physicalStock, returnStock]);

    const handleAllocate = (source: 'ean' | 'return', stockId: string, orderId: string) => {
        const pairKey = `${stockId}-${orderId}`;
        if (allocatedPairs.has(pairKey)) return;
        if (source === 'ean') {
            setPhysicalStock(prev => prev.map(item => {
                if (item.id === stockId) return { ...item, quantity: Math.max(0, item.quantity - 1) };
                return item;
            }));
        } else {
            setReturnStock(prev => prev.filter(i => i.id !== stockId));
        }
        setAllocatedPairs(prev => {
            const next = new Set(prev);
            next.add(pairKey);
            return next;
        });
    };

    const handleReturnItem = (item: any) => {
        if (!foundOrder) return;
        const sizeMatch = item.name.split(' - ').pop();
        const newItem: ReturnStockItem = {
            id: `return_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            orderNumber: foundOrder.orderNumber,
            itemName: item.name,
            sku: item.sku,
            quantity: 1, 
            addedAt: Date.now(),
            size: sizeMatch || '-',
            ean: item.ean || '-'
        };
        setReturnStock(prev => [newItem, ...prev]);
    };

    const handleSearchOrder = () => {
        const lowerSearch = orderSearch.trim().toLowerCase();
        const found = orders.find(o => 
            o.shopify.orderNumber.toLowerCase() === lowerSearch || 
            o.shopify.id.split('/').pop() === lowerSearch
        );
        if (found) setFoundOrder(found.shopify);
        else alert("Order not found in recent records.");
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                        <Boxes className="w-7 h-7 text-indigo-600" /> Stock Management
                    </h2>
                    <p className="text-gray-500 mt-1 uppercase tracking-widest text-[10px] font-black">Building Inventory • Returns • Multi-Supplier Reference library</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {[
                        { id: 'dashboard', label: 'Allocation Hub', icon: <LayoutGrid className="w-4 h-4" /> },
                        { id: 'upload', label: 'Add Stock', icon: <Plus className="w-4 h-4" /> },
                        { id: 'view', label: 'View Stock', icon: <Eye className="w-4 h-4" /> },
                        { id: 'returns', label: 'Returns', icon: <Undo2 className="w-4 h-4" /> },
                        { id: 'master', label: 'Master Data', icon: <Database className="w-4 h-4" /> }
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setActiveSubTab(tab.id as any)} className={`px-4 py-2 rounded-lg text-[10px] font-black flex items-center gap-2 transition-all uppercase tracking-widest ${activeSubTab === tab.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>{tab.icon} {tab.label}</button>
                    ))}
                </div>
            </div>

            {activeSubTab === 'dashboard' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="bg-indigo-900 text-white p-6 rounded-xl border-b-4 border-indigo-500 shadow-xl">
                            <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-1">Building Units</p>
                            <h3 className="text-4xl font-black">{physicalStock.reduce((acc, i) => acc + i.quantity, 0)}</h3>
                        </div>
                        <div className="bg-slate-900 text-white p-6 rounded-xl border-b-4 border-purple-500 shadow-xl">
                            <p className="text-[10px] font-black text-purple-300 uppercase tracking-widest mb-1">Returns</p>
                            <h3 className="text-4xl font-black">{returnStock.length}</h3>
                        </div>
                        <div className="bg-emerald-600 text-white p-6 rounded-xl border-b-4 border-emerald-800 shadow-xl">
                            <p className="text-[10px] font-black text-emerald-100 uppercase tracking-widest mb-1">Smart Allocations</p>
                            <h3 className="text-4xl font-black">{stockAllocations.length}</h3>
                        </div>
                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-xl flex flex-col justify-center">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Global Library</p>
                            <h3 className="text-4xl font-black text-indigo-600">{referenceProducts.length}</h3>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                                <h3 className="font-black text-gray-900 uppercase tracking-widest text-sm">Suggested Cloud Allocations</h3>
                            </div>
                            <span className="text-[9px] font-black uppercase text-indigo-500 bg-indigo-50 px-2 py-1 rounded border border-indigo-100">Club-Aware Matching Active</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {stockAllocations.length === 0 ? (
                                <div className="p-16 text-center text-gray-400 italic uppercase font-black tracking-widest text-[10px]">No matches found. Add stock or process returns to see suggestions.</div>
                            ) : (
                                stockAllocations.map((alloc, idx) => {
                                    const isEan = alloc.source === 'ean';
                                    const item = alloc.stockItem as any;
                                    return (
                                        <div key={idx} className="p-6 space-y-4 hover:bg-gray-50/50 transition-colors group">
                                            <div className="flex flex-col md:flex-row justify-between gap-4">
                                                <div className="flex items-start gap-4">
                                                    <div className={`p-4 rounded-2xl shadow-sm ${isEan ? 'bg-indigo-950 text-indigo-400' : 'bg-purple-950 text-purple-400'}`}>
                                                        {isEan ? <Barcode className="w-7 h-7" /> : <Undo2 className="w-7 h-7" />}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="font-black text-gray-900 uppercase tracking-wider text-xl">{isEan ? item.description : item.itemName}</h4>
                                                            <span className="text-[10px] font-black bg-slate-900 text-white px-2 py-1 rounded uppercase tracking-widest">{isEan ? item.size : 'Return Item'}</span>
                                                        </div>
                                                        <div className="flex gap-3 mt-2">
                                                            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{isEan ? `EAN: ${item.ean}` : `Original Order: #${item.orderNumber}`}</p>
                                                            {isEan && item.isEmbellished && <span className="text-[10px] font-black text-purple-600 uppercase tracking-widest flex items-center gap-1"><Zap className="w-3 h-3 fill-purple-600" /> Club: {item.clubName}</span>}
                                                            {isEan && !item.isEmbellished && <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Plain Stock</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="pl-14 space-y-3 border-l-2 border-gray-100 ml-7">
                                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Eligible Unfulfilled Orders:</p>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {alloc.matchingOrders.map(mo => {
                                                        const isAllocated = allocatedPairs.has(`${item.id}-${mo.shopify.id}`);
                                                        return (
                                                            <div key={mo.shopify.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-indigo-300 transition-all">
                                                                <div>
                                                                    <div className="font-black text-sm text-gray-900 uppercase tracking-widest">Order #{mo.shopify.orderNumber}</div>
                                                                    <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">{mo.clubName} • {mo.shopify.customerName}</div>
                                                                </div>
                                                                <button onClick={() => handleAllocate(alloc.source, item.id, mo.shopify.id)} disabled={isAllocated} className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all flex items-center gap-2 uppercase tracking-widest shadow-lg ${isAllocated ? 'bg-green-100 text-green-700 border border-green-200 cursor-default shadow-none' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 active:scale-95'}`}>{isAllocated ? <CheckCircle2 className="w-3 h-3" /> : <Package className="w-3 h-3" />}{isAllocated ? 'Allocated' : 'Ship from building'}</button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeSubTab === 'upload' && (
                <div className="max-w-xl mx-auto bg-white p-10 rounded-2xl border-b-8 border-indigo-600 shadow-2xl animate-in zoom-in-95 duration-300">
                    <div className="flex justify-between items-start mb-8 border-b border-gray-100 pb-6">
                        <div>
                            <h3 className="font-black text-gray-900 flex items-center gap-3 uppercase tracking-[0.2em] text-xl">
                                <Plus className="w-7 h-7 text-indigo-600" /> New Inventory Row
                            </h3>
                            {autoFillSource && (
                                <div className={`mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest animate-pulse ${autoFillSource === 'master' ? 'text-indigo-600' : 'text-emerald-600'}`}>
                                    <Sparkles className="w-3 h-3" /> 
                                    {autoFillSource === 'master' ? 'Matched from Master Database' : 'Matched from history'}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <form onSubmit={handleAddPhysical} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2 space-y-2">
                            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">EAN / Barcode (Scan Here)</label>
                            <input required autoFocus value={eanInput} onChange={e => setEanInput(e.target.value)} type="text" placeholder="50604..." className="w-full bg-slate-900 border-none rounded-xl px-4 py-4 text-sm text-emerald-400 font-mono focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Vendor</label>
                            <input value={vendorInput} onChange={e => setVendorInput(e.target.value)} type="text" placeholder="e.g. Canterbury" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Product Code</label>
                            <input value={codeInput} onChange={e => setCodeInput(e.target.value)} type="text" placeholder="QA006093" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Description</label>
                            <input required value={descInput} onChange={e => setDescInput(e.target.value)} type="text" placeholder="e.g. Club Hoodie" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div className="flex items-center gap-3 md:col-span-2 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                            <input id="embellished" type="checkbox" checked={isEmbellished} onChange={e => setIsEmbellished(e.target.checked)} className="w-6 h-6 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer" />
                            <label htmlFor="embellished" className="text-xs font-black text-indigo-900 uppercase tracking-widest cursor-pointer">This product is already embellished (Logos on)</label>
                        </div>
                        {isEmbellished && (
                            <div className="md:col-span-2 space-y-2 relative" ref={tagSelectorRef}>
                                <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Associated Club Name</label>
                                <div className="relative group">
                                    <input required value={clubNameInput} onFocus={() => setShowTagSelector(true)} onChange={e => { setClubNameInput(e.target.value); setShowTagSelector(true); }} type="text" placeholder="Search or type club name..." className="w-full bg-white border-2 border-indigo-500 rounded-xl px-4 py-3 text-sm font-black text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none uppercase shadow-lg pr-10" />
                                    <ChevronDown className={`absolute right-3 top-3.5 w-5 h-5 text-indigo-400 transition-transform ${showTagSelector ? 'rotate-180' : ''}`} />
                                    {showTagSelector && (
                                        <div className="absolute z-50 w-full mt-1 bg-white border-2 border-indigo-100 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
                                            <div className="p-1">
                                                {filteredTags.map((tag, idx) => (
                                                    <button key={idx} type="button" onClick={() => { setClubNameInput(tag); setShowTagSelector(false); }} className="w-full text-left px-4 py-2 text-xs font-black uppercase text-indigo-900 hover:bg-indigo-50 rounded-lg">{tag}</button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-3 gap-4 md:col-span-2">
                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Colour</label>
                                <input value={colourInput} onChange={e => setColourInput(e.target.value)} type="text" placeholder="Navy" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Size</label>
                                <input value={sizeInput} onChange={e => setSizeInput(e.target.value)} type="text" placeholder="L" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest">Qty</label>
                                <input value={qtyInput} onChange={e => setQtyInput(parseInt(e.target.value) || 0)} type="number" min="1" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-black outline-none" />
                            </div>
                        </div>
                        <div className="md:col-span-2 pt-6">
                            <button type="submit" className="w-full bg-indigo-600 text-white font-black py-5 rounded-2xl hover:bg-indigo-700 transition-all shadow-xl uppercase tracking-[0.3em] text-xs flex items-center justify-center gap-3 active:scale-95">
                                <Save className="w-5 h-5" /> Push to Cloud Ledger
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {activeSubTab === 'master' && (
                <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white p-8 rounded-2xl border border-gray-200 shadow-xl">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 border-b border-gray-100 pb-6">
                            <div className="flex items-center gap-4">
                                <div className="bg-indigo-600 text-white p-3 rounded-xl shadow-lg"><Upload className="w-6 h-6" /></div>
                                <div>
                                    <h3 className="text-xl font-black uppercase tracking-[0.1em] text-gray-900">Incremental Data Portal</h3>
                                    <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Add data from Canterbury, Nike, etc. to build your Master Library.</p>
                                </div>
                            </div>
                            <div className="bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                                <Layers className="w-4 h-4" /> Current Library: {referenceProducts.length} Items
                            </div>
                        </div>

                        <div className="space-y-8">
                            <div className={`p-10 border-4 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all group relative ${csvFile ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50/50 border-gray-200 hover:bg-indigo-50 hover:border-indigo-300'}`}>
                                <input type="file" accept=".csv" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                                {csvFile ? <CheckSquare className="w-12 h-12 text-indigo-600 mb-4 animate-bounce" /> : <Table className="w-12 h-12 text-gray-300 group-hover:text-indigo-400 mb-4" />}
                                <p className="font-black text-gray-900 uppercase tracking-widest text-sm">{csvFile ? csvFile.name : 'Select Unique Supplier CSV File'}</p>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Upload files from Canterbury, Gilbert, Stash, etc.</p>
                            </div>

                            {csvHeaders.length > 0 && (
                                <div className="space-y-10 animate-in slide-in-from-top-4">
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-2">
                                            <RefreshCw className="w-4 h-4" /> Map Supplier Columns
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-50 p-6 rounded-2xl border border-gray-200 shadow-inner">
                                            {[
                                                { key: 'ean', label: 'Barcode / EAN *', icon: <Barcode /> },
                                                { key: 'vendor', label: 'Supplier (Optional)', icon: <User /> },
                                                { key: 'productCode', label: 'Item SKU / Code', icon: <FileJson /> },
                                                { key: 'description', label: 'Item Description', icon: <MessageSquare /> },
                                                { key: 'colour', label: 'Color / Shade', icon: <Zap /> },
                                                { key: 'size', label: 'Standard Size', icon: <Maximize /> }
                                            ].map(field => (
                                                <div key={field.key} className="space-y-2">
                                                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                                                        {React.cloneElement(field.icon as React.ReactElement<any>, { className: 'w-3 h-3' })}
                                                        {field.label}
                                                    </label>
                                                    <select value={mapping[field.key]} onChange={e => setMapping({...mapping, [field.key]: e.target.value})} className={`w-full border-2 rounded-xl px-3 py-2 text-xs font-bold uppercase focus:ring-2 focus:ring-indigo-500 outline-none transition-colors ${mapping[field.key] ? 'border-indigo-500 bg-white text-indigo-900 shadow-sm' : 'border-gray-300 bg-gray-50 text-gray-400'}`}>
                                                        <option value="">-- Ignore Column --</option>
                                                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Data Staging Preview */}
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                            <FileType className="w-4 h-4" /> Import Staging Area (Preview)
                                        </h4>
                                        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                                            <table className="w-full text-left">
                                                <thead className="bg-gray-50 border-b border-gray-100">
                                                    <tr>
                                                        <th className="px-4 py-2 text-[9px] font-black uppercase text-gray-400">Barcode</th>
                                                        <th className="px-4 py-2 text-[9px] font-black uppercase text-gray-400">Previewed Product Name</th>
                                                        <th className="px-4 py-2 text-[9px] font-black uppercase text-gray-400">Details</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {csvSampleRows.map((row, idx) => {
                                                        const eanIdx = csvHeaders.indexOf(mapping.ean);
                                                        const descIdx = csvHeaders.indexOf(mapping.description);
                                                        const colIdx = csvHeaders.indexOf(mapping.colour);
                                                        const sizeIdx = csvHeaders.indexOf(mapping.size);
                                                        return (
                                                            <tr key={idx}>
                                                                <td className="px-4 py-3 font-mono text-[10px] text-indigo-600 font-bold">{eanIdx !== -1 ? row[eanIdx] : '-'}</td>
                                                                <td className="px-4 py-3 font-black text-[10px] text-gray-900 uppercase">{descIdx !== -1 ? row[descIdx] : '-'}</td>
                                                                <td className="px-4 py-3 text-[9px] text-gray-400 uppercase font-bold">{colIdx !== -1 ? row[colIdx] : ''} {sizeIdx !== -1 ? `• ${row[sizeIdx]}` : ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-6 border-t border-gray-100">
                                        <div className="flex items-start gap-3 max-w-lg">
                                            <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
                                            <p className="text-[10px] text-gray-500 font-bold leading-relaxed uppercase">
                                                This will merge data into your global library. Existing EANs will be updated; new EANs will be added. You can repeat this process for every supplier file you possess.
                                            </p>
                                        </div>
                                        <div className="flex gap-4">
                                            <button onClick={() => { setCsvFile(null); setCsvHeaders([]); }} className="px-8 py-4 text-xs font-black uppercase text-gray-500 hover:text-red-600 transition-colors">Discard</button>
                                            <button onClick={processMasterCsv} disabled={isProcessingCsv || !mapping.ean} className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs shadow-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-3 active:scale-95 transition-all">
                                                {isProcessingCsv ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                                Commit Supplier Data
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeSubTab === 'view' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex-1 w-full md:w-auto relative">
                            <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                            <input type="text" value={stockSearch} onChange={e => setStockSearch(e.target.value)} placeholder="Filter ledger..." className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50/50 font-black uppercase text-xs tracking-widest" />
                        </div>
                        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200 shadow-inner">
                            {['all', 'plain', 'embellished'].map(f => (
                                <button key={f} onClick={() => setViewFilter(f as any)} className={`px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${viewFilter === f ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-400 hover:text-gray-600'}`}>{f}</button>
                            ))}
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Product Detail & State</th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Identifiers</th>
                                    <th className="px-6 py-5 text-center text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">In Building</th>
                                    <th className="px-6 py-5 text-right text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] w-32">Control</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {aggregatedStock.map((item) => {
                                    const isEditing = editingStockId === item.id;
                                    return (
                                        <tr key={item.id} className={`hover:bg-indigo-50/30 transition-colors ${item.quantity === 0 ? 'bg-red-50/20 opacity-50' : ''}`}>
                                            <td className="px-6 py-5">
                                                {isEditing ? (
                                                    <input value={editValues.description} onChange={e => setEditValues({...editValues, description: e.target.value})} className="w-full bg-slate-900 text-emerald-400 p-2 rounded-lg text-xs font-black uppercase" />
                                                ) : (
                                                    <>
                                                        <div className="text-sm font-black text-gray-900 uppercase tracking-wider">{item.description}</div>
                                                        <div className="flex gap-2 mt-2">
                                                            <span className="text-[9px] font-black bg-gray-100 px-2 py-0.5 rounded border border-gray-200 uppercase text-gray-600">{item.colour} • {item.size}</span>
                                                            {item.isEmbellished ? (
                                                                <span className="text-[9px] font-black bg-purple-100 text-purple-700 px-2 py-0.5 rounded border border-purple-200 uppercase tracking-widest flex items-center gap-1"><ShieldCheck className="w-2.5 h-2.5" /> {item.clubName}</span>
                                                            ) : (
                                                                <span className="text-[9px] font-black bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200 uppercase tracking-widest">Plain Base</span>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="text-[10px] font-black text-indigo-600 font-mono tracking-tighter uppercase">{item.ean}</div>
                                                    <div className="text-[9px] font-black text-gray-400 mt-1 uppercase tracking-widest">{item.vendor} {item.productCode && `• ${item.productCode}`}</div>
                                                </td>
                                                <td className="px-6 py-5 text-center">
                                                    {isEditing ? (
                                                        <input type="number" value={editValues.quantity} onChange={e => setEditValues({...editValues, quantity: parseInt(e.target.value) || 0})} className="w-20 bg-slate-900 text-indigo-400 p-2 rounded-lg text-center font-black" />
                                                    ) : (
                                                        <div className="inline-flex flex-col items-center">
                                                            <span className={`text-2xl font-black ${item.quantity === 0 ? 'text-red-500' : 'text-indigo-600'}`}>{item.quantity}</span>
                                                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-[0.2em]">Units</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {isEditing ? (
                                                            <>
                                                                <button onClick={handleSaveEdit} className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-md"><Save className="w-4 h-4" /></button>
                                                                <button onClick={() => setEditingStockId(null)} className="p-2 bg-gray-200 text-gray-500 rounded-lg hover:bg-gray-300"><X className="w-4 h-4" /></button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => handleStartEdit(item)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"><Edit className="w-4 h-4" /></button>
                                                                <button onClick={() => { if(window.confirm("Remove this SKU row?")) setPhysicalStock(prev => prev.filter(i => i.id !== item.id)); }} className="p-2 text-gray-400 hover:text-red-600 hover:bg-white rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
    
                {activeSubTab === 'returns' && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                        <div className="bg-slate-900 text-white p-10 rounded-2xl border-b-8 border-purple-500 shadow-2xl flex flex-col md:flex-row gap-8 items-center">
                            <div className="flex-1">
                                <h3 className="text-2xl font-black uppercase tracking-[0.2em]">Returns Center</h3>
                                <p className="text-xs text-purple-300 mt-2 font-bold uppercase tracking-widest opacity-80 leading-relaxed">Search historical orders to raise salvage requests.</p>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto shrink-0">
                                <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearchOrder()} type="text" placeholder="Order #" className="w-full md:w-48 bg-slate-800 border-none rounded-xl px-4 py-4 text-sm font-black text-white outline-none focus:ring-2 focus:ring-purple-500" />
                                <button onClick={handleSearchOrder} className="bg-purple-600 text-white font-black px-8 py-4 rounded-xl hover:bg-purple-700 transition-all uppercase tracking-widest text-xs shadow-lg">Scan Shopify</button>
                            </div>
                        </div>
                        {foundOrder && (
                            <div className="bg-white rounded-2xl border-2 border-purple-500 shadow-2xl overflow-hidden">
                                <div className="px-8 py-6 bg-purple-50 flex justify-between items-center border-b border-purple-100">
                                    <div className="flex items-center gap-4">
                                        <div className="bg-purple-600 text-white p-3 rounded-xl shadow-lg"><ShoppingBag className="w-6 h-6" /></div>
                                        <div>
                                            <h4 className="text-xl font-black text-purple-900">ORDER #{foundOrder.orderNumber}</h4>
                                            <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest">{foundOrder.customerName} • {new Date(foundOrder.date).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    {foundOrder.items.map((item, idx) => (
                                        <div key={idx} className="p-6 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 border border-gray-200"><Box className="w-6 h-6" /></div>
                                                <div>
                                                    <div className="font-black text-gray-900 uppercase tracking-wider">{item.name}</div>
                                                    <div className="flex items-center gap-3 mt-1">
                                                        <span className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em]">SKU: {item.sku}</span>
                                                        <span className="text-[9px] text-indigo-500 font-black uppercase tracking-[0.2em] bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">EAN: {item.ean || '-'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button onClick={() => { handleReturnItem(item); setFoundOrder(null); }} className="px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-black transition-all flex items-center gap-2 uppercase tracking-widest shadow-xl">
                                                <Undo2 className="w-4 h-4" /> Raise Request
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
                            <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <div className="flex items-center gap-2">
                                    <Boxes className="w-5 h-5 text-purple-600" />
                                    <h3 className="font-black text-gray-900 uppercase tracking-[0.2em] text-xs">Salvage Queue</h3>
                                </div>
                                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black border border-purple-200 uppercase tracking-widest">{returnStock.length} Requests</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-white">
                                        <tr>
                                            <th className="px-8 py-5 text-left text-[9px] font-black text-gray-400 uppercase tracking-[0.3em]">Orig. Order</th>
                                            <th className="px-8 py-5 text-left text-[9px] font-black text-gray-400 uppercase tracking-[0.3em]">Item Details</th>
                                            <th className="px-8 py-5 text-left text-[9px] font-black text-gray-400 uppercase tracking-[0.3em]">Registered</th>
                                            <th className="px-8 py-5 w-32"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {returnStock.length === 0 ? (
                                            <tr><td colSpan={4} className="px-8 py-20 text-center text-gray-400 italic uppercase font-black tracking-widest text-[10px]">No salvage requests active.</td></tr>
                                        ) : (
                                            returnStock.map((item) => (
                                                <tr key={item.id} className="hover:bg-purple-50/30 transition-colors">
                                                    <td className="px-8 py-6 font-black text-slate-900 uppercase tracking-widest">#{item.orderNumber}</td>
                                                    <td className="px-8 py-6">
                                                        <div className="font-black text-gray-900 uppercase tracking-wide">{item.itemName}</div>
                                                        <div className="flex flex-wrap gap-2 mt-1">
                                                            <span className="text-[9px] text-purple-600 font-black uppercase tracking-[0.2em]">{item.sku}</span>
                                                            {item.ean && <span className="text-[9px] text-indigo-500 font-black uppercase tracking-widest bg-indigo-50 px-1 rounded">• EAN: {item.ean}</span>}
                                                            {item.size && <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">• SIZE: {item.size}</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{new Date(item.addedAt).toLocaleDateString()}</td>
                                                    <td className="px-8 py-6">
                                                        <div className="flex items-center justify-end gap-3">
                                                            <button onClick={() => { if(window.confirm("Remove this request?")) setReturnStock(prev => prev.filter(i => i.id !== item.id)); }} className="p-2.5 text-gray-400 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
};

export default StockManager;
