import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    PackageSearch, Search, Upload, Loader2, AlertTriangle, RefreshCw, X,
    CheckCircle2, FileSpreadsheet, Trophy, Zap, ImageOff, ChevronDown, ChevronUp,
    Sparkles,
} from 'lucide-react';
import { isSupabaseReady, supabaseFetch } from '../services/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PriceRow {
    id: number;
    wholesaler: string;
    product_code: string;
    product_name: string | null;
    brand: string | null;
    colour: string | null;
    size: string | null;
    stock_qty: number | null;
    cost_price: number | null;
    rrp: number | null;
    currency: string | null;
    image_url: string | null;
    feed_updated_at: string;
}

interface FreshnessRow {
    wholesaler: string;
    feed_updated_at: string;
    row_count: number;
}

// One unique (colour, size) combination across one or more suppliers. The
// matrix view shows aggregated stock and cheapest price for the variant;
// the supplier breakdown view drills into the underlying rows.
interface Variant {
    key: string;            // `${colour}|${size}` lower-cased
    colour: string;
    size: string;
    rows: PriceRow[];
    totalStock: number;     // sum of stock_qty (null treated as 0)
    cheapestPrice: number | null;
    cheapestSupplier: string | null;
    suppliersWithStock: number;
}

// A "Style" is the grouping unit shown as one card. Same product across
// all colours, sizes, and suppliers is one style. We pick the grouping
// key off product_name when populated (most reliable across suppliers)
// and fall back to product_code prefix otherwise.
interface Style {
    key: string;
    displayName: string;
    displayCode: string;
    brand: string | null;
    imageUrl: string | null;
    variants: Variant[];
    sizes: string[];        // ordered (XS → 6XL → numeric → alpha)
    colours: string[];      // ordered alphabetically
    suppliers: Set<string>;
    allRows: PriceRow[];
    totalStock: number;
    cheapestPrice: number | null;
    cheapestSupplier: string | null;
    cheapestRow: PriceRow | null;
    feedUpdatedAt: string;  // newest among all underlying rows
}

// ─── Static config ──────────────────────────────────────────────────────────

const KNOWN_WHOLESALERS = [
    'AWDis',
    'Ralawise',
    'BTC',
    'Prestige',
    'Pencarrie',
    'Result',
] as const;

// Header-name aliases used to auto-detect each column on upload. Lower-cased
// substrings are tested in order — first match wins. Most UK wholesalers
// publish broadly similar feeds so these defaults usually map straight
// through and the user only confirms.
const COLUMN_ALIASES: Record<string, string[]> = {
    product_code: ['code', 'sku', 'style', 'item code', 'product code', 'ref'],
    product_name: ['name', 'description', 'title', 'product', 'item'],
    brand: ['brand', 'manufacturer'],
    colour: ['colour', 'color', 'shade'],
    size: ['size'],
    stock_qty: ['stock', 'qty', 'quantity', 'available', 'on hand', 'in stock'],
    cost_price: ['cost', 'wholesale', 'trade', 'net price', 'price', 'unit price'],
    rrp: ['rrp', 'retail', 'srp', 'list'],
    image_url: ['image', 'picture', 'photo', 'thumbnail', 'img', 'image url'],
};

const FIELD_LABELS: Record<string, string> = {
    product_code: 'Product code *',
    product_name: 'Product name',
    brand: 'Brand',
    colour: 'Colour',
    size: 'Size',
    stock_qty: 'Stock qty',
    cost_price: 'Cost price',
    rrp: 'RRP',
    image_url: 'Image URL',
};

// Upload is chunked — Supabase / PostgREST happily accepts large bodies
// but per-request memory + timeout get unfriendly past ~2k rows in one go.
// 1000 keeps progress responsive and never trips the 50s function cap.
const UPSERT_CHUNK = 1000;

// Apparel size ordering. Fixed list comes first (XXS → 6XL), then any
// numeric sizes (childrenswear / waist sizes), then alpha fallback. This
// is what makes a size-matrix view actually scannable.
const SIZE_ORDER = [
    'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL',
    '3XL', '4XL', '5XL', '6XL', '7XL',
    'OS', 'ONE SIZE', 'OSFA',
];

// ─── CSV / XLSX parsing ─────────────────────────────────────────────────────

const parseCsvLine = (text: string): string[] => {
    const re = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    return text.split(re).map(cell => cell.trim().replace(/^"|"$/g, ''));
};

const parseNumber = (raw: string | undefined | null): number | null => {
    if (raw == null) return null;
    const s = String(raw).replace(/[£$€,]/g, '').replace(/\s+/g, '').trim();
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

// ExcelJS is ~270 KB gzipped — lazy-load it so it only lands in the browser
// when someone actually uploads an Excel feed.
type ExcelJSModule = typeof import('exceljs');
let excelJsPromise: Promise<ExcelJSModule> | null = null;
const loadExcelJS = (): Promise<ExcelJSModule> => {
    if (!excelJsPromise) excelJsPromise = import('exceljs');
    return excelJsPromise;
};

const isXlsx = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return name.endsWith('.xlsx') || name.endsWith('.xlsm');
};
const isXls = (file: File): boolean => file.name.toLowerCase().endsWith('.xls');

const loadRowsFromFile = async (file: File): Promise<{ headers: string[]; rows: string[][] }> => {
    if (isXls(file)) {
        throw new Error('Old .xls format isn\'t supported — please re-save as .xlsx or .csv from Excel.');
    }

    if (isXlsx(file)) {
        const ExcelJS = await loadExcelJS();
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        let usedSheet: import('exceljs').Worksheet | null = null;
        workbook.eachSheet(ws => {
            if (usedSheet) return;
            if (ws.actualRowCount && ws.actualRowCount >= 2) usedSheet = ws;
        });
        if (!usedSheet) throw new Error('That spreadsheet has no rows we can read.');

        const sheet: import('exceljs').Worksheet = usedSheet;
        const cellToString = (v: unknown): string => {
            if (v == null) return '';
            if (typeof v === 'string') return v.trim();
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            if (v instanceof Date) return v.toISOString();
            const obj = v as Record<string, unknown>;
            if (typeof obj.text === 'string') return obj.text.trim();
            if (Array.isArray(obj.richText)) return obj.richText.map((rt: { text?: string }) => rt.text || '').join('').trim();
            if (typeof obj.result === 'string' || typeof obj.result === 'number') return String(obj.result);
            if (typeof obj.hyperlink === 'string') return obj.hyperlink;
            return String(v);
        };

        const allRows: string[][] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
            const values = row.values as unknown[];
            const cells = (values.slice(1) as unknown[]).map(cellToString);
            while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
            if (cells.length > 0) allRows.push(cells);
        });

        if (allRows.length < 2) throw new Error('Spreadsheet has a header but no data rows.');
        return { headers: allRows[0] || [], rows: allRows.slice(1) };
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV is empty or has no data rows.');
    return {
        headers: parseCsvLine(lines[0] || ''),
        rows: lines.slice(1).map(l => parseCsvLine(l)),
    };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatRelative = (iso: string): string => {
    try {
        const ms = Date.now() - Date.parse(iso);
        if (!Number.isFinite(ms) || ms < 0) return '';
        const mins = Math.round(ms / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    } catch { return ''; }
};

const fmtMoney = (v: number | null, currency: string | null = 'GBP'): string => {
    if (v == null || !Number.isFinite(v)) return '—';
    const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£';
    return `${sym}${v.toFixed(2)}`;
};

// Apparel-aware size ranking. Falls back to numeric for waist sizes
// (28/30/32…) and alpha for anything truly unknown so the matrix sort
// stays sensible across feeds.
const sizeRank = (s: string): number => {
    if (!s) return 100_000;
    const u = s.toUpperCase().trim();
    const idx = SIZE_ORDER.indexOf(u);
    if (idx >= 0) return idx;
    const n = parseInt(u, 10);
    if (Number.isFinite(n)) return 1_000 + n;
    return 10_000;
};

const stockTone = (qty: number | null, qtyNeeded?: number): string => {
    if (qty == null) return 'bg-slate-100 text-slate-500';
    if (qty <= 0) return 'bg-rose-100 text-rose-700';
    if (qtyNeeded && qtyNeeded > 0) {
        if (qty >= qtyNeeded) return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300';
        return 'bg-amber-100 text-amber-800';
    }
    if (qty < 25) return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
};

// Group rows into Styles (one card per style). Grouping key is product_name
// when populated, else first whitespace-delimited token of product_code
// (handles feeds like "JH001 SUG XS" → "JH001"). Image / brand picked
// from the first row that has them.
const buildStyles = (rows: PriceRow[]): Style[] => {
    const groups = new Map<string, PriceRow[]>();
    for (const r of rows) {
        const name = (r.product_name || '').trim();
        const fallback = (r.product_code || '').trim().split(/[\s-_]+/)[0] || 'unknown';
        const key = (name || fallback).toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
    }

    const out: Style[] = [];
    for (const [key, styleRows] of groups.entries()) {
        // Aggregate variants.
        const variantMap = new Map<string, Variant>();
        for (const r of styleRows) {
            const colour = (r.colour || '').trim() || '—';
            const size = (r.size || '').trim() || '—';
            const vKey = `${colour.toLowerCase()}|${size.toLowerCase()}`;
            let v = variantMap.get(vKey);
            if (!v) {
                v = {
                    key: vKey, colour, size, rows: [],
                    totalStock: 0, cheapestPrice: null, cheapestSupplier: null,
                    suppliersWithStock: 0,
                };
                variantMap.set(vKey, v);
            }
            v.rows.push(r);
            v.totalStock += r.stock_qty || 0;
            if (r.cost_price != null && (v.cheapestPrice == null || r.cost_price < v.cheapestPrice)) {
                v.cheapestPrice = r.cost_price;
                v.cheapestSupplier = r.wholesaler;
            }
        }
        for (const v of variantMap.values()) {
            v.suppliersWithStock = new Set(v.rows.filter(r => (r.stock_qty || 0) > 0).map(r => r.wholesaler)).size;
        }

        const variants = Array.from(variantMap.values());
        const sizes = Array.from(new Set(variants.map(v => v.size)))
            .sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
        const colours = Array.from(new Set(variants.map(v => v.colour)))
            .sort((a, b) => a.localeCompare(b));

        const totalStock = styleRows.reduce((s, r) => s + (r.stock_qty || 0), 0);
        let cheapestRow: PriceRow | null = null;
        for (const r of styleRows) {
            if (r.cost_price == null) continue;
            if (!cheapestRow || (cheapestRow.cost_price != null && r.cost_price < cheapestRow.cost_price)) {
                cheapestRow = r;
            }
        }

        const display = styleRows.find(r => r.product_name)?.product_name || styleRows[0]?.product_code || key;
        const codeDisplay = styleRows.find(r => r.product_code)?.product_code?.split(/[\s-_]+/)[0] || '';
        const brand = styleRows.find(r => r.brand)?.brand || null;
        const imageUrl = styleRows.find(r => r.image_url)?.image_url || null;
        const newest = styleRows.reduce((acc, r) =>
            Date.parse(r.feed_updated_at) > Date.parse(acc) ? r.feed_updated_at : acc,
            styleRows[0]?.feed_updated_at || new Date(0).toISOString()
        );

        out.push({
            key,
            displayName: display,
            displayCode: codeDisplay,
            brand,
            imageUrl,
            variants,
            sizes,
            colours,
            suppliers: new Set(styleRows.map(r => r.wholesaler)),
            allRows: styleRows,
            totalStock,
            cheapestPrice: cheapestRow?.cost_price ?? null,
            cheapestSupplier: cheapestRow?.wholesaler ?? null,
            cheapestRow,
            feedUpdatedAt: newest,
        });
    }

    // Surface the most useful styles first: more variants = richer comparison.
    out.sort((a, b) => b.variants.length - a.variants.length || b.totalStock - a.totalStock);
    return out;
};

// ─── Main component ─────────────────────────────────────────────────────────

const WholesalerLookup: React.FC = () => {
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [results, setResults] = useState<PriceRow[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [resultLimited, setResultLimited] = useState(false);

    const [freshness, setFreshness] = useState<FreshnessRow[]>([]);
    const [freshnessLoaded, setFreshnessLoaded] = useState(false);

    const [filterWholesaler, setFilterWholesaler] = useState<string>('all');
    const [filterColour, setFilterColour] = useState<string>('all');
    const [filterBrand, setFilterBrand] = useState<string>('all');
    // Quantity needed for the "can fulfil" calculation. Empty = no calc.
    const [qtyNeeded, setQtyNeeded] = useState<string>('');
    const qtyN = useMemo(() => {
        const n = parseInt(qtyNeeded, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }, [qtyNeeded]);

    const [uploadOpen, setUploadOpen] = useState(false);

    // Debounce search — Supabase ilike is fast but pummeling it on every
    // keystroke wastes round-trips and the network blink shows on weak wifi.
    useEffect(() => {
        const t = setTimeout(() => setDebounced(search.trim()), 220);
        return () => clearTimeout(t);
    }, [search]);

    const loadFreshness = useCallback(async () => {
        if (!isSupabaseReady()) return;
        try {
            const res = await supabaseFetch(
                'stash_wholesaler_prices?select=wholesaler,feed_updated_at&order=feed_updated_at.desc&limit=2000',
                'GET'
            );
            const rows: { wholesaler: string; feed_updated_at: string }[] = await res.json();
            const map = new Map<string, { feed_updated_at: string; count: number }>();
            for (const r of rows) {
                const cur = map.get(r.wholesaler);
                if (!cur) map.set(r.wholesaler, { feed_updated_at: r.feed_updated_at, count: 1 });
                else {
                    cur.count += 1;
                    if (Date.parse(r.feed_updated_at) > Date.parse(cur.feed_updated_at)) {
                        cur.feed_updated_at = r.feed_updated_at;
                    }
                }
            }
            const list: FreshnessRow[] = Array.from(map.entries())
                .map(([wholesaler, v]) => ({ wholesaler, feed_updated_at: v.feed_updated_at, row_count: v.count }))
                .sort((a, b) => a.wholesaler.localeCompare(b.wholesaler));
            setFreshness(list);
        } catch { /* non-critical */ }
        finally { setFreshnessLoaded(true); }
    }, []);

    useEffect(() => { loadFreshness(); }, [loadFreshness]);

    // ── Search ──
    useEffect(() => {
        if (!isSupabaseReady()) {
            setSearchError('Supabase isn\'t configured.');
            return;
        }
        if (debounced.length < 2) {
            setResults([]);
            setSearchError(null);
            setResultLimited(false);
            return;
        }
        let cancelled = false;
        setSearching(true);
        setSearchError(null);
        (async () => {
            try {
                const escape = (s: string) => s.replace(/[%,()*]/g, ' ').trim();
                const term = escape(debounced);
                let url = `stash_wholesaler_prices?select=*&or=(product_code.ilike.*${encodeURIComponent(term)}*,product_name.ilike.*${encodeURIComponent(term)}*)`;
                if (filterWholesaler !== 'all') {
                    url += `&wholesaler=eq.${encodeURIComponent(filterWholesaler)}`;
                }
                url += '&order=cost_price.asc.nullslast&limit=500';
                const res = await supabaseFetch(url, 'GET');
                if (cancelled) return;
                const rows: PriceRow[] = await res.json();
                setResults(Array.isArray(rows) ? rows : []);
                setResultLimited(Array.isArray(rows) && rows.length === 500);
            } catch (e: any) {
                if (!cancelled) setSearchError(e?.message || 'Search failed');
            } finally {
                if (!cancelled) setSearching(false);
            }
        })();
        return () => { cancelled = true; };
    }, [debounced, filterWholesaler]);

    // Available colour / brand options derived from current results so the
    // dropdowns only ever show what's actually findable in the current view.
    const availableColours = useMemo(() => {
        const map = new Map<string, { display: string; count: number }>();
        for (const r of results) {
            const raw = (r.colour || '').trim();
            if (!raw) continue;
            const key = raw.toLowerCase();
            const cur = map.get(key);
            if (cur) cur.count += 1;
            else map.set(key, { display: raw, count: 1 });
        }
        return Array.from(map.entries())
            .map(([key, v]) => ({ key, display: v.display, count: v.count }))
            .sort((a, b) => a.display.localeCompare(b.display));
    }, [results]);

    const availableBrands = useMemo(() => {
        const map = new Map<string, { display: string; count: number }>();
        for (const r of results) {
            const raw = (r.brand || '').trim();
            if (!raw) continue;
            const key = raw.toLowerCase();
            const cur = map.get(key);
            if (cur) cur.count += 1;
            else map.set(key, { display: raw, count: 1 });
        }
        return Array.from(map.entries())
            .map(([key, v]) => ({ key, display: v.display, count: v.count }))
            .sort((a, b) => a.display.localeCompare(b.display));
    }, [results]);

    // Auto-clear orphaned filter selections when the result set changes.
    useEffect(() => {
        if (filterColour !== 'all' && !availableColours.some(c => c.key === filterColour)) {
            setFilterColour('all');
        }
    }, [availableColours, filterColour]);
    useEffect(() => {
        if (filterBrand !== 'all' && !availableBrands.some(b => b.key === filterBrand)) {
            setFilterBrand('all');
        }
    }, [availableBrands, filterBrand]);

    // Apply colour + brand filters client-side, then group into Styles.
    const styles = useMemo(() => {
        const filtered = results.filter(r => {
            if (filterColour !== 'all' && (r.colour || '').trim().toLowerCase() !== filterColour) return false;
            if (filterBrand !== 'all' && (r.brand || '').trim().toLowerCase() !== filterBrand) return false;
            return true;
        });
        return buildStyles(filtered);
    }, [results, filterColour, filterBrand]);

    // Best-buy hero: cheapest cost across all results that have stock > 0.
    // If qty calculator is active we only consider rows that can fulfil.
    const bestBuy = useMemo(() => {
        let candidates = results;
        if (filterColour !== 'all') candidates = candidates.filter(r => (r.colour || '').trim().toLowerCase() === filterColour);
        if (filterBrand !== 'all') candidates = candidates.filter(r => (r.brand || '').trim().toLowerCase() === filterBrand);
        if (qtyN > 0) candidates = candidates.filter(r => (r.stock_qty || 0) >= qtyN);
        else candidates = candidates.filter(r => (r.stock_qty || 0) > 0);

        let best: PriceRow | null = null;
        for (const r of candidates) {
            if (r.cost_price == null) continue;
            if (!best || (best.cost_price != null && r.cost_price < best.cost_price)) best = r;
        }
        return best;
    }, [results, filterColour, filterBrand, qtyN]);

    // ─── Render ────────────────────────────────────────────────────────────

    return (
        <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700"><PackageSearch className="w-5 h-5" /></div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-gray-900">Wholesale Lookup</h1>
                        <p className="text-[11px] text-gray-500 mt-0.5">Compare every wholesaler on stock and price in one place.</p>
                    </div>
                </div>
                <div className="flex-1" />
                <button
                    onClick={() => setUploadOpen(true)}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 flex items-center gap-1.5 shadow-sm"
                >
                    <Upload className="w-3.5 h-3.5" /> Upload Feed
                </button>
                <button
                    onClick={loadFreshness}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
                    title="Refresh freshness summary"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {/* Freshness strip */}
            {freshnessLoaded && (
                <div className="flex flex-wrap gap-1.5">
                    {freshness.length === 0 ? (
                        <div className="text-[11px] text-gray-500 italic">No supplier feeds uploaded yet — click "Upload Feed" to get started.</div>
                    ) : freshness.map(f => {
                        const ageMs = Date.now() - Date.parse(f.feed_updated_at);
                        const stale = ageMs > 7 * 24 * 60 * 60 * 1000;
                        return (
                            <div key={f.wholesaler}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-2 ${
                                    stale ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                }`}>
                                <span className="font-bold">{f.wholesaler}</span>
                                <span className="text-gray-500">{f.row_count.toLocaleString()} rows</span>
                                <span className={stale ? 'text-amber-600' : 'text-emerald-600'}>· {formatRelative(f.feed_updated_at)}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Sticky search + filters */}
            <div className="sticky top-14 z-30 bg-gray-50/85 backdrop-blur-md -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 py-2 border-y border-gray-200">
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 flex flex-col md:flex-row gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            autoFocus
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Type a code (e.g. JH001) or product name…"
                            className="w-full pl-10 pr-9 py-2.5 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Need</span>
                            <input
                                type="number"
                                min="0"
                                value={qtyNeeded}
                                onChange={e => setQtyNeeded(e.target.value)}
                                placeholder="—"
                                className="w-14 text-sm font-bold text-right focus:outline-none"
                            />
                        </label>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        <select value={filterWholesaler} onChange={e => setFilterWholesaler(e.target.value)}
                            className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="all">All Wholesalers</option>
                            {Array.from(new Set([...KNOWN_WHOLESALERS as readonly string[], ...freshness.map(f => f.wholesaler)])).sort().map(w => (
                                <option key={w} value={w}>{w}</option>
                            ))}
                        </select>
                        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} disabled={availableBrands.length === 0}
                            className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
                            <option value="all">All Brands</option>
                            {availableBrands.map(b => <option key={b.key} value={b.key}>{b.display} ({b.count})</option>)}
                        </select>
                        <select value={filterColour} onChange={e => setFilterColour(e.target.value)} disabled={availableColours.length === 0}
                            className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
                            <option value="all">All Colours</option>
                            {availableColours.map(c => <option key={c.key} value={c.key}>{c.display} ({c.count})</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Results */}
            <section className="space-y-4">
                {searching && (
                    <div className="flex items-center justify-center py-8 text-gray-500 gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm">Searching wholesalers…</span>
                    </div>
                )}

                {searchError && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> {searchError}
                    </div>
                )}

                {!searching && debounced.length < 2 && (
                    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">
                        <PackageSearch className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <p className="font-bold text-gray-700">Search any product across every wholesaler</p>
                        <p className="text-xs mt-1">Type at least 2 characters of a code or product name.</p>
                    </div>
                )}

                {!searching && debounced.length >= 2 && results.length === 0 && (
                    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">
                        <p className="font-bold text-gray-700">No matches.</p>
                        <p className="text-xs mt-1">Either no wholesaler stocks "{debounced}" or you haven't uploaded that supplier's feed yet.</p>
                    </div>
                )}

                {!searching && debounced.length >= 2 && results.length > 0 && styles.length === 0 && (filterColour !== 'all' || filterBrand !== 'all') && (
                    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-500">
                        <p className="font-bold text-gray-700">No results match those filters.</p>
                        <button onClick={() => { setFilterColour('all'); setFilterBrand('all'); }} className="mt-3 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-indigo-700">
                            Clear filters
                        </button>
                    </div>
                )}

                {resultLimited && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Showing the first 500 matches — narrow your search to see fewer, more relevant results.
                    </div>
                )}

                {/* Best-buy hero card */}
                {!searching && bestBuy && styles.length > 0 && (
                    <BestBuyCard row={bestBuy} qtyNeeded={qtyN} />
                )}

                {/* Style cards */}
                {!searching && styles.map(style => (
                    <StyleCard key={style.key} style={style} qtyNeeded={qtyN} />
                ))}
            </section>

            {/* Upload modal */}
            {uploadOpen && (
                <UploadModal onClose={() => setUploadOpen(false)} onUploaded={() => loadFreshness()} />
            )}
        </div>
    );
};

// ─── Best-buy hero ──────────────────────────────────────────────────────────

const BestBuyCard: React.FC<{ row: PriceRow; qtyNeeded: number }> = ({ row, qtyNeeded }) => {
    const stock = row.stock_qty ?? 0;
    const enoughStock = qtyNeeded > 0 ? stock >= qtyNeeded : stock > 0;
    const lineCost = qtyNeeded > 0 && row.cost_price != null ? row.cost_price * qtyNeeded : null;
    return (
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg overflow-hidden">
            <div className="p-4 sm:p-5 flex items-center gap-4 flex-wrap">
                <div className="p-2.5 rounded-xl bg-white/20 backdrop-blur-sm">
                    <Trophy className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" /> Best buy right now
                    </div>
                    <div className="mt-1 font-bold text-lg truncate">{row.product_name || row.product_code}</div>
                    <div className="text-[12px] text-emerald-50 truncate">
                        {row.wholesaler} · <span className="font-mono">{row.product_code}</span>
                        {row.colour && <> · {row.colour}</>}
                        {row.size && <> · {row.size}</>}
                    </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest text-emerald-100">Cost</div>
                        <div className="text-2xl font-black tabular-nums">{fmtMoney(row.cost_price, row.currency)}</div>
                    </div>
                    <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest text-emerald-100">Stock</div>
                        <div className="text-2xl font-black tabular-nums">{stock.toLocaleString()}</div>
                    </div>
                    {qtyNeeded > 0 && (
                        <div className="text-right">
                            <div className="text-[10px] uppercase tracking-widest text-emerald-100">For {qtyNeeded.toLocaleString()}</div>
                            <div className="text-2xl font-black tabular-nums">{fmtMoney(lineCost, row.currency)}</div>
                            <div className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${enoughStock ? 'text-emerald-100' : 'text-amber-200'}`}>
                                {enoughStock ? 'Can fulfil' : `Short ${(qtyNeeded - stock).toLocaleString()}`}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Style card with size matrix ────────────────────────────────────────────

const StyleCard: React.FC<{ style: Style; qtyNeeded: number }> = ({ style, qtyNeeded }) => {
    const [showBreakdown, setShowBreakdown] = useState(false);
    const [imgError, setImgError] = useState(false);

    // Build a quick map for matrix cell lookups: `${colourKey}|${sizeKey}` → variant.
    const variantByKey = useMemo(() => {
        const m = new Map<string, Variant>();
        for (const v of style.variants) m.set(v.key, v);
        return m;
    }, [style.variants]);

    const supplierCount = style.suppliers.size;
    const variantCount = style.variants.length;
    const canFulfil = qtyNeeded > 0
        ? style.variants.some(v => v.totalStock >= qtyNeeded)
        : style.totalStock > 0;

    return (
        <article className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Header */}
            <header className="p-3 sm:p-4 border-b border-gray-100 flex items-start gap-3 flex-wrap">
                {/* Image thumb */}
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                    {style.imageUrl && !imgError ? (
                        <img
                            src={style.imageUrl}
                            alt={style.displayName}
                            className="w-full h-full object-contain"
                            onError={() => setImgError(true)}
                            loading="lazy"
                        />
                    ) : (
                        <ImageOff className="w-6 h-6 text-gray-300" />
                    )}
                </div>

                {/* Title block */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        {style.displayCode && (
                            <span className="font-mono text-sm font-bold text-indigo-700">{style.displayCode}</span>
                        )}
                        {style.brand && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider border border-slate-200">{style.brand}</span>
                        )}
                    </div>
                    <h3 className="text-base font-bold text-gray-900 truncate" title={style.displayName}>{style.displayName}</h3>
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
                        <span><span className="font-bold text-gray-700">{style.totalStock.toLocaleString()}</span> total stock</span>
                        <span>·</span>
                        <span>cheapest <span className="font-bold text-emerald-600 tabular-nums">{fmtMoney(style.cheapestPrice, style.cheapestRow?.currency || 'GBP')}</span>{style.cheapestSupplier && <span className="text-gray-400"> ({style.cheapestSupplier})</span>}</span>
                        <span>·</span>
                        <span>{supplierCount} supplier{supplierCount === 1 ? '' : 's'} · {variantCount} variant{variantCount === 1 ? '' : 's'}</span>
                    </div>
                </div>

                {/* Fulfilment badge */}
                {qtyNeeded > 0 && (
                    <div className="shrink-0">
                        {canFulfil ? (
                            <div className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Can fulfil {qtyNeeded.toLocaleString()}
                            </div>
                        ) : (
                            <div className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest">
                                <AlertTriangle className="w-3.5 h-3.5" /> Not enough stock
                            </div>
                        )}
                    </div>
                )}
            </header>

            {/* Size matrix — only render when there's actually a meaningful grid */}
            {style.sizes.length > 0 && style.colours.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 z-10">Colour</th>
                                {style.sizes.map(s => (
                                    <th key={s} className="text-center px-2 py-2 min-w-[58px]">{s}</th>
                                ))}
                                <th className="text-right px-3 py-2">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {style.colours.map(colour => {
                                const rowTotal = style.sizes.reduce((sum, size) => {
                                    const v = variantByKey.get(`${colour.toLowerCase()}|${size.toLowerCase()}`);
                                    return sum + (v?.totalStock || 0);
                                }, 0);
                                const rowCheapest = style.sizes.reduce<number | null>((min, size) => {
                                    const v = variantByKey.get(`${colour.toLowerCase()}|${size.toLowerCase()}`);
                                    if (v?.cheapestPrice == null) return min;
                                    if (min == null || v.cheapestPrice < min) return v.cheapestPrice;
                                    return min;
                                }, null);
                                return (
                                    <tr key={colour} className="hover:bg-gray-50/50">
                                        <td className="px-3 py-1.5 sticky left-0 bg-white z-10 font-medium text-gray-700">{colour}</td>
                                        {style.sizes.map(size => {
                                            const v = variantByKey.get(`${colour.toLowerCase()}|${size.toLowerCase()}`);
                                            return (
                                                <td key={size} className="px-1 py-1 text-center align-middle">
                                                    <MatrixCell variant={v} qtyNeeded={qtyNeeded} currency={style.cheapestRow?.currency || 'GBP'} />
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-1.5 text-right">
                                            <div className="text-sm font-bold tabular-nums text-gray-700">{rowTotal.toLocaleString()}</div>
                                            <div className="text-[10px] text-gray-400 tabular-nums">{fmtMoney(rowCheapest, style.cheapestRow?.currency || 'GBP')}</div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Supplier breakdown toggle */}
            <div className="border-t border-gray-100 bg-gray-50/50">
                <button
                    type="button"
                    onClick={() => setShowBreakdown(b => !b)}
                    className="w-full px-4 py-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-indigo-600 transition-colors"
                >
                    {showBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showBreakdown ? 'Hide supplier breakdown' : 'Show supplier breakdown'}
                </button>
                {showBreakdown && <SupplierBreakdown rows={style.allRows} qtyNeeded={qtyNeeded} />}
            </div>
        </article>
    );
};

// ─── Matrix cell ────────────────────────────────────────────────────────────

const MatrixCell: React.FC<{
    variant: Variant | undefined;
    qtyNeeded: number;
    currency: string;
}> = ({ variant, qtyNeeded, currency }) => {
    if (!variant || variant.rows.length === 0) {
        return <div className="text-gray-300 text-xs">—</div>;
    }
    const stock = variant.totalStock;
    const tone = stockTone(stock, qtyNeeded);
    const price = variant.cheapestPrice;
    const tooltip = [
        `Stock: ${stock.toLocaleString()}`,
        price != null ? `Cheapest: ${fmtMoney(price, currency)} (${variant.cheapestSupplier})` : null,
        variant.suppliersWithStock > 0 ? `${variant.suppliersWithStock} supplier${variant.suppliersWithStock === 1 ? '' : 's'} in stock` : 'Out of stock everywhere',
    ].filter(Boolean).join(' · ');

    return (
        <div
            className={`mx-auto w-full max-w-[68px] py-1.5 rounded-md ${tone} flex flex-col items-center justify-center`}
            title={tooltip}
        >
            <div className="text-sm font-black tabular-nums leading-tight">{stock.toLocaleString()}</div>
            {price != null && <div className="text-[9px] font-medium tabular-nums leading-tight opacity-80">{fmtMoney(price, currency)}</div>}
        </div>
    );
};

// ─── Supplier breakdown table ──────────────────────────────────────────────

const SupplierBreakdown: React.FC<{ rows: PriceRow[]; qtyNeeded: number }> = ({ rows, qtyNeeded }) => {
    const sorted = useMemo(() => {
        return rows.slice().sort((a, b) => {
            const ap = a.cost_price ?? Infinity;
            const bp = b.cost_price ?? Infinity;
            return ap - bp;
        });
    }, [rows]);

    return (
        <div className="overflow-x-auto bg-white border-t border-gray-100">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <tr>
                        <th className="text-left px-3 py-2">Wholesaler</th>
                        <th className="text-left px-3 py-2">Code</th>
                        <th className="text-left px-3 py-2">Variant</th>
                        <th className="text-left px-3 py-2">Stock</th>
                        <th className="text-right px-3 py-2">Cost</th>
                        <th className="text-right px-3 py-2">RRP</th>
                        <th className="text-right px-3 py-2">Updated</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sorted.map(r => {
                        const enough = qtyNeeded > 0 ? (r.stock_qty || 0) >= qtyNeeded : true;
                        return (
                            <tr key={r.id} className="hover:bg-gray-50">
                                <td className="px-3 py-1.5 font-bold text-gray-800">{r.wholesaler}</td>
                                <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{r.product_code}</td>
                                <td className="px-3 py-1.5 text-gray-600 text-xs">
                                    {[r.colour, r.size].filter(Boolean).join(' · ') || <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-1.5">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${stockTone(r.stock_qty, qtyNeeded)}`}>
                                        {r.stock_qty == null ? 'n/a' : r.stock_qty.toLocaleString()}
                                    </span>
                                    {qtyNeeded > 0 && r.stock_qty != null && !enough && (
                                        <span className="ml-1 text-[10px] text-amber-600">short {(qtyNeeded - r.stock_qty).toLocaleString()}</span>
                                    )}
                                </td>
                                <td className="px-3 py-1.5 text-right font-bold tabular-nums">{fmtMoney(r.cost_price, r.currency)}</td>
                                <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{fmtMoney(r.rrp, r.currency)}</td>
                                <td className="px-3 py-1.5 text-right text-[11px] text-gray-400" title={new Date(r.feed_updated_at).toLocaleString('en-GB')}>
                                    {formatRelative(r.feed_updated_at)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

// ─── Upload modal ───────────────────────────────────────────────────────────

interface UploadModalProps {
    onClose: () => void;
    onUploaded: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ onClose, onUploaded }) => {
    const [wholesaler, setWholesaler] = useState<string>(KNOWN_WHOLESALERS[0]);
    const [customWholesaler, setCustomWholesaler] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [sampleRows, setSampleRows] = useState<string[][]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({
        product_code: '', product_name: '', brand: '', colour: '', size: '',
        stock_qty: '', cost_price: '', rrp: '', image_url: '',
    });
    const [replaceExisting, setReplaceExisting] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const effectiveWholesaler = wholesaler === '__custom__' ? customWholesaler.trim() : wholesaler;

    const onPickFile = async (f: File) => {
        setFile(f);
        setError(null);
        setSuccess(null);
        setHeaders([]);
        setSampleRows([]);
        try {
            const { headers: hdrs, rows } = await loadRowsFromFile(f);
            setHeaders(hdrs);
            setSampleRows(rows.slice(0, 3));

            const auto: Record<string, string> = {
                product_code: '', product_name: '', brand: '', colour: '', size: '',
                stock_qty: '', cost_price: '', rrp: '', image_url: '',
            };
            for (const field of Object.keys(COLUMN_ALIASES)) {
                const aliases = COLUMN_ALIASES[field];
                for (const h of hdrs) {
                    const low = h.toLowerCase();
                    if (aliases.some(a => low.includes(a))) {
                        auto[field] = h;
                        break;
                    }
                }
            }
            setMapping(auto);
        } catch (e: any) {
            setError(e?.message || 'Could not read that file');
        }
    };

    const startUpload = async () => {
        if (!file) { setError('Pick a file first.'); return; }
        if (!effectiveWholesaler) { setError('Choose a wholesaler.'); return; }
        if (!mapping.product_code) { setError('Map the Product Code column — that\'s the only required field.'); return; }
        if (!isSupabaseReady()) { setError('Supabase not configured.'); return; }

        setUploading(true);
        setError(null);
        setSuccess(null);
        setProgress({ done: 0, total: 0 });
        try {
            const { headers: hdrs, rows: dataRows } = await loadRowsFromFile(file);
            const idx: Record<string, number> = {};
            for (const [field, hdr] of Object.entries(mapping)) {
                idx[field] = hdr ? hdrs.indexOf(hdr) : -1;
            }

            const now = new Date().toISOString();
            const rows: any[] = [];
            for (const cells of dataRows) {
                const code = idx.product_code >= 0 ? (cells[idx.product_code] || '') : '';
                if (!code) continue;
                rows.push({
                    wholesaler: effectiveWholesaler,
                    product_code: code,
                    product_name: idx.product_name >= 0 ? (cells[idx.product_name] || null) : null,
                    brand: idx.brand >= 0 ? (cells[idx.brand] || null) : null,
                    colour: idx.colour >= 0 ? (cells[idx.colour] || null) : null,
                    size: idx.size >= 0 ? (cells[idx.size] || null) : null,
                    stock_qty: idx.stock_qty >= 0 ? (() => {
                        const n = parseNumber(cells[idx.stock_qty]);
                        return n == null ? null : Math.round(n);
                    })() : null,
                    cost_price: idx.cost_price >= 0 ? parseNumber(cells[idx.cost_price]) : null,
                    rrp: idx.rrp >= 0 ? parseNumber(cells[idx.rrp]) : null,
                    image_url: idx.image_url >= 0 ? (cells[idx.image_url] || null) : null,
                    currency: 'GBP',
                    feed_updated_at: now,
                });
            }

            if (rows.length === 0) {
                setError('No usable rows found. Check the Product Code column mapping.');
                setUploading(false);
                return;
            }

            if (replaceExisting) {
                await supabaseFetch(
                    `stash_wholesaler_prices?wholesaler=eq.${encodeURIComponent(effectiveWholesaler)}`,
                    'DELETE'
                );
            }

            setProgress({ done: 0, total: rows.length });
            for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
                const chunk = rows.slice(i, i + UPSERT_CHUNK);
                await supabaseFetch('stash_wholesaler_prices', 'POST', chunk);
                setProgress({ done: Math.min(i + UPSERT_CHUNK, rows.length), total: rows.length });
            }

            setSuccess(`Uploaded ${rows.length.toLocaleString()} rows for ${effectiveWholesaler}.`);
            onUploaded();
            setFile(null);
            setHeaders([]);
            setSampleRows([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (e: any) {
            setError(e?.message || 'Upload failed');
        } finally {
            setUploading(false);
            setProgress(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-8" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700"><FileSpreadsheet className="w-5 h-5" /></div>
                    <div>
                        <h2 className="font-black uppercase tracking-widest text-sm text-gray-900">Upload Wholesaler Feed</h2>
                        <p className="text-[11px] text-gray-500 mt-0.5">CSV or Excel (.xlsx) from your supplier portal — we'll auto-detect the columns including image URLs.</p>
                    </div>
                    <button onClick={onClose} className="ml-auto p-1.5 rounded hover:bg-gray-100 text-gray-500"><X className="w-4 h-4" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Wholesaler</label>
                        <div className="flex flex-wrap gap-1.5">
                            {KNOWN_WHOLESALERS.map(w => (
                                <button key={w} type="button" onClick={() => setWholesaler(w)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${wholesaler === w ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                                    {w}
                                </button>
                            ))}
                            <button type="button" onClick={() => setWholesaler('__custom__')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${wholesaler === '__custom__' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                                Other…
                            </button>
                        </div>
                        {wholesaler === '__custom__' && (
                            <input type="text" value={customWholesaler} onChange={e => setCustomWholesaler(e.target.value)}
                                placeholder="Wholesaler name"
                                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                        )}
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Supplier file</label>
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600">
                            <Upload className="w-4 h-4" />
                            <span>{file ? file.name : 'Pick a CSV or Excel file…'}</span>
                            <input ref={fileInputRef} type="file"
                                accept=".csv,.xlsx,.xlsm,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) onPickFile(f); }} />
                        </label>
                        <p className="mt-1 text-[10px] text-gray-400">Supports .csv and .xlsx. If your supplier sends .xls, re-save it as .xlsx in Excel first.</p>
                    </div>

                    {headers.length > 0 && (
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Column mapping</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {Object.keys(FIELD_LABELS).map(field => (
                                    <div key={field} className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-gray-600 w-28 shrink-0">{FIELD_LABELS[field]}</label>
                                        <select value={mapping[field]} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                                            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                            <option value="">— ignore —</option>
                                            {headers.map(h => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                    </div>
                                ))}
                            </div>
                            {sampleRows.length > 0 && mapping.product_code && (
                                <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] text-gray-600">
                                    <div className="font-bold text-gray-700 mb-1">Sample row preview:</div>
                                    {(() => {
                                        const codeIdx = headers.indexOf(mapping.product_code);
                                        const nameIdx = mapping.product_name ? headers.indexOf(mapping.product_name) : -1;
                                        const stockIdx = mapping.stock_qty ? headers.indexOf(mapping.stock_qty) : -1;
                                        const priceIdx = mapping.cost_price ? headers.indexOf(mapping.cost_price) : -1;
                                        const imgIdx = mapping.image_url ? headers.indexOf(mapping.image_url) : -1;
                                        const r = sampleRows[0] || [];
                                        return (
                                            <div className="font-mono break-all">
                                                <span className="font-bold">{codeIdx >= 0 ? r[codeIdx] : '?'}</span>
                                                {nameIdx >= 0 && <> · {r[nameIdx]}</>}
                                                {stockIdx >= 0 && <> · stock: {r[stockIdx]}</>}
                                                {priceIdx >= 0 && <> · cost: {r[priceIdx]}</>}
                                                {imgIdx >= 0 && r[imgIdx] && <> · img: {r[imgIdx].slice(0, 60)}{r[imgIdx].length > 60 ? '…' : ''}</>}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    )}

                    {headers.length > 0 && (
                        <label className="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} className="mt-0.5" />
                            <span className="text-xs text-gray-700">
                                <span className="font-bold">Replace existing {effectiveWholesaler || 'wholesaler'} rows</span>
                                <span className="text-gray-500 block mt-0.5">Recommended — clears old stock + price for this supplier so the feed is authoritative. Untick to merge into existing rows instead.</span>
                            </span>
                        </label>
                    )}

                    {error && <div className="bg-rose-50 border border-rose-200 rounded-lg p-2.5 text-xs text-rose-700 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> {error}</div>}
                    {success && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-700 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> {success}</div>}
                    {progress && (
                        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 text-xs text-indigo-700">
                            Uploading… {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                            <div className="mt-1.5 h-1 bg-white rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-600 transition-all" style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2 rounded-b-2xl">
                    <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-100">Cancel</button>
                    <button onClick={startUpload}
                        disabled={uploading || !file || !mapping.product_code || !effectiveWholesaler}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1.5">
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {uploading ? 'Uploading…' : 'Upload Feed'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WholesalerLookup;
