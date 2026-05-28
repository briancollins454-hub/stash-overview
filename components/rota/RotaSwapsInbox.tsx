// ─── RotaSwapsInbox ────────────────────────────────────────────────────────
// Manager screen for reviewing pending shift-swap requests. Approving
// re-assigns the shift; declining just sets the status.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, Loader2, X } from 'lucide-react';
import {
    appendAudit,
    decideSwapRequest, fetchEmployees, fetchShiftsInRange, fetchSwapRequests,
    saveShift,
} from '../../services/rotaService';
import {
    diffShiftPayloads, isoToDate, shortDateLabel, isoToTime,
    type RotaEmployee, type RotaShift, type RotaSwapRequest,
} from '../../utils/rota';

export interface RotaSwapsInboxProps {
    currentUser: { id: string; displayName: string };
}

export const RotaSwapsInbox: React.FC<RotaSwapsInboxProps> = ({ currentUser }) => {
    const [swaps, setSwaps] = useState<RotaSwapRequest[]>([]);
    const [shifts, setShifts] = useState<Map<number, RotaShift>>(new Map());
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [sw, emps] = await Promise.all([
                fetchSwapRequests(statusFilter === 'pending' ? { status: 'pending' } : {}),
                fetchEmployees(),
            ]);
            setSwaps(sw);
            setEmployees(emps);
            // Bulk-load each referenced shift (window keyed on min/max start).
            const ids = new Set<number>();
            sw.forEach(s => { if (s.shift_id) ids.add(s.shift_id); if (s.offered_shift_id) ids.add(s.offered_shift_id); });
            if (ids.size === 0) { setShifts(new Map()); return; }
            // Pull a generous 6-month window — cheaper than per-id requests.
            const now = new Date();
            const start = new Date(now); start.setMonth(start.getMonth() - 3);
            const end = new Date(now); end.setMonth(end.getMonth() + 3);
            const window = await fetchShiftsInRange(start.toISOString(), end.toISOString());
            const map = new Map<number, RotaShift>();
            for (const s of window) if (ids.has(s.id)) map.set(s.id, s);
            setShifts(map);
        } catch (e: any) {
            setError(e?.message || 'Failed to load swap requests');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { reload(); }, [reload]);

    const empName = (uid: string | null) => employees.find(e => e.user_id === uid)?.display_name || uid || '?';

    const handleAccept = async (swap: RotaSwapRequest) => {
        if (!swap.shift_id) return;
        const target = shifts.get(swap.shift_id);
        if (!target) {
            setError('Source shift not found — was it deleted?');
            return;
        }
        const newOwner = swap.counterparty_id || null;
        const action = newOwner
            ? `Re-assign shift on ${isoToDate(target.start_at)} ${isoToTime(target.start_at)}–${isoToTime(target.end_at)} from ${empName(target.user_id)} to ${empName(newOwner)}?`
            : `Release shift on ${isoToDate(target.start_at)} ${isoToTime(target.start_at)}–${isoToTime(target.end_at)} back to the open-shift pool?`;
        if (!window.confirm(action)) return;
        setBusyId(swap.id);
        try {
            const before = { ...target };
            const updated = await saveShift({ ...target, user_id: newOwner });
            const decided = await decideSwapRequest(swap.id, 'accepted', currentUser.id);
            if (updated) void appendAudit({
                entity: 'shift',
                entity_id: String(target.id),
                action: 'swap_accept',
                diff: diffShiftPayloads(before, updated),
                actor_id: currentUser.id,
                actor_name: currentUser.displayName,
                note: `Swap #${swap.id}`,
            });
            if (decided) setSwaps(prev => prev.map(s => s.id === decided.id ? decided : s));
        } catch (e: any) {
            setError(e?.message || 'Failed to accept swap');
        } finally {
            setBusyId(null);
        }
    };

    const handleDecline = async (swap: RotaSwapRequest) => {
        if (!window.confirm('Decline this swap request?')) return;
        setBusyId(swap.id);
        try {
            const decided = await decideSwapRequest(swap.id, 'declined', currentUser.id);
            if (decided) {
                setSwaps(prev => prev.map(s => s.id === decided.id ? decided : s));
                void appendAudit({
                    entity: 'swap',
                    entity_id: String(swap.id),
                    action: 'swap_decline',
                    diff: { status: { from: 'pending', to: 'declined' } },
                    actor_id: currentUser.id,
                    actor_name: currentUser.displayName,
                    note: '',
                });
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to decline');
        } finally {
            setBusyId(null);
        }
    };

    const filtered = useMemo(() => statusFilter === 'pending' ? swaps.filter(s => s.status === 'pending') : swaps, [swaps, statusFilter]);

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                    <ArrowRightLeft className="w-5 h-5 text-teal-600" />
                    <div>
                        <h2 className="font-black uppercase tracking-widest text-[11px] text-slate-500">Shift swap requests</h2>
                        <p className="text-xs text-slate-500">Approving re-assigns the shift to the counterparty (or releases to the open pool).</p>
                    </div>
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-2 py-1 rounded border border-slate-300 text-xs font-bold">
                    <option value="pending">Pending only</option>
                    <option value="all">All requests</option>
                </select>
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div className="flex-1">{error}</div>
                    <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No swap requests {statusFilter === 'pending' ? 'pending' : 'on record'}.</div>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {filtered.map(s => {
                            const shift = s.shift_id ? shifts.get(s.shift_id) : undefined;
                            return (
                                <li key={s.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-slate-900">
                                            {empName(s.requester_id)} → {s.counterparty_id ? empName(s.counterparty_id) : 'open pool'}
                                        </p>
                                        {shift ? (
                                            <p className="text-xs text-slate-600">
                                                <strong>{shortDateLabel(new Date(shift.start_at))}</strong> · {isoToTime(shift.start_at)}–{isoToTime(shift.end_at)}
                                                {shift.role ? ` · ${shift.role}` : ''}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-rose-600">Source shift not found.</p>
                                        )}
                                        {s.reason && <p className="text-xs text-slate-500 italic mt-1">"{s.reason}"</p>}
                                        <p className="text-[10px] text-slate-400 mt-1">
                                            Raised {new Date(s.created_at).toLocaleString('en-GB')} · status <strong className="uppercase tracking-widest">{s.status}</strong>
                                        </p>
                                    </div>
                                    {s.status === 'pending' && (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleAccept(s)} disabled={busyId === s.id} className="flex items-center gap-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                                                {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                                            </button>
                                            <button onClick={() => handleDecline(s)} disabled={busyId === s.id} className="flex items-center gap-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                                                <X className="w-3.5 h-3.5" /> Decline
                                            </button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
};

export default RotaSwapsInbox;
