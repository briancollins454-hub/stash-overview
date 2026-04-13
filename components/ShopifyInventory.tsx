import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Package, Search, MapPin, AlertTriangle, TrendingDown, TrendingUp,
  RefreshCw, Loader2, ChevronDown, ChevronRight, Edit, Save, X,
  Filter, Warehouse, ExternalLink, Eye, BarChart3, ShoppingCart,
  ArrowUpDown, CheckCircle2, XCircle, AlertCircle, Clock, Boxes
} from 'lucide-react';

interface Location {
  id: string;
  name: string;
  address?: { address1?: string; city?: string; country?: string };
  isActive: boolean;
}

interface InventoryItem {
  inventoryItemId: string;
  inventoryLevelId: string;
  sku: string;
  barcode: string;
  variantId: string;
  variantTitle: string;
  displayName: string;
  price: string;
  productId: string;
  productTitle: string;
  vendor: string;
  productType: string;
  imageUrl?: string;
  available: number;
  onHand: number;
  committed: number;
  incoming: number;
  // Forecast fields (added client-side)
  dailyVelocity?: number;
  daysOfStock?: number;
  totalSold90d?: number;
  lastSold?: string;
}

interface SearchProduct {
  productId: string;
  title: string;
  vendor: string;
  productType: string;
  imageUrl?: string;
  variants: {
    variantId: string;
    title: string;
    price: string;
    displayName: string;
    barcode: string;
    sku: string;
    inventoryItemId: string;
    inventoryLevelId: string;
    available: number;
    onHand: number;
    committed: number;
  }[];
}

type StockFilter = 'all' | 'out_of_stock' | 'low_stock' | 'in_stock' | 'overstocked';
type SortField = 'name' | 'available' | 'velocity' | 'daysLeft' | 'vendor';
type SortDir = 'asc' | 'desc';

const LOW_STOCK_THRESHOLD = 5;
const OVERSTOCK_THRESHOLD = 100;

const fetchApi = async (body: any) => {
  const resp = await fetch('/api/shopify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inventory', inventoryAction: body.action, ...body }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
};

const LOCATIONS = [
  { id: 'gid://shopify/Location/111232942466', name: 'Local Stock', address: {}, isActive: true },
  { id: 'gid://shopify/Location/22963719', name: '20 Church Street', address: {}, isActive: true },
];

const ShopifyInventory: React.FC = () => {
  // State
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [activeLocationId, setActiveLocationId] = useState<string>('');
  const [localWarehouseId, setLocalWarehouseId] = useState<string>('');
  const [externalWarehouseId, setExternalWarehouseId] = useState<string>('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [velocityData, setVelocityData] = useState<Record<string, { totalSold: number; orderCount: number; lastSold: string }>>({});
  const [loadingVelocity, setLoadingVelocity] = useState(false);

  // External location search state
  const [extSearch, setExtSearch] = useState('');
  const [extResults, setExtResults] = useState<SearchProduct[]>([]);
  const [extLoading, setExtLoading] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<number>(0);
  const [editPrice, setEditPrice] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Config modal
  const [showConfig, setShowConfig] = useState(false);

  // Load locations on mount
  useEffect(() => {
    (async () => {
      setLocationsLoading(true);
      try {
        const data = await fetchApi({ action: 'locations' });
        if (data.errors) {
          setError('Shopify API error: ' + (data.errors[0]?.message || JSON.stringify(data.errors)));
          return;
        }
        setLocations(data.locations || []);
        if (!data.locations?.length) {
          setError('No Shopify locations found. Check that the Shopify app has the read_inventory / read_locations permission scope.');
          return;
        }
        // Try to auto-detect local/external from saved config
        const saved = localStorage.getItem('stash_inventory_config');
        if (saved) {
          try {
            const cfg = JSON.parse(saved);
            if (cfg.localId) setLocalWarehouseId(cfg.localId);
            if (cfg.externalId) setExternalWarehouseId(cfg.externalId);
            if (cfg.localId) setActiveLocationId(cfg.localId);
          } catch {}
        } else if (data.locations?.length >= 2) {
          // First time — prompt to configure
          setShowConfig(true);
        } else if (data.locations?.length === 1) {
          setLocalWarehouseId(data.locations[0].id);
          setActiveLocationId(data.locations[0].id);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLocationsLoading(false);
      }
    })();
  }, []);

  // Load inventory when location changes
  const loadInventory = useCallback(async (locId: string, append = false) => {
    if (!locId) return;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const data = await fetchApi({ action: 'inventory', locationId: locId, cursor: append ? cursor : null });
      const newItems = data.items || [];
      if (append) {
        setItems(prev => [...prev, ...newItems]);
      } else {
        setItems(newItems);
      }
      setHasMore(data.pageInfo?.hasNextPage || false);
      setCursor(data.pageInfo?.endCursor || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  // Auto-load all pages for local warehouse
  const loadAllInventory = useCallback(async (locId: string) => {
    if (!locId) return;
    setLoading(true);
    setError(null);
    let allItems: InventoryItem[] = [];
    let pageCursor: string | null = null;
    try {
      for (let page = 0; page < 50; page++) { // safety limit
        const data = await fetchApi({ action: 'inventory', locationId: locId, cursor: pageCursor });
        allItems = [...allItems, ...(data.items || [])];
        if (!data.pageInfo?.hasNextPage) break;
        pageCursor = data.pageInfo.endCursor;
      }
      setItems(allItems);
      setHasMore(false);
      setCursor(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeLocationId === localWarehouseId && localWarehouseId) {
      loadAllInventory(localWarehouseId);
    } else if (activeLocationId) {
      setItems([]);
      setCursor(null);
      setHasMore(false);
    }
  }, [activeLocationId, localWarehouseId, loadAllInventory]);

  // Sales velocity (forecast data)
  const loadVelocity = useCallback(async () => {
    if (!localWarehouseId) return;
    setLoadingVelocity(true);
    try {
      const data = await fetchApi({ action: 'salesVelocity', locationId: localWarehouseId });
      setVelocityData(data.velocity || {});
    } catch (e) {
      console.warn('Velocity fetch failed:', e);
    } finally {
      setLoadingVelocity(false);
    }
  }, [localWarehouseId]);

  useEffect(() => {
    if (localWarehouseId && activeLocationId === localWarehouseId) {
      loadVelocity();
    }
  }, [localWarehouseId, activeLocationId, loadVelocity]);

  // Enrich items with velocity data
  const enrichedItems = useMemo(() => {
    return items.map(item => {
      const vel = velocityData[item.variantId];
      if (!vel) return item;
      const dailyVelocity = vel.totalSold / 90;
      const daysOfStock = dailyVelocity > 0 ? Math.round(item.available / dailyVelocity) : 999;
      return { ...item, dailyVelocity, daysOfStock, totalSold90d: vel.totalSold, lastSold: vel.lastSold };
    });
  }, [items, velocityData]);

  // Filter + sort + search
  const filteredItems = useMemo(() => {
    let result = enrichedItems;

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.productTitle?.toLowerCase().includes(q) ||
        i.sku?.toLowerCase().includes(q) ||
        i.barcode?.toLowerCase().includes(q) ||
        i.vendor?.toLowerCase().includes(q) ||
        i.displayName?.toLowerCase().includes(q)
      );
    }

    // Stock filter
    switch (filter) {
      case 'out_of_stock': result = result.filter(i => i.available <= 0); break;
      case 'low_stock': result = result.filter(i => i.available > 0 && i.available <= LOW_STOCK_THRESHOLD); break;
      case 'in_stock': result = result.filter(i => i.available > LOW_STOCK_THRESHOLD && i.available <= OVERSTOCK_THRESHOLD); break;
      case 'overstocked': result = result.filter(i => i.available > OVERSTOCK_THRESHOLD); break;
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = (a.productTitle || '').localeCompare(b.productTitle || ''); break;
        case 'available': cmp = a.available - b.available; break;
        case 'velocity': cmp = (a.dailyVelocity || 0) - (b.dailyVelocity || 0); break;
        case 'daysLeft': cmp = (a.daysOfStock || 999) - (b.daysOfStock || 999); break;
        case 'vendor': cmp = (a.vendor || '').localeCompare(b.vendor || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [enrichedItems, search, filter, sortField, sortDir]);

  // Summary stats
  const stats = useMemo(() => {
    const total = enrichedItems.length;
    const outOfStock = enrichedItems.filter(i => i.available <= 0).length;
    const lowStock = enrichedItems.filter(i => i.available > 0 && i.available <= LOW_STOCK_THRESHOLD).length;
    const healthy = enrichedItems.filter(i => i.available > LOW_STOCK_THRESHOLD).length;
    const criticalForecast = enrichedItems.filter(i => i.daysOfStock !== undefined && i.daysOfStock <= 14 && i.available > 0).length;
    const totalUnits = enrichedItems.reduce((s, i) => s + Math.max(0, i.available), 0);
    const totalValue = enrichedItems.reduce((s, i) => s + Math.max(0, i.available) * parseFloat(i.price || '0'), 0);
    return { total, outOfStock, lowStock, healthy, criticalForecast, totalUnits, totalValue };
  }, [enrichedItems]);

  // External location search
  const handleExtSearch = async () => {
    if (!extSearch.trim() || !externalWarehouseId) return;
    setExtLoading(true);
    setExtResults([]);
    try {
      const data = await fetchApi({ action: 'search', locationId: externalWarehouseId, search: extSearch.trim() });
      setExtResults(data.products || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExtLoading(false);
    }
  };

  // Inline edit handlers
  const startEdit = (item: InventoryItem | { inventoryItemId: string; available: number; price: string }) => {
    setEditingId(item.inventoryItemId);
    setEditQty(item.available);
    setEditPrice(item.price || '');
  };

  const saveEdit = async (item: { inventoryItemId: string; variantId: string; available: number; price: string }, locId: string) => {
    setSaving(true);
    try {
      const qtyDelta = editQty - item.available;
      if (qtyDelta !== 0) {
        await fetchApi({ action: 'adjust', inventoryItemId: item.inventoryItemId, locationId: locId, quantity: qtyDelta });
      }
      if (editPrice && editPrice !== item.price) {
        await fetchApi({ action: 'updatePrice', variantId: item.variantId, price: editPrice });
      }
      // Update local state
      if (locId === localWarehouseId) {
        setItems(prev => prev.map(i => i.inventoryItemId === item.inventoryItemId
          ? { ...i, available: editQty, price: editPrice || i.price }
          : i
        ));
      } else {
        setExtResults(prev => prev.map(p => ({
          ...p,
          variants: p.variants.map(v => v.inventoryItemId === item.inventoryItemId
            ? { ...v, available: editQty, price: editPrice || v.price }
            : v
          ),
        })));
      }
      setEditingId(null);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => { setEditingId(null); };

  // Sort toggle
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const saveConfig = () => {
    localStorage.setItem('stash_inventory_config', JSON.stringify({ localId: localWarehouseId, externalId: externalWarehouseId }));
    setShowConfig(false);
    if (localWarehouseId) setActiveLocationId(localWarehouseId);
  };

  const getStockBadge = (available: number, daysOfStock?: number) => {
    if (available <= 0) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">OUT OF STOCK</span>;
    if (available <= LOW_STOCK_THRESHOLD) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">LOW STOCK</span>;
    if (daysOfStock !== undefined && daysOfStock <= 14) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">REORDER SOON</span>;
    if (available > OVERSTOCK_THRESHOLD) return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">OVERSTOCKED</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">IN STOCK</span>;
  };

  const isLocal = activeLocationId === localWarehouseId;
  const isExternal = activeLocationId === externalWarehouseId;
  const localName = locations.find(l => l.id === localWarehouseId)?.name || 'Local Warehouse';
  const externalName = locations.find(l => l.id === externalWarehouseId)?.name || 'External Stock';

  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 space-y-4">
      {/* Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Warehouse className="w-5 h-5" /> Configure Warehouse Locations</h2>
            <p className="text-sm text-slate-500">Select which Shopify location is your local warehouse and which is external/supplier stock.</p>
            {locationsLoading ? (
              <p className="text-sm text-slate-500 py-4 text-center">Loading locations from Shopify...</p>
            ) : locations.length === 0 ? (
              <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                Couldn't auto-detect locations. Enter your Shopify location IDs below.
                <p className="mt-1 text-xs">Find them in Shopify Admin → Settings → Locations (the number in the URL).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Local Warehouse ID</label>
                <input type="text" placeholder="e.g. 111232942466" value={localWarehouseId.replace('gid://shopify/Location/', '')}
                  onChange={e => {
                    const v = e.target.value.trim();
                    setLocalWarehouseId(v ? `gid://shopify/Location/${v}` : '');
                  }}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">External Stock ID (20 Church Street)</label>
                <input type="text" placeholder="e.g. 22963719" value={externalWarehouseId.replace('gid://shopify/Location/', '')}
                  onChange={e => {
                    const v = e.target.value.trim();
                    setExternalWarehouseId(v ? `gid://shopify/Location/${v}` : '');
                  }}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              </>
            ) : (<>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Local Warehouse (your building)</label>
              <select value={localWarehouseId} onChange={e => setLocalWarehouseId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select location...</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.address?.address1 ? ` — ${l.address.address1}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">External Stock (supplier / 20 Church Street)</label>
              <select value={externalWarehouseId} onChange={e => setExternalWarehouseId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select location...</option>
                {locations.filter(l => l.id !== localWarehouseId).map(l => <option key={l.id} value={l.id}>{l.name}{l.address?.address1 ? ` — ${l.address.address1}` : ''}</option>)}
              </select>
            </div>
            </>)
            }
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowConfig(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={saveConfig} disabled={!localWarehouseId} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Package className="w-7 h-7 text-indigo-600" /> Shopify Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">{locations.length} location{locations.length !== 1 ? 's' : ''} configured</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowConfig(true)} className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-1.5">
            <Warehouse className="w-4 h-4" /> Configure
          </button>
          {isLocal && (
            <button onClick={() => loadAllInventory(localWarehouseId)} disabled={loading} className="px-3 py-2 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          )}
        </div>
      </div>

      {/* Location Tabs */}
      {(localWarehouseId || externalWarehouseId) && (
        <div className="flex gap-2 border-b border-slate-200 pb-0">
          {localWarehouseId && (
            <button
              onClick={() => setActiveLocationId(localWarehouseId)}
              className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${isLocal ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
              <MapPin className="w-4 h-4 inline mr-1.5" />{localName}
            </button>
          )}
          {externalWarehouseId && (
            <button
              onClick={() => setActiveLocationId(externalWarehouseId)}
              className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${isExternal ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
              <ExternalLink className="w-4 h-4 inline mr-1.5" />{externalName}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* === LOCAL WAREHOUSE VIEW === */}
      {isLocal && (
        <>
          {/* Summary Cards */}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="bg-white rounded-xl border p-3 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Total SKUs</div>
                <div className="text-xl font-bold text-slate-800">{stats.total.toLocaleString()}</div>
              </div>
              <div className="bg-white rounded-xl border p-3 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Total Units</div>
                <div className="text-xl font-bold text-slate-800">{stats.totalUnits.toLocaleString()}</div>
              </div>
              <div className="bg-white rounded-xl border p-3 shadow-sm">
                <div className="text-xs text-slate-500 font-medium">Stock Value</div>
                <div className="text-xl font-bold text-slate-800">£{stats.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
              </div>
              <button onClick={() => setFilter(f => f === 'out_of_stock' ? 'all' : 'out_of_stock')} className={`bg-white rounded-xl border p-3 shadow-sm text-left hover:border-red-300 transition-colors ${filter === 'out_of_stock' ? 'ring-2 ring-red-500' : ''}`}>
                <div className="text-xs text-slate-500 font-medium">Out of Stock</div>
                <div className="text-xl font-bold text-red-600">{stats.outOfStock}</div>
              </button>
              <button onClick={() => setFilter(f => f === 'low_stock' ? 'all' : 'low_stock')} className={`bg-white rounded-xl border p-3 shadow-sm text-left hover:border-amber-300 transition-colors ${filter === 'low_stock' ? 'ring-2 ring-amber-500' : ''}`}>
                <div className="text-xs text-slate-500 font-medium">Low Stock (≤{LOW_STOCK_THRESHOLD})</div>
                <div className="text-xl font-bold text-amber-600">{stats.lowStock}</div>
              </button>
              <button onClick={() => setFilter(f => f === 'in_stock' ? 'all' : 'in_stock')} className={`bg-white rounded-xl border p-3 shadow-sm text-left hover:border-green-300 transition-colors ${filter === 'in_stock' ? 'ring-2 ring-green-500' : ''}`}>
                <div className="text-xs text-slate-500 font-medium">Healthy</div>
                <div className="text-xl font-bold text-green-600">{stats.healthy}</div>
              </button>
              <button onClick={() => { setFilter('all'); toggleSort('daysLeft'); setSortDir('asc'); }} className={`bg-white rounded-xl border p-3 shadow-sm text-left hover:border-orange-300 transition-colors ${sortField === 'daysLeft' && sortDir === 'asc' ? 'ring-2 ring-orange-500' : ''}`}>
                <div className="text-xs text-slate-500 font-medium flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Reorder Soon</div>
                <div className="text-xl font-bold text-orange-600">{stats.criticalForecast}</div>
              </button>
            </div>
          )}

          {/* Search + Filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 bg-white rounded-xl border shadow-sm flex items-center px-3">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by product name, SKU, barcode, vendor..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 px-3 py-2.5 outline-none text-sm text-slate-700"
              />
              {search && <button onClick={() => setSearch('')}><X className="w-4 h-4 text-slate-400" /></button>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'out_of_stock', 'low_stock', 'in_stock', 'overstocked'] as StockFilter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${filter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                  {f === 'all' ? 'All' : f === 'out_of_stock' ? 'Out of Stock' : f === 'low_stock' ? 'Low Stock' : f === 'in_stock' ? 'In Stock' : 'Overstocked'}
                </button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-20">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
                <p className="text-sm text-slate-500 mt-2">Loading inventory...</p>
              </div>
            </div>
          )}

          {/* Inventory Table */}
          {!loading && filteredItems.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-left">
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-10"></th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-700" onClick={() => toggleSort('name')}>
                        Product {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">SKU</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-700" onClick={() => toggleSort('vendor')}>
                        Vendor {sortField === 'vendor' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center cursor-pointer hover:text-slate-700" onClick={() => toggleSort('available')}>
                        Available {sortField === 'available' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center">Committed</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center">On Hand</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center cursor-pointer hover:text-slate-700" onClick={() => toggleSort('velocity')}>
                        90d Sold {sortField === 'velocity' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center cursor-pointer hover:text-slate-700" onClick={() => toggleSort('daysLeft')}>
                        Days Left {sortField === 'daysLeft' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center">Status</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-center">Price</th>
                      <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map(item => (
                      <tr key={item.inventoryItemId} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 py-2">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center"><Boxes className="w-4 h-4 text-slate-400" /></div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800 truncate max-w-[250px]">{item.productTitle}</div>
                          {item.variantTitle && item.variantTitle !== 'Default Title' && (
                            <div className="text-xs text-slate-500">{item.variantTitle}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600 font-mono text-xs">{item.sku || '—'}</td>
                        <td className="px-3 py-2 text-slate-600 text-xs">{item.vendor || '—'}</td>
                        <td className="px-3 py-2 text-center">
                          {editingId === item.inventoryItemId ? (
                            <input type="number" value={editQty} onChange={e => setEditQty(parseInt(e.target.value) || 0)} className="w-16 border rounded px-2 py-1 text-center text-sm" />
                          ) : (
                            <span className={`font-bold ${item.available <= 0 ? 'text-red-600' : item.available <= LOW_STOCK_THRESHOLD ? 'text-amber-600' : 'text-slate-800'}`}>{item.available}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-500">{item.committed}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{item.onHand}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{item.totalSold90d ?? '—'}</td>
                        <td className="px-3 py-2 text-center">
                          {item.daysOfStock !== undefined && item.daysOfStock < 999 ? (
                            <span className={`font-medium ${item.daysOfStock <= 7 ? 'text-red-600' : item.daysOfStock <= 14 ? 'text-orange-600' : item.daysOfStock <= 30 ? 'text-amber-600' : 'text-slate-600'}`}>{item.daysOfStock}d</span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">{getStockBadge(item.available, item.daysOfStock)}</td>
                        <td className="px-3 py-2 text-center">
                          {editingId === item.inventoryItemId ? (
                            <input type="text" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="w-16 border rounded px-2 py-1 text-center text-sm" />
                          ) : (
                            <span className="text-slate-600">£{parseFloat(item.price || '0').toFixed(2)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {editingId === item.inventoryItemId ? (
                            <div className="flex gap-1">
                              <button onClick={() => saveEdit(item, localWarehouseId)} disabled={saving} className="text-green-600 hover:text-green-700"><Save className="w-4 h-4" /></button>
                              <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-indigo-600"><Edit className="w-3.5 h-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-slate-50 text-xs text-slate-500 border-t flex justify-between items-center">
                <span>Showing {filteredItems.length} of {enrichedItems.length} items</span>
                {loadingVelocity && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading forecast data...</span>}
              </div>
            </div>
          )}

          {!loading && filteredItems.length === 0 && items.length > 0 && (
            <div className="text-center py-16 text-slate-500">
              <Filter className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No items match your filters</p>
              <button onClick={() => { setFilter('all'); setSearch(''); }} className="text-indigo-600 text-sm mt-1 hover:underline">Clear filters</button>
            </div>
          )}

          {!loading && items.length === 0 && !error && localWarehouseId && (
            <div className="text-center py-16 text-slate-500">
              <Package className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No inventory loaded</p>
              <button onClick={() => loadAllInventory(localWarehouseId)} className="text-indigo-600 text-sm mt-1 hover:underline">Load inventory</button>
            </div>
          )}

          {/* Forecast Alert Section */}
          {!loading && stats.criticalForecast > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <h3 className="font-semibold text-orange-800 flex items-center gap-2 text-sm mb-2">
                <AlertTriangle className="w-4 h-4" /> Stock Shortage Forecast — {stats.criticalForecast} items need reordering
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-orange-600">
                      <th className="px-2 py-1">Product</th>
                      <th className="px-2 py-1 text-center">Available</th>
                      <th className="px-2 py-1 text-center">Daily Sales</th>
                      <th className="px-2 py-1 text-center">Days Left</th>
                      <th className="px-2 py-1 text-center">90d Sold</th>
                      <th className="px-2 py-1">Suggested Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedItems
                      .filter(i => i.daysOfStock !== undefined && i.daysOfStock <= 14 && i.available > 0)
                      .sort((a, b) => (a.daysOfStock || 0) - (b.daysOfStock || 0))
                      .slice(0, 20)
                      .map(item => (
                        <tr key={item.inventoryItemId} className="border-t border-orange-200">
                          <td className="px-2 py-1.5 text-slate-800 font-medium">{item.productTitle}<span className="text-slate-400 ml-1">{item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}</span></td>
                          <td className="px-2 py-1.5 text-center font-bold text-orange-700">{item.available}</td>
                          <td className="px-2 py-1.5 text-center text-slate-600">{item.dailyVelocity?.toFixed(1)}/day</td>
                          <td className="px-2 py-1.5 text-center font-bold text-red-600">{item.daysOfStock}d</td>
                          <td className="px-2 py-1.5 text-center text-slate-600">{item.totalSold90d}</td>
                          <td className="px-2 py-1.5 text-slate-700">
                            Order ~{Math.ceil((item.dailyVelocity || 0) * 30)} units (30-day cover)
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* === EXTERNAL WAREHOUSE VIEW === */}
      {isExternal && (
        <>
          <div className="bg-white rounded-xl border shadow-sm p-4 space-y-4">
            <div>
              <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-1"><ExternalLink className="w-5 h-5 text-indigo-600" /> {externalName}</h2>
              <p className="text-xs text-slate-500">Search for products to view stock levels at this location. Results are not stored.</p>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 bg-slate-50 rounded-lg flex items-center px-3 border">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by product name, SKU, vendor..."
                  value={extSearch}
                  onChange={e => setExtSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleExtSearch()}
                  className="flex-1 px-3 py-2.5 outline-none text-sm text-slate-700 bg-transparent"
                />
              </div>
              <button onClick={handleExtSearch} disabled={extLoading || !extSearch.trim()} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                {extLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
              </button>
            </div>
          </div>

          {/* External Search Results */}
          {extResults.length > 0 && (
            <div className="space-y-3">
              {extResults.map(product => (
                <div key={product.productId} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b flex items-center gap-3">
                    {product.imageUrl && <img src={product.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                    <div>
                      <div className="font-semibold text-slate-800">{product.title}</div>
                      <div className="text-xs text-slate-500">{product.vendor}{product.productType ? ` · ${product.productType}` : ''}</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b bg-slate-50/50">
                        <th className="px-4 py-2">Variant</th>
                        <th className="px-4 py-2">SKU</th>
                        <th className="px-4 py-2 text-center">Available</th>
                        <th className="px-4 py-2 text-center">On Hand</th>
                        <th className="px-4 py-2 text-center">Committed</th>
                        <th className="px-4 py-2 text-center">Status</th>
                        <th className="px-4 py-2 text-center">Price</th>
                        <th className="px-4 py-2 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.variants.map(v => (
                        <tr key={v.variantId} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="px-4 py-2 text-slate-700">{v.title || 'Default'}</td>
                          <td className="px-4 py-2 text-slate-500 font-mono text-xs">{v.sku || '—'}</td>
                          <td className="px-4 py-2 text-center">
                            {editingId === v.inventoryItemId ? (
                              <input type="number" value={editQty} onChange={e => setEditQty(parseInt(e.target.value) || 0)} className="w-16 border rounded px-2 py-1 text-center text-sm" />
                            ) : (
                              <span className={`font-bold ${v.available <= 0 ? 'text-red-600' : v.available <= LOW_STOCK_THRESHOLD ? 'text-amber-600' : 'text-slate-800'}`}>{v.available}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center text-slate-500">{v.onHand}</td>
                          <td className="px-4 py-2 text-center text-slate-500">{v.committed}</td>
                          <td className="px-4 py-2 text-center">{getStockBadge(v.available)}</td>
                          <td className="px-4 py-2 text-center">
                            {editingId === v.inventoryItemId ? (
                              <input type="text" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="w-16 border rounded px-2 py-1 text-center text-sm" />
                            ) : (
                              <span className="text-slate-600">£{parseFloat(v.price || '0').toFixed(2)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {editingId === v.inventoryItemId ? (
                              <div className="flex gap-1">
                                <button onClick={() => saveEdit({ inventoryItemId: v.inventoryItemId, variantId: v.variantId, available: v.available, price: v.price }, externalWarehouseId)} disabled={saving} className="text-green-600 hover:text-green-700"><Save className="w-4 h-4" /></button>
                                <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                              </div>
                            ) : (
                              <button onClick={() => startEdit({ inventoryItemId: v.inventoryItemId, available: v.available, price: v.price })} className="text-slate-400 hover:text-indigo-600"><Edit className="w-3.5 h-3.5" /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {extLoading && (
            <div className="flex justify-center py-16">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
                <p className="text-sm text-slate-500 mt-2">Searching external stock...</p>
              </div>
            </div>
          )}

          {!extLoading && extResults.length === 0 && extSearch && (
            <div className="text-center py-16 text-slate-400">
              <Search className="w-10 h-10 mx-auto mb-3" />
              <p>Search for products to view external stock levels</p>
            </div>
          )}
        </>
      )}

      {/* No locations configured */}
      {!localWarehouseId && !externalWarehouseId && !showConfig && locations.length > 0 && (
        <div className="text-center py-20 text-slate-500">
          <Warehouse className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-lg">Configure your warehouse locations to get started</p>
          <button onClick={() => setShowConfig(true)} className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">Configure Locations</button>
        </div>
      )}
    </div>
  );
};

export default ShopifyInventory;
