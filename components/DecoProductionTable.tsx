import React, { useState, useMemo } from 'react';
import type { DecoJob, DecoItem } from '../types';
import { Scissors, Timer, Hash, ChevronDown, ChevronUp, Search, Filter } from 'lucide-react';

/* ---------- Production time estimation ---------- */
const STITCHES_PER_MIN = 600;
const HEADS_MULTI = 6;
const BIG_RUN_THRESHOLD = 6;
const SETUP_BUFFER = 1.15;
const DEFAULT_TIMES: Record<string, number> = {
    DTF: 2, FLEX: 2, TRANSFER: 2, SCREEN: 1, UV: 3, VINYL: 2,
    SUBLIMATION: 2, DTG: 3, FREEFORM: 5, NONE: 0,
};

interface ProductionEstimate {
    totalMinutes: number;
    machineType: 'single' | '6-head';
    stitchesPerItem: number;
    totalStitches: number;
    isEmbroidery: boolean;
}

function estimateProductionTime(items: DecoItem[]): ProductionEstimate {
    let totalStitches = 0;
    let totalQty = 0;
    let stitchesPerItem = 0;
    let hasEmbroidery = false;
    let nonEmbMinutes = 0;

    items.forEach(item => {
        totalQty += item.quantity;
        if (item.stitchCount && item.stitchCount > 0) {
            hasEmbroidery = true;
            totalStitches += item.stitchCount * item.quantity;
            stitchesPerItem = Math.max(stitchesPerItem, item.stitchCount);
        } else {
            const dt = item.decorationType || '';
            const perItem = DEFAULT_TIMES[dt] ?? 3;
            nonEmbMinutes += perItem * item.quantity;
        }
    });

    if (hasEmbroidery) {
        const heads = totalQty >= BIG_RUN_THRESHOLD ? HEADS_MULTI : 1;
        const runs = Math.ceil(totalQty / heads);
        const minsPerRun = stitchesPerItem / STITCHES_PER_MIN;
        const rawMinutes = runs * minsPerRun;
        const totalMinutes = Math.ceil((rawMinutes + nonEmbMinutes) * SETUP_BUFFER);
        return { totalMinutes, machineType: heads === HEADS_MULTI ? '6-head' : 'single', stitchesPerItem, totalStitches, isEmbroidery: true };
    }

    return { totalMinutes: Math.ceil(nonEmbMinutes * SETUP_BUFFER), machineType: 'single', stitchesPerItem: 0, totalStitches: 0, isEmbroidery: false };
}

function fmtTime(minutes: number): string {
    if (minutes <= 0) return '—';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtStitches(n: number): string {
    if (n <= 0) return '—';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString();
}

function fmtK(n: number) {
    if (n >= 1000) return '£' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '£' + n.toFixed(2);
}

function fmtDate(d: string | undefined) {
    if (!d) return '—';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function daysBetween(a: Date, b: Date): number {
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

const DECO_BADGE: Record<string, { bg: string; text: string }> = {
    EMB: { bg: 'bg-purple-500/20 border-purple-500/30', text: 'text-purple-300' },
    DTF: { bg: 'bg-cyan-500/20 border-cyan-500/30', text: 'text-cyan-300' },
    FLEX: { bg: 'bg-amber-500/20 border-amber-500/30', text: 'text-amber-300' },
    TRANSFER: { bg: 'bg-orange-500/20 border-orange-500/30', text: 'text-orange-300' },
    UV: { bg: 'bg-blue-500/20 border-blue-500/30', text: 'text-blue-300' },
    SCREEN: { bg: 'bg-green-500/20 border-green-500/30', text: 'text-green-300' },
    FREEFORM: { bg: 'bg-rose-500/20 border-rose-500/30', text: 'text-rose-300' },
    VINYL: { bg: 'bg-teal-500/20 border-teal-500/30', text: 'text-teal-300' },
    SUBLIMATION: { bg: 'bg-pink-500/20 border-pink-500/30', text: 'text-pink-300' },
    DTG: { bg: 'bg-indigo-500/20 border-indigo-500/30', text: 'text-indigo-300' },
    NONE: { bg: 'bg-gray-500/20 border-gray-500/30', text: 'text-gray-400' },
};

const getDecoBadge = (type: string | undefined) => {
    if (!type) return { bg: 'bg-white/5 border-white/10', text: 'text-white/30' };
    return DECO_BADGE[type] || { bg: 'bg-white/10 border-white/20', text: 'text-white/60' };
};

const STATUS_BADGE: Record<string, string> = {
    'Order': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'Production': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    'In Production': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    'Awaiting Processing': 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    'Awaiting Stock': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'Awaiting Artwork': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    'Awaiting Review': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    'Awaiting PO': 'bg-red-500/20 text-red-300 border-red-500/30',
    'Not Ordered': 'bg-red-500/20 text-red-300 border-red-500/30',
    'Ready for Shipping': 'bg-green-500/20 text-green-300 border-green-500/30',
    'Completed': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    'Shipped': 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    'On Hold': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    'Cancelled': 'bg-red-500/10 text-red-400/60 border-red-500/20',
};

type SortKey = 'due' | 'value' | 'time' | 'pph' | 'stitches' | 'status' | 'ordered' | 'customer';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'active' | 'all' | 'production' | 'awaiting';

interface Props {
    decoJobs: DecoJob[];
    onNavigateToOrder: (orderNum: string) => void;
}

export default function DecoProductionTable({ decoJobs, onNavigateToOrder }: Props) {
    const [sortKey, setSortKey] = useState<SortKey>('due');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedJob, setExpandedJob] = useState<string | null>(null);

    const now = useMemo(() => new Date(), []);

    const EXCLUDED_STATUSES = new Set(['Shipped', 'Completed', 'Cancelled']);
    const PRODUCTION_STATUSES = new Set(['In Production', 'Production', 'Order']);
    const AWAITING_STATUSES = new Set(['Awaiting Stock', 'Awaiting Artwork', 'Awaiting Review', 'Awaiting Processing', 'Awaiting PO', 'Not Ordered', 'On Hold']);

    const enrichedJobs = useMemo(() => {
        return decoJobs.map(job => {
            const est = estimateProductionTime(job.items);
            const totalQty = job.items.reduce((a, i) => a + i.quantity, 0);
            const jobValue = job.orderTotal || job.billableAmount || 0;
            const estHours = est.totalMinutes / 60;
            const poundPerHour = estHours > 0 && jobValue > 0 ? jobValue / estHours : 0;
            const decoTypes = Array.from(new Set(job.items.map(i => i.decorationType).filter(Boolean))) as string[];
            const dueDate = job.dateDue ? new Date(job.dateDue) : null;
            const daysUntilDue = dueDate ? daysBetween(now, dueDate) : null;
            const orderedDate = job.dateOrdered ? new Date(job.dateOrdered) : null;
            const daysInProd = orderedDate ? daysBetween(orderedDate, now) : null;
            return { ...job, est, totalQty, jobValue, poundPerHour, decoTypes, daysUntilDue, daysInProd };
        });
    }, [decoJobs, now]);

    const filtered = useMemo(() => {
        let list = enrichedJobs;

        // Status filter
        if (statusFilter === 'active') list = list.filter(j => !EXCLUDED_STATUSES.has(j.status));
        else if (statusFilter === 'production') list = list.filter(j => PRODUCTION_STATUSES.has(j.status));
        else if (statusFilter === 'awaiting') list = list.filter(j => AWAITING_STATUSES.has(j.status));

        // Search
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            list = list.filter(j =>
                j.jobNumber.includes(s) ||
                j.customerName.toLowerCase().includes(s) ||
                j.jobName.toLowerCase().includes(s) ||
                j.decoTypes.some(t => t.toLowerCase().includes(s))
            );
        }

        // Sort
        list = [...list].sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
                case 'due': cmp = (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999); break;
                case 'value': cmp = b.jobValue - a.jobValue; break;
                case 'time': cmp = b.est.totalMinutes - a.est.totalMinutes; break;
                case 'pph': cmp = b.poundPerHour - a.poundPerHour; break;
                case 'stitches': cmp = b.est.totalStitches - a.est.totalStitches; break;
                case 'status': cmp = a.status.localeCompare(b.status); break;
                case 'ordered': cmp = (a.daysInProd ?? 0) - (b.daysInProd ?? 0); break;
                case 'customer': cmp = a.customerName.localeCompare(b.customerName); break;
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });

        return list;
    }, [enrichedJobs, statusFilter, searchTerm, sortKey, sortDir]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir(key === 'due' || key === 'ordered' ? 'asc' : 'desc'); }
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ChevronDown className="w-3 h-3 text-white/15" />;
        return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-indigo-400" /> : <ChevronDown className="w-3 h-3 text-indigo-400" />;
    };

    // Summary stats
    const totalValue = filtered.reduce((a, j) => a + j.jobValue, 0);
    const totalMinutes = filtered.reduce((a, j) => a + j.est.totalMinutes, 0);
    const totalStitchesAll = filtered.reduce((a, j) => a + j.est.totalStitches, 0);
    const embCount = filtered.filter(j => j.decoTypes.includes('EMB')).length;
    const dtfCount = filtered.filter(j => j.decoTypes.includes('DTF')).length;
    const flexCount = filtered.filter(j => j.decoTypes.includes('FLEX')).length;

    return (
        <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-indigo-400" />
                            DECO PRODUCTION JOBS
                        </h2>
                        <p className="text-[10px] text-white/40 mt-0.5">
                            {filtered.length} jobs &middot; {fmtK(totalValue)} pipeline &middot; {fmtTime(totalMinutes)} total est.
                            {totalStitchesAll > 0 && <> &middot; {fmtStitches(totalStitchesAll)} stitches</>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 text-white/30 absolute left-2 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                placeholder="Search jobs..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-[10px] text-white placeholder-white/30 w-40 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                            />
                        </div>
                    </div>
                </div>
                {/* Type summary badges */}
                <div className="flex flex-wrap gap-2 mt-3">
                    {[
                        { label: 'Active', key: 'active' as StatusFilter, count: enrichedJobs.filter(j => !EXCLUDED_STATUSES.has(j.status)).length },
                        { label: 'In Production', key: 'production' as StatusFilter, count: enrichedJobs.filter(j => PRODUCTION_STATUSES.has(j.status)).length },
                        { label: 'Awaiting', key: 'awaiting' as StatusFilter, count: enrichedJobs.filter(j => AWAITING_STATUSES.has(j.status)).length },
                        { label: 'All', key: 'all' as StatusFilter, count: enrichedJobs.length },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setStatusFilter(f.key)}
                            className={`px-2.5 py-1 rounded-lg text-[9px] font-bold tracking-wider uppercase transition-all ${
                                statusFilter === f.key
                                    ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                                    : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                            }`}
                        >
                            {f.label} ({f.count})
                        </button>
                    ))}
                    <div className="w-px h-5 bg-white/10 mx-1 self-center" />
                    {embCount > 0 && <span className="px-2 py-0.5 rounded border text-[8px] font-black uppercase bg-purple-500/20 border-purple-500/30 text-purple-300">{embCount} EMB</span>}
                    {dtfCount > 0 && <span className="px-2 py-0.5 rounded border text-[8px] font-black uppercase bg-cyan-500/20 border-cyan-500/30 text-cyan-300">{dtfCount} DTF</span>}
                    {flexCount > 0 && <span className="px-2 py-0.5 rounded border text-[8px] font-black uppercase bg-amber-500/20 border-amber-500/30 text-amber-300">{flexCount} FLEX</span>}
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-[10px]">
                    <thead>
                        <tr className="border-b border-white/10 text-white/30 font-bold uppercase tracking-widest text-[9px]">
                            <th className="px-3 py-2.5 w-20 cursor-pointer hover:text-white/60" onClick={() => toggleSort('due')}>
                                <span className="flex items-center gap-1">Job <SortIcon col="due" /></span>
                            </th>
                            <th className="px-3 py-2.5 cursor-pointer hover:text-white/60" onClick={() => toggleSort('customer')}>
                                <span className="flex items-center gap-1">Customer / Job <SortIcon col="customer" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-20 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('status')}>
                                <span className="flex items-center gap-1 justify-center">Status <SortIcon col="status" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-16 text-center">Type</th>
                            <th className="px-3 py-2.5 w-14 text-center">Qty</th>
                            <th className="px-3 py-2.5 w-20 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('stitches')}>
                                <span className="flex items-center gap-1 justify-center">Stitches <SortIcon col="stitches" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-16 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('time')}>
                                <span className="flex items-center gap-1 justify-center">Est. <SortIcon col="time" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-16 text-center">Machine</th>
                            <th className="px-3 py-2.5 w-16 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('ordered')}>
                                <span className="flex items-center gap-1 justify-center">Age <SortIcon col="ordered" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-16 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('due')}>
                                <span className="flex items-center gap-1 justify-center">Due <SortIcon col="due" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-16 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('value')}>
                                <span className="flex items-center gap-1 justify-center">Value <SortIcon col="value" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-16 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('pph')}>
                                <span className="flex items-center gap-1 justify-center">£/hr <SortIcon col="pph" /></span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {filtered.length === 0 && (
                            <tr><td colSpan={12} className="px-5 py-8 text-center text-white/30 text-xs">No jobs match this filter.</td></tr>
                        )}
                        {filtered.map(job => {
                            const isExpanded = expandedJob === job.id;
                            const statusClass = STATUS_BADGE[job.status] || 'bg-white/10 text-white/50 border-white/20';
                            const dueColor = job.daysUntilDue !== null
                                ? job.daysUntilDue < 0 ? 'text-red-400 font-bold' : job.daysUntilDue <= 3 ? 'text-amber-400 font-bold' : 'text-white/50'
                                : 'text-white/20';
                            const ageColor = job.daysInProd !== null
                                ? job.daysInProd >= 14 ? 'text-red-400 font-bold' : job.daysInProd >= 7 ? 'text-orange-400 font-bold' : 'text-white/50'
                                : 'text-white/20';
                            const pphColor = job.poundPerHour >= 50 ? 'text-emerald-400 font-bold' : job.poundPerHour >= 25 ? 'text-amber-400' : job.poundPerHour > 0 ? 'text-red-400' : 'text-white/20';

                            return (
                                <React.Fragment key={job.id}>
                                    <tr
                                        className="hover:bg-white/5 cursor-pointer transition-colors"
                                        onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                                    >
                                        <td className="px-3 py-2.5">
                                            <span className="text-[10px] font-mono text-indigo-400/70">#{job.jobNumber}</span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="text-xs text-white/80 font-bold truncate max-w-[200px]">{job.customerName}</div>
                                            <div className="text-[9px] text-white/30 truncate max-w-[200px]">{job.jobName}</div>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase border ${statusClass}`}>{job.status}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <div className="flex flex-wrap gap-0.5 justify-center">
                                                {job.decoTypes.length > 0 ? job.decoTypes.map(t => {
                                                    const b = getDecoBadge(t);
                                                    return <span key={t} className={`px-1.5 py-0.5 rounded border text-[7px] font-black uppercase ${b.bg} ${b.text}`}>{t}</span>;
                                                }) : <span className="text-white/20">—</span>}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-white/60 font-bold">{job.totalQty}</td>
                                        <td className="px-3 py-2.5 text-center font-bold text-purple-300">{job.est.totalStitches > 0 ? fmtStitches(job.est.totalStitches) : '—'}</td>
                                        <td className="px-3 py-2.5 text-center font-bold text-blue-300">{job.est.totalMinutes > 0 ? fmtTime(job.est.totalMinutes) : '—'}</td>
                                        <td className="px-3 py-2.5 text-center text-[9px] text-white/40">{job.est.isEmbroidery ? job.est.machineType : '—'}</td>
                                        <td className="px-3 py-2.5 text-center">
                                            <span className={ageColor}>{job.daysInProd !== null ? `${job.daysInProd}d` : '—'}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <div className={dueColor}>{job.daysUntilDue !== null ? (job.daysUntilDue < 0 ? `${Math.abs(job.daysUntilDue)}d over` : job.daysUntilDue === 0 ? 'Today' : `${job.daysUntilDue}d`) : '—'}</div>
                                            <div className="text-[8px] text-white/20">{fmtDate(job.dateDue)}</div>
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-white/50 font-bold">{job.jobValue > 0 ? fmtK(job.jobValue) : '—'}</td>
                                        <td className="px-3 py-2.5 text-center">
                                            <span className={pphColor}>{job.poundPerHour > 0 ? `£${job.poundPerHour.toFixed(0)}` : '—'}</span>
                                        </td>
                                    </tr>
                                    {/* Expanded item detail */}
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={12} className="bg-[#16162e] px-4 py-3">
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left text-[9px]">
                                                        <thead>
                                                            <tr className="text-white/25 font-bold uppercase tracking-widest border-b border-white/5">
                                                                <th className="px-2 py-1.5">SKU</th>
                                                                <th className="px-2 py-1.5">Item</th>
                                                                <th className="px-2 py-1.5 text-center">Color</th>
                                                                <th className="px-2 py-1.5 text-center">Qty</th>
                                                                <th className="px-2 py-1.5 text-center">Type</th>
                                                                <th className="px-2 py-1.5 text-center">Stitches</th>
                                                                <th className="px-2 py-1.5 text-center">Est.</th>
                                                                <th className="px-2 py-1.5 text-center">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-white/[0.02]">
                                                            {job.items.map((item, idx) => {
                                                                const parts = item.name.split(' - ');
                                                                const color = parts.length >= 3 ? parts[parts.length - 2] : '—';
                                                                const detail = parts.length >= 2 ? parts.slice(0, -1).join(' - ') : item.name;
                                                                const itemEst = estimateProductionTime([item]);
                                                                const badge = getDecoBadge(item.decorationType);
                                                                return (
                                                                    <tr key={idx} className="hover:bg-white/[0.02]">
                                                                        <td className="px-2 py-1.5 font-mono text-indigo-400/50">{item.productCode || item.vendorSku || '—'}</td>
                                                                        <td className="px-2 py-1.5 text-white/60 truncate max-w-[250px]">{detail}</td>
                                                                        <td className="px-2 py-1.5 text-center text-white/40">{color}</td>
                                                                        <td className="px-2 py-1.5 text-center text-white/60 font-bold">{item.quantity}</td>
                                                                        <td className="px-2 py-1.5 text-center">
                                                                            <span className={`px-1.5 py-0.5 rounded border text-[7px] font-black uppercase ${badge.bg} ${badge.text}`}>{item.decorationType || '—'}</span>
                                                                        </td>
                                                                        <td className="px-2 py-1.5 text-center text-purple-300">{item.stitchCount ? fmtStitches(item.stitchCount) : '—'}</td>
                                                                        <td className="px-2 py-1.5 text-center text-blue-300">{itemEst.totalMinutes > 0 ? fmtTime(itemEst.totalMinutes) : '—'}</td>
                                                                        <td className="px-2 py-1.5 text-center">
                                                                            <span className={`text-[8px] font-bold uppercase ${item.isShipped ? 'text-green-400' : item.isProduced ? 'text-blue-400' : item.isReceived ? 'text-amber-400' : 'text-white/30'}`}>
                                                                                {item.status || '—'}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onNavigateToOrder(job.jobNumber); }}
                                                        className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 uppercase tracking-widest"
                                                    >
                                                        View Full Job →
                                                    </button>
                                                    {job.est.isEmbroidery && (
                                                        <span className="text-[9px] text-white/25">
                                                            {fmtStitches(job.est.stitchesPerItem)}/item × {job.totalQty} pcs = {fmtStitches(job.est.totalStitches)} total → {fmtTime(job.est.totalMinutes)} on {job.est.machineType}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer summary */}
            <div className="px-5 py-3 border-t border-white/5 flex flex-wrap items-center gap-4">
                <span className="text-[10px] text-white/25">{filtered.length} jobs &middot; {fmtK(totalValue)} total value</span>
                {totalMinutes > 0 && <span className="text-[10px] text-blue-400/50">{fmtTime(totalMinutes)} total production time ({(totalMinutes / 480).toFixed(1)} shifts)</span>}
                {totalStitchesAll > 0 && <span className="text-[10px] text-purple-400/50">{fmtStitches(totalStitchesAll)} total stitches</span>}
            </div>
        </div>
    );
}
