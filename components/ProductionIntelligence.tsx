import React, { useMemo } from 'react';
import type { DecoJob, DecoItem } from '../types';
import { AlertTriangle, ShieldAlert, Zap, TrendingDown, CheckCircle2, XCircle, Clock, Package, Palette, FileWarning, DollarSign, RefreshCw, Hash } from 'lucide-react';
import { isEmbItem } from './DecoProductionTable';

/* ================================================================
   PRODUCTION INTELLIGENCE DASHBOARD
   Combined: Risk Score, Conflict Detector, Readiness Gate,
   Profit Leak, Data Quality, Late Recovery, Reorder Intelligence
   ================================================================ */

// ---------- CONSTANTS ----------
const STITCHES_PER_MIN = 600;
const HEADS_MULTI = 6;
const BIG_RUN_THRESHOLD = 6;
const SETUP_BUFFER = 1.15;
const DEFAULT_TIMES: Record<string, number> = { DTF: 2, FLEX: 2, TRANSFER: 2, SCREEN: 1, UV: 3, VINYL: 2, SUBLIMATION: 2, DTG: 3, FREEFORM: 5, NONE: 0 };
const PRINT_TYPES = new Set(['DTF', 'DTG', 'FLEX', 'TRANSFER', 'SCREEN', 'UV', 'VINYL', 'SUBLIMATION', 'FREEFORM', 'PRINT', 'LASER', 'RHS', 'PATCH', 'APPLIQUE', 'DECO', 'TRF']);
const EXCLUDED = new Set(['Shipped', 'Completed', 'Cancelled']);

function daysBetween(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86400000); }
function fmtK(n: number) { return n >= 1000 ? '£' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '£' + n.toFixed(0); }
function fmtTime(m: number) { if (m <= 0) return '—'; if (m < 60) return `${m}m`; const h = Math.floor(m / 60); const r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; }

interface EnrichedJob {
    job: DecoJob;
    decoTypes: string[];
    totalQty: number;
    estMinutes: number;
    totalStitches: number;
    daysUntilDue: number | null;
    daysInProd: number | null;
    jobValue: number;
    pph: number;
    embTotal: number; embDone: number;
    printTotal: number; printDone: number;
    // Computed intelligence
    riskScore: number;
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
    hasConflict: boolean;
    conflictReason: string;
    readiness: { stock: boolean; artwork: boolean; po: boolean; production: boolean };
    readinessScore: number;
    lateReason: string | null;
    isLate: boolean;
}

function enrichJob(job: DecoJob, now: Date): EnrichedJob {
    const items = job.items;
    const totalQty = items.reduce((a, i) => a + i.quantity, 0);
    const decoTypes = Array.from(new Set(items.map(i => i.decorationType).filter(Boolean))) as string[];
    const jobValue = job.orderTotal || job.billableAmount || 0;

    // Estimate time
    let totalStitches = 0, hasEmb = false, nonEmbMin = 0, stitchesPerItem = 0;
    items.forEach(i => {
        if (i.stitchCount && i.stitchCount > 0) { hasEmb = true; totalStitches += i.stitchCount * i.quantity; stitchesPerItem = Math.max(stitchesPerItem, i.stitchCount); }
        else { nonEmbMin += (DEFAULT_TIMES[i.decorationType || ''] ?? 3) * i.quantity; }
    });
    let estMinutes = 0;
    if (hasEmb) {
        const heads = totalQty >= BIG_RUN_THRESHOLD ? HEADS_MULTI : 1;
        estMinutes = Math.ceil((Math.ceil(totalQty / heads) * (stitchesPerItem / STITCHES_PER_MIN) + nonEmbMin) * SETUP_BUFFER);
    } else { estMinutes = Math.ceil(nonEmbMin * SETUP_BUFFER); }

    const estHours = estMinutes / 60;
    const pph = estHours > 0 && jobValue > 0 ? jobValue / estHours : 0;
    const dueDate = job.dateDue ? new Date(job.dateDue) : null;
    const daysUntilDue = dueDate ? daysBetween(now, dueDate) : null;
    const orderedDate = job.dateOrdered ? new Date(job.dateOrdered) : null;
    const daysInProd = orderedDate ? daysBetween(orderedDate, now) : null;

    const embItems = items.filter(isEmbItem);
    const embTotal = embItems.reduce((a, i) => a + i.quantity, 0);
    const embDone = embItems.filter(i => i.isProduced || i.isShipped).reduce((a, i) => a + i.quantity, 0);
    const printItems = items.filter(i => !isEmbItem(i) && i.decorationType && PRINT_TYPES.has(i.decorationType));
    const printTotal = printItems.reduce((a, i) => a + i.quantity, 0);
    const printDone = printItems.filter(i => i.isProduced || i.isShipped).reduce((a, i) => a + i.quantity, 0);

    // ---- RISK SCORE (0-100) ----
    let risk = 0;
    // Due date pressure
    if (daysUntilDue !== null) {
        if (daysUntilDue < 0) risk += 40 + Math.min(Math.abs(daysUntilDue) * 2, 20); // overdue
        else if (daysUntilDue === 0) risk += 35;
        else if (daysUntilDue <= 2) risk += 25;
        else if (daysUntilDue <= 5) risk += 15;
        else if (daysUntilDue <= 7) risk += 8;
    } else { risk += 10; } // no due date is mildly risky

    // Production time vs days remaining
    if (daysUntilDue !== null && estMinutes > 0) {
        const hoursAvail = daysUntilDue * 8; // 8h work day
        const hoursNeeded = estMinutes / 60;
        if (hoursNeeded > hoursAvail) risk += 20;
        else if (hoursNeeded > hoursAvail * 0.7) risk += 10;
    }

    // Status-based risk
    const st = job.status.toLowerCase();
    if (st.includes('awaiting stock') || st.includes('not ordered')) risk += 15;
    else if (st.includes('awaiting artwork') || st.includes('awaiting review')) risk += 10;
    else if (st.includes('hold')) risk += 12;
    else if (st.includes('awaiting po')) risk += 8;

    // High value jobs carry more risk weight
    if (jobValue > 500) risk += 5;
    if (jobValue > 1000) risk += 5;

    // No decoration type = data quality risk
    if (decoTypes.length === 0) risk += 8;

    risk = Math.min(100, Math.max(0, risk));
    const riskLevel = risk >= 60 ? 'critical' : risk >= 40 ? 'high' : risk >= 20 ? 'medium' : 'low';

    // ---- CONFLICT DETECTOR ----
    const hasConflict = decoTypes.length > 2;
    const hasEmbAndPrint = decoTypes.includes('EMB') && decoTypes.some(t => PRINT_TYPES.has(t) && t !== 'EMB');
    const conflictReason = hasConflict ? `${decoTypes.length} processes: ${decoTypes.join('+')}` : hasEmbAndPrint ? `Mixed EMB + ${decoTypes.filter(t => t !== 'EMB').join('+')}` : '';

    // ---- READINESS GATE ----
    const stock = !st.includes('awaiting stock') && !st.includes('not ordered');
    const artwork = !st.includes('awaiting artwork') && !st.includes('awaiting review');
    const po = !st.includes('awaiting po');
    const production = st.includes('production') || st.includes('order') || items.some(i => i.isProduced);
    const readinessScore = [stock, artwork, po].filter(Boolean).length;

    // ---- LATE ANALYSIS ----
    const isLate = daysUntilDue !== null && daysUntilDue < 0;
    let lateReason: string | null = null;
    if (isLate) {
        if (!stock) lateReason = 'STOCK';
        else if (!artwork) lateReason = 'ARTWORK';
        else if (!po) lateReason = 'PO';
        else if (daysInProd !== null && daysInProd > 21) lateReason = 'SCHEDULING';
        else lateReason = 'PRODUCTION';
    }

    return {
        job, decoTypes, totalQty, estMinutes, totalStitches, daysUntilDue, daysInProd, jobValue, pph,
        embTotal, embDone, printTotal, printDone,
        riskScore: risk, riskLevel, hasConflict: hasConflict || hasEmbAndPrint, conflictReason,
        readiness: { stock, artwork, po, production }, readinessScore, lateReason, isLate,
    };
}

interface Props {
    decoJobs: DecoJob[];
    onNavigateToOrder?: (num: string) => void;
}

// ---- Risk Badge ----
function RiskBadge({ level, score }: { level: string; score: number }) {
    const cls = level === 'critical' ? 'bg-red-500/20 text-red-300 border-red-500/40' :
        level === 'high' ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' :
        level === 'medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
        'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    return <span className={`px-1.5 py-0.5 rounded border text-[8px] font-black uppercase ${cls}`}>{score}</span>;
}

// ---- Readiness Dots ----
function ReadinessDots({ r }: { r: { stock: boolean; artwork: boolean; po: boolean; production: boolean } }) {
    const Dot = ({ ok, label }: { ok: boolean; label: string }) => (
        <span title={label} className={`w-2 h-2 rounded-full inline-block ${ok ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
    );
    return (
        <span className="inline-flex gap-0.5 items-center">
            <Dot ok={r.stock} label="Stock" />
            <Dot ok={r.artwork} label="Artwork" />
            <Dot ok={r.po} label="PO" />
        </span>
    );
}

export default function ProductionIntelligence({ decoJobs, onNavigateToOrder }: Props) {
    const now = useMemo(() => new Date(), []);
    const jobs = useMemo(() =>
        decoJobs.filter(j => !EXCLUDED.has(j.status)).map(j => enrichJob(j, now)),
    [decoJobs, now]);

    // ---- Aggregated stats ----
    const critical = jobs.filter(j => j.riskLevel === 'critical');
    const high = jobs.filter(j => j.riskLevel === 'high');
    const conflicts = jobs.filter(j => j.hasConflict);
    const lateJobs = jobs.filter(j => j.isLate);
    const blocked = jobs.filter(j => j.readinessScore < 3);
    const profitLeaks = jobs.filter(j => j.pph > 0 && j.pph < 15);
    const noType = jobs.filter(j => j.decoTypes.length === 0);
    const noStitchEmb = jobs.filter(j => j.decoTypes.includes('EMB') && j.totalStitches === 0);

    // ---- Today Plan: highest risk first, fit into 8h day by machine ----
    const todayPlan = useMemo(() => {
        const ready = jobs.filter(j => j.readinessScore >= 3 && !j.isLate).sort((a, b) => b.riskScore - a.riskScore);
        const embQueue: EnrichedJob[] = [];
        const printQueue: EnrichedJob[] = [];
        let embMinLeft = 480; // 8 hours
        let printMinLeft = 480;

        for (const j of ready) {
            const hasEmb = j.decoTypes.includes('EMB');
            const hasPrint = j.decoTypes.some(t => PRINT_TYPES.has(t) && t !== 'EMB');
            if (hasEmb && embMinLeft >= j.estMinutes) { embQueue.push(j); embMinLeft -= j.estMinutes; }
            else if (hasPrint && printMinLeft >= j.estMinutes) { printQueue.push(j); printMinLeft -= j.estMinutes; }
            else if (printMinLeft >= j.estMinutes) { printQueue.push(j); printMinLeft -= j.estMinutes; }
        }
        return { embQueue, printQueue, embMinUsed: 480 - embMinLeft, printMinUsed: 480 - printMinLeft };
    }, [jobs]);

    // ---- SLA Calendar (next 14 days) ----
    const calDays = useMemo(() => {
        const days: { date: Date; label: string; jobs: EnrichedJob[]; risk: 'ok' | 'warn' | 'danger' }[] = [];
        for (let d = 0; d < 14; d++) {
            const dt = new Date(now);
            dt.setDate(dt.getDate() + d);
            dt.setHours(0, 0, 0, 0);
            const dtEnd = new Date(dt); dtEnd.setHours(23, 59, 59);
            const dayJobs = jobs.filter(j => {
                if (!j.job.dateDue) return false;
                const due = new Date(j.job.dateDue);
                return due >= dt && due <= dtEnd;
            });
            const risk = dayJobs.some(j => j.riskLevel === 'critical') ? 'danger' : dayJobs.some(j => j.riskLevel === 'high') ? 'warn' : 'ok';
            days.push({ date: dt, label: dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }), jobs: dayJobs, risk });
        }
        return days;
    }, [jobs, now]);

    // ---- Overdue breakdown by reason ----
    const lateReasons = useMemo(() => {
        const counts: Record<string, number> = {};
        lateJobs.forEach(j => { const r = j.lateReason || 'UNKNOWN'; counts[r] = (counts[r] || 0) + 1; });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, [lateJobs]);

    // ---- Reorder intelligence: recurring customers ----
    const reorderCustomers = useMemo(() => {
        const custMap = new Map<string, { count: number; totalValue: number; lastOrder: string; types: Set<string> }>();
        decoJobs.forEach(j => {
            const name = j.customerName;
            const cur = custMap.get(name) || { count: 0, totalValue: 0, lastOrder: '', types: new Set<string>() };
            cur.count++;
            cur.totalValue += j.orderTotal || j.billableAmount || 0;
            if (!cur.lastOrder || (j.dateOrdered && j.dateOrdered > cur.lastOrder)) cur.lastOrder = j.dateOrdered || '';
            j.items.forEach(i => { if (i.decorationType) cur.types.add(i.decorationType); });
            custMap.set(name, cur);
        });
        return Array.from(custMap.entries())
            .filter(([, v]) => v.count >= 3)
            .sort((a, b) => b[1].totalValue - a[1].totalValue)
            .slice(0, 10);
    }, [decoJobs]);

    const [activePanel, setActivePanel] = React.useState<string>('overview');

    const panels = [
        { id: 'overview', label: 'Overview', icon: <Zap className="w-3 h-3" /> },
        { id: 'today', label: 'Today Plan', icon: <Clock className="w-3 h-3" /> },
        { id: 'calendar', label: 'SLA Calendar', icon: <Clock className="w-3 h-3" /> },
        { id: 'late', label: `Late (${lateJobs.length})`, icon: <AlertTriangle className="w-3 h-3" /> },
        { id: 'quality', label: `Data Quality`, icon: <FileWarning className="w-3 h-3" /> },
        { id: 'reorder', label: 'Reorder Intel', icon: <RefreshCw className="w-3 h-3" /> },
    ];

    return (
        <div className="bg-[#1e1e3a]/80 backdrop-blur rounded-2xl border border-white/5 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-sm font-black tracking-wider text-white uppercase">Production Intelligence</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {critical.length > 0 && <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 text-[9px] font-black animate-pulse">{critical.length} CRITICAL</span>}
                        {high.length > 0 && <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 text-[9px] font-black">{high.length} HIGH RISK</span>}
                        {conflicts.length > 0 && <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9px] font-black">{conflicts.length} CONFLICTS</span>}
                        {blocked.length > 0 && <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-black">{blocked.length} BLOCKED</span>}
                    </div>
                </div>

                {/* Panel tabs */}
                <div className="flex gap-1 mt-3 flex-wrap">
                    {panels.map(p => (
                        <button key={p.id} onClick={() => setActivePanel(p.id)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold tracking-wider uppercase transition-all ${
                                activePanel === p.id ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40' : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                            }`}>{p.icon}{p.label}</button>
                    ))}
                </div>
            </div>

            {/* ---- OVERVIEW PANEL ---- */}
            {activePanel === 'overview' && (
                <div className="p-5 space-y-4">
                    {/* Risk Distribution */}
                    <div className="grid grid-cols-4 gap-3">
                        {[
                            { label: 'Critical', count: critical.length, color: 'red', jobs: critical },
                            { label: 'High Risk', count: high.length, color: 'orange', jobs: high },
                            { label: 'Blocked', count: blocked.length, color: 'amber', jobs: blocked },
                            { label: 'Profit Leak', count: profitLeaks.length, color: 'pink', jobs: profitLeaks },
                        ].map(b => (
                            <div key={b.label} className={`rounded-xl border border-${b.color}-500/20 bg-${b.color}-500/5 p-3`}>
                                <div className={`text-2xl font-black text-${b.color}-300`}>{b.count}</div>
                                <div className="text-[9px] font-bold text-white/40 uppercase tracking-wider">{b.label}</div>
                                {b.jobs.length > 0 && (
                                    <div className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                                        {b.jobs.slice(0, 5).map(j => (
                                            <div key={j.job.jobNumber} className="flex items-center gap-1.5 text-[8px]">
                                                <RiskBadge level={j.riskLevel} score={j.riskScore} />
                                                <button onClick={() => onNavigateToOrder?.(j.job.jobNumber)} className="text-white/60 hover:text-white truncate max-w-[120px]">{j.job.customerName}</button>
                                                <span className="text-white/20 ml-auto">{j.daysUntilDue !== null ? `${j.daysUntilDue}d` : '?'}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Conflicts */}
                    {conflicts.length > 0 && (
                        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
                            <div className="flex items-center gap-2 mb-2">
                                <Palette className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-[10px] font-black text-purple-300 uppercase tracking-wider">Process Conflicts ({conflicts.length})</span>
                            </div>
                            <div className="space-y-1">
                                {conflicts.slice(0, 8).map(j => (
                                    <div key={j.job.jobNumber} className="flex items-center gap-2 text-[9px]">
                                        <button onClick={() => onNavigateToOrder?.(j.job.jobNumber)} className="text-purple-300/80 hover:text-white font-mono">#{j.job.jobNumber}</button>
                                        <span className="text-white/40 truncate">{j.job.customerName}</span>
                                        <span className="ml-auto text-purple-300/60 font-bold">{j.conflictReason}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Readiness summary */}
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                        <div className="text-[10px] font-black text-white/40 uppercase tracking-wider mb-2">Readiness Gates</div>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { label: 'Stock Ready', count: jobs.filter(j => j.readiness.stock).length, total: jobs.length, color: 'emerald' },
                                { label: 'Artwork Ready', count: jobs.filter(j => j.readiness.artwork).length, total: jobs.length, color: 'blue' },
                                { label: 'PO Confirmed', count: jobs.filter(j => j.readiness.po).length, total: jobs.length, color: 'cyan' },
                            ].map(g => {
                                const pct = g.total > 0 ? Math.round(g.count / g.total * 100) : 0;
                                return (
                                    <div key={g.label}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[8px] font-bold text-white/50 uppercase">{g.label}</span>
                                            <span className={`text-[9px] font-black text-${g.color}-300`}>{g.count}/{g.total}</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div className={`h-full bg-${g.color}-400 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ---- TODAY PLAN ---- */}
            {activePanel === 'today' && (
                <div className="p-5 space-y-4">
                    <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                        Suggested run order for today — highest risk first, fitted to 8h shift
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {/* EMB Queue */}
                        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-purple-300 uppercase">Embroidery Queue</span>
                                <span className="text-[9px] text-purple-300/60 font-mono">{fmtTime(todayPlan.embMinUsed)} / 8h</span>
                            </div>
                            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                                <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(100, todayPlan.embMinUsed / 480 * 100)}%` }} />
                            </div>
                            {todayPlan.embQueue.length === 0 ? <div className="text-[9px] text-white/20 text-center py-4">No embroidery jobs ready</div> :
                                <div className="space-y-1.5">
                                    {todayPlan.embQueue.map((j, i) => (
                                        <div key={j.job.jobNumber} className="flex items-center gap-2 text-[9px]">
                                            <span className="text-purple-300/40 font-mono w-4">{i + 1}.</span>
                                            <RiskBadge level={j.riskLevel} score={j.riskScore} />
                                            <button onClick={() => onNavigateToOrder?.(j.job.jobNumber)} className="text-white/60 hover:text-white truncate max-w-[140px]" title={j.job.jobName}>{j.job.customerName}</button>
                                            <span className="ml-auto text-white/25 font-mono">{fmtTime(j.estMinutes)}</span>
                                        </div>
                                    ))}
                                </div>
                            }
                        </div>
                        {/* Print Queue */}
                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-cyan-300 uppercase">Print Queue</span>
                                <span className="text-[9px] text-cyan-300/60 font-mono">{fmtTime(todayPlan.printMinUsed)} / 8h</span>
                            </div>
                            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                                <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${Math.min(100, todayPlan.printMinUsed / 480 * 100)}%` }} />
                            </div>
                            {todayPlan.printQueue.length === 0 ? <div className="text-[9px] text-white/20 text-center py-4">No print jobs ready</div> :
                                <div className="space-y-1.5">
                                    {todayPlan.printQueue.map((j, i) => (
                                        <div key={j.job.jobNumber} className="flex items-center gap-2 text-[9px]">
                                            <span className="text-cyan-300/40 font-mono w-4">{i + 1}.</span>
                                            <RiskBadge level={j.riskLevel} score={j.riskScore} />
                                            <button onClick={() => onNavigateToOrder?.(j.job.jobNumber)} className="text-white/60 hover:text-white truncate max-w-[140px]" title={j.job.jobName}>{j.job.customerName}</button>
                                            <span className="ml-auto text-white/25 font-mono">{fmtTime(j.estMinutes)}</span>
                                        </div>
                                    ))}
                                </div>
                            }
                        </div>
                    </div>
                </div>
            )}

            {/* ---- SLA CALENDAR ---- */}
            {activePanel === 'calendar' && (
                <div className="p-5">
                    <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider mb-3">
                        Next 14 days — colored by risk level of jobs due that day
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                        {calDays.map((day, i) => {
                            const bg = day.risk === 'danger' ? 'bg-red-500/20 border-red-500/30' :
                                day.risk === 'warn' ? 'bg-amber-500/15 border-amber-500/25' :
                                day.jobs.length > 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/[0.02] border-white/5';
                            const isToday = i === 0;
                            return (
                                <div key={i} className={`rounded-lg border p-2 min-h-[70px] ${bg} ${isToday ? 'ring-1 ring-indigo-500/50' : ''}`}>
                                    <div className={`text-[8px] font-bold uppercase ${isToday ? 'text-indigo-300' : 'text-white/30'}`}>{day.label}</div>
                                    <div className={`text-lg font-black ${day.risk === 'danger' ? 'text-red-300' : day.risk === 'warn' ? 'text-amber-300' : day.jobs.length > 0 ? 'text-emerald-300' : 'text-white/10'}`}>
                                        {day.jobs.length || ''}
                                    </div>
                                    {day.jobs.length > 0 && (
                                        <div className="mt-1 space-y-0.5">
                                            {day.jobs.slice(0, 3).map(j => (
                                                <div key={j.job.jobNumber} className="text-[6px] text-white/40 truncate" title={j.job.customerName}>
                                                    {j.job.customerName.substring(0, 12)}
                                                </div>
                                            ))}
                                            {day.jobs.length > 3 && <div className="text-[6px] text-white/20">+{day.jobs.length - 3} more</div>}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ---- LATE JOBS + WHY LATE ---- */}
            {activePanel === 'late' && (
                <div className="p-5 space-y-4">
                    {lateJobs.length === 0 ? (
                        <div className="text-center py-8">
                            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                            <div className="text-white/40 text-[10px] font-bold uppercase">No overdue jobs</div>
                        </div>
                    ) : (
                        <>
                            {/* Why Late breakdown */}
                            <div className="flex gap-2 flex-wrap">
                                {lateReasons.map(([reason, count]) => {
                                    const colors: Record<string, string> = {
                                        STOCK: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                                        ARTWORK: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
                                        PO: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                                        SCHEDULING: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
                                        PRODUCTION: 'bg-red-500/20 text-red-300 border-red-500/30',
                                    };
                                    return (
                                        <span key={reason} className={`px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase ${colors[reason] || 'bg-white/5 text-white/40 border-white/10'}`}>
                                            {reason}: {count}
                                        </span>
                                    );
                                })}
                            </div>

                            {/* Late jobs table */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-[9px]">
                                    <thead>
                                        <tr className="border-b border-white/10">
                                            <th className="text-left py-1.5 px-2 text-white/30 font-bold uppercase">Risk</th>
                                            <th className="text-left py-1.5 px-2 text-white/30 font-bold uppercase">Job</th>
                                            <th className="text-left py-1.5 px-2 text-white/30 font-bold uppercase">Customer</th>
                                            <th className="text-center py-1.5 px-2 text-white/30 font-bold uppercase">Days Late</th>
                                            <th className="text-center py-1.5 px-2 text-white/30 font-bold uppercase">Why</th>
                                            <th className="text-center py-1.5 px-2 text-white/30 font-bold uppercase">Ready</th>
                                            <th className="text-right py-1.5 px-2 text-white/30 font-bold uppercase">Value</th>
                                            <th className="text-left py-1.5 px-2 text-white/30 font-bold uppercase">Recovery</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lateJobs.sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0)).map(j => {
                                            const daysLate = Math.abs(j.daysUntilDue || 0);
                                            const recovery = j.readinessScore >= 3 ? 'Rush production' :
                                                !j.readiness.stock ? 'Chase stock supplier' :
                                                !j.readiness.artwork ? 'Chase artwork approval' :
                                                !j.readiness.po ? 'Confirm PO' : 'Reprioritise queue';
                                            return (
                                                <tr key={j.job.jobNumber} className="border-b border-white/5 hover:bg-white/[0.02]">
                                                    <td className="py-1.5 px-2"><RiskBadge level={j.riskLevel} score={j.riskScore} /></td>
                                                    <td className="py-1.5 px-2">
                                                        <button onClick={() => onNavigateToOrder?.(j.job.jobNumber)} className="text-indigo-300 hover:text-white font-mono">#{j.job.jobNumber}</button>
                                                    </td>
                                                    <td className="py-1.5 px-2 text-white/60 max-w-[150px] truncate">{j.job.customerName}</td>
                                                    <td className="py-1.5 px-2 text-center">
                                                        <span className={`font-black ${daysLate > 7 ? 'text-red-400' : daysLate > 3 ? 'text-orange-400' : 'text-amber-300'}`}>{daysLate}d</span>
                                                    </td>
                                                    <td className="py-1.5 px-2 text-center">
                                                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/50 text-[7px] font-black uppercase">{j.lateReason}</span>
                                                    </td>
                                                    <td className="py-1.5 px-2 text-center"><ReadinessDots r={j.readiness} /></td>
                                                    <td className="py-1.5 px-2 text-right text-white/40 font-mono">{fmtK(j.jobValue)}</td>
                                                    <td className="py-1.5 px-2 text-emerald-300/60 text-[8px] font-bold">{recovery}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ---- DATA QUALITY ---- */}
            {activePanel === 'quality' && (
                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: 'Missing Decoration Type', count: noType.length, color: 'amber', icon: <Palette className="w-4 h-4" /> },
                            { label: 'EMB Missing Stitches', count: noStitchEmb.length, color: 'purple', icon: <Hash className="w-4 h-4" /> },
                            { label: 'No Due Date', count: jobs.filter(j => !j.job.dateDue).length, color: 'red', icon: <Clock className="w-4 h-4" /> },
                        ].map(q => (
                            <div key={q.label} className={`rounded-xl border p-3 ${q.count === 0 ? 'border-emerald-500/20 bg-emerald-500/5' : `border-${q.color}-500/20 bg-${q.color}-500/5`}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={q.count === 0 ? 'text-emerald-400' : `text-${q.color}-400`}>{q.icon}</span>
                                    <span className="text-[9px] font-bold text-white/40 uppercase">{q.label}</span>
                                </div>
                                <div className={`text-2xl font-black ${q.count === 0 ? 'text-emerald-300' : `text-${q.color}-300`}`}>
                                    {q.count === 0 ? '✓' : q.count}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Jobs needing attention */}
                    {(noType.length > 0 || noStitchEmb.length > 0) && (
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                            <div className="text-[10px] font-black text-white/40 uppercase tracking-wider mb-2">Jobs Needing Data Fix</div>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {[...noType, ...noStitchEmb].slice(0, 20).map(j => (
                                    <div key={j.job.jobNumber + '_dq'} className="flex items-center gap-2 text-[9px]">
                                        <button onClick={() => onNavigateToOrder?.(j.job.jobNumber)} className="text-indigo-300 hover:text-white font-mono">#{j.job.jobNumber}</button>
                                        <span className="text-white/40 truncate max-w-[200px]">{j.job.customerName}</span>
                                        <span className="ml-auto text-amber-300/50 text-[7px] font-black uppercase">
                                            {j.decoTypes.length === 0 ? 'NO TYPE' : 'NO STITCHES'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ---- REORDER INTELLIGENCE ---- */}
            {activePanel === 'reorder' && (
                <div className="p-5 space-y-4">
                    <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                        Top recurring customers (3+ orders) — predict reorder windows, pre-stage stock
                    </div>
                    {reorderCustomers.length === 0 ? (
                        <div className="text-center py-8 text-white/20 text-[10px]">Not enough order history for patterns</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[9px]">
                                <thead>
                                    <tr className="border-b border-white/10">
                                        <th className="text-left py-1.5 px-2 text-white/30 font-bold uppercase">Customer</th>
                                        <th className="text-center py-1.5 px-2 text-white/30 font-bold uppercase">Orders</th>
                                        <th className="text-right py-1.5 px-2 text-white/30 font-bold uppercase">Total Value</th>
                                        <th className="text-center py-1.5 px-2 text-white/30 font-bold uppercase">Processes</th>
                                        <th className="text-center py-1.5 px-2 text-white/30 font-bold uppercase">Last Order</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reorderCustomers.map(([name, data]) => (
                                        <tr key={name} className="border-b border-white/5 hover:bg-white/[0.02]">
                                            <td className="py-1.5 px-2 text-white/70 font-bold max-w-[200px] truncate">{name}</td>
                                            <td className="py-1.5 px-2 text-center text-indigo-300 font-black">{data.count}</td>
                                            <td className="py-1.5 px-2 text-right text-emerald-300 font-mono">{fmtK(data.totalValue)}</td>
                                            <td className="py-1.5 px-2 text-center">
                                                <div className="flex gap-0.5 justify-center flex-wrap">
                                                    {Array.from(data.types).slice(0, 4).map(t => (
                                                        <span key={t} className="px-1 py-0.5 rounded bg-white/5 text-white/40 text-[7px] font-black">{t}</span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="py-1.5 px-2 text-center text-white/30 font-mono">
                                                {data.lastOrder ? new Date(data.lastOrder).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
