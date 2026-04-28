import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ClipboardList, Plus, Loader2, AlertTriangle, CheckCircle2, RefreshCw,
    Image as ImageIcon, X, Search, ChevronDown, ChevronUp, Trash2, Download
} from 'lucide-react';
import { isSupabaseReady, supabaseFetch } from '../services/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

type RequestType = 'new_product' | 'missing_decoration' | 'amend_decoration' | 'price_update' | 'other';
type IssueStatus = 'open' | 'done';

interface Issue {
    id: number;
    created_at: string;
    created_by: string | null;
    requester_name: string | null;
    request_type: RequestType;
    description: string;
    screenshot: string | null;
    status: IssueStatus;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_notes: string | null;
    updated_at: string;
}

interface Props {
    currentUser: { name: string; email: string };
}

// ─── Static config ──────────────────────────────────────────────────────────

const REQUEST_TYPES: { value: RequestType; label: string; tone: string }[] = [
    { value: 'new_product',         label: 'New Product',         tone: 'bg-blue-50 text-blue-700 border-blue-200' },
    { value: 'missing_decoration',  label: 'Missing Decoration',  tone: 'bg-rose-50 text-rose-700 border-rose-200' },
    { value: 'amend_decoration',    label: 'Amend Decoration',    tone: 'bg-amber-50 text-amber-700 border-amber-200' },
    { value: 'price_update',        label: 'Price Update',        tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { value: 'other',               label: 'Other',               tone: 'bg-slate-100 text-slate-700 border-slate-200' },
];

// Image compression — production team often takes phone photos that arrive
// as 4-8MB HEIC/JPEG files. We resize to max 1600px on the long edge and
// re-encode as JPEG @ 0.82 quality, which keeps almost every screenshot
// under ~400 KB. Anything over the cap below is rejected outright.
const MAX_IMAGE_BYTES = 750 * 1024; // post-compression ceiling
const MAX_IMAGE_DIMENSION = 1600;

const compressImage = async (file: File): Promise<string> => {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error('Could not read that image');

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Two passes: try 0.82 first, drop to 0.65 if still too big.
    let dataUri = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUri.length * 0.75 > MAX_IMAGE_BYTES) {
        dataUri = canvas.toDataURL('image/jpeg', 0.65);
    }
    if (dataUri.length * 0.75 > MAX_IMAGE_BYTES) {
        throw new Error('Image too large even after compression — try a smaller crop');
    }
    return dataUri;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const typeMeta = (t: RequestType) => REQUEST_TYPES.find(r => r.value === t) || REQUEST_TYPES[REQUEST_TYPES.length - 1];

const formatRelative = (iso: string): string => {
    try {
        const d = new Date(iso);
        const diffMs = Date.now() - d.getTime();
        const mins = Math.round(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.round(hours / 24);
        if (days < 7) return `${days}d ago`;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
};

const formatFull = (iso: string): string => {
    try {
        const d = new Date(iso);
        return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
};

// ─── Component ──────────────────────────────────────────────────────────────

const ProductionIssueLog: React.FC<Props> = ({ currentUser }) => {
    const [issues, setIssues] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<'open' | 'done' | 'all'>('open');
    const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all');
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState<number | null>(null);

    // Form state
    const [formOpen, setFormOpen] = useState(true);
    const [name, setName] = useState(currentUser.name || '');
    const [requestType, setRequestType] = useState<RequestType>('missing_decoration');
    const [description, setDescription] = useState('');
    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [imageError, setImageError] = useState<string | null>(null);
    const [imageBusy, setImageBusy] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitFlash, setSubmitFlash] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Loading ──
    const loadIssues = useCallback(async () => {
        if (!isSupabaseReady()) {
            setLoadError('Supabase isn\'t configured — issue log unavailable.');
            setLoading(false);
            return;
        }
        setLoading(true);
        setLoadError(null);
        try {
            const res = await supabaseFetch(
                'stash_production_issues?select=*&order=created_at.desc&limit=500',
                'GET'
            );
            const rows = await res.json();
            setIssues(Array.isArray(rows) ? rows : []);
        } catch (e: any) {
            setLoadError(e?.message || 'Failed to load issues');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadIssues(); }, [loadIssues]);

    // ── Submit ──
    const handleFile = async (file: File) => {
        setImageError(null);
        setImageBusy(true);
        try {
            const dataUri = await compressImage(file);
            setScreenshot(dataUri);
        } catch (e: any) {
            setImageError(e?.message || 'Could not attach image');
        } finally {
            setImageBusy(false);
        }
    };

    const submitIssue = async () => {
        if (!description.trim()) {
            setSubmitError('Add a short description before submitting.');
            return;
        }
        if (!isSupabaseReady()) {
            setSubmitError('Supabase isn\'t configured — can\'t save.');
            return;
        }
        setSubmitting(true);
        setSubmitError(null);
        setSubmitFlash(null);
        try {
            const payload = {
                created_by: currentUser.email || null,
                requester_name: name.trim() || currentUser.name || null,
                request_type: requestType,
                description: description.trim(),
                screenshot: screenshot,
                status: 'open' as const,
            };
            const res = await supabaseFetch(
                'stash_production_issues',
                'POST',
                payload,
                'return=representation'
            );
            const rows = await res.json();
            const newRow = Array.isArray(rows) ? rows[0] : null;
            if (newRow) {
                setIssues(prev => [newRow, ...prev]);
            } else {
                // Fallback — refetch if Postgres didn't echo the row.
                loadIssues();
            }
            // Reset form (keep name, drop the rest)
            setDescription('');
            setScreenshot(null);
            setRequestType('missing_decoration');
            if (fileInputRef.current) fileInputRef.current.value = '';
            setSubmitFlash('Logged — thanks!');
            window.setTimeout(() => setSubmitFlash(null), 3500);
        } catch (e: any) {
            setSubmitError(e?.message || 'Failed to log issue');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Mark done / reopen ──
    const updateStatus = async (id: number, status: IssueStatus, notes?: string) => {
        try {
            const patch: Record<string, any> = { status };
            if (status === 'done') {
                patch.resolved_at = new Date().toISOString();
                patch.resolved_by = currentUser.email || currentUser.name || null;
                if (notes && notes.trim()) patch.resolution_notes = notes.trim();
            } else {
                patch.resolved_at = null;
                patch.resolved_by = null;
                patch.resolution_notes = null;
            }
            await supabaseFetch(`stash_production_issues?id=eq.${id}`, 'PATCH', patch);
            setIssues(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
        } catch (e: any) {
            alert(`Couldn't update issue: ${e?.message || 'unknown error'}`);
        }
    };

    const deleteIssue = async (id: number) => {
        if (!confirm('Delete this issue permanently? This can\'t be undone.')) return;
        try {
            await supabaseFetch(`stash_production_issues?id=eq.${id}`, 'DELETE');
            setIssues(prev => prev.filter(i => i.id !== id));
            if (expandedId === id) setExpandedId(null);
        } catch (e: any) {
            alert(`Couldn't delete: ${e?.message || 'unknown error'}`);
        }
    };

    // ── Filtering ──
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return issues.filter(i => {
            if (statusFilter !== 'all' && i.status !== statusFilter) return false;
            if (typeFilter !== 'all' && i.request_type !== typeFilter) return false;
            if (q) {
                const hay = [i.description, i.requester_name, i.created_by, i.resolution_notes]
                    .filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [issues, statusFilter, typeFilter, search]);

    const counts = useMemo(() => ({
        open: issues.filter(i => i.status === 'open').length,
        done: issues.filter(i => i.status === 'done').length,
        total: issues.length,
    }), [issues]);

    // ── CSV export — useful for the weekly cleanup pass ──
    const exportCsv = () => {
        const rows = filtered.map(i => ({
            id: i.id,
            logged: formatFull(i.created_at),
            name: i.requester_name || i.created_by || '',
            type: typeMeta(i.request_type).label,
            description: i.description,
            status: i.status,
            resolved_at: i.resolved_at ? formatFull(i.resolved_at) : '',
            resolved_by: i.resolved_by || '',
            resolution_notes: i.resolution_notes || '',
            has_screenshot: i.screenshot ? 'yes' : 'no',
        }));
        if (rows.length === 0) return;
        const headers = Object.keys(rows[0]);
        const escape = (v: any) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape((r as any)[h])).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `production-issues-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ─── Render ────────────────────────────────────────────────────────────

    return (
        <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                        <ClipboardList className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-gray-900">Issue Log</h1>
                        <p className="text-[11px] text-gray-500 mt-0.5">Production team flags missing/incorrect product info, decoration areas, sizes & prices.</p>
                    </div>
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
                    <span className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200">{counts.open} Open</span>
                    <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{counts.done} Done</span>
                </div>
                <button
                    onClick={loadIssues}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
                    title="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* New request form */}
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <button
                    type="button"
                    onClick={() => setFormOpen(o => !o)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-gray-100"
                >
                    <span className="p-1.5 rounded bg-indigo-600 text-white"><Plus className="w-4 h-4" /></span>
                    <span className="font-black uppercase tracking-widest text-xs text-gray-800">New Request</span>
                    <span className="text-[10px] text-gray-500 font-medium normal-case tracking-normal hidden sm:inline">— Log missing/wrong product info or decoration</span>
                    <span className="ml-auto">{formOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}</span>
                </button>

                {formOpen && (
                    <div className="p-4 space-y-3">
                        {/* Row 1: name + type */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Your name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Who's logging this?"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Type of request</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {REQUEST_TYPES.map(t => (
                                        <button
                                            key={t.value}
                                            type="button"
                                            onClick={() => setRequestType(t.value)}
                                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-all ${
                                                requestType === t.value
                                                    ? `${t.tone} ring-2 ring-offset-1 ring-indigo-400`
                                                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                            }`}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="e.g. Castleford U13 badge is too small on the back of the shirt — needs to be 2x bigger."
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">Include product name, decoration area, size — whatever helps the back-end fix it.</p>
                        </div>

                        {/* Screenshot */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Screenshot (optional)</label>
                            {screenshot ? (
                                <div className="relative inline-block">
                                    <img
                                        src={screenshot}
                                        alt="Screenshot preview"
                                        className="max-h-40 rounded-lg border border-gray-200 shadow-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setScreenshot(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                        className="absolute -top-2 -right-2 bg-rose-600 text-white rounded-full p-1 shadow"
                                        title="Remove screenshot"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ) : (
                                <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600">
                                    {imageBusy
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <ImageIcon className="w-4 h-4" />}
                                    <span>{imageBusy ? 'Compressing…' : 'Attach screenshot'}</span>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={e => {
                                            const f = e.target.files?.[0];
                                            if (f) handleFile(f);
                                        }}
                                    />
                                </label>
                            )}
                            {imageError && <p className="mt-1 text-[11px] text-rose-600">{imageError}</p>}
                        </div>

                        {/* Submit row */}
                        <div className="flex items-center gap-3 pt-1">
                            <button
                                type="button"
                                onClick={submitIssue}
                                disabled={submitting || !description.trim()}
                                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                            >
                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                {submitting ? 'Logging…' : 'Log Request'}
                            </button>
                            {submitError && <span className="text-xs text-rose-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {submitError}</span>}
                            {submitFlash && <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {submitFlash}</span>}
                        </div>
                    </div>
                )}
            </section>

            {/* Filters */}
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
                    {(['open', 'done', 'all'] as const).map(s => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-widest transition-all ${
                                statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {s === 'open' ? `Open (${counts.open})` : s === 'done' ? `Done (${counts.done})` : `All (${counts.total})`}
                        </button>
                    ))}
                </div>
                <select
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value as RequestType | 'all')}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    <option value="all">All Types</option>
                    {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search description, name…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <button
                    onClick={exportCsv}
                    disabled={filtered.length === 0}
                    className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs font-bold uppercase tracking-widest flex items-center gap-1.5"
                    title="Download filtered list as CSV"
                >
                    <Download className="w-3.5 h-3.5" /> CSV
                </button>
            </section>

            {/* List */}
            <section className="space-y-2">
                {loading && (
                    <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm">Loading issues…</span>
                    </div>
                )}

                {!loading && loadError && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700 text-sm flex items-start gap-2">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-bold">Couldn't load the issue log.</p>
                            <p className="mt-1 text-rose-600">{loadError}</p>
                        </div>
                    </div>
                )}

                {!loading && !loadError && filtered.length === 0 && (
                    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">
                        <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <p className="font-bold text-gray-700">Nothing here.</p>
                        <p className="text-xs mt-1">
                            {statusFilter === 'open' ? 'No open issues — production team is happy.' : 'No issues match the current filters.'}
                        </p>
                    </div>
                )}

                {!loading && !loadError && filtered.map(issue => {
                    const meta = typeMeta(issue.request_type);
                    const isExpanded = expandedId === issue.id;
                    return (
                        <article
                            key={issue.id}
                            className={`bg-white border rounded-xl shadow-sm transition-all ${
                                issue.status === 'done' ? 'border-gray-200 opacity-75' : 'border-gray-200 hover:border-indigo-300 hover:shadow-md'
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                                className="w-full text-left p-3 sm:p-4 flex items-start gap-3"
                            >
                                <span className={`shrink-0 mt-0.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${meta.tone}`}>
                                    {meta.label}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${issue.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                                        {issue.description}
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                        <span className="font-medium text-gray-600">{issue.requester_name || issue.created_by || 'Unknown'}</span>
                                        <span title={formatFull(issue.created_at)}>{formatRelative(issue.created_at)}</span>
                                        {issue.screenshot && <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> screenshot</span>}
                                        {issue.status === 'done' && issue.resolved_at && (
                                            <span className="text-emerald-600 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Done {formatRelative(issue.resolved_at)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <span className="shrink-0 mt-0.5">
                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                </span>
                            </button>

                            {isExpanded && (
                                <div className="border-t border-gray-100 p-3 sm:p-4 space-y-3 bg-gray-50/50">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Logged</div>
                                            <div className="text-gray-700">{formatFull(issue.created_at)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">By</div>
                                            <div className="text-gray-700">{issue.requester_name || '—'}{issue.created_by && issue.created_by !== issue.requester_name && <span className="text-gray-400"> · {issue.created_by}</span>}</div>
                                        </div>
                                        {issue.status === 'done' && (
                                            <>
                                                <div>
                                                    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Resolved</div>
                                                    <div className="text-gray-700">{issue.resolved_at ? formatFull(issue.resolved_at) : '—'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Resolved by</div>
                                                    <div className="text-gray-700">{issue.resolved_by || '—'}</div>
                                                </div>
                                                {issue.resolution_notes && (
                                                    <div className="sm:col-span-2">
                                                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Notes</div>
                                                        <div className="text-gray-700 whitespace-pre-wrap">{issue.resolution_notes}</div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {issue.screenshot && (
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Screenshot</div>
                                            <a href={issue.screenshot} target="_blank" rel="noopener noreferrer">
                                                <img
                                                    src={issue.screenshot}
                                                    alt="Issue screenshot"
                                                    className="max-h-80 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                                                />
                                            </a>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        {issue.status === 'open' ? (
                                            <button
                                                onClick={() => {
                                                    const notes = window.prompt('Resolution notes (optional):', '') || '';
                                                    updateStatus(issue.id, 'done', notes);
                                                }}
                                                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 flex items-center gap-1.5"
                                            >
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Mark Done
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => updateStatus(issue.id, 'open')}
                                                className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold uppercase tracking-widest hover:bg-amber-200 flex items-center gap-1.5"
                                            >
                                                <RefreshCw className="w-3.5 h-3.5" /> Reopen
                                            </button>
                                        )}
                                        <button
                                            onClick={() => deleteIssue(issue.id)}
                                            className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 text-[11px] font-bold uppercase tracking-widest hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 flex items-center gap-1.5"
                                            title="Delete this issue"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </article>
                    );
                })}
            </section>
        </div>
    );
};

export default ProductionIssueLog;
