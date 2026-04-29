import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    PackageSearch, Search, Upload, Loader2, AlertTriangle, RefreshCw, X,
    CheckCircle2, FileSpreadsheet,
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
    feed_updated_at: string;
}

interface FreshnessRow {
    wholesaler: string;
    feed_updated_at: string;
    row_count: number;
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

// Header-name aliases used to auto-detect each column on CSV upload. Lower-cased
// substrings are tested in order — first match wins. Most UK wholesalers
// publish broadly similar feeds, so these defaults usually map straight
// through and the user only has to confirm.
const COLUMN_ALIASES: Record<string, string[]> = {
    product_code: ['code', 'sku', 'style', 'item code', 'product code', 'ref'],
    product_name: ['name', 'description', 'title', 'product', 'item'],
    brand: ['brand', 'manufacturer'],
    colour: ['colour', 'color', 'shade'],
    size: ['size'],
    stock_qty: ['stock', 'qty', 'quantity', 'available', 'on hand', 'in stock'],
    cost_price: ['cost', 'wholesale', 'trade', 'net price', 'price', 'unit price'],
    rrp: ['rrp', 'retail', 'srp', 'list'],
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
};

// CSV upload is chunked — Supabase / PostgREST happily accepts large bodies
// but per-request memory + timeout get unfriendly past ~2k rows in one go.
// 1000 keeps progress responsive and never trips the 50s function cap.
const UPSERT_CHUNK = 1000;

// ─── CSV parsing ────────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatRelative = (iso: string): string => {
    try {
        const ms = Date.now() - Date.parse(iso);
        if (!Number.isFinite(ms) || ms < 0) return '';
        const mins = Math.round(ms / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.round(hours / 24);
        return `${days}d ago`;
    } catch { return ''; }
};

const fmtMoney = (v: number | null, currency: string | null = 'GBP'): string => {
    if (v == null || !Number.isFinite(v)) return '—';
    const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£';
    return `${sym}${v.toFixed(2)}`;
};

const stockTone = (qty: number | null): string => {
    if (qty == null) return 'bg-slate-100 text-slate-600 border-slate-200';
    if (qty <= 0) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (qty < 50) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
};

// ─── Component ──────────────────────────────────────────────────────────────

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
    const [sortKey, setSortKey] = useState<'price' | 'stock' | 'wholesaler'>('price');

    const [uploadOpen, setUploadOpen] = useState(false);

    // Debounce search input — Supabase ilike is fast but pummelling it on every
    // keystroke is wasteful and the network blink is visible on slower wifi.
    useEffect(() => {
        const t = setTimeout(() => setDebounced(search.trim()), 220);
        return () => clearTimeout(t);
    }, [search]);

    const loadFreshness = useCallback(async () => {
        if (!isSupabaseReady()) return;
        try {
            // PostgREST doesn't do GROUP BY directly without a view, so we
            // settle for "newest row per wholesaler" by ordering desc and
            // sampling. A view would be cleaner if this ever gets heavy.
            const res = await supabaseFetch(
                'stash_wholesaler_prices?select=wholesaler,feed_updated_at&order=feed_updated_at.desc&limit=2000',
                'GET'
            );
            const rows: { wholesaler: string; feed_updated_at: string }[] = await res.json();
            const map = new Map<string, { feed_updated_at: string; count: number }>();
            for (const r of rows) {
                const cur = map.get(r.wholesaler);
                if (!cur) {
                    map.set(r.wholesaler, { feed_updated_at: r.feed_updated_at, count: 1 });
                } else {
                    cur.count += 1;
                    if (Date.parse(r.feed_updated_at) > Date.parse(cur.feed_updated_at)) {
                        cur.feed_updated_at = r.feed_updated_at;
                    }
                }
            }
            const list: FreshnessRow[] = Array.from(map.entries()).map(([wholesaler, v]) => ({
                wholesaler,
                feed_updated_at: v.feed_updated_at,
                row_count: v.count,
            })).sort((a, b) => a.wholesaler.localeCompare(b.wholesaler));
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
        const q = debounced;
        if (q.length < 2) {
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
                const term = escape(q);
                // PostgREST `or=` filter — match either code or name. ilike is
                // case-insensitive, * acts as % wildcard.
                let url = `stash_wholesaler_prices?select=*&or=(product_code.ilike.*${encodeURIComponent(term)}*,product_name.ilike.*${encodeURIComponent(term)}*)`;
                if (filterWholesaler !== 'all') {
                    url += `&wholesaler=eq.${encodeURIComponent(filterWholesaler)}`;
                }
                url += '&order=cost_price.asc.nullslast&limit=300';
                const res = await supabaseFetch(url, 'GET');
                if (cancelled) return;
                const rows: PriceRow[] = await res.json();
                setResults(Array.isArray(rows) ? rows : []);
                setResultLimited(Array.isArray(rows) && rows.length === 300);
            } catch (e: any) {
                if (!cancelled) setSearchError(e?.message || 'Search failed');
            } finally {
                if (!cancelled) setSearching(false);
            }
        })();
        return () => { cancelled = true; };
    }, [debounced, filterWholesaler]);

    // Group by product_code so each unique product gets one comparison block.
    const grouped = useMemo(() => {
        const groups = new Map<string, PriceRow[]>();
        for (const r of results) {
            const key = (r.product_code || 'unknown').trim().toLowerCase();
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
        }
        // Sort rows within each group by the chosen key, then return entries
        // sorted by group size desc (most-comparable products first).
        const sortFn = (a: PriceRow, b: PriceRow) => {
            if (sortKey === 'price') {
                const ap = a.cost_price ?? Infinity;
                const bp = b.cost_price ?? Infinity;
                return ap - bp;
            }
            if (sortKey === 'stock') {
                const as = a.stock_qty ?? -1;
                const bs = b.stock_qty ?? -1;
                return bs - as;
            }
            return a.wholesaler.localeCompare(b.wholesaler);
        };
        const list = Array.from(groups.entries()).map(([code, rows]) => ({
            code,
            rows: rows.slice().sort(sortFn),
            displayCode: rows[0]?.product_code || code,
            displayName: rows.map(r => r.product_name).find(Boolean) || '',
        }));
        list.sort((a, b) => b.rows.length - a.rows.length);
        return list;
    }, [results, sortKey]);

    // ─── Render ────────────────────────────────────────────────────────────

    return (
        <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                        <PackageSearch className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-gray-900">Wholesale Lookup</h1>
                        <p className="text-[11px] text-gray-500 mt-0.5">Type a code or product name to compare stock and price across every wholesaler at a glance.</p>
                    </div>
                </div>
                <div className="flex-1" />
                <button
                    onClick={() => setUploadOpen(true)}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 flex items-center gap-1.5 shadow-sm"
                    title="Upload a wholesaler stock/price CSV"
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

            {/* Freshness strip — one chip per wholesaler with last-uploaded timestamp */}
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

            {/* Search bar */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        autoFocus
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Type a code (e.g. GD64000) or product name…"
                        className="w-full pl-10 pr-9 py-2.5 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <select
                    value={filterWholesaler}
                    onChange={e => setFilterWholesaler(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    <option value="all">All Wholesalers</option>
                    {Array.from(new Set([...KNOWN_WHOLESALERS as readonly string[], ...freshness.map(f => f.wholesaler)])).sort().map(w => (
                        <option key={w} value={w}>{w}</option>
                    ))}
                </select>
                <select
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as 'price' | 'stock' | 'wholesaler')}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    <option value="price">Sort: cheapest first</option>
                    <option value="stock">Sort: most stock first</option>
                    <option value="wholesaler">Sort: by wholesaler</option>
                </select>
            </div>

            {/* Results */}
            <section className="space-y-3">
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

                {resultLimited && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Showing the first 300 matches — narrow your search to see fewer, more relevant results.
                    </div>
                )}

                {!searching && grouped.map(group => (
                    <article key={group.code} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                        <header className="px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-white border-b border-gray-100 flex items-center gap-3 flex-wrap">
                            <span className="font-mono text-sm font-bold text-indigo-700">{group.displayCode}</span>
                            {group.displayName && (
                                <span className="text-sm text-gray-600 truncate max-w-[60%]" title={group.displayName}>{group.displayName}</span>
                            )}
                            <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                {group.rows.length} wholesaler{group.rows.length === 1 ? '' : 's'}
                            </span>
                        </header>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                    <tr>
                                        <th className="text-left px-4 py-2">Wholesaler</th>
                                        <th className="text-left px-4 py-2">Code</th>
                                        <th className="text-left px-4 py-2">Variant</th>
                                        <th className="text-left px-4 py-2">Stock</th>
                                        <th className="text-right px-4 py-2">Cost</th>
                                        <th className="text-right px-4 py-2">RRP</th>
                                        <th className="text-right px-4 py-2">Updated</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {group.rows.map((r, idx) => {
                                        const isCheapest = idx === 0 && sortKey === 'price' && r.cost_price != null;
                                        return (
                                            <tr key={r.id} className={isCheapest ? 'bg-emerald-50/40' : 'hover:bg-gray-50'}>
                                                <td className="px-4 py-2">
                                                    <span className="font-bold text-gray-800">{r.wholesaler}</span>
                                                    {isCheapest && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-widest">Cheapest</span>}
                                                </td>
                                                <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.product_code}</td>
                                                <td className="px-4 py-2 text-gray-600">
                                                    {[r.colour, r.size].filter(Boolean).join(' · ') || <span className="text-gray-300">—</span>}
                                                </td>
                                                <td className="px-4 py-2">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${stockTone(r.stock_qty)}`}>
                                                        {r.stock_qty == null ? 'n/a' : r.stock_qty.toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-right font-bold tabular-nums">{fmtMoney(r.cost_price, r.currency)}</td>
                                                <td className="px-4 py-2 text-right text-gray-500 tabular-nums">{fmtMoney(r.rrp, r.currency)}</td>
                                                <td className="px-4 py-2 text-right text-[11px] text-gray-400" title={new Date(r.feed_updated_at).toLocaleString('en-GB')}>
                                                    {formatRelative(r.feed_updated_at)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </article>
                ))}
            </section>

            {/* Upload modal */}
            {uploadOpen && (
                <UploadModal
                    onClose={() => setUploadOpen(false)}
                    onUploaded={() => { loadFreshness(); }}
                />
            )}
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
        stock_qty: '', cost_price: '', rrp: '',
    });
    const [replaceExisting, setReplaceExisting] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const effectiveWholesaler = wholesaler === '__custom__' ? customWholesaler.trim() : wholesaler;

    const onPickFile = (f: File) => {
        setFile(f);
        setError(null);
        setSuccess(null);
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || '');
            const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
            if (lines.length === 0) {
                setError('CSV is empty');
                return;
            }
            const hdrs = parseCsvLine(lines[0] || '');
            setHeaders(hdrs);
            setSampleRows(lines.slice(1, 4).map(l => parseCsvLine(l)));

            // Auto-detect column mappings from header names
            const auto: Record<string, string> = {
                product_code: '', product_name: '', brand: '', colour: '', size: '',
                stock_qty: '', cost_price: '', rrp: '',
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
        };
        reader.onerror = () => setError('Could not read CSV file');
        reader.readAsText(f);
    };

    const startUpload = async () => {
        if (!file) { setError('Pick a CSV first.'); return; }
        if (!effectiveWholesaler) { setError('Choose a wholesaler.'); return; }
        if (!mapping.product_code) { setError('Map the Product Code column — that\'s the only required field.'); return; }
        if (!isSupabaseReady()) { setError('Supabase not configured.'); return; }

        setUploading(true);
        setError(null);
        setSuccess(null);
        setProgress({ done: 0, total: 0 });
        try {
            const text = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('Read failed'));
                reader.readAsText(file);
            });

            const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
            if (lines.length < 2) {
                setError('CSV has no data rows.');
                setUploading(false);
                return;
            }
            const hdrs = parseCsvLine(lines[0] || '');
            const idx: Record<string, number> = {};
            for (const [field, hdr] of Object.entries(mapping)) {
                idx[field] = hdr ? hdrs.indexOf(hdr) : -1;
            }

            const now = new Date().toISOString();
            const rows: any[] = [];
            for (let i = 1; i < lines.length; i++) {
                const cells = parseCsvLine(lines[i] || '');
                const code = idx.product_code >= 0 ? cells[idx.product_code] : '';
                if (!code) continue; // skip rows without a code
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
                    currency: 'GBP',
                    feed_updated_at: now,
                });
            }

            if (rows.length === 0) {
                setError('No usable rows found. Check the Product Code column mapping.');
                setUploading(false);
                return;
            }

            // Optionally clear existing rows for this wholesaler so the feed is
            // an authoritative replacement and we don't leave stale stock around.
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
            // Reset the form so a second upload starts clean.
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
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700"><FileSpreadsheet className="w-5 h-5" /></div>
                    <div>
                        <h2 className="font-black uppercase tracking-widest text-sm text-gray-900">Upload Wholesaler Feed</h2>
                        <p className="text-[11px] text-gray-500 mt-0.5">CSV from your supplier portal — we'll auto-detect the columns.</p>
                    </div>
                    <button onClick={onClose} className="ml-auto p-1.5 rounded hover:bg-gray-100 text-gray-500"><X className="w-4 h-4" /></button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Wholesaler picker */}
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Wholesaler</label>
                        <div className="flex flex-wrap gap-1.5">
                            {KNOWN_WHOLESALERS.map(w => (
                                <button
                                    key={w}
                                    type="button"
                                    onClick={() => setWholesaler(w)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${
                                        wholesaler === w
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    {w}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setWholesaler('__custom__')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${
                                    wholesaler === '__custom__'
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                Other…
                            </button>
                        </div>
                        {wholesaler === '__custom__' && (
                            <input
                                type="text"
                                value={customWholesaler}
                                onChange={e => setCustomWholesaler(e.target.value)}
                                placeholder="Wholesaler name"
                                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        )}
                    </div>

                    {/* File picker */}
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">CSV file</label>
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600">
                            <Upload className="w-4 h-4" />
                            <span>{file ? file.name : 'Pick a CSV file…'}</span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv,text/csv"
                                className="hidden"
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) onPickFile(f);
                                }}
                            />
                        </label>
                    </div>

                    {/* Column mapping */}
                    {headers.length > 0 && (
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Column mapping</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {Object.keys(FIELD_LABELS).map(field => (
                                    <div key={field} className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-gray-600 w-28 shrink-0">{FIELD_LABELS[field]}</label>
                                        <select
                                            value={mapping[field]}
                                            onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                                            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
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
                                        const r = sampleRows[0] || [];
                                        return (
                                            <div className="font-mono">
                                                <span className="font-bold">{codeIdx >= 0 ? r[codeIdx] : '?'}</span>
                                                {nameIdx >= 0 && <> · {r[nameIdx]}</>}
                                                {stockIdx >= 0 && <> · stock: {r[stockIdx]}</>}
                                                {priceIdx >= 0 && <> · cost: {r[priceIdx]}</>}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Replace toggle */}
                    {headers.length > 0 && (
                        <label className="flex items-start gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={replaceExisting}
                                onChange={e => setReplaceExisting(e.target.checked)}
                                className="mt-0.5"
                            />
                            <span className="text-xs text-gray-700">
                                <span className="font-bold">Replace existing {effectiveWholesaler || 'wholesaler'} rows</span>
                                <span className="text-gray-500 block mt-0.5">Recommended — clears old stock + price for this supplier so the feed is authoritative. Untick to merge into existing rows instead.</span>
                            </span>
                        </label>
                    )}

                    {/* Status */}
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

                {/* Footer */}
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2 rounded-b-2xl">
                    <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-100">Cancel</button>
                    <button
                        onClick={startUpload}
                        disabled={uploading || !file || !mapping.product_code || !effectiveWholesaler}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {uploading ? 'Uploading…' : 'Upload Feed'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WholesalerLookup;
