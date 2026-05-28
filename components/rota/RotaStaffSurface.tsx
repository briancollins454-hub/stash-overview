// ─── RotaStaffSurface ──────────────────────────────────────────────────────
// The view non-managers see. Hero card with "next shift", team rota view,
// open-shift claim, swap requests, iCal subscribe, holiday clash heads-up.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, CalendarRange, Loader2, MailCheck, Plane, Plus, X,
    Clock, ChevronLeft, ChevronRight, Building2, CheckCircle2, Sparkles,
    Users, Calendar, Copy, ArrowRightLeft, ShieldAlert,
} from 'lucide-react';
import {
    addDays, daysCountFor, isoDate, isoToTime, makeWeekRange, shortDateLabel,
    shiftLengthHours, summariseAllowance,
    clashingTimeOff, detectTimeOffBlocks,
    DEFAULT_SHIFT_PRESETS, ackedByUser,
    type RotaBlockedDate, type RotaEmployee, type RotaShift, type RotaShiftAck,
    type RotaSwapRequest, type RotaTimeOff,
    type TimeOffHalfDay, type TimeOffStatus,
} from '../../utils/rota';
import {
    acknowledgeShift,
    createSwapRequest,
    decideSwapRequest,
    dispatchRotaEmail,
    fetchAcksForUser, fetchBlockedDates, fetchClosures, fetchEmployees,
    fetchShiftsInRange, fetchShiftsForUser, fetchSwapRequests, fetchTimeOff,
    submitTimeOff,
} from '../../services/rotaService';

export interface RotaStaffSurfaceProps {
    currentUser: { id: string; username: string; displayName: string; role: string; email?: string };
    chromeless?: boolean;
}

const STATUS_BADGES: Record<TimeOffStatus, { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
    declined: { label: 'Declined', cls: 'bg-rose-100 text-rose-800' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
};

type StaffTab = 'me' | 'team' | 'open' | 'swaps' | 'time-off';

export const RotaStaffSurface: React.FC<RotaStaffSurfaceProps> = ({ currentUser, chromeless }) => {
    const [tab, setTab] = useState<StaffTab>('me');
    const [anchor, setAnchor] = useState(new Date());
    const week = useMemo(() => makeWeekRange(anchor), [anchor]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const [myShifts, setMyShifts] = useState<RotaShift[]>([]);
    const [allShifts, setAllShifts] = useState<RotaShift[]>([]);
    const [requests, setRequests] = useState<RotaTimeOff[]>([]);
    const [allRequests, setAllRequests] = useState<RotaTimeOff[]>([]);
    const [closuresDates, setClosuresDates] = useState<Record<string, string>>({});
    const [employee, setEmployee] = useState<RotaEmployee | null>(null);
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [acks, setAcks] = useState<RotaShiftAck[]>([]);
    const [swaps, setSwaps] = useState<RotaSwapRequest[]>([]);
    const [blockedDates, setBlockedDates] = useState<RotaBlockedDate[]>([]);
    const [requesting, setRequesting] = useState(false);
    const [swapRequestingFor, setSwapRequestingFor] = useState<RotaShift | null>(null);

    const myUserId = currentUser.username || currentUser.id;

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [mine, all, ownReqs, allReqs, cls, emps, ackRows, swapRows, blocked] = await Promise.all([
                fetchShiftsForUser(myUserId, week.isoStart, week.isoEnd),
                fetchShiftsInRange(week.isoStart, week.isoEnd),
                fetchTimeOff({ userId: myUserId }),
                fetchTimeOff(),
                fetchClosures(),
                fetchEmployees(),
                fetchAcksForUser(myUserId),
                fetchSwapRequests({ userId: myUserId }),
                fetchBlockedDates(),
            ]);
            // Staff only see published shifts — never draft/WIP.
            const published = (rows: RotaShift[]) => rows.filter(s => s.published);
            setMyShifts(published(mine));
            setAllShifts(published(all));
            setRequests(ownReqs);
            setAllRequests(allReqs);
            setClosuresDates(Object.fromEntries(cls.map(c => [c.closure_date, c.label])));
            setEmployees(emps);
            setEmployee(emps.find(e => e.user_id === myUserId) || null);
            setAcks(ackRows);
            setSwaps(swapRows);
            setBlockedDates(blocked);
        } catch (e: any) {
            setError(e?.message || 'Failed to load your rota');
        } finally {
            setLoading(false);
        }
    }, [week.isoStart, week.isoEnd, myUserId]);

    useEffect(() => { reload(); }, [reload]);

    const totalHours = useMemo(() => myShifts.reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0), [myShifts]);
    const allowance = useMemo(() => employee ? summariseAllowance(employee, requests) : null, [employee, requests]);

    const openShifts = useMemo(() => allShifts.filter(s => !s.user_id), [allShifts]);

    const upcomingShift = useMemo(() => {
        const now = Date.now();
        return [...myShifts]
            .filter(s => new Date(s.end_at).getTime() > now)
            .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] || null;
    }, [myShifts]);

    const unackedShifts = useMemo(
        () => myShifts.filter(s => !ackedByUser(acks, s.id, myUserId)),
        [myShifts, acks, myUserId],
    );

    const handleAck = async (shiftId: number) => {
        try {
            const ack = await acknowledgeShift(shiftId, myUserId);
            if (ack) setAcks(prev => [...prev.filter(a => a.shift_id !== shiftId), ack]);
        } catch (e: any) {
            setError(e?.message || 'Failed to acknowledge');
        }
    };

    const handleClaim = async (shift: RotaShift) => {
        if (!window.confirm(`Request this open shift on ${shortDateLabel(new Date(shift.start_at))} ${isoToTime(shift.start_at)}–${isoToTime(shift.end_at)}? A manager will need to approve.`)) return;
        try {
            const claimReq = await createSwapRequest({
                requester_id: myUserId,
                counterparty_id: myUserId, // manager approval will assign shift to this user
                shift_id: shift.id,
                offered_shift_id: null,
                reason: `Open-shift claim request (${shortDateLabel(new Date(shift.start_at))} ${isoToTime(shift.start_at)}-${isoToTime(shift.end_at)})`,
                status: 'pending',
                decided_by: null,
                decided_at: null,
            });
            if (claimReq) {
                setSwaps(prev => [claimReq, ...prev]);
                dispatchRotaEmail({
                    kind: 'shift_swap_requested',
                    swap: claimReq,
                    employee: employee
                        ? { display_name: employee.display_name, email: employee.email }
                        : { display_name: currentUser.displayName, email: currentUser.email || null },
                });
                setInfo('Claim request sent to manager for approval.');
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to request claim');
        }
    };

    const handleRequestSwap = async (shift: RotaShift, reason: string) => {
        try {
            const swap = await createSwapRequest({
                requester_id: myUserId,
                counterparty_id: null,
                shift_id: shift.id,
                offered_shift_id: null,
                reason,
                status: 'pending',
                decided_by: null,
                decided_at: null,
            });
            if (swap) {
                setSwaps(prev => [swap, ...prev]);
                dispatchRotaEmail({
                    kind: 'shift_swap_requested',
                    swap,
                    employee: employee
                        ? { display_name: employee.display_name, email: employee.email }
                        : { display_name: currentUser.displayName, email: currentUser.email || null },
                });
                setInfo('Swap request raised. A manager will review it.');
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to request swap');
        }
    };

    const handleCancelSwap = async (id: number) => {
        if (!window.confirm('Withdraw this swap request?')) return;
        try {
            const updated = await decideSwapRequest(id, 'cancelled', myUserId);
            if (updated) setSwaps(prev => prev.map(s => s.id === updated.id ? updated : s));
        } catch (e: any) {
            setError(e?.message || 'Failed to cancel');
        }
    };

    const copyIcalUrl = async () => {
        if (!employee?.ical_token) {
            setError('Your iCal token is not set up yet — ask a manager to refresh your profile.');
            return;
        }
        const url = `${window.location.origin}/api/rota-ics?token=${employee.ical_token}`;
        try {
            await navigator.clipboard.writeText(url);
            setInfo('iCal URL copied — paste it into Apple Calendar / Google Calendar "Subscribe to calendar".');
        } catch {
            window.prompt('Copy this URL into your calendar app:', url);
        }
    };

    const tabs: { id: StaffTab; label: string; icon: typeof Calendar; count?: number }[] = [
        { id: 'me', label: 'My rota', icon: Calendar },
        { id: 'team', label: 'Team', icon: Users },
        { id: 'open', label: 'Open shifts', icon: Sparkles, count: openShifts.length },
        { id: 'swaps', label: 'Swaps', icon: ArrowRightLeft, count: swaps.filter(s => s.status === 'pending').length },
        { id: 'time-off', label: 'Time off', icon: Plane, count: requests.filter(r => r.status === 'pending').length },
    ];

    return (
        <div className={chromeless ? '' : 'min-h-screen bg-slate-50'}>
            {!chromeless && <StaffHeader displayName={currentUser.displayName || currentUser.username} />}

            <main className={chromeless ? 'space-y-4' : 'max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4'}>
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="flex-1">{error}</div>
                        <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
                    </div>
                )}
                {info && (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm">
                        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="flex-1">{info}</div>
                        <button onClick={() => setInfo(null)}><X className="w-4 h-4" /></button>
                    </div>
                )}

                {!employee && !loading && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 text-sm text-slate-700">
                        Your Rota profile hasn't been set up yet. Ask your manager to add you under <strong>Rota → Employees</strong>.
                    </div>
                )}

                {upcomingShift && (
                    <NextShiftHero
                        shift={upcomingShift}
                        unackedCount={unackedShifts.length}
                        onAck={() => handleAck(upcomingShift.id)}
                        acked={ackedByUser(acks, upcomingShift.id, myUserId)}
                        onCopyIcal={copyIcalUrl}
                        hasIcal={!!employee?.ical_token}
                    />
                )}

                <nav className="bg-white rounded-2xl shadow-sm border border-slate-200 p-1 flex gap-1 overflow-x-auto">
                    {tabs.map(t => {
                        const Icon = t.icon;
                        const isActive = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-colors whitespace-nowrap ${
                                    isActive ? 'bg-teal-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />{t.label}
                                {t.count != null && t.count > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] ${isActive ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'}`}>{t.count}</span>
                                )}
                            </button>
                        );
                    })}
                </nav>

                {/* My rota */}
                {tab === 'me' && (
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <header className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                <CalendarRange className="w-4 h-4 text-teal-600" />
                                <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700">This week</h2>
                            </div>
                            <WeekNav anchor={anchor} onChange={setAnchor} week={week} />
                        </header>
                        {loading ? (
                            <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                        ) : (
                            <WeekGrid
                                week={week}
                                shifts={myShifts}
                                closuresDates={closuresDates}
                                requests={requests}
                                acks={acks}
                                onAck={handleAck}
                                onSwap={shift => setSwapRequestingFor(shift)}
                                myUserId={myUserId}
                            />
                        )}
                        <footer className="px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-600 flex items-center justify-between">
                            <span>Total this week</span>
                            <span className="font-black tabular-nums text-slate-800">{totalHours.toFixed(totalHours % 1 === 0 ? 0 : 2)}h</span>
                        </footer>
                    </section>
                )}

                {/* Team rota */}
                {tab === 'team' && (
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <header className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                <Users className="w-4 h-4 text-teal-600" />
                                <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700">Team rota</h2>
                            </div>
                            <WeekNav anchor={anchor} onChange={setAnchor} week={week} />
                        </header>
                        {loading ? (
                            <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                        ) : (
                            <TeamGrid
                                week={week}
                                shifts={allShifts}
                                employees={employees}
                                requests={allRequests}
                                closuresDates={closuresDates}
                                meUserId={myUserId}
                            />
                        )}
                    </section>
                )}

                {/* Open shifts */}
                {tab === 'open' && (
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <header className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-pink-600" /> Open shifts — {openShifts.length}
                            </h2>
                        </header>
                        {openShifts.length === 0 ? (
                            <div className="p-8 text-center text-sm text-slate-500">No open shifts at the moment.</div>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {openShifts.map(s => (
                                    <li key={s.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-900">
                                                {shortDateLabel(new Date(s.start_at))} · {isoToTime(s.start_at)}–{isoToTime(s.end_at)}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                {[s.role, s.location].filter(Boolean).join(' · ') || 'Open shift'}
                                                {s.requires_count && s.requires_count > 1 ? ` · ${s.requires_count} slots` : ''}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleClaim(s)}
                                            className="flex items-center gap-2 px-4 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-pink-600 text-white hover:bg-pink-700"
                                        >
                                            Request claim
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}

                {/* Swaps */}
                {tab === 'swaps' && (
                    <SwapsPanel
                        swaps={swaps}
                        myUserId={myUserId}
                        myShifts={myShifts}
                        onCancel={handleCancelSwap}
                    />
                )}

                {/* Time off */}
                {tab === 'time-off' && (
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <header className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                <Plane className="w-4 h-4 text-teal-600" />
                                <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700">My time off</h2>
                            </div>
                            <button onClick={() => setRequesting(true)} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                                <Plus className="w-3.5 h-3.5" /> Book time off
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
                                                {r.decided_note && <p className="text-xs text-slate-500 mt-0.5">Manager note: <span className="text-slate-700">{r.decided_note}</span></p>}
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${badge.cls}`}>{badge.label}</span>
                                                {r.status === 'pending' && (
                                                    <button
                                                        onClick={async () => {
                                                            if (!window.confirm('Cancel this request?')) return;
                                                            try {
                                                                const updated = await submitTimeOff({ ...r, status: 'cancelled' });
                                                                if (updated) setRequests(prev => prev.map(x => x.id === updated.id ? updated : x));
                                                            } catch (e: any) {
                                                                setError(e?.message || 'Failed to cancel');
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
                )}
            </main>

            {requesting && (
                <RequestModal
                    employee={employee}
                    allRequests={allRequests}
                    employees={employees}
                    blockedDates={blockedDates}
                    myUserId={myUserId}
                    onClose={() => setRequesting(false)}
                    onSubmit={async ({ type, start, end, halfDay, reason }) => {
                        try {
                            const saved = await submitTimeOff({
                                user_id: myUserId,
                                type, start_date: start, end_date: end,
                                half_day: halfDay, reason,
                                status: 'pending',
                                decided_by: null, decided_at: null, decided_note: '',
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

            {swapRequestingFor && (
                <SwapRequestModal
                    shift={swapRequestingFor}
                    onClose={() => setSwapRequestingFor(null)}
                    onSubmit={async (reason) => {
                        await handleRequestSwap(swapRequestingFor, reason);
                        setSwapRequestingFor(null);
                    }}
                />
            )}
        </div>
    );
};

// ─── Hero ──────────────────────────────────────────────────────────────────
const NextShiftHero: React.FC<{
    shift: RotaShift;
    unackedCount: number;
    acked: boolean;
    hasIcal: boolean;
    onAck: () => void;
    onCopyIcal: () => void;
}> = ({ shift, unackedCount, acked, hasIcal, onAck, onCopyIcal }) => {
    const start = new Date(shift.start_at);
    const end = new Date(shift.end_at);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
    const diff = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
    const when = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    return (
        <section className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-2xl shadow-md p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] opacity-80">Your next shift</p>
                    <h2 className="text-2xl font-black mt-1">{when} · {isoToTime(shift.start_at)}–{isoToTime(shift.end_at)}</h2>
                    <div className="mt-1 text-sm opacity-90 flex items-center gap-3 flex-wrap">
                        {shift.role && <span><strong>Role:</strong> {shift.role}</span>}
                        {shift.location && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {shift.location}</span>}
                        <span className="opacity-80">{((end.getTime() - start.getTime()) / 3_600_000).toFixed(1)}h</span>
                    </div>
                    {unackedCount > 0 && (
                        <p className="text-[11px] opacity-90 mt-2">
                            {unackedCount} shift{unackedCount === 1 ? '' : 's'} this week haven't been acknowledged.
                        </p>
                    )}
                </div>
                <div className="flex flex-col gap-2">
                    {acked ? (
                        <span className="px-3 py-2 rounded-lg bg-white/20 text-[11px] font-black uppercase tracking-widest flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Acknowledged</span>
                    ) : (
                        <button onClick={onAck} className="px-3 py-2 rounded-lg bg-white text-teal-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-100">Got it</button>
                    )}
                    {hasIcal && (
                        <button onClick={onCopyIcal} className="px-3 py-2 rounded-lg bg-white/15 text-[11px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-white/25">
                            <Copy className="w-3.5 h-3.5" /> Calendar URL
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
};

// ─── Week navigation ───────────────────────────────────────────────────────
const WeekNav: React.FC<{ anchor: Date; week: any; onChange: (d: Date) => void }> = ({ anchor, week, onChange }) => (
    <div className="flex items-center gap-1">
        <button onClick={() => onChange(addDays(anchor, -7))} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
        <div className="px-3 py-2 text-xs font-bold text-slate-700">{shortDateLabel(week.days[0])} – {shortDateLabel(week.days[6])}</div>
        <button onClick={() => onChange(addDays(anchor, 7))} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => onChange(new Date())} className="ml-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-teal-700 hover:bg-teal-50">Today</button>
    </div>
);

// ─── Week grid for the staff "me" tab ──────────────────────────────────────
const WeekGrid: React.FC<{
    week: any;
    shifts: RotaShift[];
    closuresDates: Record<string, string>;
    requests: RotaTimeOff[];
    acks: RotaShiftAck[];
    onAck: (shiftId: number) => void;
    onSwap: (shift: RotaShift) => void;
    myUserId: string;
}> = ({ week, shifts, closuresDates, requests, acks, onAck, onSwap, myUserId }) => (
    <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        {week.days.map((day: Date) => {
            const target = isoDate(day);
            const cellShifts = shifts.filter(s => s.start_at.startsWith(target));
            const off = requests.find(r => target >= r.start_date && target <= r.end_date && r.status !== 'declined' && r.status !== 'cancelled');
            const closureLabel = closuresDates[target];
            const isToday = isoDate(new Date()) === target;
            return (
                <div key={target} className={`p-3 min-h-[130px] ${isToday ? 'bg-teal-50/50' : ''}`}>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{shortDateLabel(day)}</div>
                    {closureLabel && <div className="mt-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-rose-50 text-rose-700 border border-rose-200">{closureLabel}</div>}
                    {off && <div className="mt-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-amber-50 text-amber-800 border border-amber-200">{off.type}{off.status === 'pending' ? ' · pending' : ''}</div>}
                    {cellShifts.length === 0 && !closureLabel && !off ? (
                        <p className="mt-3 text-[11px] text-slate-400">—</p>
                    ) : (
                        cellShifts.map(s => {
                            const isAcked = ackedByUser(acks, s.id, myUserId);
                            return (
                                <div key={s.id} className={`mt-2 px-2 py-1.5 rounded-lg border text-[11px] font-bold ${DEFAULT_SHIFT_PRESETS.find(p => p.key === s.template_key)?.color || 'bg-teal-100 text-teal-800 border-teal-300'}`}>
                                    <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{isoToTime(s.start_at)}–{isoToTime(s.end_at)}</div>
                                    {s.role && <div className="text-[10px] opacity-80 truncate">{s.role}</div>}
                                    {s.location && <div className="text-[10px] opacity-70 flex items-center gap-1"><Building2 className="w-3 h-3" />{s.location}</div>}
                                    <div className="flex items-center gap-1 mt-1">
                                        {isAcked ? (
                                            <span className="text-[9px] font-black uppercase tracking-widest opacity-70 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Seen</span>
                                        ) : (
                                            <button onClick={() => onAck(s.id)} className="text-[9px] font-black uppercase tracking-widest underline opacity-80 hover:opacity-100">Got it</button>
                                        )}
                                        <button onClick={() => onSwap(s)} className="text-[9px] font-black uppercase tracking-widest underline opacity-70 hover:opacity-100 ml-auto">Swap</button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            );
        })}
    </div>
);

// ─── Team grid ─────────────────────────────────────────────────────────────
const TeamGrid: React.FC<{
    week: any;
    shifts: RotaShift[];
    employees: RotaEmployee[];
    requests: RotaTimeOff[];
    closuresDates: Record<string, string>;
    meUserId: string;
}> = ({ week, shifts, employees, requests, closuresDates, meUserId }) => {
    const active = employees.filter(e => e.is_active);
    const shiftsByCell = useMemo(() => {
        const m = new Map<string, RotaShift[]>();
        for (const s of shifts) {
            if (!s.user_id) continue;
            const key = `${s.user_id}|${isoDate(new Date(s.start_at))}`;
            const arr = m.get(key) || [];
            arr.push(s);
            m.set(key, arr);
        }
        return m;
    }, [shifts]);

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left p-2 font-black uppercase text-[10px] tracking-widest text-slate-500 sticky left-0 bg-slate-50 min-w-[140px]">Team</th>
                        {week.days.map((day: Date) => {
                            const closure = closuresDates[isoDate(day)];
                            return (
                                <th key={day.toISOString()} className="p-2 text-left font-black uppercase text-[10px] tracking-widest text-slate-500 min-w-[110px]">
                                    {shortDateLabel(day)}
                                    {closure && <div className="text-[9px] text-rose-600 font-bold normal-case tracking-normal">{closure}</div>}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {active.map(emp => (
                        <tr key={emp.user_id} className={`border-b border-slate-100 ${emp.user_id === meUserId ? 'bg-teal-50/40' : ''}`}>
                            <td className="p-2 sticky left-0 bg-white border-r border-slate-100">
                                <div className="font-bold text-slate-900 text-xs">{emp.display_name}</div>
                                {emp.user_id === meUserId && <div className="text-[9px] font-black uppercase tracking-widest text-teal-700">You</div>}
                            </td>
                            {week.days.map((day: Date) => {
                                const cs = shiftsByCell.get(`${emp.user_id}|${isoDate(day)}`) || [];
                                const off = requests.find(r => r.user_id === emp.user_id && r.status === 'approved' && isoDate(day) >= r.start_date && isoDate(day) <= r.end_date);
                                return (
                                    <td key={day.toISOString()} className="p-2 align-top border-r border-slate-100">
                                        {off && <div className="text-[9px] font-bold uppercase tracking-widest bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded mb-1">Off</div>}
                                        {cs.length === 0 && !off ? <span className="text-slate-300">—</span> : cs.map(s => (
                                            <div key={s.id} className={`mb-1 px-1.5 py-1 rounded text-[10px] font-bold ${DEFAULT_SHIFT_PRESETS.find(p => p.key === s.template_key)?.color || 'bg-teal-100 text-teal-800 border-teal-300'} border`}>
                                                {isoToTime(s.start_at)}–{isoToTime(s.end_at)}
                                            </div>
                                        ))}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

// ─── Swaps ─────────────────────────────────────────────────────────────────
const SwapsPanel: React.FC<{
    swaps: RotaSwapRequest[];
    myUserId: string;
    myShifts: RotaShift[];
    onCancel: (id: number) => void;
}> = ({ swaps, myUserId, onCancel }) => (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <header className="px-4 sm:px-5 py-4 border-b border-slate-200">
            <h2 className="font-black text-[11px] uppercase tracking-widest text-slate-700">My swap requests</h2>
            <p className="text-[11px] text-slate-500 mt-1">Raise a swap from your own shift in the My rota tab.</p>
        </header>
        {swaps.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No swap requests yet.</div>
        ) : (
            <ul className="divide-y divide-slate-100">
                {swaps.map(s => (
                    <li key={s.id} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900">Shift #{s.shift_id} · {s.status}</p>
                            {s.reason && <p className="text-xs text-slate-600 italic">"{s.reason}"</p>}
                            <p className="text-[10px] text-slate-400 mt-1">Raised {new Date(s.created_at).toLocaleString('en-GB')}</p>
                        </div>
                        {s.requester_id === myUserId && s.status === 'pending' && (
                            <button onClick={() => onCancel(s.id)} className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600">Withdraw</button>
                        )}
                    </li>
                ))}
            </ul>
        )}
    </section>
);

const SwapRequestModal: React.FC<{
    shift: RotaShift;
    onClose: () => void;
    onSubmit: (reason: string) => void;
}> = ({ shift, onClose, onSubmit }) => {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-black text-lg text-slate-900">Request shift swap</h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button>
                </header>
                <div className="px-5 py-4 space-y-3">
                    <p className="text-sm text-slate-700">
                        <strong>{shortDateLabel(new Date(shift.start_at))}</strong> · {isoToTime(shift.start_at)}–{isoToTime(shift.end_at)}
                    </p>
                    <label className="block">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Why are you asking to swap?</span>
                        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Optional context for your manager…" />
                    </label>
                    <p className="text-[11px] text-slate-400"><MailCheck className="w-3 h-3 inline mr-1" />Your manager will be emailed.</p>
                </div>
                <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} disabled={busy} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                    <button onClick={async () => { setBusy(true); await onSubmit(reason); setBusy(false); }} disabled={busy} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Request swap
                    </button>
                </footer>
            </div>
        </div>
    );
};

// ─── Header / Stats ────────────────────────────────────────────────────────
const StaffHeader: React.FC<{ displayName: string }> = ({ displayName }) => (
    <header className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
            <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] opacity-80">Stash · My Rota</p>
                <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">Hi, {displayName.split(' ')[0]}</h1>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-80 hidden sm:block">Salaried staff portal</div>
        </div>
    </header>
);

const Stat: React.FC<{ label: string; value: string; tone: 'emerald' | 'slate' | 'amber' }> = ({ label, value, tone }) => {
    const cls = tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
        : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-slate-50 border-slate-200 text-slate-800';
    return (
        <div className={`rounded-xl border px-3 py-2 ${cls}`}>
            <div className="text-[9px] font-black uppercase tracking-widest opacity-80">{label}</div>
            <div className="text-lg font-black tabular-nums">{value}</div>
        </div>
    );
};

// ─── Holiday request modal with clash + block detection ────────────────────
interface RequestModalProps {
    employee: RotaEmployee | null;
    allRequests: RotaTimeOff[];
    employees: RotaEmployee[];
    blockedDates: RotaBlockedDate[];
    myUserId: string;
    onClose: () => void;
    onSubmit: (payload: {
        type: 'holiday' | 'sick' | 'unpaid' | 'other';
        start: string;
        end: string;
        halfDay: TimeOffHalfDay;
        reason: string;
    }) => void;
}

const RequestModal: React.FC<RequestModalProps> = ({ allRequests, employees, blockedDates, myUserId, onClose, onSubmit }) => {
    const [type, setType] = useState<'holiday' | 'sick' | 'unpaid' | 'other'>('holiday');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [halfDay, setHalfDay] = useState<TimeOffHalfDay>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const days = start && end ? daysCountFor(start, end, halfDay) : 0;
    const clashes = useMemo(() => {
        if (!start || !end) return [] as RotaTimeOff[];
        return clashingTimeOff(start, end, myUserId, allRequests);
    }, [start, end, allRequests, myUserId]);
    const blocks = useMemo(() => {
        if (!start || !end) return [];
        return detectTimeOffBlocks(start, end, blockedDates);
    }, [start, end, blockedDates]);
    const hardBlock = blocks.some(b => b.severity === 'error');

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <h3 className="font-black text-lg text-slate-900">Book time off</h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
                </header>
                <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
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

                    {blocks.length > 0 && (
                        <ul className="space-y-1.5">
                            {blocks.map((b, i) => (
                                <li key={i} className={`flex items-start gap-2 p-2 rounded text-[11px] font-semibold ${b.severity === 'error' ? 'bg-rose-50 border border-rose-200 text-rose-900' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />{b.message}
                                </li>
                            ))}
                        </ul>
                    )}

                    {clashes.length > 0 && (
                        <div className="p-2 rounded text-[11px] bg-amber-50 border border-amber-200 text-amber-900">
                            <p className="font-bold mb-1">Heads-up — {clashes.length} other staff have leave overlapping these dates:</p>
                            <ul className="list-disc list-inside">
                                {clashes.slice(0, 6).map(c => {
                                    const emp = employees.find(e => e.user_id === c.user_id);
                                    return <li key={c.id}>{emp?.display_name || c.user_id} ({c.status})</li>;
                                })}
                                {clashes.length > 6 && <li>+{clashes.length - 6} more</li>}
                            </ul>
                            <p className="mt-1 italic">Your manager will see this when approving — submit anyway if you'd still like to request it.</p>
                        </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Working days</span>
                        <span className="font-bold text-slate-700 tabular-nums">{days.toFixed(days % 1 === 0 ? 0 : 1)}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                        <MailCheck className="w-3 h-3 inline-block mr-1" />Your manager will be emailed for approval.
                    </p>
                </div>
                <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} disabled={busy} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                    <button
                        onClick={async () => { if (!start || !end || hardBlock) return; setBusy(true); await onSubmit({ type, start, end, halfDay, reason }); setBusy(false); }}
                        disabled={busy || !start || !end || hardBlock}
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
