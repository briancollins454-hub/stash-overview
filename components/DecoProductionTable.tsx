import React, { useState, useMemo, useRef } from 'react';
import type { DecoJob, DecoItem } from '../types';
import { Scissors, Timer, Hash, ChevronDown, ChevronUp, Search, Filter, Printer, RefreshCw, CalendarDays, FileDown } from 'lucide-react';

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

const STATUS_BADGE: Record<string, { cls: string; short: string }> = {
    'Order': { cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30', short: 'ORDER' },
    'Production': { cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', short: 'PRODUCING' },
    'In Production': { cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', short: 'PRODUCING' },
    'Awaiting Processing': { cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30', short: 'PROCESSING' },
    'Awaiting Stock': { cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30', short: 'NEED STOCK' },
    'Awaiting Artwork': { cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30', short: 'NEED ART' },
    'Awaiting Review': { cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', short: 'IN REVIEW' },
    'Awaiting PO': { cls: 'bg-red-500/20 text-red-300 border-red-500/30', short: 'NEED PO' },
    'Not Ordered': { cls: 'bg-red-500/20 text-red-300 border-red-500/30', short: 'NOT ORDERED' },
    'Ready for Shipping': { cls: 'bg-green-500/20 text-green-300 border-green-500/30', short: 'READY' },
    'Completed': { cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', short: 'DONE' },
    'Shipped': { cls: 'bg-sky-500/20 text-sky-300 border-sky-500/30', short: 'SHIPPED' },
    'On Hold': { cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30', short: 'ON HOLD' },
    'Cancelled': { cls: 'bg-red-500/10 text-red-400/60 border-red-500/20', short: 'CANCELLED' },
};

type SortKey = 'due' | 'value' | 'time' | 'pph' | 'stitches' | 'status' | 'ordered' | 'customer' | 'risk';
type SortDir = 'asc' | 'desc';
type StatusFilter =
    | 'active'
    | 'production'
    | 'awaiting'
    | 'awaitingStock'
    | 'awaitingProcessing'
    | 'partiallyFulfilled'
    | 'awaitingShipping';

const PRINT_TYPES = new Set(['FLEX', 'SCREEN', 'TRANSFER', 'DTF', 'DTG', 'UV', 'PRINT']);

// Predicate for "Partially Fulfilled": some items shipped but not all.
const isPartiallyFulfilled = (items: DecoItem[]): boolean => {
    if (items.length === 0) return false;
    let shipped = 0;
    for (const i of items) if (i.isShipped) shipped++;
    return shipped > 0 && shipped < items.length;
};

interface Props {
    decoJobs: DecoJob[];
    onNavigateToOrder: (orderNum: string) => void;
    onEnrichProduction?: () => Promise<void>;
    isEnriching?: boolean;
    enrichMsg?: string;
}

export default function DecoProductionTable({ decoJobs, onNavigateToOrder, onEnrichProduction, isEnriching, enrichMsg }: Props) {
    const [sortKey, setSortKey] = useState<SortKey>('due');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedJob, setExpandedJob] = useState<string | null>(null);
    const [hideIncomplete, setHideIncomplete] = useState(false);
    const [dueFrom, setDueFrom] = useState('');
    const [dueTo, setDueTo] = useState('');
    const [orderedFrom, setOrderedFrom] = useState('');
    const [orderedTo, setOrderedTo] = useState('');
    const tableRef = useRef<HTMLDivElement>(null);

    const now = useMemo(() => new Date(), []);

    const EXCLUDED_STATUSES = new Set(['Shipped', 'Completed', 'Cancelled']);
    const PRODUCTION_STATUSES = new Set(['In Production', 'Production', 'Order']);
    const AWAITING_STATUSES = new Set(['Awaiting Stock', 'Awaiting Artwork', 'Awaiting Review', 'Awaiting Processing', 'Awaiting PO', 'Not Ordered', 'On Hold']);

    const enrichedJobs = useMemo(() => {
        return decoJobs
            .filter(job => !EXCLUDED_STATUSES.has(job.status))
            .map(job => {
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
            // Per-job EMB/Print completion
            const embItems = job.items.filter(i => i.decorationType === 'EMB');
            const embTotal = embItems.reduce((a, i) => a + i.quantity, 0);
            const embDone = embItems.filter(i => i.isProduced || i.isShipped).reduce((a, i) => a + i.quantity, 0);
            const printItems = job.items.filter(i => i.decorationType && PRINT_TYPES.has(i.decorationType));
            const printTotal = printItems.reduce((a, i) => a + i.quantity, 0);
            const printDone = printItems.filter(i => i.isProduced || i.isShipped).reduce((a, i) => a + i.quantity, 0);
            // ---- RISK SCORE (0-100) + REASONS + NEXT STEPS ----
            let riskScore = 0;
            const riskReasons: string[] = [];
            const nextSteps: string[] = [];
            if (daysUntilDue !== null) {
                if (daysUntilDue < 0) {
                    riskScore += 40 + Math.min(Math.abs(daysUntilDue) * 2, 20);
                    riskReasons.push(`Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? 's' : ''}`);
                    nextSteps.push('Rush this job — contact customer if delivery will slip');
                } else if (daysUntilDue === 0) {
                    riskScore += 35;
                    riskReasons.push('Due today');
                    nextSteps.push('Prioritise for immediate production');
                } else if (daysUntilDue <= 2) {
                    riskScore += 25;
                    riskReasons.push(`Only ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''} until due`);
                    nextSteps.push('Move to front of queue');
                } else if (daysUntilDue <= 5) {
                    riskScore += 15;
                    riskReasons.push(`Due in ${daysUntilDue} days`);
                } else if (daysUntilDue <= 7) {
                    riskScore += 8;
                }
            } else {
                riskScore += 10;
                riskReasons.push('No due date set');
                nextSteps.push('Set a due date in DecoNetwork');
            }
            if (daysUntilDue !== null && est.totalMinutes > 0) {
                const hoursAvail = daysUntilDue * 8;
                const hoursNeeded = est.totalMinutes / 60;
                if (hoursNeeded > hoursAvail) {
                    riskScore += 20;
                    riskReasons.push(`Needs ${fmtTime(est.totalMinutes)} but only ${Math.max(0, daysUntilDue)}d left`);
                    nextSteps.push('Start production now or negotiate deadline');
                } else if (hoursNeeded > hoursAvail * 0.7) {
                    riskScore += 10;
                    riskReasons.push('Production time is tight against deadline');
                    nextSteps.push('Schedule today to stay on track');
                }
            }
            const stLower = job.status.toLowerCase();
            if (stLower.includes('awaiting stock') || stLower.includes('not ordered')) {
                riskScore += 15;
                riskReasons.push('Stock not received / not ordered');
                nextSteps.push('Chase supplier or place stock order');
            } else if (stLower.includes('awaiting artwork') || stLower.includes('awaiting review')) {
                riskScore += 10;
                riskReasons.push('Waiting on artwork approval');
                nextSteps.push('Chase customer for artwork sign-off');
            } else if (stLower.includes('hold')) {
                riskScore += 12;
                riskReasons.push('Job is on hold');
                nextSteps.push('Review hold reason and unblock');
            }
            if (jobValue > 500) riskScore += 5;
            if (decoTypes.length === 0) {
                riskScore += 8;
                riskReasons.push('No decoration type identified');
                nextSteps.push('Run Sync Types or check job in DecoNetwork');
            }
            riskScore = Math.min(100, Math.max(0, riskScore));
            const riskLevel = riskScore >= 60 ? 'critical' as const : riskScore >= 40 ? 'high' as const : riskScore >= 20 ? 'medium' as const : 'low' as const;
            if (riskReasons.length === 0) {
                riskReasons.push('On track — no issues detected');
            }
            // ---- READINESS GATES ----
            const stockReady = !stLower.includes('awaiting stock') && !stLower.includes('not ordered');
            const artReady = !stLower.includes('awaiting artwork') && !stLower.includes('awaiting review');
            const poReady = !stLower.includes('awaiting po');
            return { ...job, est, totalQty, jobValue, poundPerHour, decoTypes, daysUntilDue, daysInProd, embTotal, embDone, printTotal, printDone, riskScore, riskLevel, riskReasons, nextSteps, stockReady, artReady, poReady };
        });
    }, [decoJobs, now]);

    const filtered = useMemo(() => {
        let list = enrichedJobs;

        // Hide jobs with no decoration data
        if (hideIncomplete) {
            list = list.filter(j => j.decoTypes.length > 0);
        }

        // Status filter (shipped/completed already excluded)
        if (statusFilter === 'production') list = list.filter(j => PRODUCTION_STATUSES.has(j.status));
        else if (statusFilter === 'awaiting') list = list.filter(j => AWAITING_STATUSES.has(j.status));
        else if (statusFilter === 'awaitingStock') list = list.filter(j => j.status === 'Awaiting Stock');
        else if (statusFilter === 'awaitingProcessing') list = list.filter(j => j.status === 'Awaiting Processing');
        else if (statusFilter === 'partiallyFulfilled') list = list.filter(j => isPartiallyFulfilled(j.items));
        else if (statusFilter === 'awaitingShipping') list = list.filter(j => j.status === 'Ready for Shipping');

        // Date range filters
        if (dueFrom) { const d = new Date(dueFrom); list = list.filter(j => j.dateDue && new Date(j.dateDue) >= d); }
        if (dueTo) { const d = new Date(dueTo); d.setHours(23,59,59); list = list.filter(j => j.dateDue && new Date(j.dateDue) <= d); }
        if (orderedFrom) { const d = new Date(orderedFrom); list = list.filter(j => j.dateOrdered && new Date(j.dateOrdered) >= d); }
        if (orderedTo) { const d = new Date(orderedTo); d.setHours(23,59,59); list = list.filter(j => j.dateOrdered && new Date(j.dateOrdered) <= d); }

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

        // Type filter
        if (typeFilter) {
            list = list.filter(j => j.decoTypes.includes(typeFilter));
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
                case 'risk': cmp = b.riskScore - a.riskScore; break;
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });

        return list;
    }, [enrichedJobs, hideIncomplete, statusFilter, typeFilter, searchTerm, sortKey, sortDir, dueFrom, dueTo, orderedFrom, orderedTo]);

    const incompleteCount = useMemo(() => {
        let base = enrichedJobs;
        if (statusFilter === 'active') base = base.filter(j => !EXCLUDED_STATUSES.has(j.status));
        else if (statusFilter === 'production') base = base.filter(j => PRODUCTION_STATUSES.has(j.status));
        else if (statusFilter === 'awaiting') base = base.filter(j => AWAITING_STATUSES.has(j.status));
        else if (statusFilter === 'awaitingStock') base = base.filter(j => j.status === 'Awaiting Stock');
        else if (statusFilter === 'awaitingProcessing') base = base.filter(j => j.status === 'Awaiting Processing');
        else if (statusFilter === 'partiallyFulfilled') base = base.filter(j => isPartiallyFulfilled(j.items));
        else if (statusFilter === 'awaitingShipping') base = base.filter(j => j.status === 'Ready for Shipping');
        return base.filter(j => j.decoTypes.length === 0).length;
    }, [enrichedJobs, statusFilter]);

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

    const embJobs = filtered.filter(j => j.decoTypes.includes('EMB'));
    const embQtyTotal = embJobs.reduce((a, j) => a + j.embTotal, 0);
    const embQtyDone = embJobs.reduce((a, j) => a + j.embDone, 0);
    const embMins = embJobs.reduce((a, j) => a + j.est.totalMinutes, 0);
    const printJobsList = filtered.filter(j => j.decoTypes.some(t => PRINT_TYPES.has(t)));
    const printQtyTotal = printJobsList.reduce((a, j) => a + j.printTotal, 0);
    const printQtyDone = printJobsList.reduce((a, j) => a + j.printDone, 0);
    const printMins = printJobsList.reduce((a, j) => a + j.est.totalMinutes, 0);
    const untypedJobs = filtered.filter(j => !j.items.some(i => i.decorationType)).length;
    const hasDateFilters = dueFrom || dueTo || orderedFrom || orderedTo;

    // All unique decoration types across all jobs
    const allDecoTypes = useMemo(() => {
        const types = new Set<string>();
        enrichedJobs.forEach(j => j.decoTypes.forEach(t => types.add(t)));
        return Array.from(types).sort();
    }, [enrichedJobs]);

    // Count per type (from enriched, not filtered, so counts don't change when type filter active)
    const typeCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        // Apply status + search filters but NOT type filter for the counts
        let base = enrichedJobs;
        if (statusFilter === 'active') base = base.filter(j => !EXCLUDED_STATUSES.has(j.status));
        else if (statusFilter === 'production') base = base.filter(j => PRODUCTION_STATUSES.has(j.status));
        else if (statusFilter === 'awaiting') base = base.filter(j => AWAITING_STATUSES.has(j.status));
        else if (statusFilter === 'awaitingStock') base = base.filter(j => j.status === 'Awaiting Stock');
        else if (statusFilter === 'awaitingProcessing') base = base.filter(j => j.status === 'Awaiting Processing');
        else if (statusFilter === 'partiallyFulfilled') base = base.filter(j => isPartiallyFulfilled(j.items));
        else if (statusFilter === 'awaitingShipping') base = base.filter(j => j.status === 'Ready for Shipping');
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            base = base.filter(j => j.jobNumber.includes(s) || j.customerName.toLowerCase().includes(s) || j.jobName.toLowerCase().includes(s) || j.decoTypes.some(t => t.toLowerCase().includes(s)));
        }
        base.forEach(j => j.decoTypes.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
        return counts;
    }, [enrichedJobs, statusFilter, searchTerm]);

    const handleGenerateReport = () => {
        // Basic HTML escaper for content we inject into the report.
        const esc = (v: string | number | null | undefined): string => {
            if (v === null || v === undefined) return '';
            return String(v)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        // Columns we break print items into (everything not EMB, NONE, or untyped)
        const printTypeCols = ['DTF', 'DTG', 'SCREEN', 'TRANSFER', 'UV', 'FLEX', 'VINYL', 'SUBLIMATION', 'FREEFORM'];

        const isEmbItem = (i: DecoItem): boolean =>
            i.decorationType === 'EMB' || ((i.stitchCount ?? 0) > 0);

        type JobRow = {
            jobNumber: string;
            customer: string;
            jobName: string;
            status: string;
            dueDate: string;
            dueClass: '' | 'overdue' | 'due-soon';
            totalQty: number;
            embQty: number;
            embStitches: number;
            printQty: number;
            perType: Record<string, number>;
            otherPrintQty: number;
            untypedQty: number;
            jobValue: number;
            estMinutes: number;
        };

        const rows: JobRow[] = enrichedJobs.map(job => {
            const perType: Record<string, number> = {};
            printTypeCols.forEach(t => { perType[t] = 0; });
            let embQty = 0;
            let embStitches = 0;
            let printQty = 0;
            let otherPrintQty = 0;
            let untypedQty = 0;
            for (const item of job.items) {
                const qty = item.quantity || 0;
                if (isEmbItem(item)) {
                    embQty += qty;
                    embStitches += (item.stitchCount ?? 0) * qty;
                    continue;
                }
                const dt = (item.decorationType || '').toUpperCase();
                if (!dt || dt === 'NONE') { untypedQty += qty; continue; }
                if (Object.prototype.hasOwnProperty.call(perType, dt)) {
                    perType[dt] += qty;
                    printQty += qty;
                } else {
                    otherPrintQty += qty;
                    printQty += qty;
                }
            }
            const dueClass: '' | 'overdue' | 'due-soon' =
                job.daysUntilDue === null || job.daysUntilDue === undefined ? ''
                    : job.daysUntilDue < 0 ? 'overdue'
                    : job.daysUntilDue <= 3 ? 'due-soon'
                    : '';
            return {
                jobNumber: job.jobNumber,
                customer: job.customerName,
                jobName: job.jobName,
                status: job.status,
                dueDate: job.dateDue ? new Date(job.dateDue).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
                dueClass,
                totalQty: job.totalQty,
                embQty,
                embStitches,
                printQty,
                perType,
                otherPrintQty,
                untypedQty,
                jobValue: job.jobValue,
                estMinutes: job.est.totalMinutes,
            };
        });

        // Grand totals
        const totals = rows.reduce((acc, r) => {
            acc.jobs += 1;
            acc.totalQty += r.totalQty;
            acc.embQty += r.embQty;
            acc.embStitches += r.embStitches;
            acc.printQty += r.printQty;
            acc.otherPrintQty += r.otherPrintQty;
            acc.untypedQty += r.untypedQty;
            acc.jobValue += r.jobValue;
            acc.estMinutes += r.estMinutes;
            for (const t of printTypeCols) acc.perType[t] += r.perType[t];
            return acc;
        }, {
            jobs: 0, totalQty: 0, embQty: 0, embStitches: 0, printQty: 0, otherPrintQty: 0, untypedQty: 0, jobValue: 0, estMinutes: 0,
            perType: Object.fromEntries(printTypeCols.map(t => [t, 0])) as Record<string, number>,
        });

        // Status breakdown (mutually exclusive definitions match the tabs)
        const statusGroups = [
            { label: 'Awaiting Stock', count: enrichedJobs.filter(j => j.status === 'Awaiting Stock').length },
            { label: 'Awaiting Processing', count: enrichedJobs.filter(j => j.status === 'Awaiting Processing').length },
            { label: 'In Production', count: enrichedJobs.filter(j => PRODUCTION_STATUSES.has(j.status)).length },
            { label: 'Partially Fulfilled', count: enrichedJobs.filter(j => isPartiallyFulfilled(j.items)).length },
            { label: 'Awaiting Shipping', count: enrichedJobs.filter(j => j.status === 'Ready for Shipping').length },
            { label: 'Other / On Hold', count: enrichedJobs.filter(j => j.status === 'On Hold' || j.status === 'Awaiting Artwork' || j.status === 'Awaiting Review' || j.status === 'Awaiting PO' || j.status === 'Not Ordered').length },
        ];

        // Decoration summary (Embroidery + per-print-type)
        const embJobCount = rows.filter(r => r.embQty > 0).length;
        const decorationRows = [
            { label: 'Embroidery', jobs: embJobCount, qty: totals.embQty, extra: `${fmtStitches(totals.embStitches)} stitches`, highlight: true },
            ...printTypeCols.map(t => ({
                label: t,
                jobs: rows.filter(r => r.perType[t] > 0).length,
                qty: totals.perType[t],
                extra: '',
                highlight: false,
            })),
        ];
        if (totals.otherPrintQty > 0) {
            decorationRows.push({ label: 'Other Print', jobs: rows.filter(r => r.otherPrintQty > 0).length, qty: totals.otherPrintQty, extra: '', highlight: false });
        }
        if (totals.untypedQty > 0) {
            decorationRows.push({ label: 'Untyped', jobs: rows.filter(r => r.untypedQty > 0).length, qty: totals.untypedQty, extra: '', highlight: false });
        }

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const w = window.open('', '_blank');
        if (!w) {
            alert('Please allow pop-ups for this site to generate the report.');
            return;
        }

        const styles = `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: A4; margin: 14mm 12mm; }
            html, body { background: #fff; color: #1a1a2e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10px; line-height: 1.4; }
            body { padding: 8px; }
            .report-header { border-bottom: 2px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
            .brand { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #666; margin-bottom: 2px; }
            h1 { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #1a1a2e; }
            .meta { text-align: right; font-size: 9px; color: #666; line-height: 1.5; }
            .meta strong { color: #1a1a2e; font-size: 10px; }
            h2 { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #4f46e5; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
            h2:first-of-type { margin-top: 0; }
            .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 4px; }
            .kpi { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; background: #fafafc; page-break-inside: avoid; }
            .kpi .label { font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 4px; }
            .kpi .value { font-size: 18px; font-weight: 900; color: #1a1a2e; line-height: 1.1; }
            .kpi .sub { font-size: 8px; color: #6b7280; margin-top: 2px; }
            .kpi.accent-emb { background: #faf5ff; border-color: #d8b4fe; }
            .kpi.accent-emb .label { color: #7e22ce; }
            .kpi.accent-emb .value { color: #6b21a8; }
            .kpi.accent-print { background: #ecfeff; border-color: #a5f3fc; }
            .kpi.accent-print .label { color: #0e7490; }
            .kpi.accent-print .value { color: #155e75; }
            .kpi.accent-value { background: #f0fdf4; border-color: #bbf7d0; }
            .kpi.accent-value .label { color: #15803d; }
            .kpi.accent-value .value { color: #166534; }
            .status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
            .status-item { border: 1px solid #e5e7eb; border-radius: 5px; padding: 8px 10px; background: #fafafc; display: flex; justify-content: space-between; align-items: center; page-break-inside: avoid; }
            .status-item .label { font-size: 9px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; }
            .status-item .count { font-size: 16px; font-weight: 900; color: #1a1a2e; }
            .status-item.zero { opacity: 0.4; }
            table { width: 100%; border-collapse: collapse; font-size: 9px; }
            thead { display: table-header-group; }
            tr { page-break-inside: avoid; }
            th { background: #1a1a2e; color: #fff; text-align: left; padding: 6px 8px; font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; border: 1px solid #1a1a2e; }
            th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
            td { padding: 5px 8px; border: 1px solid #e5e7eb; vertical-align: middle; }
            tbody tr:nth-child(even) td { background: #fafafc; }
            tr.total-row td { background: #1a1a2e !important; color: #fff; font-weight: 900; border-color: #1a1a2e; }
            tr.highlight td { background: #faf5ff !important; font-weight: 700; }
            tr.highlight.total-row td { background: #1a1a2e !important; }
            td.overdue { color: #b91c1c; font-weight: 800; }
            td.due-soon { color: #c2410c; font-weight: 700; }
            .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid; }
            .badge-status-stock { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
            .badge-status-processing { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
            .badge-status-production { background: #eef2ff; color: #4338ca; border-color: #a5b4fc; }
            .badge-status-partial { background: #fff7ed; color: #c2410c; border-color: #fdba74; }
            .badge-status-ready { background: #ecfdf5; color: #047857; border-color: #6ee7b7; }
            .badge-status-other { background: #f9fafb; color: #6b7280; border-color: #d1d5db; }
            .print-footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8px; color: #9ca3af; text-align: center; letter-spacing: 0.5px; }
            .empty { padding: 30px; text-align: center; color: #9ca3af; font-size: 11px; }
            @media print {
                body { padding: 0; }
                .no-print { display: none !important; }
            }
            .actions { margin-bottom: 14px; padding: 8px 12px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
            .actions span { font-size: 10px; color: #3730a3; }
            .actions button { background: #4f46e5; color: #fff; border: none; padding: 6px 14px; border-radius: 5px; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; cursor: pointer; }
            .actions button:hover { background: #4338ca; }
        `;

        const statusBadgeClass = (status: string): string => {
            if (status === 'Awaiting Stock') return 'badge-status-stock';
            if (status === 'Awaiting Processing') return 'badge-status-processing';
            if (PRODUCTION_STATUSES.has(status)) return 'badge-status-production';
            if (status === 'Ready for Shipping') return 'badge-status-ready';
            return 'badge-status-other';
        };

        const kpiHtml = `
            <div class="kpi-grid">
                <div class="kpi">
                    <div class="label">Active Jobs</div>
                    <div class="value">${totals.jobs}</div>
                    <div class="sub">${totals.totalQty.toLocaleString()} items total</div>
                </div>
                <div class="kpi accent-emb">
                    <div class="label">Embroidery</div>
                    <div class="value">${totals.embQty.toLocaleString()}</div>
                    <div class="sub">${fmtStitches(totals.embStitches)} stitches · ${embJobCount} jobs</div>
                </div>
                <div class="kpi accent-print">
                    <div class="label">Print</div>
                    <div class="value">${totals.printQty.toLocaleString()}</div>
                    <div class="sub">${rows.filter(r => r.printQty > 0).length} jobs</div>
                </div>
                <div class="kpi">
                    <div class="label">Est. Time</div>
                    <div class="value">${fmtTime(totals.estMinutes)}</div>
                    <div class="sub">production hours</div>
                </div>
                <div class="kpi accent-value">
                    <div class="label">Pipeline Value</div>
                    <div class="value">${fmtK(totals.jobValue)}</div>
                    <div class="sub">across all active jobs</div>
                </div>
            </div>
        `;

        const statusHtml = `
            <div class="status-grid">
                ${statusGroups.map(g => `
                    <div class="status-item${g.count === 0 ? ' zero' : ''}">
                        <span class="label">${esc(g.label)}</span>
                        <span class="count">${g.count}</span>
                    </div>
                `).join('')}
            </div>
        `;

        const decorationTableHtml = `
            <table>
                <thead>
                    <tr>
                        <th>Decoration Type</th>
                        <th class="num">Jobs</th>
                        <th class="num">Items</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    ${decorationRows.map(r => `
                        <tr class="${r.highlight ? 'highlight' : ''}">
                            <td><strong>${esc(r.label)}</strong></td>
                            <td class="num">${r.jobs}</td>
                            <td class="num">${r.qty.toLocaleString()}</td>
                            <td>${esc(r.extra)}</td>
                        </tr>
                    `).join('')}
                    <tr class="total-row">
                        <td>TOTAL</td>
                        <td class="num">—</td>
                        <td class="num">${(totals.embQty + totals.printQty + totals.otherPrintQty + totals.untypedQty).toLocaleString()}</td>
                        <td>${fmtStitches(totals.embStitches)} stitches (embroidery)</td>
                    </tr>
                </tbody>
            </table>
        `;

        const jobsTableHtml = rows.length === 0 ? '<div class="empty">No active jobs to report on.</div>' : `
            <table>
                <thead>
                    <tr>
                        <th>Job #</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Due</th>
                        <th class="num">Items</th>
                        <th class="num">Embroidery</th>
                        <th class="num">Stitches</th>
                        <th class="num">Print</th>
                        <th class="num">Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td><strong>#${esc(r.jobNumber)}</strong></td>
                            <td>${esc(r.customer)}</td>
                            <td><span class="badge ${statusBadgeClass(r.status)}">${esc(r.status)}</span></td>
                            <td class="${r.dueClass}">${esc(r.dueDate)}</td>
                            <td class="num">${r.totalQty}</td>
                            <td class="num">${r.embQty > 0 ? r.embQty.toLocaleString() : '—'}</td>
                            <td class="num">${r.embStitches > 0 ? fmtStitches(r.embStitches) : '—'}</td>
                            <td class="num">${r.printQty > 0 ? r.printQty.toLocaleString() : '—'}</td>
                            <td class="num">${r.jobValue > 0 ? fmtK(r.jobValue) : '—'}</td>
                        </tr>
                    `).join('')}
                    <tr class="total-row">
                        <td colspan="4">TOTAL · ${totals.jobs} jobs</td>
                        <td class="num">${totals.totalQty.toLocaleString()}</td>
                        <td class="num">${totals.embQty.toLocaleString()}</td>
                        <td class="num">${fmtStitches(totals.embStitches)}</td>
                        <td class="num">${totals.printQty.toLocaleString()}</td>
                        <td class="num">${fmtK(totals.jobValue)}</td>
                    </tr>
                </tbody>
            </table>
        `;

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Production Report — ${esc(dateStr)}</title><style>${styles}</style></head><body>
            <div class="actions no-print">
                <span>Use your browser's print dialog to save as PDF or send to the printer.</span>
                <button onclick="window.print()">Print / Save as PDF</button>
            </div>
            <div class="report-header">
                <div>
                    <div class="brand">Stash Production</div>
                    <h1>Production Report</h1>
                </div>
                <div class="meta">
                    <strong>${esc(dateStr)}</strong><br>
                    Generated ${esc(timeStr)}<br>
                    ${totals.jobs} active ${totals.jobs === 1 ? 'job' : 'jobs'}
                </div>
            </div>

            <h2>Executive Summary</h2>
            ${kpiHtml}

            <h2>Status Breakdown</h2>
            ${statusHtml}

            <h2>Decoration Summary</h2>
            ${decorationTableHtml}

            <h2>Job Detail</h2>
            ${jobsTableHtml}

            <div class="print-footer">
                Stash Production Report · ${esc(dateStr)} · ${esc(timeStr)} · ${totals.jobs} jobs · ${fmtK(totals.jobValue)} pipeline
            </div>
        </body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        // Auto-trigger the print dialog once the document has laid out.
        setTimeout(() => {
            try { w.print(); } catch { /* user can click the button */ }
        }, 250);
    };

    const handlePrint = () => {
        const el = tableRef.current;
        if (!el) return;
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`<!DOCTYPE html><html><head><title>Deco Production Jobs</title><style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 9px; color: #1e1e3a; padding: 12px; }
            h1 { font-size: 14px; margin-bottom: 2px; }
            .subtitle { font-size: 9px; color: #666; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #f0f0f8; font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 6px; border: 1px solid #ddd; text-align: left; font-weight: 800; }
            td { padding: 4px 6px; border: 1px solid #ddd; font-size: 9px; }
            tr:nth-child(even) { background: #f8f8fc; }
            .badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7px; font-weight: 900; text-transform: uppercase; border: 1px solid; }
            .emb { background: #f3e8ff; color: #6b21a8; border-color: #c084fc; }
            .dtf { background: #e0f7fa; color: #00838f; border-color: #4dd0e1; }
            .flex { background: #fff8e1; color: #e65100; border-color: #ffb74d; }
            .transfer { background: #fff3e0; color: #bf360c; border-color: #ff8a65; }
            .uv { background: #e3f2fd; color: #0d47a1; border-color: #64b5f6; }
            .screen { background: #e8f5e9; color: #1b5e20; border-color: #81c784; }
            .freeform { background: #fce4ec; color: #880e4f; border-color: #f48fb1; }
            .vinyl { background: #e0f2f1; color: #004d40; border-color: #4db6ac; }
            .sublimation { background: #fce4ec; color: #ad1457; border-color: #f06292; }
            .dtg { background: #e8eaf6; color: #283593; border-color: #7986cb; }
            .none { background: #f5f5f5; color: #999; border-color: #ccc; }
            .status-production { background: #e8eaf6; color: #3949ab; }
            .status-awaiting { background: #fff8e1; color: #f57f17; }
            .status-ready { background: #e8f5e9; color: #2e7d32; }
            .status-order { background: #e3f2fd; color: #1565c0; }
            .status-hold { background: #f5f5f5; color: #757575; }
            .overdue { color: #d32f2f; font-weight: bold; }
            .due-soon { color: #e65100; font-weight: bold; }
            .pph-good { color: #2e7d32; font-weight: bold; }
            .pph-ok { color: #e65100; font-weight: bold; }
            .pph-low { color: #c62828; font-weight: bold; }
            .filter-info { font-size: 8px; color: #888; margin-bottom: 8px; }
            @media print { body { padding: 0; } }
        </style></head><body>`);
        printWindow.document.write(`<h1>Deco Production Jobs</h1>`);
        printWindow.document.write(`<div class="subtitle">${filtered.length} jobs · ${fmtK(totalValue)} pipeline · ${fmtTime(totalMinutes)} est. · Printed ${new Date().toLocaleString('en-GB')}</div>`);
        const statusFilterLabel: Record<StatusFilter, string> = {
            active: '',
            production: 'IN PRODUCTION',
            awaiting: 'AWAITING',
            awaitingStock: 'AWAITING STOCK',
            awaitingProcessing: 'AWAITING PROCESSING',
            partiallyFulfilled: 'PARTIALLY FULFILLED',
            awaitingShipping: 'AWAITING SHIPPING',
        };
        const filters = [statusFilterLabel[statusFilter] || '', typeFilter || '', searchTerm ? `"${searchTerm}"` : ''].filter(Boolean);
        if (filters.length) printWindow.document.write(`<div class="filter-info">Filters: ${filters.join(' · ')}</div>`);
        printWindow.document.write(`<table><thead><tr><th>Job</th><th>Customer</th><th>Job Name</th><th>Status</th><th>Type</th><th>Qty</th><th>EMB</th><th>Print</th><th>Stitches</th><th>Est. Time</th><th>Machine</th><th>Age</th><th>Due</th><th>Value</th><th>£/hr</th></tr></thead><tbody>`);
        filtered.forEach(job => {
            const typeClass = (job.decoTypes[0] || 'none').toLowerCase();
            const statusClass = job.status.toLowerCase().includes('production') ? 'status-production' : job.status.toLowerCase().includes('await') ? 'status-awaiting' : job.status.toLowerCase().includes('ready') ? 'status-ready' : job.status.toLowerCase().includes('order') ? 'status-order' : 'status-hold';
            const dueClass = job.daysUntilDue !== null ? (job.daysUntilDue < 0 ? 'overdue' : job.daysUntilDue <= 3 ? 'due-soon' : '') : '';
            const pphClass = job.poundPerHour >= 50 ? 'pph-good' : job.poundPerHour >= 25 ? 'pph-ok' : job.poundPerHour > 0 ? 'pph-low' : '';
            const dueText = job.daysUntilDue !== null ? (job.daysUntilDue < 0 ? `${Math.abs(job.daysUntilDue)}d over` : job.daysUntilDue === 0 ? 'Today' : `${job.daysUntilDue}d`) : '—';
            printWindow.document.write(`<tr>`);
            printWindow.document.write(`<td>#${job.jobNumber}</td>`);
            printWindow.document.write(`<td>${job.customerName}</td>`);
            printWindow.document.write(`<td>${job.jobName}</td>`);
            printWindow.document.write(`<td><span class="badge ${statusClass}">${job.status}</span></td>`);
            printWindow.document.write(`<td>${job.decoTypes.map(t => `<span class="badge ${t.toLowerCase()}">${t}</span>`).join(' ') || '—'}</td>`);
            printWindow.document.write(`<td>${job.totalQty}</td>`);
            printWindow.document.write(`<td>${job.embTotal > 0 ? `${job.embDone}/${job.embTotal}` : '—'}</td>`);
            printWindow.document.write(`<td>${job.printTotal > 0 ? `${job.printDone}/${job.printTotal}` : '—'}</td>`);
            printWindow.document.write(`<td>${job.est.totalStitches > 0 ? fmtStitches(job.est.totalStitches) : '—'}</td>`);
            printWindow.document.write(`<td>${job.est.totalMinutes > 0 ? fmtTime(job.est.totalMinutes) : '—'}</td>`);
            printWindow.document.write(`<td>${job.est.isEmbroidery ? job.est.machineType : '—'}</td>`);
            printWindow.document.write(`<td>${job.daysInProd !== null ? `${job.daysInProd}d` : '—'}</td>`);
            printWindow.document.write(`<td class="${dueClass}">${dueText}</td>`);
            printWindow.document.write(`<td>${job.jobValue > 0 ? fmtK(job.jobValue) : '—'}</td>`);
            printWindow.document.write(`<td class="${pphClass}">${job.poundPerHour > 0 ? '£' + job.poundPerHour.toFixed(0) : '—'}</td>`);
            printWindow.document.write(`</tr>`);
        });
        printWindow.document.write(`</tbody></table></body></html>`);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    };

    return (
        <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 overflow-hidden" ref={tableRef}>
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
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border bg-purple-500/10 border-purple-500/20">
                                <span className="text-[9px] font-black uppercase tracking-wider text-purple-300">Embroidery</span>
                                <span className="text-[10px] font-mono font-bold text-purple-200">{embJobs.length}<span className="text-purple-400 text-[8px]"> jobs</span></span>
                                <span className="text-purple-500/40">·</span>
                                <span className="text-[10px] font-mono font-bold text-purple-200">{embQtyDone}/{embQtyTotal}<span className="text-purple-400 text-[8px]"> pcs</span></span>
                                <span className="text-purple-500/40">·</span>
                                <span className="text-[10px] font-mono font-bold text-purple-200">{fmtTime(embMins)}</span>
                            </div>
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border bg-cyan-500/10 border-cyan-500/20">
                                <span className="text-[9px] font-black uppercase tracking-wider text-cyan-300">Print</span>
                                <span className="text-[10px] font-mono font-bold text-cyan-200">{printJobsList.length}<span className="text-cyan-400 text-[8px]"> jobs</span></span>
                                <span className="text-cyan-500/40">·</span>
                                <span className="text-[10px] font-mono font-bold text-cyan-200">{printQtyDone}/{printQtyTotal}<span className="text-cyan-400 text-[8px]"> pcs</span></span>
                                <span className="text-cyan-500/40">·</span>
                                <span className="text-[10px] font-mono font-bold text-cyan-200">{fmtTime(printMins)}</span>
                            </div>
                            {untypedJobs > 0 && (
                                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border bg-white/5 border-white/10">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">Untyped</span>
                                    <span className="text-[10px] font-mono font-bold text-white/40">{untypedJobs}<span className="text-white/20 text-[8px]"> jobs</span></span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {onEnrichProduction && (
                            <button
                                onClick={onEnrichProduction}
                                disabled={isEnriching}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase border transition-all ${
                                    isEnriching
                                        ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300 cursor-wait'
                                        : 'bg-white/5 border-white/10 text-white/50 hover:text-indigo-300 hover:bg-indigo-500/10 hover:border-indigo-500/30'
                                }`}
                                title={isEnriching ? (enrichMsg || 'Enriching...') : 'Sync decoration types & stitch counts from Deco API'}
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isEnriching ? 'animate-spin' : ''}`} />
                                {isEnriching ? (enrichMsg || 'Syncing...') : 'Sync Types'}
                            </button>
                        )}
                        <button
                            onClick={handleGenerateReport}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/20 transition-all"
                            title="Generate production report — opens a PDF-ready page with embroidery & print totals, status breakdown, and per-job detail"
                        >
                            <FileDown className="w-3.5 h-3.5" /> Report (PDF)
                        </button>
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-all"
                            title="Print spreadsheet"
                        >
                            <Printer className="w-3.5 h-3.5" /> Print
                        </button>
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
                {/* Status filters */}
                <div className="flex flex-wrap gap-2 mt-3">
                    {[
                        { label: 'Active', key: 'active' as StatusFilter, count: enrichedJobs.length },
                        { label: 'In Production', key: 'production' as StatusFilter, count: enrichedJobs.filter(j => PRODUCTION_STATUSES.has(j.status)).length },
                        { label: 'Awaiting', key: 'awaiting' as StatusFilter, count: enrichedJobs.filter(j => AWAITING_STATUSES.has(j.status)).length },
                        { label: 'Awaiting Stock', key: 'awaitingStock' as StatusFilter, count: enrichedJobs.filter(j => j.status === 'Awaiting Stock').length },
                        { label: 'Awaiting Processing', key: 'awaitingProcessing' as StatusFilter, count: enrichedJobs.filter(j => j.status === 'Awaiting Processing').length },
                        { label: 'Partially Fulfilled', key: 'partiallyFulfilled' as StatusFilter, count: enrichedJobs.filter(j => isPartiallyFulfilled(j.items)).length },
                        { label: 'Awaiting Shipping', key: 'awaitingShipping' as StatusFilter, count: enrichedJobs.filter(j => j.status === 'Ready for Shipping').length },
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
                    {incompleteCount > 0 && (
                        <button
                            onClick={() => setHideIncomplete(h => !h)}
                            className={`px-2.5 py-1 rounded-lg text-[9px] font-bold tracking-wider uppercase transition-all ml-auto ${
                                hideIncomplete
                                    ? 'text-white/25 hover:text-white/50 hover:bg-white/5'
                                    : 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                            }`}
                            title={hideIncomplete ? 'Show jobs with no decoration data' : 'Hide jobs with no decoration data'}
                        >
                            {hideIncomplete ? `+ ${incompleteCount} untyped` : `Hide ${incompleteCount} untyped`}
                        </button>
                    )}
                </div>
                {/* Decoration type filters */}
                {allDecoTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        <button
                            onClick={() => setTypeFilter(null)}
                            className={`px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-wider transition-all ${
                                typeFilter === null
                                    ? 'bg-white/10 border-white/30 text-white ring-1 ring-white/20'
                                    : 'bg-white/5 border-white/10 text-white/30 hover:text-white/60'
                            }`}
                        >All Types</button>
                        {allDecoTypes.map(t => {
                            const b = getDecoBadge(t);
                            const count = typeCounts[t] || 0;
                            const isActive = typeFilter === t;
                            return (
                                <button
                                    key={t}
                                    onClick={() => setTypeFilter(isActive ? null : t)}
                                    className={`px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-wider transition-all ${
                                        isActive
                                            ? `${b.bg} ${b.text} ring-1 ring-current`
                                            : `bg-white/5 border-white/10 text-white/30 hover:text-white/60`
                                    }`}
                                >
                                    {t} ({count})
                                </button>
                            );
                        })}
                    </div>
                )}
                {/* Date range filters */}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                    <CalendarDays className="w-3.5 h-3.5 text-white/20" />
                    <div className="flex items-center gap-1.5">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-white/25">Due from</span>
                        <input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 [color-scheme:dark]" />
                        <span className="text-[8px] font-bold uppercase tracking-widest text-white/25">to</span>
                        <input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 [color-scheme:dark]" />
                    </div>
                    <span className="text-white/10">|</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-white/25">Ordered from</span>
                        <input type="date" value={orderedFrom} onChange={e => setOrderedFrom(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 [color-scheme:dark]" />
                        <span className="text-[8px] font-bold uppercase tracking-widest text-white/25">to</span>
                        <input type="date" value={orderedTo} onChange={e => setOrderedTo(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 [color-scheme:dark]" />
                    </div>
                    {hasDateFilters && (
                        <button onClick={() => { setDueFrom(''); setDueTo(''); setOrderedFrom(''); setOrderedTo(''); }} className="text-[8px] font-bold uppercase tracking-widest text-red-400/50 hover:text-red-400 transition-colors">Clear dates</button>
                    )}
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
                            <th className="px-3 py-2.5 w-20 text-center">EMB</th>
                            <th className="px-3 py-2.5 w-20 text-center">Print</th>
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
                            <th className="px-3 py-2.5 w-14 text-center cursor-pointer hover:text-white/60" onClick={() => toggleSort('risk')}>
                                <span className="flex items-center gap-1 justify-center">Risk <SortIcon col="risk" /></span>
                            </th>
                            <th className="px-3 py-2.5 w-10 text-center" title="Stock · Artwork · PO">Ready</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {filtered.length === 0 && (
                            <tr><td colSpan={16} className="px-5 py-8 text-center text-white/30 text-xs">No jobs match this filter.</td></tr>
                        )}
                        {filtered.map(job => {
                            const isExpanded = expandedJob === job.id;
                            const statusInfo = STATUS_BADGE[job.status] || { cls: 'bg-white/10 text-white/50 border-white/20', short: job.status.toUpperCase() };
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
                                            <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase whitespace-nowrap border ${statusInfo.cls}`} title={job.status}>{statusInfo.short}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <div className="flex flex-wrap gap-0.5 justify-center">
                                                {job.decoTypes.length > 0 ? job.decoTypes.map(t => {
                                                    const b = getDecoBadge(t);
                                                    return <span key={t} className={`px-1.5 py-0.5 rounded border text-[7px] font-black uppercase ${b.bg} ${b.text}`}>{t}</span>;
                                                }) : <span className="px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300/50 text-[7px] font-black uppercase">?</span>}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-white/60 font-bold">{job.totalQty}</td>
                                        <td className="px-3 py-2.5 text-center">
                                            {job.embTotal > 0 ? (
                                                <span className={`font-mono text-[10px] font-bold ${job.embDone >= job.embTotal ? 'text-emerald-400' : job.embDone > 0 ? 'text-amber-300' : 'text-purple-300/60'}`}>
                                                    {job.embDone}/{job.embTotal}
                                                </span>
                                            ) : <span className="text-white/15">—</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            {job.printTotal > 0 ? (
                                                <span className={`font-mono text-[10px] font-bold ${job.printDone >= job.printTotal ? 'text-emerald-400' : job.printDone > 0 ? 'text-amber-300' : 'text-cyan-300/60'}`}>
                                                    {job.printDone}/{job.printTotal}
                                                </span>
                                            ) : <span className="text-white/15">—</span>}
                                        </td>
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
                                        <td className="px-3 py-2.5 text-center">
                                            <span
                                                title={`${job.riskReasons.join(' · ')}${job.nextSteps.length ? '\n→ ' + job.nextSteps.join('\n→ ') : ''}`}
                                                className={`px-1.5 py-0.5 rounded border text-[8px] font-black cursor-help ${
                                                job.riskLevel === 'critical' ? 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse' :
                                                job.riskLevel === 'high' ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' :
                                                job.riskLevel === 'medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                                                'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                            }`}>{job.riskScore}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <span className="inline-flex gap-0.5">
                                                <span title="Stock" className={`w-2 h-2 rounded-full ${job.stockReady ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                                                <span title="Artwork" className={`w-2 h-2 rounded-full ${job.artReady ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                                                <span title="PO" className={`w-2 h-2 rounded-full ${job.poReady ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                                            </span>
                                        </td>
                                    </tr>
                                    {/* Expanded item detail */}
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={16} className="bg-[#16162e] px-4 py-3">
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
                                                {/* Risk Analysis */}
                                                <div className="mt-2 pt-2 border-t border-white/5">
                                                    <div className="flex items-start gap-6">
                                                        <div className="flex-1">
                                                            <div className="text-[8px] font-black uppercase tracking-widest text-white/25 mb-1">Why {job.riskLevel === 'low' ? 'low risk' : 'at risk'}</div>
                                                            <div className="space-y-0.5">
                                                                {job.riskReasons.map((r: string, i: number) => (
                                                                    <div key={i} className="flex items-start gap-1.5 text-[9px]">
                                                                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                                                            job.riskLevel === 'critical' ? 'bg-red-400' :
                                                                            job.riskLevel === 'high' ? 'bg-orange-400' :
                                                                            job.riskLevel === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'
                                                                        }`} />
                                                                        <span className="text-white/50">{r}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        {job.nextSteps.length > 0 && (
                                                            <div className="flex-1">
                                                                <div className="text-[8px] font-black uppercase tracking-widest text-white/25 mb-1">Next Steps</div>
                                                                <div className="space-y-0.5">
                                                                    {job.nextSteps.map((s: string, i: number) => (
                                                                        <div key={i} className="flex items-start gap-1.5 text-[9px]">
                                                                            <span className="text-indigo-400 font-bold mt-px">→</span>
                                                                            <span className="text-indigo-300/70">{s}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
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
