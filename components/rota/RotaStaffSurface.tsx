// ─── RotaStaffSurface ──────────────────────────────────────────────────────
// The view non-managers see. Renders in two modes:
//
//   1. Embedded in the manager Rota tab (chromeless=true) — pure content.
//   2. Full-screen for users whose only allowed tab is rota — adds a
//      compact header + sign-out, no main app chrome.
//
// Two cards: "This week" (your shifts laid out as a 7-day calendar) and
// "My time off" (book a request, see history). Pending requests can be
// cancelled before the manager decides.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, CalendarRange, Loader2, MailCheck, Plane, Plus, X,
    Clock, ChevronLeft, ChevronRight, Building2,
} from 'lucide-react';
import {
    addDays, daysCountFor, isoDate, makeWeekRange, shortDateLabel,
    shiftLengthHours, summariseAllowance, isoToTime,
    DEFAULT_SHIFT_PRESETS,
    type RotaEmployee, type RotaShift, type RotaTimeOff,
    type TimeOffHalfDay, type TimeOffStatus,
} from '../../utils/rota';
import {
    dispatchRotaEmail,
    fetchClosures, fetchEmployees, fetchShiftsForUser,
    fetchTimeOff, submitTimeOff,
} from '../../services/rotaService';

export interface RotaStaffSurfaceProps {
    currentUser: { id: string; username: string; displayName: string; role: string; email?: string };
    /** When true, hide the surface header (we're embedded inside the manager UI). */
    chromeless?: boolean;
}

const STATUS_BADGES: Record<TimeOffStatus, { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
    declined: { label: 'Declined', cls: 'bg-rose-100 text-rose-800' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
};

export const RotaStaffSurface: React.FC<RotaStaffSurfaceProps> = ({ currentUser, chromeless }) => {
    const [anchor, setAnchor] = useState(new Date());
    const week = useMemo(() => makeWeekRange(anchor), [anchor]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [shifts, setShifts] = useState<RotaShift[]>([]);
    const [requests, setRequests] = useState<RotaTimeOff[]>([]);
    const [closuresDates, setClosuresDates] = useState<Record<string, string>>({});
    const [employee, setEmployee] = useState<RotaEmployee | null>(null);
    const [requesting, setRequesting] = useState(false);

    // Username is the user_id we keyed employees on. The manager will have
    // pre-populated stash_rota_employees with display_name + holiday data.
    const myUserId = currentUser.username || currentUser.id;

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [sh, reqs, cls, emps] = await Promise.all([
                fetchShiftsForUser(myUserId, week.isoStart, week.isoEnd),
                fetchTimeOff({ userId: myUserId }),
                fetchClosures(),
                fetchEmployees(),
            ]);
            setShifts(sh);
            setRequests(reqs);
            setClosuresDates(Object.fromEntries(cls.map(c => [c.closure_date, c.label])));
            setEmployee(emps.find(e => e.user_id === myUserId) || null);
        } catch (e: any) {
            setError(e?.message || 'Failed to load your rota');
        } finally {
            setLoading(false);
        }
    }, [week.isoStart, week.isoEnd, myUserId]);

    useEffect(() => { reload(); }, [reload]);

    const totalHours = useMemo(() => shifts.reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0), [shifts]);
    const allowance = useMemo(() => employee ? summariseAllowance(employee, requests) : null, [employee, requests]);

    return (
        <div className={chromeless ? '' : 'min-h-screen bg-slate-50'}>
            {!chromeless && <StaffHeader displayName={currentUser.displayName || currentUser.username} />}

            <main className={chromeless ? 'space-y-4' : 'max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4'}>
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>{error}</div>
                    </div>
                )}

                {!employee && !loading && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 text-sm text-slate-700">
                        Your Rota profile hasn't been set up yet. Ask your manager to add you under
                        <strong> Rota → Employees</strong>.
                    </div>
                )}

                {/* This week */}
                <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <header className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                            <CalendarRange className="w-4 h-4 text-teal-600" />
                            <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700">This week</h2>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => setAnchor(prev => addDays(prev, -7))} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
                            <div className="px-3 py-2 text-xs font-bold text-slate-700">{shortDateLabel(week.days[0])} – {shortDateLabel(week.days[6])}</div>
                            <button onClick={() => setAnchor(prev => addDays(prev, 7))} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><ChevronRight className="w-4 h-4" /></button>
                            <button onClick={() => setAnchor(new Date())} className="ml-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-teal-700 hover:bg-teal-50">Today</button>
                        </div>
                    </header>
                    {loading ? (
                        <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
                            {week.days.map(day => {
                                const target = isoDate(day);
                                const cellShifts = shifts.filter(s => s.start_at.startsWith(target));
                                const offsForDay = requests.find(r =>
                                    target >= r.start_date && target <= r.end_date && r.status !== 'declined' && r.status !== 'cancelled',
                                );
                                const closureLabel = closuresDates[target];
                                const isToday = isoDate(new Date()) === target;
                                return (
                                    <div key={target} className={`p-3 min-h-[110px] ${isToday ? 'bg-teal-50/50' : ''}`}>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{shortDateLabel(day)}</div>
                                        {closureLabel && (
                                            <div className="mt-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-rose-50 text-rose-700 border border-rose-200">{closureLabel}</div>
                                        )}
                                        {offsForDay && (
                                            <div className="mt-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-amber-50 text-amber-800 border border-amber-200">
                                                {offsForDay.type}{offsForDay.status === 'pending' ? ' · pending' : ''}
                                            </div>
                                        )}
                                        {cellShifts.length === 0 && !closureLabel && !offsForDay ? (
                                            <p className="mt-3 text-[11px] text-slate-400">—</p>
                                        ) : (
                                            cellShifts.map(s => (
                                                <div
                                                    key={s.id}
                                                    className={`mt-2 px-2 py-1.5 rounded-lg border text-[11px] font-bold ${DEFAULT_SHIFT_PRESETS.find(p => p.key === s.template_key)?.color || 'bg-teal-100 text-teal-800 border-teal-300'}`}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {isoToTime(s.start_at)}–{isoToTime(s.end_at)}
                                                    </div>
                                                    {s.role && <div className="text-[10px] opacity-80 truncate">{s.role}</div>}
                                                    {s.location && <div className="text-[10px] opacity-70 flex items-center gap-1"><Building2 className="w-3 h-3" />{s.location}</div>}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <footer className="px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-600 flex items-center justify-between">
                        <span>Total this week</span>
                        <span className="font-black tabular-nums text-slate-800">{totalHours.toFixed(totalHours % 1 === 0 ? 0 : 2)}h</span>
                    </footer>
                </section>

                {/* Time off */}
                <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <header className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                            <Plane className="w-4 h-4 text-teal-600" />
                            <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700">My time off</h2>
                        </div>
                        <button
                            onClick={() => setRequesting(true)}
                            className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Book time off
                        </button>
                    </header>

                    {allowance && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 sm:px-5 py-4 border-b border-slate-100">
                            <Stat label="Remaining" value={`${allowance.remaining.toFixed(allowance.remaining % 1 === 0 ? 0 : 1)}d`} tone="emerald" />
                            <Stat label="Booked" value={`${allowance.booked.toFixed(allowance.booked % 1 === 0 ? 0 : 1)}d`} tone="slate" />
                            <Stat label="Pending" value={`${allowance.pending.toFixed(allowance.pending % 1 === 0 ? 0 : 1)}d`} tone="amber" />
                            <Stat label="Annual" value={`${allowance.annualAllowance}d`} tone="slate" />
                        </div>
                    )}

                    {requests.length === 0 ? (
                        <div className="p-8 text-center text-sm text-slate-500">No time-off requests yet.</div>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {requests.map(r => {
                                const badge = STATUS_BADGES[r.status];
                                return (
                                    <li key={r.id} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-900">
                                                {r.start_date}
                                                {r.start_date === r.end_date
                                                    ? (r.half_day ? ` (${r.half_day.toUpperCase()} only)` : '')
                                                    : <> &nbsp;→&nbsp; {r.end_date}</>}
                                                <span className="ml-2 text-xs text-slate-500">
                                                    {Number(r.days_count || 0)} day{Number(r.days_count || 0) === 1 ? '' : 's'} · {r.type}
                                                </span>
                                            </p>
                                            {r.reason && <p className="text-xs text-slate-500 italic mt-0.5">"{r.reason}"</p>}
                                            {r.decided_note && (
                                                <p className="text-xs text-slate-500 mt-0.5">Manager note: <span className="text-slate-700">{r.decided_note}</span></p>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${badge.cls}`}>{badge.label}</span>
                                            {r.status === 'pending' && (
                                                <button
                                                    onClick={async () => {
                                                        if (!window.confirm('Cancel this request?')) return;
                                                        try {
                                                            const updated = await submitTimeOff({
                                                                id: r.id,
                                                                user_id: r.user_id,
                                                                type: r.type,
                                                                start_date: r.start_date,
                                                                end_date: r.end_date,
                                                                half_day: r.half_day,
                                                                reason: r.reason,
                                                                status: 'cancelled',
                                                                decided_by: r.decided_by,
                                                                decided_at: r.decided_at,
                                                                decided_note: r.decided_note,
                                                                days_count: r.days_count,
                                                            });
                                                            if (updated) setRequests(prev => prev.map(x => x.id === updated.id ? updated : x));
                                                        } catch (e: any) {
                                                            setError(e?.message || 'Failed to cancel request');
                                                        }
                                                    }}
                                                    className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            </main>

            {requesting && (
                <RequestModal
                    employee={employee}
                    onClose={() => setRequesting(false)}
                    onSubmit={async ({ type, start, end, halfDay, reason }) => {
                        try {
                            const saved = await submitTimeOff({
                                user_id: myUserId,
                                type,
                                start_date: start,
                                end_date: end,
                                half_day: halfDay,
                                reason,
                                status: 'pending',
                                decided_by: null,
                                decided_at: null,
                                decided_note: '',
                                days_count: daysCountFor(start, end, halfDay),
                            });
                            if (saved) {
                                setRequests(prev => [saved, ...prev]);
                                dispatchRotaEmail({
                                    kind: 'time_off_requested',
                                    request: saved,
                                    employee: employee
                                        ? { display_name: employee.display_name, email: employee.email }
                                        : { display_name: currentUser.displayName, email: currentUser.email || null },
                                });
                            }
                            setRequesting(false);
                        } catch (e: any) {
                            setError(e?.message || 'Failed to submit request');
                        }
                    }}
                />
            )}
        </div>
    );
};

const StaffHeader: React.FC<{ displayName: string }> = ({ displayName }) => (
    <header className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
            <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] opacity-80">Stash · My Rota</p>
                <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">Hi, {displayName.split(' ')[0]}</h1>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-80 hidden sm:block">
                Salaried staff portal
            </div>
        </div>
    </header>
);

const Stat: React.FC<{ label: string; value: string; tone: 'emerald' | 'slate' | 'amber' }> = ({ label, value, tone }) => {
    const cls =
        tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
        tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800' :
        'bg-slate-50 border-slate-200 text-slate-800';
    return (
        <div className={`rounded-xl border px-3 py-2 ${cls}`}>
            <div className="text-[9px] font-black uppercase tracking-widest opacity-80">{label}</div>
            <div className="text-lg font-black tabular-nums">{value}</div>
        </div>
    );
};

interface RequestModalProps {
    employee: RotaEmployee | null;
    onClose: () => void;
    onSubmit: (payload: {
        type: 'holiday' | 'sick' | 'unpaid' | 'other';
        start: string;
        end: string;
        halfDay: TimeOffHalfDay;
        reason: string;
    }) => void;
}

const RequestModal: React.FC<RequestModalProps> = ({ employee, onClose, onSubmit }) => {
    const [type, setType] = useState<'holiday' | 'sick' | 'unpaid' | 'other'>('holiday');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [halfDay, setHalfDay] = useState<TimeOffHalfDay>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const days = start && end ? daysCountFor(start, end, halfDay) : 0;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <h3 className="font-black text-lg text-slate-900">Book time off</h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </header>
                <div className="px-5 py-4 space-y-3">
                    <label className="block">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Type</span>
                        <select value={type} onChange={e => setType(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none">
                            <option value="holiday">Holiday</option>
                            <option value="sick">Sick day</option>
                            <option value="unpaid">Unpaid leave</option>
                            <option value="other">Other</option>
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">From</span>
                            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        </label>
                        <label className="block">
                            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">To</span>
                            <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        </label>
                    </div>
                    {start && start === end && (
                        <label className="block">
                            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Duration</span>
                            <select value={halfDay || ''} onChange={e => setHalfDay((e.target.value || null) as TimeOffHalfDay)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none">
                                <option value="">Full day</option>
                                <option value="am">Morning only (AM)</option>
                                <option value="pm">Afternoon only (PM)</option>
                            </select>
                        </label>
                    )}
                    <label className="block">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Reason (optional)</span>
                        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                    </label>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Working days</span>
                        <span className="font-bold text-slate-700 tabular-nums">{days.toFixed(days % 1 === 0 ? 0 : 1)}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                        <MailCheck className="w-3 h-3 inline-block mr-1" />
                        Your manager will be emailed for approval.
                    </p>
                </div>
                <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} disabled={busy} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                    <button
                        onClick={async () => {
                            if (!start || !end) return;
                            setBusy(true);
                            await onSubmit({ type, start, end, halfDay, reason });
                            setBusy(false);
                        }}
                        disabled={busy || !start || !end}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Submit request
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default RotaStaffSurface;
