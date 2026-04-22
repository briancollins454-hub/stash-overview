import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { DecoJob, DecoItem } from '../types';
import { Scissors, Timer, Hash, ChevronDown, ChevronUp, Search, Filter, Printer, RefreshCw, CalendarDays, FileDown, FileSpreadsheet, Settings2, Eye, EyeOff, Lock } from 'lucide-react';

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

// Single source of truth for "is this row embroidery work?".
// An item counts as embroidery if it's explicitly EMB, OR has a non-zero
// stitchCount (some DecoNetwork jobs come through with a stitchCount but no
// decorationType set).
export function isEmbItem(i: DecoItem): boolean {
    return i.decorationType === 'EMB' || ((i.stitchCount ?? 0) > 0);
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

// All selectable status filter keys excluding the catch-all 'active'.
const STATUS_FILTER_KEYS: Exclude<StatusFilter, 'active'>[] = [
    'production', 'awaiting', 'awaitingStock', 'awaitingProcessing', 'partiallyFulfilled', 'awaitingShipping',
];

// Readable labels, used in UI + report headings.
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
    active: 'Active',
    production: 'In Production',
    awaiting: 'Awaiting',
    awaitingStock: 'Awaiting Stock',
    awaitingProcessing: 'Awaiting Processing',
    partiallyFulfilled: 'Partially Fulfilled',
    awaitingShipping: 'Awaiting Shipping',
};

// ─── Report field visibility config ─────────────────────────────────────
// Controls which sections / columns appear on exported PDFs and CSVs.
// Persisted to localStorage per-browser so each user keeps their preference.
interface ReportFieldConfig {
    // PDF-only summary sections
    showExecutiveSummary: boolean;   // KPI tiles at the top
    showStatusBreakdown: boolean;    // status count grid
    showDecorationSummary: boolean;  // emb + per-print-type table
    // Column / field visibility (both PDF and CSV)
    showFinancials: boolean;         // pipeline value, per-job value
    showCustomer: boolean;           // customer name column
    showJobName: boolean;            // job name column (CSV only; PDF doesn't show it currently)
    showStatus: boolean;             // status column
    showDateOrdered: boolean;        // CSV column only
    showDueDate: boolean;            // due date column
    showDaysUntilDue: boolean;       // CSV column only
    showTotalItems: boolean;         // total items column (full report job detail)
    showDecoBreakdown: boolean;      // embroidery qty / print qty / per-type columns
    showEstTime: boolean;            // estimated production time
    showStitches: boolean;           // stitch counts
    showAlsoOnJob: boolean;          // mixed-decoration indicator (type-specific reports)
}

const FULL_FIELD_CONFIG: ReportFieldConfig = {
    showExecutiveSummary: true,
    showStatusBreakdown: true,
    showDecorationSummary: true,
    showFinancials: true,
    showCustomer: true,
    showJobName: true,
    showStatus: true,
    showDateOrdered: true,
    showDueDate: true,
    showDaysUntilDue: true,
    showTotalItems: true,
    showDecoBreakdown: true,
    showEstTime: true,
    showStitches: true,
    showAlsoOnJob: true,
};

// Department-safe preset: no financials, no pipeline KPIs, no status/deco summaries.
// Keeps what shop-floor staff actually need: who, when, how much of their work.
const DEPARTMENT_FIELD_CONFIG: ReportFieldConfig = {
    showExecutiveSummary: false,
    showStatusBreakdown: false,
    showDecorationSummary: false,
    showFinancials: false,
    showCustomer: true,
    showJobName: true,
    showStatus: true,
    showDateOrdered: false,
    showDueDate: true,
    showDaysUntilDue: false,
    showTotalItems: false,
    showDecoBreakdown: true,
    showEstTime: true,
    showStitches: true,
    showAlsoOnJob: true,
};

// Very minimal: barcode-ready sheet — Job #, Due, Items only.
const MINIMAL_FIELD_CONFIG: ReportFieldConfig = {
    showExecutiveSummary: false,
    showStatusBreakdown: false,
    showDecorationSummary: false,
    showFinancials: false,
    showCustomer: true,
    showJobName: false,
    showStatus: false,
    showDateOrdered: false,
    showDueDate: true,
    showDaysUntilDue: false,
    showTotalItems: false,
    showDecoBreakdown: true,
    showEstTime: false,
    showStitches: false,
    showAlsoOnJob: true,
};

const FIELD_CONFIG_STORAGE_KEY = 'stash_production_report_fields';

const loadFieldConfig = (): ReportFieldConfig => {
    try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(FIELD_CONFIG_STORAGE_KEY) : null;
        if (!raw) return FULL_FIELD_CONFIG;
        const parsed = JSON.parse(raw);
        return { ...FULL_FIELD_CONFIG, ...parsed };
    } catch { return FULL_FIELD_CONFIG; }
};

const saveFieldConfig = (cfg: ReportFieldConfig) => {
    try {
        if (typeof window !== 'undefined') window.localStorage.setItem(FIELD_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
    } catch { /* storage may be unavailable */ }
};

// Readable labels for the field filter UI.
const FIELD_LABELS: { key: keyof ReportFieldConfig; label: string; group: 'sections' | 'columns' | 'sensitive' }[] = [
    { key: 'showFinancials',         label: 'Financial info (pipeline + job value)', group: 'sensitive' },
    { key: 'showExecutiveSummary',   label: 'Executive summary (KPI tiles)',         group: 'sections' },
    { key: 'showStatusBreakdown',    label: 'Status breakdown grid',                 group: 'sections' },
    { key: 'showDecorationSummary',  label: 'Decoration type summary table',         group: 'sections' },
    { key: 'showCustomer',           label: 'Customer name',                         group: 'columns' },
    { key: 'showJobName',            label: 'Job name',                              group: 'columns' },
    { key: 'showStatus',             label: 'Status',                                group: 'columns' },
    { key: 'showDueDate',            label: 'Due date',                              group: 'columns' },
    { key: 'showDateOrdered',        label: 'Date ordered (CSV)',                    group: 'columns' },
    { key: 'showDaysUntilDue',       label: 'Days until due (CSV)',                  group: 'columns' },
    { key: 'showTotalItems',         label: 'Total items per job',                   group: 'columns' },
    { key: 'showDecoBreakdown',      label: 'Decoration breakdown (EMB / Print / per-type)', group: 'columns' },
    { key: 'showStitches',           label: 'Stitch counts',                         group: 'columns' },
    { key: 'showEstTime',            label: 'Estimated production time',             group: 'columns' },
    { key: 'showAlsoOnJob',          label: 'Mixed-decoration indicator',            group: 'columns' },
];

const configsEqual = (a: ReportFieldConfig, b: ReportFieldConfig): boolean => {
    for (const f of FIELD_LABELS) if (a[f.key] !== b[f.key]) return false;
    return true;
};

// ─── Per-row print-annotation storage ───────────────────────────────────
// Notes and "Aim" dates are decorations the user attaches to individual
// jobs specifically for the printed report — separate from Deco's real
// due date. Keyed by jobNumber so they survive re-fetches that change the
// internal job.id. Persisted per-browser.
const ROW_NOTES_KEY = 'stash_production_row_notes';
const ROW_AIMS_KEY = 'stash_production_row_aim_dates';

const loadStringRecord = (key: string): Record<string, string> => {
    try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
};

const saveStringRecord = (key: string, value: Record<string, string>) => {
    try {
        if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage may be unavailable */ }
};

export default function DecoProductionTable({ decoJobs, onNavigateToOrder, onEnrichProduction, isEnriching, enrichMsg }: Props) {
    const [sortKey, setSortKey] = useState<SortKey>('due');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    // Multi-select status filters. Empty set == "Active" (all not-shipped/completed/cancelled).
    const [statusFilters, setStatusFilters] = useState<Set<Exclude<StatusFilter, 'active'>>>(new Set());
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedJob, setExpandedJob] = useState<string | null>(null);
    const [hideIncomplete, setHideIncomplete] = useState(false);
    const [dueFrom, setDueFrom] = useState('');
    const [dueTo, setDueTo] = useState('');
    const [orderedFrom, setOrderedFrom] = useState('');
    const [orderedTo, setOrderedTo] = useState('');
    const tableRef = useRef<HTMLDivElement>(null);

    // Report field visibility — persisted per-browser.
    const [fieldConfig, setFieldConfig] = useState<ReportFieldConfig>(() => loadFieldConfig());
    const [showFieldPanel, setShowFieldPanel] = useState(false);
    const fieldPanelRef = useRef<HTMLDivElement>(null);

    useEffect(() => { saveFieldConfig(fieldConfig); }, [fieldConfig]);

    // Per-row PDF controls: selection, notes, and aim dates.
    // When a selection exists we export *only* those rows; otherwise we fall
    // back to the full scoped list like before. Notes and aim dates persist
    // across sessions regardless of whether the row is currently selected,
    // so work isn't lost when someone unchecks and re-checks a job.
    const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
    const [jobNotes, setJobNotes] = useState<Record<string, string>>(() => loadStringRecord(ROW_NOTES_KEY));
    const [aimDates, setAimDates] = useState<Record<string, string>>(() => loadStringRecord(ROW_AIMS_KEY));
    useEffect(() => { saveStringRecord(ROW_NOTES_KEY, jobNotes); }, [jobNotes]);
    useEffect(() => { saveStringRecord(ROW_AIMS_KEY, aimDates); }, [aimDates]);

    const toggleJobSelected = (jobId: string) => {
        setSelectedJobIds(prev => {
            const next = new Set(prev);
            if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
            return next;
        });
    };
    const setJobNote = (jobNumber: string, value: string) => {
        setJobNotes(prev => {
            const next = { ...prev };
            if (value) next[jobNumber] = value; else delete next[jobNumber];
            return next;
        });
    };
    const setJobAim = (jobNumber: string, value: string) => {
        setAimDates(prev => {
            const next = { ...prev };
            if (value) next[jobNumber] = value; else delete next[jobNumber];
            return next;
        });
    };

    // Close the field panel when the user clicks outside of it.
    useEffect(() => {
        if (!showFieldPanel) return;
        const handler = (e: MouseEvent) => {
            if (fieldPanelRef.current && !fieldPanelRef.current.contains(e.target as Node)) {
                setShowFieldPanel(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showFieldPanel]);

    // Active preset name for display (or "Custom").
    const activePresetName = useMemo(() => {
        if (configsEqual(fieldConfig, FULL_FIELD_CONFIG)) return 'Full';
        if (configsEqual(fieldConfig, DEPARTMENT_FIELD_CONFIG)) return 'Department';
        if (configsEqual(fieldConfig, MINIMAL_FIELD_CONFIG)) return 'Minimal';
        return 'Custom';
    }, [fieldConfig]);

    // Ticking "now" — updates every 60s so days-until-due / overdue badges
    // don't go stale for users who leave the tab open all day.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNowTick(Date.now()), 60_000);
        return () => clearInterval(id);
    }, []);
    const now = useMemo(() => new Date(nowTick), [nowTick]);

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
            // Per-job EMB/Print completion. Use the shared isEmbItem helper so
            // stitch-only items (no decorationType) still count as embroidery.
            const embItems = job.items.filter(isEmbItem);
            const embTotal = embItems.reduce((a, i) => a + i.quantity, 0);
            const embDone = embItems.filter(i => i.isProduced || i.isShipped).reduce((a, i) => a + i.quantity, 0);
            const printItems = job.items.filter(i => !isEmbItem(i) && i.decorationType && PRINT_TYPES.has(i.decorationType));
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

        // Multi-select status filters (shipped/completed already excluded by enrichedJobs).
        // Empty selection => show all of enrichedJobs (i.e. "Active"). Otherwise show union.
        if (statusFilters.size > 0) {
            list = list.filter(j => {
                for (const f of statusFilters) {
                    if (f === 'production' && PRODUCTION_STATUSES.has(j.status)) return true;
                    if (f === 'awaiting' && AWAITING_STATUSES.has(j.status)) return true;
                    if (f === 'awaitingStock' && j.status === 'Awaiting Stock') return true;
                    if (f === 'awaitingProcessing' && j.status === 'Awaiting Processing') return true;
                    if (f === 'partiallyFulfilled' && isPartiallyFulfilled(j.items)) return true;
                    if (f === 'awaitingShipping' && j.status === 'Ready for Shipping') return true;
                }
                return false;
            });
        }

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
    }, [enrichedJobs, hideIncomplete, statusFilters, typeFilter, searchTerm, sortKey, sortDir, dueFrom, dueTo, orderedFrom, orderedTo]);

    const incompleteCount = useMemo(() => {
        let base = enrichedJobs;
        if (statusFilters.size > 0) {
            base = base.filter(j => {
                for (const f of statusFilters) {
                    if (f === 'production' && PRODUCTION_STATUSES.has(j.status)) return true;
                    if (f === 'awaiting' && AWAITING_STATUSES.has(j.status)) return true;
                    if (f === 'awaitingStock' && j.status === 'Awaiting Stock') return true;
                    if (f === 'awaitingProcessing' && j.status === 'Awaiting Processing') return true;
                    if (f === 'partiallyFulfilled' && isPartiallyFulfilled(j.items)) return true;
                    if (f === 'awaitingShipping' && j.status === 'Ready for Shipping') return true;
                }
                return false;
            });
        }
        return base.filter(j => j.decoTypes.length === 0).length;
    }, [enrichedJobs, statusFilters]);

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
        if (statusFilters.size > 0) {
            base = base.filter(j => {
                for (const f of statusFilters) {
                    if (f === 'production' && PRODUCTION_STATUSES.has(j.status)) return true;
                    if (f === 'awaiting' && AWAITING_STATUSES.has(j.status)) return true;
                    if (f === 'awaitingStock' && j.status === 'Awaiting Stock') return true;
                    if (f === 'awaitingProcessing' && j.status === 'Awaiting Processing') return true;
                    if (f === 'partiallyFulfilled' && j.items && isPartiallyFulfilled(j.items)) return true;
                    if (f === 'awaitingShipping' && j.status === 'Ready for Shipping') return true;
                }
                return false;
            });
        }
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            base = base.filter(j => j.jobNumber.includes(s) || j.customerName.toLowerCase().includes(s) || j.jobName.toLowerCase().includes(s) || j.decoTypes.some(t => t.toLowerCase().includes(s)));
        }
        base.forEach(j => j.decoTypes.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
        return counts;
    }, [enrichedJobs, statusFilters, searchTerm]);

    // Jobs included in exported reports (respect selected status filters, ignore search/date/type).
    const scopedJobsBase = useMemo(() => {
        if (statusFilters.size === 0) return enrichedJobs;
        return enrichedJobs.filter(j => {
            for (const f of statusFilters) {
                if (f === 'production' && PRODUCTION_STATUSES.has(j.status)) return true;
                if (f === 'awaiting' && AWAITING_STATUSES.has(j.status)) return true;
                if (f === 'awaitingStock' && j.status === 'Awaiting Stock') return true;
                if (f === 'awaitingProcessing' && j.status === 'Awaiting Processing') return true;
                if (f === 'partiallyFulfilled' && isPartiallyFulfilled(j.items)) return true;
                if (f === 'awaitingShipping' && j.status === 'Ready for Shipping') return true;
            }
            return false;
        });
    }, [enrichedJobs, statusFilters]);

    // If the user has ticked specific rows, exports are scoped to just those.
    // Otherwise we fall back to the full filter-scoped list (prior behaviour).
    // Selection-IDs that no longer match any job are silently ignored.
    const scopedJobs = useMemo(() => {
        if (selectedJobIds.size === 0) return scopedJobsBase;
        const picked = scopedJobsBase.filter(j => selectedJobIds.has(j.id));
        // Fall back if every selected row got filtered out by status — avoids
        // generating an empty report.
        return picked.length > 0 ? picked : scopedJobsBase;
    }, [scopedJobsBase, selectedJobIds]);

    // Count of the user's currently-active selection that actually appears in
    // the visible list — used to show "N selected" and disable the master toggle.
    const visibleSelectedCount = useMemo(() => {
        if (selectedJobIds.size === 0) return 0;
        return scopedJobsBase.reduce((n, j) => n + (selectedJobIds.has(j.id) ? 1 : 0), 0);
    }, [scopedJobsBase, selectedJobIds]);

    const scopeLabel = useMemo(() => {
        if (visibleSelectedCount > 0) {
            return `${visibleSelectedCount} selected job${visibleSelectedCount === 1 ? '' : 's'}`;
        }
        if (statusFilters.size === 0) return 'All Active Jobs';
        // Preserve the order of STATUS_FILTER_KEYS for consistent display.
        return STATUS_FILTER_KEYS.filter(k => statusFilters.has(k)).map(k => STATUS_FILTER_LABELS[k]).join(' + ');
    }, [statusFilters, visibleSelectedCount]);

    const handleGenerateReport = () => {
        const cfg = fieldConfig; // snapshot so helpers below see a stable reference
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

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // Shared CSS for both report variants
        const styles = `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: A4; margin: 14mm 12mm; }
            html, body { background: #fff; color: #1a1a2e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10px; line-height: 1.4; }
            body { padding: 8px; }
            .report-header { border-bottom: 2px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
            .brand { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #666; margin-bottom: 2px; }
            h1 { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #1a1a2e; }
            h1 .type-tag { display: inline-block; margin-left: 8px; padding: 3px 10px; border-radius: 5px; font-size: 13px; font-weight: 900; vertical-align: middle; }
            .meta { text-align: right; font-size: 9px; color: #666; line-height: 1.5; }
            .meta strong { color: #1a1a2e; font-size: 10px; }
            h2 { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #4f46e5; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
            h2:first-of-type { margin-top: 0; }
            .kpi-grid { display: grid; gap: 8px; margin-bottom: 4px; }
            .kpi-grid.cols-5 { grid-template-columns: repeat(5, 1fr); }
            .kpi-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
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
            td.mixed-job { font-size: 8px; color: #6b7280; font-style: italic; }
            td.mixed-job strong { color: #c2410c; font-style: normal; font-weight: 800; }
            .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid; }
            .badge-status-stock { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
            .badge-status-processing { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
            .badge-status-production { background: #eef2ff; color: #4338ca; border-color: #a5b4fc; }
            .badge-status-partial { background: #fff7ed; color: #c2410c; border-color: #fdba74; }
            .badge-status-ready { background: #ecfdf5; color: #047857; border-color: #6ee7b7; }
            .badge-status-other { background: #f9fafb; color: #6b7280; border-color: #d1d5db; }
            .print-footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8px; color: #9ca3af; text-align: center; letter-spacing: 0.5px; }
            .empty { padding: 30px; text-align: center; color: #9ca3af; font-size: 11px; }
            .note-box { margin-bottom: 14px; padding: 10px 12px; background: #fff7ed; border: 1px solid #fdba74; border-radius: 6px; font-size: 9px; color: #7c2d12; line-height: 1.5; }
            .note-box strong { color: #7c2d12; }
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

        const openAndPrint = (title: string, bodyHtml: string) => {
            const win = window.open('', '_blank');
            if (!win) {
                alert('Please allow pop-ups for this site to generate the report.');
                return;
            }
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${styles}</style></head><body>${bodyHtml}</body></html>`;
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.focus();
            setTimeout(() => { try { win.print(); } catch { /* user can click the button */ } }, 250);
        };

        // ──────────────────────────────────────────────────────────────────
        // TYPE-SPECIFIC REPORT (when a decoration type filter is active)
        // ──────────────────────────────────────────────────────────────────
        if (typeFilter) {
            const activeType = typeFilter;
            const isEmbReport = activeType === 'EMB';
            const typeLabel = isEmbReport ? 'Embroidery' : activeType;

            // Badge color palette per type — matches the on-screen decoration badges.
            const badgeColors: Record<string, { bg: string; text: string; border: string }> = {
                EMB: { bg: '#f3e8ff', text: '#6b21a8', border: '#c084fc' },
                DTF: { bg: '#ecfeff', text: '#155e75', border: '#67e8f9' },
                DTG: { bg: '#e8eaf6', text: '#283593', border: '#7986cb' },
                SCREEN: { bg: '#e8f5e9', text: '#1b5e20', border: '#81c784' },
                TRANSFER: { bg: '#fff3e0', text: '#bf360c', border: '#ff8a65' },
                UV: { bg: '#e3f2fd', text: '#0d47a1', border: '#64b5f6' },
                FLEX: { bg: '#fff8e1', text: '#e65100', border: '#ffb74d' },
                VINYL: { bg: '#e0f2f1', text: '#004d40', border: '#4db6ac' },
                SUBLIMATION: { bg: '#fce4ec', text: '#ad1457', border: '#f06292' },
                FREEFORM: { bg: '#fce4ec', text: '#880e4f', border: '#f48fb1' },
            };
            const bc = badgeColors[activeType] || { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' };

            // Build per-job rows filtered to this type's workload.
            type TypeRow = {
                jobNumber: string;
                customer: string;
                jobName: string;
                status: string;
                dueDate: string;
                dueClass: '' | 'overdue' | 'due-soon';
                typeQty: number;
                typeStitches: number; // only populated for EMB
                typeMinutes: number;
                jobTotalQty: number;
                otherTypes: string[];
                jobValue: number;
                note: string;         // optional per-row PDF note
                aimDate: string;      // optional per-row aim date (yyyy-mm-dd)
            };

            const typeRows: TypeRow[] = [];
            for (const job of scopedJobs) {
                // Items belonging to the active type on this job.
                const typeItems = job.items.filter(i =>
                    isEmbReport ? isEmbItem(i) : (i.decorationType || '').toUpperCase() === activeType,
                );
                if (typeItems.length === 0) continue;
                const typeQty = typeItems.reduce((a, i) => a + (i.quantity || 0), 0);
                if (typeQty === 0) continue;
                const typeStitches = isEmbReport
                    ? typeItems.reduce((a, i) => a + (i.stitchCount ?? 0) * (i.quantity || 0), 0)
                    : 0;
                const typeEst = estimateProductionTime(typeItems);
                const otherTypes = Array.from(new Set(job.items
                    .filter(i => !(isEmbReport ? isEmbItem(i) : (i.decorationType || '').toUpperCase() === activeType))
                    .map(i => {
                        if (isEmbItem(i)) return 'EMB';
                        return (i.decorationType || '').toUpperCase();
                    })
                    .filter(t => t && t !== 'NONE')
                ));
                const dueClass: '' | 'overdue' | 'due-soon' =
                    job.daysUntilDue === null || job.daysUntilDue === undefined ? ''
                        : job.daysUntilDue < 0 ? 'overdue'
                        : job.daysUntilDue <= 3 ? 'due-soon'
                        : '';
                typeRows.push({
                    jobNumber: job.jobNumber,
                    customer: job.customerName,
                    jobName: job.jobName,
                    status: job.status,
                    dueDate: job.dateDue ? new Date(job.dateDue).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
                    dueClass,
                    typeQty,
                    typeStitches,
                    typeMinutes: typeEst.totalMinutes,
                    jobTotalQty: job.totalQty,
                    otherTypes,
                    jobValue: job.jobValue,
                    note: (jobNotes[job.jobNumber] || '').trim(),
                    aimDate: aimDates[job.jobNumber] || '',
                });
            }

            const anyAimDates = typeRows.some(r => r.aimDate);

            // Sort by due date (overdue/soonest first), then by job number.
            typeRows.sort((a, b) => {
                const aDue = a.dueDate === '—' ? Infinity : new Date(a.dueDate).getTime();
                const bDue = b.dueDate === '—' ? Infinity : new Date(b.dueDate).getTime();
                if (aDue !== bDue) return aDue - bDue;
                return a.jobNumber.localeCompare(b.jobNumber);
            });

            const totals = typeRows.reduce((acc, r) => {
                acc.jobs += 1;
                acc.qty += r.typeQty;
                acc.stitches += r.typeStitches;
                acc.minutes += r.typeMinutes;
                acc.value += r.jobValue;
                acc.mixedJobs += r.otherTypes.length > 0 ? 1 : 0;
                return acc;
            }, { jobs: 0, qty: 0, stitches: 0, minutes: 0, value: 0, mixedJobs: 0 });

            // KPI tiles — conditional on cfg.
            type KpiTile = { label: string; value: string; sub: string; cls: string };
            const kpiTiles: KpiTile[] = [];
            kpiTiles.push({
                label: 'Jobs',
                value: String(totals.jobs),
                sub: isEmbReport ? 'with embroidery work' : `with ${typeLabel} work`,
                cls: isEmbReport ? 'accent-emb' : 'accent-print',
            });
            kpiTiles.push({
                label: isEmbReport ? 'Items to Embroider' : 'Items',
                value: totals.qty.toLocaleString(),
                sub: 'total pieces',
                cls: isEmbReport ? 'accent-emb' : 'accent-print',
            });
            if (isEmbReport && cfg.showStitches) {
                kpiTiles.push({
                    label: 'Total Stitches',
                    value: fmtStitches(totals.stitches),
                    sub: 'across all items',
                    cls: 'accent-emb',
                });
            }
            if (cfg.showEstTime) {
                kpiTiles.push({
                    label: 'Est. Time',
                    value: fmtTime(totals.minutes),
                    sub: isEmbReport ? 'embroidery only' : `${typeLabel} only`,
                    cls: '',
                });
            }
            if (cfg.showFinancials) {
                kpiTiles.push({
                    label: 'Pipeline Value',
                    value: fmtK(totals.value),
                    sub: `${totals.jobs} ${totals.jobs === 1 ? 'job' : 'jobs'} total`,
                    cls: 'accent-value',
                });
            }

            const kpiHtml = (cfg.showExecutiveSummary && kpiTiles.length > 0) ? `
                <div class="kpi-grid cols-${Math.min(kpiTiles.length, 5)}">
                    ${kpiTiles.map(t => `
                        <div class="kpi ${t.cls}">
                            <div class="label">${esc(t.label)}</div>
                            <div class="value">${esc(t.value)}</div>
                            <div class="sub">${esc(t.sub)}</div>
                        </div>
                    `).join('')}
                </div>
            ` : '';

            // Build job-detail columns dynamically so everything stays aligned.
            type ColDef = {
                header: string;
                numeric?: boolean;
                renderCell: (r: TypeRow) => string;
                renderTotal: () => string;
                cellClass?: (r: TypeRow) => string;
            };
            const fmtAim = (iso: string) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
            const noteLineHtml = (r: TypeRow) => r.note
                ? `<div style="font-size:8px;font-style:italic;color:#7c2d12;margin-top:2px;">📝 ${esc(r.note)}</div>`
                : '';
            const cols: ColDef[] = [
                {
                    header: 'Job #',
                    renderCell: r => `<strong>#${esc(r.jobNumber)}</strong>${!cfg.showJobName && !cfg.showCustomer ? noteLineHtml(r) : ''}`,
                    renderTotal: () => `TOTAL · ${totals.jobs} ${totals.jobs === 1 ? 'job' : 'jobs'}`,
                },
            ];
            if (cfg.showCustomer) cols.push({
                header: 'Customer',
                renderCell: r => `${esc(r.customer)}${!cfg.showJobName ? noteLineHtml(r) : ''}`,
                renderTotal: () => '',
            });
            if (cfg.showJobName) cols.push({
                header: 'Job Name',
                renderCell: r => `${esc(r.jobName)}${noteLineHtml(r)}`,
                renderTotal: () => '',
            });
            if (cfg.showStatus) cols.push({
                header: 'Status',
                renderCell: r => `<span class="badge ${statusBadgeClass(r.status)}">${esc(r.status)}</span>`,
                renderTotal: () => '',
            });
            if (cfg.showDueDate) cols.push({
                header: 'Due',
                renderCell: r => esc(r.dueDate),
                renderTotal: () => '',
                cellClass: r => r.dueClass,
            });
            if (anyAimDates) cols.push({
                header: 'Aim',
                renderCell: r => r.aimDate ? `<strong style="color:#047857;">${esc(fmtAim(r.aimDate))}</strong>` : '—',
                renderTotal: () => '',
            });
            cols.push({
                header: `${typeLabel} Items`,
                numeric: true,
                renderCell: r => `${r.typeQty.toLocaleString()}${cfg.showTotalItems && r.jobTotalQty > r.typeQty ? ` <span style="color:#9ca3af;font-weight:400;">/ ${r.jobTotalQty}</span>` : ''}`,
                renderTotal: () => totals.qty.toLocaleString(),
            });
            if (isEmbReport && cfg.showStitches) cols.push({
                header: 'Stitches',
                numeric: true,
                renderCell: r => r.typeStitches > 0 ? fmtStitches(r.typeStitches) : '—',
                renderTotal: () => fmtStitches(totals.stitches),
            });
            if (cfg.showEstTime) cols.push({
                header: 'Est. Time',
                numeric: true,
                renderCell: r => r.typeMinutes > 0 ? fmtTime(r.typeMinutes) : '—',
                renderTotal: () => fmtTime(totals.minutes),
            });
            if (cfg.showAlsoOnJob) cols.push({
                header: 'Also on Job',
                renderCell: r => r.otherTypes.length === 0 ? '—' : `<strong>Mixed:</strong> ${r.otherTypes.map(t => esc(t)).join(', ')}`,
                renderTotal: () => totals.mixedJobs > 0 ? `${totals.mixedJobs} mixed` : '—',
                cellClass: () => 'mixed-job',
            });

            const tableHtml = typeRows.length === 0 ? `<div class="empty">No active ${esc(typeLabel)} jobs to report on.</div>` : `
                <table>
                    <thead>
                        <tr>${cols.map(c => `<th${c.numeric ? ' class="num"' : ''}>${esc(c.header)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${typeRows.map(r => `
                            <tr>${cols.map(c => {
                                const classes = [c.numeric ? 'num' : '', c.cellClass ? c.cellClass(r) : ''].filter(Boolean).join(' ');
                                return `<td${classes ? ` class="${classes}"` : ''}>${c.renderCell(r)}</td>`;
                            }).join('')}</tr>
                        `).join('')}
                        <tr class="total-row">${cols.map((c, i) => `<td${c.numeric ? ' class="num"' : ''}>${i === 0 ? c.renderTotal() : c.renderTotal()}</td>`).join('')}</tr>
                    </tbody>
                </table>
            `;

            const mixedNote = totals.mixedJobs > 0 ? `
                <div class="note-box">
                    <strong>Note:</strong> ${totals.mixedJobs} of these ${totals.jobs === 1 ? 'job is' : 'jobs are'} <strong>mixed decoration</strong> — they also have other work (shown in the "Also on Job" column).
                    Do not mark the order complete until all decoration types are finished.
                </div>
            ` : '';

            const bodyHtml = `
                <div class="actions no-print">
                    <span>${esc(typeLabel)} production report — use your browser's print dialog to save as PDF or send to the printer.</span>
                    <button onclick="window.print()">Print / Save as PDF</button>
                </div>
                <div class="report-header">
                    <div>
                        <div class="brand">Stash Production</div>
                        <h1>${esc(typeLabel)} Production Report<span class="type-tag" style="background:${bc.bg};color:${bc.text};border:1px solid ${bc.border};">${esc(activeType)}</span></h1>
                    </div>
                    <div class="meta">
                        <strong>${esc(dateStr)}</strong><br>
                        Generated ${esc(timeStr)}<br>
                        Scope: <strong>${esc(scopeLabel)}</strong><br>
                        ${totals.jobs} ${totals.jobs === 1 ? 'job' : 'jobs'} · ${totals.qty.toLocaleString()} items
                    </div>
                </div>

                ${cfg.showAlsoOnJob ? mixedNote : ''}

                ${kpiHtml ? `<h2>Summary</h2>${kpiHtml}` : ''}

                <h2>Job Detail</h2>
                ${tableHtml}

                <div class="print-footer">
                    Stash ${esc(typeLabel)} Production Report · ${esc(dateStr)} · ${esc(timeStr)} · Filtered to ${esc(activeType)} work only
                </div>
            `;

            openAndPrint(`${typeLabel} Production Report — ${dateStr}`, bodyHtml);
            return;
        }

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
            note: string;
            aimDate: string;
        };

        const rows: JobRow[] = scopedJobs.map(job => {
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
                note: (jobNotes[job.jobNumber] || '').trim(),
                aimDate: aimDates[job.jobNumber] || '',
            };
        });
        const anyFullAimDates = rows.some(r => r.aimDate);

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

        // Status breakdown — counts within the selected scope so the report is self-consistent.
        const statusGroups = [
            { label: 'Awaiting Stock', count: scopedJobs.filter(j => j.status === 'Awaiting Stock').length },
            { label: 'Awaiting Processing', count: scopedJobs.filter(j => j.status === 'Awaiting Processing').length },
            { label: 'In Production', count: scopedJobs.filter(j => PRODUCTION_STATUSES.has(j.status)).length },
            { label: 'Partially Fulfilled', count: scopedJobs.filter(j => isPartiallyFulfilled(j.items)).length },
            { label: 'Awaiting Shipping', count: scopedJobs.filter(j => j.status === 'Ready for Shipping').length },
            { label: 'Other / On Hold', count: scopedJobs.filter(j => j.status === 'On Hold' || j.status === 'Awaiting Artwork' || j.status === 'Awaiting Review' || j.status === 'Awaiting PO' || j.status === 'Not Ordered').length },
        ];

        // Decoration summary (Embroidery + per-print-type).
        // Only include rows that actually have work — hides the long list of
        // zero-qty print types so the summary stays clean.
        const embJobCount = rows.filter(r => r.embQty > 0).length;
        const decorationRows: { label: string; jobs: number; qty: number; extra: string; highlight: boolean }[] = [];
        if (totals.embQty > 0) {
            decorationRows.push({ label: 'Embroidery', jobs: embJobCount, qty: totals.embQty, extra: `${fmtStitches(totals.embStitches)} stitches`, highlight: true });
        }
        for (const t of printTypeCols) {
            if (totals.perType[t] > 0) {
                decorationRows.push({
                    label: t,
                    jobs: rows.filter(r => r.perType[t] > 0).length,
                    qty: totals.perType[t],
                    extra: '',
                    highlight: false,
                });
            }
        }
        if (totals.otherPrintQty > 0) {
            decorationRows.push({ label: 'Other Print', jobs: rows.filter(r => r.otherPrintQty > 0).length, qty: totals.otherPrintQty, extra: '', highlight: false });
        }
        if (totals.untypedQty > 0) {
            decorationRows.push({ label: 'Untyped', jobs: rows.filter(r => r.untypedQty > 0).length, qty: totals.untypedQty, extra: '', highlight: false });
        }

        // ──────────────────────────────────────────────────────────────────
        // FULL REPORT (no type filter)
        // ──────────────────────────────────────────────────────────────────

        // Executive Summary KPI tiles — conditional on cfg.
        type KpiTile = { label: string; value: string; sub: string; cls: string };
        const summaryTiles: KpiTile[] = [];
        summaryTiles.push({
            label: 'Active Jobs',
            value: String(totals.jobs),
            sub: `${totals.totalQty.toLocaleString()} items total`,
            cls: '',
        });
        if (cfg.showDecoBreakdown) {
            summaryTiles.push({
                label: 'Embroidery',
                value: totals.embQty.toLocaleString(),
                sub: `${cfg.showStitches ? fmtStitches(totals.embStitches) + ' stitches · ' : ''}${embJobCount} jobs`,
                cls: 'accent-emb',
            });
            summaryTiles.push({
                label: 'Print',
                value: totals.printQty.toLocaleString(),
                sub: `${rows.filter(r => r.printQty > 0).length} jobs`,
                cls: 'accent-print',
            });
        }
        if (cfg.showEstTime) {
            summaryTiles.push({
                label: 'Est. Time',
                value: fmtTime(totals.estMinutes),
                sub: 'production hours',
                cls: '',
            });
        }
        if (cfg.showFinancials) {
            summaryTiles.push({
                label: 'Pipeline Value',
                value: fmtK(totals.jobValue),
                sub: 'across all active jobs',
                cls: 'accent-value',
            });
        }
        const kpiHtml = summaryTiles.length === 0 ? '' : `
            <div class="kpi-grid cols-${Math.min(summaryTiles.length, 5)}">
                ${summaryTiles.map(t => `
                    <div class="kpi ${t.cls}">
                        <div class="label">${esc(t.label)}</div>
                        <div class="value">${esc(t.value)}</div>
                        <div class="sub">${esc(t.sub)}</div>
                    </div>
                `).join('')}
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
                        <td>${totals.embStitches > 0 ? `${fmtStitches(totals.embStitches)} stitches (embroidery)` : ''}</td>
                    </tr>
                </tbody>
            </table>
        `;

        // Job detail columns — build dynamically from cfg so everything aligns.
        type FullColDef = {
            header: string;
            numeric?: boolean;
            renderCell: (r: JobRow) => string;
            renderTotal: () => string;
            cellClass?: (r: JobRow) => string;
        };
        const fmtAimFull = (iso: string) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const noteLineFull = (r: JobRow) => r.note
            ? `<div style="font-size:8px;font-style:italic;color:#7c2d12;margin-top:2px;">📝 ${esc(r.note)}</div>`
            : '';
        const fullCols: FullColDef[] = [
            {
                header: 'Job #',
                renderCell: r => `<strong>#${esc(r.jobNumber)}</strong>${!cfg.showCustomer ? noteLineFull(r) : ''}`,
                renderTotal: () => `TOTAL · ${totals.jobs} jobs`,
            },
        ];
        if (cfg.showCustomer) fullCols.push({
            header: 'Customer',
            renderCell: r => `${esc(r.customer)}${r.jobName ? `<div style="font-size:8px;color:#6b7280;">${esc(r.jobName)}</div>` : ''}${noteLineFull(r)}`,
            renderTotal: () => '',
        });
        if (cfg.showStatus) fullCols.push({
            header: 'Status',
            renderCell: r => `<span class="badge ${statusBadgeClass(r.status)}">${esc(r.status)}</span>`,
            renderTotal: () => '',
        });
        if (cfg.showDueDate) fullCols.push({
            header: 'Due',
            renderCell: r => esc(r.dueDate),
            renderTotal: () => '',
            cellClass: r => r.dueClass,
        });
        if (anyFullAimDates) fullCols.push({
            header: 'Aim',
            renderCell: r => r.aimDate ? `<strong style="color:#047857;">${esc(fmtAimFull(r.aimDate))}</strong>` : '—',
            renderTotal: () => '',
        });
        if (cfg.showTotalItems) fullCols.push({
            header: 'Items',
            numeric: true,
            renderCell: r => String(r.totalQty),
            renderTotal: () => totals.totalQty.toLocaleString(),
        });
        if (cfg.showDecoBreakdown) {
            fullCols.push({
                header: 'Embroidery',
                numeric: true,
                renderCell: r => r.embQty > 0 ? r.embQty.toLocaleString() : '—',
                renderTotal: () => totals.embQty.toLocaleString(),
            });
            if (cfg.showStitches) fullCols.push({
                header: 'Stitches',
                numeric: true,
                renderCell: r => r.embStitches > 0 ? fmtStitches(r.embStitches) : '—',
                renderTotal: () => fmtStitches(totals.embStitches),
            });
            fullCols.push({
                header: 'Print',
                numeric: true,
                renderCell: r => r.printQty > 0 ? r.printQty.toLocaleString() : '—',
                renderTotal: () => totals.printQty.toLocaleString(),
            });
        }
        if (cfg.showEstTime) fullCols.push({
            header: 'Est. Time',
            numeric: true,
            renderCell: r => r.estMinutes > 0 ? fmtTime(r.estMinutes) : '—',
            renderTotal: () => fmtTime(totals.estMinutes),
        });
        if (cfg.showFinancials) fullCols.push({
            header: 'Value',
            numeric: true,
            renderCell: r => r.jobValue > 0 ? fmtK(r.jobValue) : '—',
            renderTotal: () => fmtK(totals.jobValue),
        });

        const jobsTableHtml = rows.length === 0 ? '<div class="empty">No active jobs to report on.</div>' : `
            <table>
                <thead>
                    <tr>${fullCols.map(c => `<th${c.numeric ? ' class="num"' : ''}>${esc(c.header)}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>${fullCols.map(c => {
                            const classes = [c.numeric ? 'num' : '', c.cellClass ? c.cellClass(r) : ''].filter(Boolean).join(' ');
                            return `<td${classes ? ` class="${classes}"` : ''}>${c.renderCell(r)}</td>`;
                        }).join('')}</tr>
                    `).join('')}
                    <tr class="total-row">${fullCols.map(c => `<td${c.numeric ? ' class="num"' : ''}>${c.renderTotal()}</td>`).join('')}</tr>
                </tbody>
            </table>
        `;

        const footerBits: string[] = [`${totals.jobs} jobs`];
        if (cfg.showFinancials) footerBits.push(`${fmtK(totals.jobValue)} pipeline`);

        const bodyHtml = `
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
                    Scope: <strong>${esc(scopeLabel)}</strong><br>
                    ${totals.jobs} ${totals.jobs === 1 ? 'job' : 'jobs'}
                </div>
            </div>

            ${cfg.showExecutiveSummary ? `<h2>Executive Summary</h2>${kpiHtml}` : ''}

            ${cfg.showStatusBreakdown ? `<h2>Status Breakdown</h2>${statusHtml}` : ''}

            ${cfg.showDecorationSummary ? `<h2>Decoration Summary</h2>${decorationTableHtml}` : ''}

            <h2>Job Detail</h2>
            ${jobsTableHtml}

            <div class="print-footer">
                Stash Production Report · ${esc(dateStr)} · ${esc(timeStr)} · ${footerBits.join(' · ')}
            </div>
        `;

        openAndPrint(`Production Report — ${dateStr}`, bodyHtml);
    };

    const handleDownloadCsv = () => {
        const cfg = fieldConfig;
        // RFC 4180 CSV field escape
        const esc = (v: string | number | null | undefined): string => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
        };
        const formatDate = (d: string | undefined): string =>
            d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

        const printTypeCols = ['DTF', 'DTG', 'SCREEN', 'TRANSFER', 'UV', 'FLEX', 'VINYL', 'SUBLIMATION', 'FREEFORM'];

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const lines: string[] = [];

        // ── TYPE-SPECIFIC CSV ───────────────────────────────────────────
        if (typeFilter) {
            const activeType = typeFilter;
            const isEmbReport = activeType === 'EMB';
            const typeLabel = isEmbReport ? 'Embroidery' : activeType;

            type TypeCsvRow = {
                jobNumber: string;
                customer: string;
                jobName: string;
                status: string;
                dateOrdered: string;
                dueDate: string;
                daysUntilDue: string;
                typeQty: number;
                typeStitches: number;
                typeMinutes: number;
                jobTotalQty: number;
                alsoOnJob: string;
                jobValue: number;
                note: string;
                aimDate: string;
            };
            const rows: TypeCsvRow[] = [];
            for (const job of scopedJobs) {
                const typeItems = job.items.filter(i =>
                    isEmbReport ? isEmbItem(i) : (i.decorationType || '').toUpperCase() === activeType,
                );
                if (typeItems.length === 0) continue;
                const typeQty = typeItems.reduce((a, i) => a + (i.quantity || 0), 0);
                if (typeQty === 0) continue;
                const typeStitches = isEmbReport
                    ? typeItems.reduce((a, i) => a + (i.stitchCount ?? 0) * (i.quantity || 0), 0)
                    : 0;
                const typeEst = estimateProductionTime(typeItems);
                const otherTypes = Array.from(new Set(job.items
                    .filter(i => !(isEmbReport ? isEmbItem(i) : (i.decorationType || '').toUpperCase() === activeType))
                    .map(i => (isEmbItem(i) ? 'EMB' : (i.decorationType || '').toUpperCase()))
                    .filter(t => t && t !== 'NONE')
                ));
                rows.push({
                    jobNumber: job.jobNumber,
                    customer: job.customerName,
                    jobName: job.jobName,
                    status: job.status,
                    dateOrdered: formatDate(job.dateOrdered),
                    dueDate: formatDate(job.dateDue),
                    daysUntilDue: job.daysUntilDue !== null && job.daysUntilDue !== undefined ? String(job.daysUntilDue) : '',
                    typeQty,
                    typeStitches,
                    typeMinutes: typeEst.totalMinutes,
                    jobTotalQty: job.totalQty,
                    alsoOnJob: otherTypes.join(' + '),
                    jobValue: job.jobValue,
                    note: (jobNotes[job.jobNumber] || '').trim(),
                    aimDate: aimDates[job.jobNumber] ? formatDate(aimDates[job.jobNumber]) : '',
                });
            }
            const anyCsvAim = rows.some(r => r.aimDate);
            const anyCsvNote = rows.some(r => r.note);
            rows.sort((a, b) => {
                const aDue = a.dueDate ? a.dueDate.split('/').reverse().join('-') : '9999';
                const bDue = b.dueDate ? b.dueDate.split('/').reverse().join('-') : '9999';
                if (aDue !== bDue) return aDue.localeCompare(bDue);
                return a.jobNumber.localeCompare(b.jobNumber);
            });

            const totals = rows.reduce((acc, r) => {
                acc.jobs += 1;
                acc.qty += r.typeQty;
                acc.stitches += r.typeStitches;
                acc.minutes += r.typeMinutes;
                acc.value += r.jobValue;
                acc.mixed += r.alsoOnJob ? 1 : 0;
                return acc;
            }, { jobs: 0, qty: 0, stitches: 0, minutes: 0, value: 0, mixed: 0 });

            // Metadata block at top of CSV — only include fields the user has enabled.
            lines.push(esc(`STASH ${typeLabel.toUpperCase()} PRODUCTION REPORT`));
            lines.push(esc(`Generated: ${dateStr} ${timeStr}`));
            lines.push(esc(`Decoration Type: ${activeType} (${typeLabel})`));
            lines.push(esc(`Status Filter: ${scopeLabel}`));
            lines.push(esc(`Total Jobs: ${totals.jobs}`));
            lines.push(esc(`Total ${typeLabel} Items: ${totals.qty}`));
            if (isEmbReport && cfg.showStitches) lines.push(esc(`Total Stitches: ${totals.stitches}`));
            if (cfg.showEstTime) lines.push(esc(`Total Est. Time: ${fmtTime(totals.minutes)}`));
            if (cfg.showAlsoOnJob) lines.push(esc(`Mixed-Decoration Jobs: ${totals.mixed}`));
            if (cfg.showFinancials) lines.push(esc(`Total Pipeline Value (GBP): ${totals.value.toFixed(2)}`));
            lines.push(''); // blank spacer

            // Column defs: header, row extractor, totals cell.
            type CsvCol = { header: string; row: (r: TypeCsvRow) => string | number; total: string | number };
            const csvCols: CsvCol[] = [
                { header: 'Job #', row: r => r.jobNumber, total: 'TOTAL' },
            ];
            if (cfg.showCustomer) csvCols.push({ header: 'Customer', row: r => r.customer, total: `${totals.jobs} jobs` });
            if (cfg.showJobName) csvCols.push({ header: 'Job Name', row: r => r.jobName, total: '' });
            if (cfg.showStatus) csvCols.push({ header: 'Status', row: r => r.status, total: '' });
            if (cfg.showDateOrdered) csvCols.push({ header: 'Date Ordered', row: r => r.dateOrdered, total: '' });
            if (cfg.showDueDate) csvCols.push({ header: 'Due Date', row: r => r.dueDate, total: '' });
            if (anyCsvAim) csvCols.push({ header: 'Aim Date', row: r => r.aimDate, total: '' });
            if (cfg.showDaysUntilDue) csvCols.push({ header: 'Days Until Due', row: r => r.daysUntilDue, total: '' });
            csvCols.push({ header: `${typeLabel} Items`, row: r => r.typeQty, total: totals.qty });
            if (cfg.showTotalItems) csvCols.push({ header: 'Job Total Items', row: r => r.jobTotalQty, total: '' });
            if (isEmbReport && cfg.showStitches) csvCols.push({ header: 'Stitches', row: r => r.typeStitches, total: totals.stitches });
            if (cfg.showEstTime) csvCols.push({ header: 'Est. Time (min)', row: r => r.typeMinutes, total: totals.minutes });
            if (cfg.showAlsoOnJob) csvCols.push({ header: 'Also on Job', row: r => r.alsoOnJob, total: totals.mixed > 0 ? `${totals.mixed} mixed` : '' });
            if (cfg.showFinancials) csvCols.push({ header: 'Job Value (GBP)', row: r => r.jobValue.toFixed(2), total: totals.value.toFixed(2) });
            if (anyCsvNote) csvCols.push({ header: 'Note', row: r => r.note, total: '' });

            lines.push(csvCols.map(c => esc(c.header)).join(','));
            for (const r of rows) lines.push(csvCols.map(c => esc(c.row(r))).join(','));
            lines.push(csvCols.map(c => esc(c.total)).join(','));

            const filename = `stash-${activeType.toLowerCase()}-production-${now.toISOString().slice(0, 10)}.csv`;
            downloadCsv(lines.join('\r\n'), filename);
            return;
        }

        // ── FULL CSV (all decoration types broken out) ──────────────────
        type FullCsvRow = {
            jobNumber: string;
            customer: string;
            jobName: string;
            status: string;
            dateOrdered: string;
            dueDate: string;
            daysUntilDue: string;
            totalQty: number;
            embQty: number;
            embStitches: number;
            printQty: number;
            perType: Record<string, number>;
            otherPrint: number;
            untyped: number;
            estMinutes: number;
            jobValue: number;
            note: string;
            aimDate: string;
        };

        const rows: FullCsvRow[] = scopedJobs.map(job => {
            const perType: Record<string, number> = {};
            printTypeCols.forEach(t => { perType[t] = 0; });
            let embQty = 0;
            let embStitches = 0;
            let printQty = 0;
            let otherPrint = 0;
            let untyped = 0;
            for (const item of job.items) {
                const qty = item.quantity || 0;
                if (isEmbItem(item)) { embQty += qty; embStitches += (item.stitchCount ?? 0) * qty; continue; }
                const dt = (item.decorationType || '').toUpperCase();
                if (!dt || dt === 'NONE') { untyped += qty; continue; }
                if (Object.prototype.hasOwnProperty.call(perType, dt)) { perType[dt] += qty; printQty += qty; }
                else { otherPrint += qty; printQty += qty; }
            }
            return {
                jobNumber: job.jobNumber,
                customer: job.customerName,
                jobName: job.jobName,
                status: job.status,
                dateOrdered: formatDate(job.dateOrdered),
                dueDate: formatDate(job.dateDue),
                daysUntilDue: job.daysUntilDue !== null && job.daysUntilDue !== undefined ? String(job.daysUntilDue) : '',
                totalQty: job.totalQty,
                embQty, embStitches, printQty, perType, otherPrint, untyped,
                estMinutes: job.est.totalMinutes,
                jobValue: job.jobValue,
                note: (jobNotes[job.jobNumber] || '').trim(),
                aimDate: aimDates[job.jobNumber] ? formatDate(aimDates[job.jobNumber]) : '',
            };
        });
        const anyFullCsvAim = rows.some(r => r.aimDate);
        const anyFullCsvNote = rows.some(r => r.note);

        rows.sort((a, b) => {
            const aDue = a.dueDate ? a.dueDate.split('/').reverse().join('-') : '9999';
            const bDue = b.dueDate ? b.dueDate.split('/').reverse().join('-') : '9999';
            if (aDue !== bDue) return aDue.localeCompare(bDue);
            return a.jobNumber.localeCompare(b.jobNumber);
        });

        const totals = rows.reduce((acc, r) => {
            acc.jobs += 1;
            acc.totalQty += r.totalQty;
            acc.embQty += r.embQty;
            acc.embStitches += r.embStitches;
            acc.printQty += r.printQty;
            acc.otherPrint += r.otherPrint;
            acc.untyped += r.untyped;
            acc.estMinutes += r.estMinutes;
            acc.jobValue += r.jobValue;
            for (const t of printTypeCols) acc.perType[t] += r.perType[t];
            return acc;
        }, {
            jobs: 0, totalQty: 0, embQty: 0, embStitches: 0, printQty: 0, otherPrint: 0, untyped: 0, estMinutes: 0, jobValue: 0,
            perType: Object.fromEntries(printTypeCols.map(t => [t, 0])) as Record<string, number>,
        });

        // Metadata block — only include fields the user has enabled.
        lines.push(esc('STASH PRODUCTION REPORT'));
        lines.push(esc(`Generated: ${dateStr} ${timeStr}`));
        lines.push(esc(`Status Filter: ${scopeLabel}`));
        lines.push(esc(`Total Jobs: ${totals.jobs}`));
        if (cfg.showTotalItems) lines.push(esc(`Total Items: ${totals.totalQty}`));
        if (cfg.showDecoBreakdown) {
            lines.push(esc(`Total Embroidery Items: ${totals.embQty}${cfg.showStitches ? `  (${totals.embStitches} stitches)` : ''}`));
            lines.push(esc(`Total Print Items: ${totals.printQty}`));
        }
        if (cfg.showEstTime) lines.push(esc(`Total Est. Production Time: ${fmtTime(totals.estMinutes)}`));
        if (cfg.showFinancials) lines.push(esc(`Total Pipeline Value (GBP): ${totals.jobValue.toFixed(2)}`));
        lines.push('');

        // Column defs for the full CSV.
        type FullCsvCol = { header: string; row: (r: FullCsvRow) => string | number; total: string | number };
        const fullCsvCols: FullCsvCol[] = [
            { header: 'Job #', row: r => r.jobNumber, total: 'TOTAL' },
        ];
        if (cfg.showCustomer) fullCsvCols.push({ header: 'Customer', row: r => r.customer, total: `${totals.jobs} jobs` });
        if (cfg.showJobName) fullCsvCols.push({ header: 'Job Name', row: r => r.jobName, total: '' });
        if (cfg.showStatus) fullCsvCols.push({ header: 'Status', row: r => r.status, total: '' });
        if (cfg.showDateOrdered) fullCsvCols.push({ header: 'Date Ordered', row: r => r.dateOrdered, total: '' });
        if (cfg.showDueDate) fullCsvCols.push({ header: 'Due Date', row: r => r.dueDate, total: '' });
        if (anyFullCsvAim) fullCsvCols.push({ header: 'Aim Date', row: r => r.aimDate, total: '' });
        if (cfg.showDaysUntilDue) fullCsvCols.push({ header: 'Days Until Due', row: r => r.daysUntilDue, total: '' });
        if (cfg.showTotalItems) fullCsvCols.push({ header: 'Total Items', row: r => r.totalQty, total: totals.totalQty });
        if (cfg.showDecoBreakdown) {
            fullCsvCols.push({ header: 'Embroidery Items', row: r => r.embQty, total: totals.embQty });
            if (cfg.showStitches) fullCsvCols.push({ header: 'Embroidery Stitches', row: r => r.embStitches, total: totals.embStitches });
            fullCsvCols.push({ header: 'Print Items (Total)', row: r => r.printQty, total: totals.printQty });
            for (const t of printTypeCols) fullCsvCols.push({ header: `${t} Qty`, row: r => r.perType[t], total: totals.perType[t] });
            fullCsvCols.push({ header: 'Other Print Qty', row: r => r.otherPrint, total: totals.otherPrint });
            fullCsvCols.push({ header: 'Untyped Qty', row: r => r.untyped, total: totals.untyped });
        }
        if (cfg.showEstTime) fullCsvCols.push({ header: 'Est. Time (min)', row: r => r.estMinutes, total: totals.estMinutes });
        if (cfg.showFinancials) fullCsvCols.push({ header: 'Job Value (GBP)', row: r => r.jobValue.toFixed(2), total: totals.jobValue.toFixed(2) });
        if (anyFullCsvNote) fullCsvCols.push({ header: 'Note', row: r => r.note, total: '' });

        lines.push(fullCsvCols.map(c => esc(c.header)).join(','));
        for (const r of rows) lines.push(fullCsvCols.map(c => esc(c.row(r))).join(','));
        lines.push(fullCsvCols.map(c => esc(c.total)).join(','));

        const filename = `stash-production-${now.toISOString().slice(0, 10)}.csv`;
        downloadCsv(lines.join('\r\n'), filename);
    };

    // Trigger a browser download of the CSV content. UTF-8 BOM for Excel compatibility.
    const downloadCsv = (csv: string, filename: string) => {
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        // HTML-escape anything that came from Shopify/Deco (customer names,
        // job names, statuses, search terms) so hostile strings can't execute
        // in the print window context.
        const escHtml = (v: string | number | null | undefined): string => {
            if (v === null || v === undefined) return '';
            return String(v)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };
        // A conservative allowlist for any value we inject into `class="..."`.
        const escCls = (v: string): string => (v || '').replace(/[^a-z0-9_-]/gi, '');

        printWindow.document.write(`<h1>Deco Production Jobs</h1>`);
        printWindow.document.write(`<div class="subtitle">${escHtml(filtered.length)} jobs · ${escHtml(fmtK(totalValue))} pipeline · ${escHtml(fmtTime(totalMinutes))} est. · Printed ${escHtml(new Date().toLocaleString('en-GB'))}</div>`);
        const selectedStatusLabels = Array.from(statusFilters).map(k => STATUS_FILTER_LABELS[k].toUpperCase());
        const filters = [selectedStatusLabels.join(' + '), typeFilter || '', searchTerm ? `"${searchTerm}"` : ''].filter(Boolean);
        if (filters.length) printWindow.document.write(`<div class="filter-info">Filters: ${escHtml(filters.join(' · '))}</div>`);
        printWindow.document.write(`<table><thead><tr><th>Job</th><th>Customer</th><th>Job Name</th><th>Status</th><th>Type</th><th>Qty</th><th>EMB</th><th>Print</th><th>Stitches</th><th>Est. Time</th><th>Machine</th><th>Age</th><th>Due</th><th>Value</th><th>£/hr</th></tr></thead><tbody>`);
        filtered.forEach(job => {
            const statusClass = job.status.toLowerCase().includes('production') ? 'status-production' : job.status.toLowerCase().includes('await') ? 'status-awaiting' : job.status.toLowerCase().includes('ready') ? 'status-ready' : job.status.toLowerCase().includes('order') ? 'status-order' : 'status-hold';
            const dueClass = job.daysUntilDue !== null ? (job.daysUntilDue < 0 ? 'overdue' : job.daysUntilDue <= 3 ? 'due-soon' : '') : '';
            const pphClass = job.poundPerHour >= 50 ? 'pph-good' : job.poundPerHour >= 25 ? 'pph-ok' : job.poundPerHour > 0 ? 'pph-low' : '';
            const dueText = job.daysUntilDue !== null ? (job.daysUntilDue < 0 ? `${Math.abs(job.daysUntilDue)}d over` : job.daysUntilDue === 0 ? 'Today' : `${job.daysUntilDue}d`) : '—';
            printWindow.document.write(`<tr>`);
            printWindow.document.write(`<td>#${escHtml(job.jobNumber)}</td>`);
            printWindow.document.write(`<td>${escHtml(job.customerName)}</td>`);
            printWindow.document.write(`<td>${escHtml(job.jobName)}</td>`);
            printWindow.document.write(`<td><span class="badge ${escCls(statusClass)}">${escHtml(job.status)}</span></td>`);
            printWindow.document.write(`<td>${job.decoTypes.map(t => `<span class="badge ${escCls(t.toLowerCase())}">${escHtml(t)}</span>`).join(' ') || '—'}</td>`);
            printWindow.document.write(`<td>${escHtml(job.totalQty)}</td>`);
            printWindow.document.write(`<td>${job.embTotal > 0 ? `${escHtml(job.embDone)}/${escHtml(job.embTotal)}` : '—'}</td>`);
            printWindow.document.write(`<td>${job.printTotal > 0 ? `${escHtml(job.printDone)}/${escHtml(job.printTotal)}` : '—'}</td>`);
            printWindow.document.write(`<td>${job.est.totalStitches > 0 ? escHtml(fmtStitches(job.est.totalStitches)) : '—'}</td>`);
            printWindow.document.write(`<td>${job.est.totalMinutes > 0 ? escHtml(fmtTime(job.est.totalMinutes)) : '—'}</td>`);
            printWindow.document.write(`<td>${job.est.isEmbroidery ? escHtml(job.est.machineType) : '—'}</td>`);
            printWindow.document.write(`<td>${job.daysInProd !== null ? `${escHtml(job.daysInProd)}d` : '—'}</td>`);
            printWindow.document.write(`<td class="${escCls(dueClass)}">${escHtml(dueText)}</td>`);
            printWindow.document.write(`<td>${job.jobValue > 0 ? escHtml(fmtK(job.jobValue)) : '—'}</td>`);
            printWindow.document.write(`<td class="${escCls(pphClass)}">${job.poundPerHour > 0 ? '£' + escHtml(job.poundPerHour.toFixed(0)) : '—'}</td>`);
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
                        <div className="relative" ref={fieldPanelRef}>
                            <button
                                onClick={() => setShowFieldPanel(v => !v)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase border transition-all ${
                                    activePresetName === 'Full'
                                        ? 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10'
                                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:text-amber-200 hover:bg-amber-500/20'
                                }`}
                                title={`Choose which fields appear on printed reports. Current preset: ${activePresetName}. Affects both PDF and CSV.`}
                            >
                                <Settings2 className="w-3.5 h-3.5" />
                                Fields: {activePresetName}
                                {!fieldConfig.showFinancials && <Lock className="w-3 h-3 ml-0.5" />}
                            </button>
                            {showFieldPanel && (
                                <div className="absolute right-0 top-full mt-1.5 z-30 w-[340px] bg-[#14142b] border border-white/10 rounded-lg shadow-2xl p-3 text-white">
                                    <div className="flex items-center justify-between mb-2.5">
                                        <div className="text-[10px] font-bold tracking-wider uppercase text-white/80">Report Fields</div>
                                        <div className="text-[8px] text-white/40 tracking-wider uppercase">Auto-saved</div>
                                    </div>
                                    <div className="text-[10px] text-white/50 mb-2">Presets</div>
                                    <div className="grid grid-cols-3 gap-1 mb-3">
                                        {[
                                            { name: 'Full', cfg: FULL_FIELD_CONFIG, desc: 'Everything (management)' },
                                            { name: 'Department', cfg: DEPARTMENT_FIELD_CONFIG, desc: 'No financials / pipeline (shop floor)' },
                                            { name: 'Minimal', cfg: MINIMAL_FIELD_CONFIG, desc: 'Bare-bones run sheet' },
                                        ].map(p => (
                                            <button
                                                key={p.name}
                                                onClick={() => setFieldConfig(p.cfg)}
                                                title={p.desc}
                                                className={`px-2 py-1.5 rounded text-[9px] font-bold tracking-wider uppercase border transition-all ${
                                                    activePresetName === p.name
                                                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200'
                                                        : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                                                }`}
                                            >
                                                {p.name}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="text-[10px] text-white/50 mb-1 flex items-center gap-1">
                                        <Lock className="w-2.5 h-2.5" /> Confidential
                                    </div>
                                    <div className="space-y-1 mb-2">
                                        {FIELD_LABELS.filter(f => f.group === 'sensitive').map(f => (
                                            <label key={f.key} className="flex items-center gap-2 text-[10px] text-white/80 cursor-pointer hover:text-white px-1 py-0.5 rounded hover:bg-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={fieldConfig[f.key]}
                                                    onChange={e => setFieldConfig({ ...fieldConfig, [f.key]: e.target.checked })}
                                                    className="accent-amber-500"
                                                />
                                                <span>{f.label}</span>
                                                {!fieldConfig[f.key] && <EyeOff className="w-3 h-3 text-amber-400 ml-auto" />}
                                            </label>
                                        ))}
                                    </div>

                                    <div className="text-[10px] text-white/50 mb-1">Summary sections (PDF)</div>
                                    <div className="space-y-1 mb-2">
                                        {FIELD_LABELS.filter(f => f.group === 'sections').map(f => (
                                            <label key={f.key} className="flex items-center gap-2 text-[10px] text-white/80 cursor-pointer hover:text-white px-1 py-0.5 rounded hover:bg-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={fieldConfig[f.key]}
                                                    onChange={e => setFieldConfig({ ...fieldConfig, [f.key]: e.target.checked })}
                                                    className="accent-indigo-500"
                                                />
                                                <span>{f.label}</span>
                                            </label>
                                        ))}
                                    </div>

                                    <div className="text-[10px] text-white/50 mb-1">Columns / fields</div>
                                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                                        {FIELD_LABELS.filter(f => f.group === 'columns').map(f => (
                                            <label key={f.key} className="flex items-center gap-2 text-[10px] text-white/80 cursor-pointer hover:text-white px-1 py-0.5 rounded hover:bg-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={fieldConfig[f.key]}
                                                    onChange={e => setFieldConfig({ ...fieldConfig, [f.key]: e.target.checked })}
                                                    className="accent-indigo-500"
                                                />
                                                <span>{f.label}</span>
                                            </label>
                                        ))}
                                    </div>

                                    <div className="mt-3 pt-2 border-t border-white/10 text-[9px] text-white/40 leading-relaxed">
                                        Applies to both <strong className="text-white/70">PDF</strong> and <strong className="text-white/70">CSV</strong>. Saved to this browser.
                                    </div>
                                </div>
                            )}
                        </div>
                        {visibleSelectedCount > 0 && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30" title="PDF / CSV will include only these rows">
                                <span className="text-[9px] font-black tracking-wider uppercase text-emerald-300">
                                    {visibleSelectedCount} selected
                                </span>
                                <button
                                    onClick={() => setSelectedJobIds(new Set())}
                                    className="text-[8px] font-bold tracking-widest uppercase text-emerald-400/70 hover:text-emerald-200 transition-colors"
                                    title="Clear selection"
                                >
                                    Clear
                                </button>
                            </div>
                        )}
                        <button
                            onClick={handleGenerateReport}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/20 transition-all"
                            title={typeFilter
                                ? `Generate ${typeFilter === 'EMB' ? 'Embroidery' : typeFilter} production report — only ${typeFilter} work for the department. Preset: ${activePresetName}. Covers: ${scopeLabel}.`
                                : `Generate full production PDF report. Preset: ${activePresetName}. Covers: ${scopeLabel}.`}
                        >
                            <FileDown className="w-3.5 h-3.5" />
                            {visibleSelectedCount > 0
                                ? `PDF (${visibleSelectedCount} selected)`
                                : (typeFilter ? `${typeFilter === 'EMB' ? 'EMB' : typeFilter} Report (PDF)` : 'Report (PDF)')}
                        </button>
                        <button
                            onClick={handleDownloadCsv}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:text-blue-200 hover:bg-blue-500/20 transition-all"
                            title={typeFilter
                                ? `Download ${typeFilter === 'EMB' ? 'Embroidery' : typeFilter} production data as CSV (for editing in Excel / Sheets). Covers: ${scopeLabel}.`
                                : `Download full production data as CSV (for editing in Excel / Sheets). Covers: ${scopeLabel}.`}
                        >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            {typeFilter ? `${typeFilter === 'EMB' ? 'EMB' : typeFilter} CSV` : 'CSV'}
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
                {/* Status filters — multi-select. Click Active to clear all. */}
                <div className="flex flex-wrap gap-2 mt-3">
                    {(() => {
                        const activeIsSelected = statusFilters.size === 0;
                        const toggleFilter = (key: Exclude<StatusFilter, 'active'>) => {
                            setStatusFilters(prev => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                            });
                        };
                        const tabs: { label: string; key: StatusFilter; count: number }[] = [
                            { label: 'Active', key: 'active', count: enrichedJobs.length },
                            { label: 'In Production', key: 'production', count: enrichedJobs.filter(j => PRODUCTION_STATUSES.has(j.status)).length },
                            { label: 'Awaiting', key: 'awaiting', count: enrichedJobs.filter(j => AWAITING_STATUSES.has(j.status)).length },
                            { label: 'Awaiting Stock', key: 'awaitingStock', count: enrichedJobs.filter(j => j.status === 'Awaiting Stock').length },
                            { label: 'Awaiting Processing', key: 'awaitingProcessing', count: enrichedJobs.filter(j => j.status === 'Awaiting Processing').length },
                            { label: 'Partially Fulfilled', key: 'partiallyFulfilled', count: enrichedJobs.filter(j => isPartiallyFulfilled(j.items)).length },
                            { label: 'Awaiting Shipping', key: 'awaitingShipping', count: enrichedJobs.filter(j => j.status === 'Ready for Shipping').length },
                        ];
                        return tabs.map(f => {
                            const isSelected = f.key === 'active' ? activeIsSelected : statusFilters.has(f.key as Exclude<StatusFilter, 'active'>);
                            return (
                                <button
                                    key={f.key}
                                    onClick={() => {
                                        if (f.key === 'active') setStatusFilters(new Set());
                                        else toggleFilter(f.key as Exclude<StatusFilter, 'active'>);
                                    }}
                                    title={f.key === 'active' ? 'Clear all status filters' : `Toggle ${f.label}`}
                                    className={`px-2.5 py-1 rounded-lg text-[9px] font-bold tracking-wider uppercase transition-all ${
                                        isSelected
                                            ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                                            : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                                    }`}
                                >
                                    {isSelected && f.key !== 'active' && <span className="mr-1 text-indigo-400">✓</span>}
                                    {f.label} ({f.count})
                                </button>
                            );
                        });
                    })()}
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
                            <th className="px-2 py-2.5 w-8 text-center" title="Select rows to export — checked rows are the only ones included in the PDF / CSV. Unchecked = export the whole scope as before.">
                                <input
                                    type="checkbox"
                                    className="accent-emerald-500 cursor-pointer"
                                    checked={filtered.length > 0 && filtered.every(j => selectedJobIds.has(j.id))}
                                    ref={el => {
                                        if (el) {
                                            const picked = filtered.filter(j => selectedJobIds.has(j.id)).length;
                                            el.indeterminate = picked > 0 && picked < filtered.length;
                                        }
                                    }}
                                    onChange={e => {
                                        const checked = e.target.checked;
                                        setSelectedJobIds(prev => {
                                            const next = new Set(prev);
                                            if (checked) filtered.forEach(j => next.add(j.id));
                                            else filtered.forEach(j => next.delete(j.id));
                                            return next;
                                        });
                                    }}
                                    title="Select all visible / none"
                                />
                            </th>
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
                            <tr><td colSpan={17} className="px-5 py-8 text-center text-white/30 text-xs">No jobs match this filter.</td></tr>
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

                            const isSelected = selectedJobIds.has(job.id);
                            const rowNote = jobNotes[job.jobNumber] || '';
                            const rowAim = aimDates[job.jobNumber] || '';
                            return (
                                <React.Fragment key={job.id}>
                                    <tr
                                        className={`hover:bg-white/5 cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500/[0.06]' : ''}`}
                                        onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                                    >
                                        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                className="accent-emerald-500 cursor-pointer"
                                                checked={isSelected}
                                                onChange={() => toggleJobSelected(job.id)}
                                                title="Include this job in the exported PDF / CSV"
                                            />
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className="text-[10px] font-mono text-indigo-400/70">#{job.jobNumber}</span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="text-xs text-white/80 font-bold truncate max-w-[200px]">{job.customerName}</div>
                                            <div className="text-[9px] text-white/30 truncate max-w-[200px]">{job.jobName}</div>
                                            {(rowNote || rowAim) && (
                                                <div className="mt-1 flex items-center gap-2 text-[8px]">
                                                    {rowAim && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold uppercase tracking-wider">
                                                            Aim {new Date(rowAim + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                        </span>
                                                    )}
                                                    {rowNote && (
                                                        <span className="italic text-amber-300/80 truncate max-w-[220px]" title={rowNote}>📝 {rowNote}</span>
                                                    )}
                                                </div>
                                            )}
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
                                            <div className={ageColor}>{job.daysInProd !== null ? `${job.daysInProd}d` : '—'}</div>
                                            <div className="text-[8px] text-white/20">{fmtDate(job.dateOrdered)}</div>
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
                                    {/* Selection sub-row: per-job note + aim date for the exported PDF */}
                                    {isSelected && (
                                        <tr className="bg-emerald-500/[0.04]" onClick={e => e.stopPropagation()}>
                                            <td className="px-2 py-2 border-t border-emerald-500/10" />
                                            <td colSpan={16} className="px-3 py-2 border-t border-emerald-500/10">
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <span className="text-[8px] font-bold uppercase tracking-widest text-emerald-400/70 shrink-0">For PDF:</span>
                                                    <div className="flex items-center gap-1.5">
                                                        <label className="text-[8px] font-bold uppercase tracking-widest text-white/40">Aim</label>
                                                        <input
                                                            type="date"
                                                            value={rowAim}
                                                            onChange={e => setJobAim(job.jobNumber, e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white/80 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 [color-scheme:dark]"
                                                            title="Aim date shown on the exported PDF (separate from the Deco due date)"
                                                        />
                                                        {rowAim && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); setJobAim(job.jobNumber, ''); }}
                                                                className="text-[8px] font-bold uppercase tracking-widest text-red-400/60 hover:text-red-300 transition-colors"
                                                                title="Clear aim date"
                                                            >
                                                                Clear
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 flex-1 min-w-[240px]">
                                                        <label className="text-[8px] font-bold uppercase tracking-widest text-white/40 shrink-0">Note</label>
                                                        <input
                                                            type="text"
                                                            value={rowNote}
                                                            onChange={e => setJobNote(job.jobNumber, e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            placeholder="Note to print with this job (e.g. 'Rush — customer collecting Friday')"
                                                            maxLength={180}
                                                            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] text-white/80 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                        />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {/* Expanded item detail */}
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={17} className="bg-[#16162e] px-4 py-3">
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
