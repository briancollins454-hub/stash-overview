// ─── RotaReports ───────────────────────────────────────────────────────────
// Manager analytics — scheduled hours per employee, holiday usage, unfilled
// open-shift count, contract over/under across an arbitrary date range.
// Each section has a CSV export.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, BarChart3, FileDown, Loader2, Plane, Sparkles, Users, Clock, X,
} from 'lucide-react';
import {
    fetchEmployees, fetchShiftsInRange, fetchTimeOff, fetchToilEntries,
} from '../../services/rotaService';
import {
    isoDate, shiftLengthHours, summariseAllowance, toilBalance, workingDaysBetween,
    type RotaEmployee, type RotaShift, type RotaTimeOff, type RotaToilEntry,
} from '../../utils/rota';

function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const RotaReports: React.FC = () => {
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [from, setFrom] = useState(isoDate(defaultFrom));
    const [to, setTo] = useState(isoDate(defaultTo));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [shifts, setShifts] = useState<RotaShift[]>([]);
    const [timeOff, setTimeOff] = useState<RotaTimeOff[]>([]);
    const [toil, setToil] = useState<RotaToilEntry[]>([]);

    const reload = useCallback(async () => {
        if (!from || !to || from > to) return;
        setLoading(true);
        try {
            const fromIso = `${from}T00:00:00.000Z`;
            const toIso = `${to}T23:59:59.999Z`;
            const [emps, sh, off, tl] = await Promise.all([
                fetchEmployees(),
                fetchShiftsInRange(fromIso, toIso),
                fetchTimeOff(),
                fetchToilEntries(),
            ]);
            setEmployees(emps);
            setShifts(sh);
            setTimeOff(off);
            setToil(tl);
        } catch (e: any) {
            setError(e?.message || 'Failed to load reports');
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => { reload(); }, [reload]);

    const active = useMemo(() => employees.filter(e => e.is_active), [employees]);

    const hoursByEmployee = useMemo(() => {
        const out = new Map<string, { scheduled: number; published: number; contract: number; weeks: number }>();
        const weeks = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / (7 * 86_400_000));
        for (const emp of active) {
            const own = shifts.filter(s => s.user_id === emp.user_id);
            const scheduled = own.reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0);
            const published = own.filter(s => s.published).reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0);
            out.set(emp.user_id, {
                scheduled,
                published,
                contract: (Number(emp.weekly_hours || 0)) * weeks,
                weeks,
            });
        }
        return out;
    }, [active, shifts, from, to]);

    const holidayUsage = useMemo(() => active.map(emp => {
        const summary = summariseAllowance(emp, timeOff);
        return {
            emp,
            ...summary,
            usedInWindow: timeOff
                .filter(r => r.user_id === emp.user_id && r.type === 'holiday' && r.status === 'approved')
                .filter(r => !(r.end_date < from || r.start_date > to))
                .reduce((sum, r) => sum + Number(r.days_count || 0), 0),
        };
    }), [active, timeOff, from, to]);

    const openShiftCount = shifts.filter(s => !s.user_id).length;
    const unpublishedCount = shifts.filter(s => !s.published).length;
    const totalScheduled = shifts.reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0);
    const workingDays = workingDaysBetween(from, to);

    const handleHoursCsv = () => {
        downloadCsv(`rota-hours-${from}_${to}.csv`,
            ['employee', 'user_id', 'team', 'scheduled_hours', 'published_hours', 'contract_hours_in_window', 'over_under_hours', 'toil_balance'],
            active.map(emp => {
                const h = hoursByEmployee.get(emp.user_id) || { scheduled: 0, published: 0, contract: 0, weeks: 0 };
                return [
                    emp.display_name,
                    emp.user_id,
                    emp.team || '',
                    h.scheduled,
                    h.published,
                    h.contract,
                    h.scheduled - h.contract,
                    toilBalance(toil, emp.user_id),
                ];
            }),
        );
    };

    const handleHolidayCsv = () => {
        downloadCsv(`rota-holiday-${from}_${to}.csv`,
            ['employee', 'user_id', 'annual_allowance', 'carried_over', 'pending_days', 'booked_days', 'remaining_days', 'used_in_window'],
            holidayUsage.map(r => [
                r.emp.display_name,
                r.emp.user_id,
                r.annualAllowance,
                r.carriedOver,
                r.pending,
                r.booked,
                r.remaining,
                r.usedInWindow,
            ]),
        );
    };

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 space-y-3">
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-teal-600" />
                    <h2 className="font-black uppercase tracking-widest text-[11px] text-slate-500">Reports</h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                        From
                        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300 text-sm font-bold" />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                        To
                        <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300 text-sm font-bold" />
                    </label>
                    <div className="text-xs text-slate-500">{workingDays} working days · {Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1} calendar days</div>
                </div>
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div className="flex-1">{error}</div>
                    <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
            ) : (
                <div className="space-y-4">
                    <div className="grid sm:grid-cols-4 gap-3">
                        <KpiCard label="Total scheduled" value={`${totalScheduled.toFixed(1)}h`} icon={Clock} tone="teal" />
                        <KpiCard label="Active employees" value={String(active.length)} icon={Users} tone="slate" />
                        <KpiCard label="Open shifts" value={String(openShiftCount)} icon={Sparkles} tone={openShiftCount > 0 ? 'pink' : 'slate'} />
                        <KpiCard label="Unpublished drafts" value={String(unpublishedCount)} icon={Plane} tone={unpublishedCount > 0 ? 'amber' : 'slate'} />
                    </div>

                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Hours per employee</h3>
                            <button onClick={handleHoursCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                                <FileDown className="w-3.5 h-3.5" /> CSV
                            </button>
                        </header>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    <th className="text-left p-3">Employee</th>
                                    <th className="text-right p-3">Scheduled</th>
                                    <th className="text-right p-3">Published</th>
                                    <th className="text-right p-3">Contract*</th>
                                    <th className="text-right p-3">Over/Under</th>
                                    <th className="text-right p-3">TOIL balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {active.map(emp => {
                                    const h = hoursByEmployee.get(emp.user_id) || { scheduled: 0, published: 0, contract: 0, weeks: 0 };
                                    const diff = h.scheduled - h.contract;
                                    const toilHours = toilBalance(toil, emp.user_id);
                                    return (
                                        <tr key={emp.user_id} className="border-b border-slate-100">
                                            <td className="p-3 font-bold text-slate-900">{emp.display_name}<div className="text-[10px] text-slate-500">{emp.team || ''}</div></td>
                                            <td className="p-3 text-right tabular-nums">{h.scheduled.toFixed(1)}h</td>
                                            <td className="p-3 text-right tabular-nums">{h.published.toFixed(1)}h</td>
                                            <td className="p-3 text-right tabular-nums text-slate-500">{h.contract.toFixed(1)}h</td>
                                            <td className={`p-3 text-right tabular-nums font-bold ${diff > 0 ? 'text-rose-700' : diff < 0 ? 'text-amber-700' : 'text-slate-600'}`}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}h</td>
                                            <td className="p-3 text-right tabular-nums">{toilHours.toFixed(1)}h</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <p className="text-[10px] text-slate-400 px-4 py-2">* Contract hours pro-rated for the window from each employee's weekly contract.</p>
                    </section>

                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Holiday usage</h3>
                            <button onClick={handleHolidayCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                                <FileDown className="w-3.5 h-3.5" /> CSV
                            </button>
                        </header>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    <th className="text-left p-3">Employee</th>
                                    <th className="text-right p-3">Annual</th>
                                    <th className="text-right p-3">Carried</th>
                                    <th className="text-right p-3">Booked</th>
                                    <th className="text-right p-3">Pending</th>
                                    <th className="text-right p-3">Remaining</th>
                                    <th className="text-right p-3">Used in window</th>
                                </tr>
                            </thead>
                            <tbody>
                                {holidayUsage.map(r => (
                                    <tr key={r.emp.user_id} className="border-b border-slate-100">
                                        <td className="p-3 font-bold text-slate-900">{r.emp.display_name}</td>
                                        <td className="p-3 text-right tabular-nums">{r.annualAllowance}d</td>
                                        <td className="p-3 text-right tabular-nums">{r.carriedOver}d</td>
                                        <td className="p-3 text-right tabular-nums">{r.booked.toFixed(r.booked % 1 === 0 ? 0 : 1)}d</td>
                                        <td className="p-3 text-right tabular-nums text-amber-700">{r.pending.toFixed(r.pending % 1 === 0 ? 0 : 1)}d</td>
                                        <td className={`p-3 text-right tabular-nums font-bold ${r.remaining < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{r.remaining.toFixed(r.remaining % 1 === 0 ? 0 : 1)}d</td>
                                        <td className="p-3 text-right tabular-nums">{r.usedInWindow.toFixed(r.usedInWindow % 1 === 0 ? 0 : 1)}d</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                </div>
            )}
        </section>
    );
};

const KpiCard: React.FC<{ label: string; value: string; icon: any; tone: 'teal' | 'pink' | 'amber' | 'slate' }> = ({ label, value, icon: Icon, tone }) => {
    const cls = tone === 'teal' ? 'bg-teal-50 border-teal-200 text-teal-800'
        : tone === 'pink' ? 'bg-pink-50 border-pink-200 text-pink-800'
        : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-slate-50 border-slate-200 text-slate-800';
    return (
        <div className={`rounded-2xl border p-4 ${cls}`}>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest opacity-80"><Icon className="w-3.5 h-3.5" />{label}</div>
            <div className="text-2xl font-black tabular-nums mt-1">{value}</div>
        </div>
    );
};

export default RotaReports;
