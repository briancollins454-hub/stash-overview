import React, { useState, useMemo, useCallback } from 'react';
import { ApiSettings } from './SettingsModal';
import { BarChart3, Download, Loader2, RefreshCw, Filter, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Search } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Money {
  amount: string;
  currencyCode: string;
}

interface TaxLine {
  title: string;
  rate: number;
  priceSet: { shopMoney: Money };
}

interface LineItemNode {
  id: string;
  title: string;
  variantTitle: string | null;
  vendor: string | null;
  quantity: number;
  originalTotalSet: { shopMoney: Money };
  discountedTotalSet: { shopMoney: Money };
  totalDiscountSet: { shopMoney: Money };
  taxLines: TaxLine[];
  variant: {
    inventoryItem: {
      unitCost: Money | null;
    } | null;
  } | null;
}

interface ReturnLineItemNode {
  id: string;
  quantity: number;
  refundedQuantity: number;
  fulfillmentLineItem: {
    lineItem: { id: string };
  } | null;
}

interface ReturnNode {
  id: string;
  returnLineItems: {
    edges: Array<{ node: ReturnLineItemNode }>;
  };
}

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  lineItems: {
    edges: Array<{ node: LineItemNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  returns: {
    edges: Array<{ node: ReturnNode }>;
  };
}

interface AggregatedLineItem {
  vendor: string;
  itemName: string;
  variant: string;
  grossSales: number;
  netSales: number;
  cost: number | null;
  discounts: number;
  tax: number;
  returns: number;
  quantity: number;
  refundedQuantity: number;
}

interface Props {
  settings: ApiSettings;
  isDark: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const money = (m: Money | null | undefined): number => parseFloat(m?.amount || '0');

const escapeCell = (cell: any): string => {
  let str = String(cell ?? '');
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const fmt = (n: number): string => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── GraphQL Query ──────────────────────────────────────────────────────────────

const ORDERS_FINANCIAL_QUERY = `
query getOrdersFinancial($cursor: String, $query: String) {
  orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              variantTitle
              vendor
              quantity
              originalTotalSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
              totalDiscountSet { shopMoney { amount currencyCode } }
              taxLines {
                title
                rate
                priceSet { shopMoney { amount currencyCode } }
              }
              variant {
                inventoryItem {
                  unitCost { amount currencyCode }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        refunds(first: 20) {
          refundLineItems(first: 50) {
            edges {
              node {
                quantity
                lineItem { id }
                priceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

// ── Component ──────────────────────────────────────────────────────────────────

const SalesAnalytics: React.FC<Props> = ({ settings, isDark }) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [orders, setOrders] = useState<OrderNode[]>([]);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [includeVat, setIncludeVat] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'grossSales' | 'netSales' | 'quantity' | 'vendor' | 'itemName' | 'profit'>('grossSales');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [fetched, setFetched] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setProgress('Fetching orders...');
    setOrders([]);

    try {
      const allOrders: OrderNode[] = [];
      let hasNextPage = true;
      let cursor: string | null = null;
      let page = 0;

      // Shopify query syntax: space-separated terms (implicit AND), no explicit AND keyword
      let queryFilter = `created_at:>='${dateFrom}T00:00:00Z' created_at:<='${dateTo}T23:59:59Z'`;
      if (keyword.trim()) {
        // Search across order name, customer, tags, etc.
        queryFilter += ` ${keyword.trim()}`;
      }

      while (hasNextPage) {
        page++;
        setProgress(`Fetching page ${page}...`);

        const res = await fetch('/api/shopify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: ORDERS_FINANCIAL_QUERY,
            variables: { cursor, query: queryFilter }
          })
        });

        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const json = await res.json();
        if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join('; '));
        const data = json?.data?.orders;
        if (!data) throw new Error('No order data returned — check date range');

        const nodes = data.edges.map((e: any) => e.node as OrderNode);
        allOrders.push(...nodes);

        hasNextPage = data.pageInfo.hasNextPage;
        cursor = data.pageInfo.endCursor;
        setProgress(`Fetched ${allOrders.length} orders...`);
      }

      setOrders(allOrders);
      setFetched(true);
      setProgress(`Done — ${allOrders.length} orders loaded`);
    } catch (err: any) {
      setProgress(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, keyword]);

  // ── Aggregate line items ─────────────────────────────────────────────────────

  const aggregated = useMemo<AggregatedLineItem[]>(() => {
    if (orders.length === 0) return [];

    // Build refund map: lineItem GID → { refunded qty, refund amount }
    const returnMap = new Map<string, { qty: number; amount: number }>();
    for (const order of orders) {
      const refunds = (order as any).refunds || [];
      for (const refund of refunds) {
        const edges = refund?.refundLineItems?.edges || [];
        for (const edge of edges) {
          const rli = edge.node;
          const lineItemId = rli?.lineItem?.id;
          if (lineItemId) {
            const existing = returnMap.get(lineItemId) || { qty: 0, amount: 0 };
            existing.qty += rli.quantity || 0;
            existing.amount += money(rli.priceSet?.shopMoney);
            returnMap.set(lineItemId, existing);
          }
        }
      }
    }

    // Aggregate by vendor + item + variant
    const map = new Map<string, AggregatedLineItem>();

    for (const order of orders) {
      for (const edge of order.lineItems.edges) {
        const li = edge.node;
        const vendor = li.vendor || 'Unknown Vendor';
        const variant = li.variantTitle || 'Default';
        const key = `${vendor}|||${li.title}|||${variant}`;

        const gross = money(li.originalTotalSet?.shopMoney);
        const discounted = money(li.discountedTotalSet?.shopMoney);
        const discount = money(li.totalDiscountSet?.shopMoney);
        const tax = li.taxLines.reduce((s, t) => s + money(t.priceSet?.shopMoney), 0);
        const unitCost = li.variant?.inventoryItem?.unitCost ? money(li.variant.inventoryItem.unitCost) : null;
        const totalCost = unitCost !== null ? unitCost * li.quantity : null;
        const refundData = returnMap.get(li.id) || { qty: 0, amount: 0 };
        const refunded = refundData.qty;
        const returnAmount = refundData.amount > 0 ? refundData.amount : (refunded > 0 && li.quantity > 0 ? (gross / li.quantity) * refunded : 0);

        const existing = map.get(key);
        if (existing) {
          existing.grossSales += gross;
          existing.netSales += discounted - returnAmount;
          existing.discounts += discount;
          existing.tax += tax;
          existing.cost = existing.cost !== null && totalCost !== null ? existing.cost + totalCost : (existing.cost ?? totalCost);
          existing.quantity += li.quantity;
          existing.refundedQuantity += refunded;
          existing.returns += returnAmount;
        } else {
          map.set(key, {
            vendor,
            itemName: li.title,
            variant,
            grossSales: gross,
            netSales: discounted - returnAmount,
            discounts: discount,
            tax,
            cost: totalCost,
            quantity: li.quantity,
            refundedQuantity: refunded,
            returns: returnAmount,
          });
        }
      }
    }

    return Array.from(map.values());
  }, [orders]);

  // ── Vendors list ─────────────────────────────────────────────────────────────

  const vendors = useMemo(() => {
    const s = new Set(aggregated.map(a => a.vendor));
    return ['all', ...Array.from(s).sort()];
  }, [aggregated]);

  // ── Filter, search, sort ─────────────────────────────────────────────────────

  const displayed = useMemo(() => {
    let items = aggregated;
    if (vendorFilter !== 'all') items = items.filter(i => i.vendor === vendorFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      items = items.filter(i => i.itemName.toLowerCase().includes(q) || i.vendor.toLowerCase().includes(q) || i.variant.toLowerCase().includes(q));
    }
    return [...items].sort((a, b) => {
      let av: number, bv: number;
      if (sortBy === 'vendor') return sortDir === 'asc' ? a.vendor.localeCompare(b.vendor) : b.vendor.localeCompare(a.vendor);
      if (sortBy === 'itemName') return sortDir === 'asc' ? a.itemName.localeCompare(b.itemName) : b.itemName.localeCompare(a.itemName);
      if (sortBy === 'profit') {
        av = a.cost !== null ? (includeVat ? a.netSales : a.netSales - a.tax) - a.cost : -Infinity;
        bv = b.cost !== null ? (includeVat ? b.netSales : b.netSales - b.tax) - b.cost : -Infinity;
      } else {
        av = a[sortBy];
        bv = b[sortBy];
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [aggregated, vendorFilter, searchTerm, sortBy, sortDir, includeVat]);

  // ── Totals ───────────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const t = { grossSales: 0, netSales: 0, discounts: 0, tax: 0, cost: 0, returns: 0, quantity: 0, refunded: 0, hasCost: false };
    for (const r of displayed) {
      t.grossSales += r.grossSales;
      t.netSales += r.netSales;
      t.discounts += r.discounts;
      t.tax += r.tax;
      if (r.cost !== null) { t.cost += r.cost; t.hasCost = true; }
      t.returns += r.returns;
      t.quantity += r.quantity;
      t.refunded += r.refundedQuantity;
    }
    return t;
  }, [displayed]);

  // ── Adjust for VAT toggle ────────────────────────────────────────────────────

  const v = useCallback((amount: number, tax: number) => includeVat ? amount : amount - tax, [includeVat]);

  // ── CSV Export ───────────────────────────────────────────────────────────────

  const exportCSV = useCallback(() => {
    const vatLabel = includeVat ? 'Inc VAT' : 'Exc VAT';
    const headers = ['Vendor', 'Product', 'Variant', 'Quantity', 'Refunded Qty', `Gross Sales (${vatLabel})`, 'Discounts', `Net Sales (${vatLabel})`, 'Tax', 'Returns', 'Cost', `Profit (${vatLabel})`];

    const rows = displayed.map(r => {
      const gross = includeVat ? r.grossSales : r.grossSales - r.tax;
      const net = includeVat ? r.netSales : r.netSales - r.tax;
      const profit = r.cost !== null ? net - r.cost : '';
      return [r.vendor, r.itemName, r.variant, r.quantity, r.refundedQuantity, gross.toFixed(2), r.discounts.toFixed(2), net.toFixed(2), r.tax.toFixed(2), r.returns.toFixed(2), r.cost !== null ? r.cost.toFixed(2) : '', profit !== '' ? (profit as number).toFixed(2) : ''];
    });

    // Totals row
    const totalGross = includeVat ? totals.grossSales : totals.grossSales - totals.tax;
    const totalNet = includeVat ? totals.netSales : totals.netSales - totals.tax;
    const totalProfit = totals.hasCost ? totalNet - totals.cost : '';
    rows.push(['TOTAL', '', '', String(totals.quantity), String(totals.refunded), totalGross.toFixed(2), totals.discounts.toFixed(2), totalNet.toFixed(2), totals.tax.toFixed(2), totals.returns.toFixed(2), totals.hasCost ? totals.cost.toFixed(2) : '', totalProfit !== '' ? (totalProfit as number).toFixed(2) : '']);

    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales-analytics-${dateFrom}-to-${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [displayed, totals, includeVat, dateFrom, dateTo]);

  // ── Sort handler ─────────────────────────────────────────────────────────────

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return null;
    return sortDir === 'desc' ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronUp className="w-3 h-3 inline" />;
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`${isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'} rounded-xl border ${isDark ? 'border-gray-700' : 'border-gray-200'} shadow-sm`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-100'} flex items-center justify-between flex-wrap gap-2`}>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-500" />
          <h3 className="text-xs font-black uppercase tracking-widest">Sales Analytics</h3>
          {fetched && <span className="text-[9px] font-bold text-gray-500 uppercase">{orders.length} orders · {aggregated.length} line items</span>}
        </div>
      </div>

      {/* Controls */}
      <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-50'} flex items-center flex-wrap gap-3`}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={`text-xs font-bold border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 ${isDark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={`text-xs font-bold border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 ${isDark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`} />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[160px] max-w-xs">
          <Search className="w-3 h-3 text-gray-400 shrink-0" />
          <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !loading) fetchData(); }} placeholder="Club, school or keyword..." className={`text-xs font-bold border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 w-full ${isDark ? 'bg-gray-800 border-gray-600 text-gray-200 placeholder-gray-500' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'}`} />
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-indigo-700 transition-colors disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {loading ? 'Loading...' : 'Fetch Data'}
        </button>

        {fetched && (
          <>
            <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
            <button onClick={() => setIncludeVat(!includeVat)} className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border transition-colors ${includeVat ? (isDark ? 'border-emerald-700 bg-emerald-900/30 text-emerald-400' : 'border-emerald-300 bg-emerald-50 text-emerald-700') : (isDark ? 'border-gray-600 bg-gray-800 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500')}`}>
              {includeVat ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
              VAT {includeVat ? 'Inc' : 'Exc'}
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-emerald-700 transition-colors">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </>
        )}
      </div>

      {/* Filters (only when data loaded) */}
      {fetched && (
        <div className={`px-4 py-2 border-b ${isDark ? 'border-gray-700' : 'border-gray-50'} flex items-center flex-wrap gap-3`}>
          <div className="flex items-center gap-2">
            <Filter className="w-3 h-3 text-gray-400" />
            <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className={`text-[10px] font-bold border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 ${isDark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
              {vendors.map(v => <option key={v} value={v}>{v === 'all' ? 'All Vendors' : v}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3 h-3 text-gray-400" />
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search products..." className={`text-[10px] font-bold border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 w-full ${isDark ? 'bg-gray-800 border-gray-600 text-gray-200 placeholder-gray-500' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'}`} />
          </div>
        </div>
      )}

      {/* Progress message */}
      {progress && !fetched && (
        <div className="px-4 py-6 text-center">
          {loading && <Loader2 className="w-6 h-6 text-indigo-500 animate-spin mx-auto mb-2" />}
          <p className="text-xs font-bold text-gray-500">{progress}</p>
        </div>
      )}

      {/* Empty state */}
      {!fetched && !loading && (
        <div className="px-4 py-12 text-center">
          <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-gray-400">Select a date range and click Fetch Data</p>
          <p className="text-[10px] text-gray-400 mt-1">Pulls line-item level financial data from Shopify</p>
        </div>
      )}

      {/* Summary cards */}
      {fetched && (
        <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-50'} grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3`}>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Gross Sales</p>
            <p className="text-lg font-black">£{fmt(v(totals.grossSales, totals.tax))}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Discounts</p>
            <p className="text-lg font-black text-amber-500">-£{fmt(totals.discounts)}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Net Sales</p>
            <p className="text-lg font-black text-emerald-600">£{fmt(v(totals.netSales, totals.tax))}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Tax (VAT)</p>
            <p className="text-lg font-black text-blue-500">£{fmt(totals.tax)}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Returns</p>
            <p className="text-lg font-black text-red-500">-£{fmt(totals.returns)}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Units Sold</p>
            <p className="text-lg font-black">{totals.quantity.toLocaleString()}{totals.refunded > 0 && <span className="text-red-500 text-xs ml-1">(-{totals.refunded})</span>}</p>
          </div>
        </div>
      )}

      {/* Data table */}
      {fetched && displayed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className={isDark ? 'bg-gray-800' : 'bg-gray-50'}>
                <Th col="vendor" label="Vendor" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <Th col="itemName" label="Product" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <th className="px-3 py-2 text-left font-black uppercase tracking-widest text-gray-500">Variant</th>
                <Th col="quantity" label="Qty" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} align="center" />
                <Th col="grossSales" label={`Gross ${includeVat ? '(Inc)' : '(Exc)'}`} sortBy={sortBy} sortDir={sortDir} onClick={handleSort} align="right" />
                <th className="px-3 py-2 text-right font-black uppercase tracking-widest text-gray-500">Discounts</th>
                <Th col="netSales" label={`Net ${includeVat ? '(Inc)' : '(Exc)'}`} sortBy={sortBy} sortDir={sortDir} onClick={handleSort} align="right" />
                <th className="px-3 py-2 text-right font-black uppercase tracking-widest text-gray-500">Tax</th>
                <th className="px-3 py-2 text-right font-black uppercase tracking-widest text-gray-500">Returns</th>
                <th className="px-3 py-2 text-right font-black uppercase tracking-widest text-gray-500">Cost</th>
                <Th col="profit" label="Profit" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} align="right" />
                <th className="px-3 py-2 text-right font-black uppercase tracking-widest text-gray-500">Margin</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((r, i) => {
                const gross = v(r.grossSales, r.tax);
                const net = v(r.netSales, r.tax);
                const profit = r.cost !== null ? net - r.cost : null;
                const margin = profit !== null && net > 0 ? (profit / net) * 100 : null;
                return (
                  <tr key={i} className={`border-t ${isDark ? 'border-gray-700 hover:bg-gray-800/50' : 'border-gray-50 hover:bg-indigo-50/50'} transition-colors`}>
                    <td className="px-3 py-2 font-bold text-indigo-500 whitespace-nowrap">{r.vendor}</td>
                    <td className="px-3 py-2 font-bold truncate max-w-[200px]" title={r.itemName}>{r.itemName}</td>
                    <td className={`px-3 py-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{r.variant}</td>
                    <td className="px-3 py-2 text-center font-bold">
                      {r.quantity}{r.refundedQuantity > 0 && <span className="text-red-500 ml-0.5">(-{r.refundedQuantity})</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-bold">£{fmt(gross)}</td>
                    <td className={`px-3 py-2 text-right ${r.discounts > 0 ? 'text-amber-500 font-bold' : (isDark ? 'text-gray-600' : 'text-gray-300')}`}>
                      {r.discounts > 0 ? `-£${fmt(r.discounts)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-black text-emerald-600">£{fmt(net)}</td>
                    <td className={`px-3 py-2 text-right ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>£{fmt(r.tax)}</td>
                    <td className={`px-3 py-2 text-right ${r.returns > 0 ? 'text-red-500 font-bold' : (isDark ? 'text-gray-600' : 'text-gray-300')}`}>
                      {r.returns > 0 ? `-£${fmt(r.returns)}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${r.cost !== null ? '' : (isDark ? 'text-gray-600' : 'text-gray-300')}`}>
                      {r.cost !== null ? `£${fmt(r.cost)}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-black ${profit !== null ? (profit >= 0 ? 'text-emerald-600' : 'text-red-500') : (isDark ? 'text-gray-600' : 'text-gray-300')}`}>
                      {profit !== null ? `${profit < 0 ? '-' : ''}£${fmt(Math.abs(profit))}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold ${margin !== null ? (margin >= 0 ? 'text-emerald-600' : 'text-red-500') : (isDark ? 'text-gray-600' : 'text-gray-300')}`}>
                      {margin !== null ? `${margin.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={`border-t-2 ${isDark ? 'border-gray-600 bg-gray-800' : 'border-gray-200 bg-gray-50'} font-black`}>
                <td className="px-3 py-2" colSpan={3}>TOTAL ({displayed.length} lines)</td>
                <td className="px-3 py-2 text-center">{totals.quantity.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">£{fmt(v(totals.grossSales, totals.tax))}</td>
                <td className="px-3 py-2 text-right text-amber-500">-£{fmt(totals.discounts)}</td>
                <td className="px-3 py-2 text-right text-emerald-600">£{fmt(v(totals.netSales, totals.tax))}</td>
                <td className={`px-3 py-2 text-right ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>£{fmt(totals.tax)}</td>
                <td className="px-3 py-2 text-right text-red-500">-£{fmt(totals.returns)}</td>
                <td className="px-3 py-2 text-right">{totals.hasCost ? `£${fmt(totals.cost)}` : '—'}</td>
                <td className={`px-3 py-2 text-right ${totals.hasCost ? (v(totals.netSales, totals.tax) - totals.cost >= 0 ? 'text-emerald-600' : 'text-red-500') : ''}`}>
                  {totals.hasCost ? `£${fmt(v(totals.netSales, totals.tax) - totals.cost)}` : '—'}
                </td>
                <td className={`px-3 py-2 text-right ${totals.hasCost ? (v(totals.netSales, totals.tax) - totals.cost >= 0 ? 'text-emerald-600' : 'text-red-500') : ''}`}>
                  {totals.hasCost && v(totals.netSales, totals.tax) > 0 ? `${(((v(totals.netSales, totals.tax) - totals.cost) / v(totals.netSales, totals.tax)) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {fetched && displayed.length === 0 && (
        <div className="px-4 py-8 text-center">
          <p className="text-xs font-bold text-gray-400">No results match your filters</p>
        </div>
      )}
    </div>
  );
};

// ── Sortable table header ──────────────────────────────────────────────────────

const Th: React.FC<{
  col: string;
  label: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onClick: (col: any) => void;
  align?: 'left' | 'center' | 'right';
}> = ({ col, label, sortBy, sortDir, onClick, align = 'left' }) => (
  <th
    className={`px-3 py-2 font-black uppercase tracking-widest text-gray-500 cursor-pointer hover:text-indigo-500 transition-colors select-none text-${align}`}
    onClick={() => onClick(col)}
  >
    {label} {sortBy === col && (sortDir === 'desc' ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronUp className="w-3 h-3 inline" />)}
  </th>
);

export default SalesAnalytics;
