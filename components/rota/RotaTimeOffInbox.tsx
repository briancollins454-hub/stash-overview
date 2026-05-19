// ─── RotaTimeOffInbox ──────────────────────────────────────────────────────
// Manager screen for reviewing time-off requests. Pending requests bubble
// to the top with one-click approve / decline; approved/declined history
// stays underneath. Each decision triggers an email to the requester.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Loader2, Check, XCircle, MailCheck, Plane, AlertTriangle, Filter, Search, Plus,
} from 'lucide-react';
import {
    decideTimeOff, dispatchRotaEmail, fetchEmployees, fetchTimeOff,
    submitTimeOff,
} from '../../services/rotaService';
import {
    daysCountFor, summariseAllowance,
} from '../../utils/rota';
import type { RotaEmployee, RotaTimeOff, TimeOffStatus } from '../../utils/rota';

export interface RotaTimeOffInboxProps {
    currentUser: { id: string; username: string; displayName: string; role: string };
}

const STATUS_BADGES: Record<TimeOffStatus, { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
    declined: { label: 'Declined', cls: 'bg-rose-100 text-rose-800' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
};

export const RotaTimeOffInbox: React.FC<RotaTimeOffInboxProps> = ({ currentUser }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [requests, setRequests] = useState<RotaTimeOff[]>([]);
    const [statusFilter, setStatusFilter] = useState<'all' | TimeOffStatus>('pending');
    const [search, setSearch] = useState('');
    const [decisionFor, setDecisionFor] = useState<RotaTimeOff | null>(null);
    const [decisionNote, setDecisionNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [emps, reqs] = await Promise.all([fetchEmployees(), fetchTimeOff()]);
            setEmployees(emps);
            setRequests(reqs);
        } catch (e: any) {
            setError(e?.message || 'Failed to load requests');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const empByUserId = useMemo(() => {
        const m = new Map<string, RotaEmployee>();
        for (const e of employees) m.set(e.user_id, e);
        return m;
    }, [employees]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return requests
            .filter(r => statusFilter === 'all' || r.status === statusFilter)
            .filter(r => {
                if (!q) return true;
                const emp = empByUserId.get(r.user_id);
                const hay = `${emp?.display_name || r.user_id} ${r.reason} ${r.type}`.toLowerCase();
                return hay.includes(q);
            })
            .sort((a, b) => {
                // Pending first, then by recency.
                if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
                return b.requested_at.localeCompare(a.requested_at);
            });
    }, [requests, statusFilter, search, empByUserId]);

    const decide = async (status: 'approved' | 'declined') => {
        if (!decisionFor) return;
        setBusy(true);
        setError(null);
        try {
            const updated = await decideTimeOff(decisionFor.id, status, currentUser.id, decisionNote);
            if (updated) {
                setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
                const emp = empByUserId.get(updated.user_id);
                dispatchRotaEmail({
                    kind: 'time_off_decided',
                    request: updated,
                    employee: emp ? { display_name: emp.display_name, email: emp.email } : undefined,
                    decidedByDisplayName: currentUser.displayName,
                });
            }
            setDecisionFor(null);
            setDecisionNote('');
        } catch (e: any) {
            setError(e?.message || 'Failed to update request');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                            type="search"
                            placeholder="Search requests"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        {(['pending', 'approved', 'declined', 'all'] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-widest ${statusFilter === s ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                            >
                                {s === 'all' ? 'All' : STATUS_BADGES[s].label}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onClick={() => setAdding(true)}
                    className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Log time off on behalf
                </button>
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>{error}</div>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center">
                        <p className="text-sm font-bold text-slate-700">No requests match the current filter.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {filtered.map(r => {
                            const emp = empByUserId.get(r.user_id);
                            const allowance = emp ? summariseAllowance(emp, requests) : null;
                            const badge = STATUS_BADGES[r.status];
                            return (
                                <li key={r.id} className="p-4 sm:p-5 hover:bg-slate-50 transition-colors">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Plane className="w-4 h-4 text-teal-600" />
                                                <h4 className="font-black text-sm text-slate-900">
                                                    {emp?.display_name || r.user_id}
                                                </h4>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${badge.cls}`}>
                                                    {badge.label}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-700">
                                                    {r.type}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-700 mt-1">
                                                {r.start_date}
                                                {r.start_date === r.end_date ? (
                                                    r.half_day ? ` (${r.half_day.toUpperCase()} only)` : ''
                                                ) : (
                                                    <> &nbsp;→&nbsp; {r.end_date}</>
                                                )}
                                                <span className="ml-3 text-xs text-slate-500">
                                                    {Number(r.days_count || 0)} day{Number(r.days_count || 0) === 1 ? '' : 's'}
                                                </span>
                                            </p>
                                            {r.reason && <p className="text-xs text-slate-600 mt-1 italic">"{r.reason}"</p>}
                                            {r.decided_note && (
                                                <p className="text-xs text-slate-500 mt-1">
                                                    Manager note: <span className="text-slate-700">{r.decided_note}</span>
                                                </p>
                                            )}
                                            {allowance && (
                                                <p className="text-[11px] text-slate-500 mt-2">
                                                    Allowance: <span className="font-bold text-slate-700">{allowance.remaining.toFixed(allowance.remaining % 1 === 0 ? 0 : 1)}d</span> remaining
                                                    {' '}· {allowance.booked.toFixed(allowance.booked % 1 === 0 ? 0 : 1)}d booked
                                                    {' '}· {allowance.pending.toFixed(allowance.pending % 1 === 0 ? 0 : 1)}d pending
                                                </p>
                                            )}
                                        </div>
                                        {r.status === 'pending' ? (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => { setDecisionFor(r); setDecisionNote(''); }}
                                                    className="flex items-center gap-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                    Decide
                                                </button>
                                            </div>
                                        ) : r.decided_at ? (
                                            <p className="text-[11px] text-slate-400 font-bold">
                                                {new Date(r.decided_at).toLocaleDateString('en-GB')}
                                            </p>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {decisionFor && (
                <DecisionModal
                    request={decisionFor}
                    employeeName={empByUserId.get(decisionFor.user_id)?.display_name || decisionFor.user_id}
                    note={decisionNote}
                    onNoteChange={setDecisionNote}
                    onApprove={() => decide('approved')}
                    onDecline={() => decide('declined')}
                    onClose={() => { setDecisionFor(null); setDecisionNote(''); }}
                    busy={busy}
                />
            )}

            {adding && (
                <ManualEntryModal
                    employees={employees.filter(e => e.is_active)}
                    onClose={() => setAdding(false)}
                    onCreated={async (req) => {
                        setBusy(true);
                        try {
                            const saved = await submitTimeOff({
                                user_id: req.user_id,
                                type: req.type,
                                start_date: req.start_date,
                                end_date: req.end_date,
                                half_day: req.half_day,
                                reason: req.reason,
                                status: 'approved',
                                decided_by: currentUser.id,
                                decided_at: new Date().toISOString(),
                                decided_note: 'Added by manager',
                                days_count: daysCountFor(req.start_date, req.end_date, req.half_day),
                            });
                            if (saved) setRequests(prev => [saved, ...prev]);
                            setAdding(false);
                        } catch (e: any) {
                            setError(e?.message || 'Failed to log time off');
                        } finally {
                            setBusy(false);
                        }
                    }}
                />
            )}
        </section>
    );
};

interface DecisionModalProps {
    request: RotaTimeOff;
    employeeName: string;
    note: string;
    onNoteChange: (next: string) => void;
    onApprove: () => void;
    onDecline: () => void;
    onClose: () => void;
    busy: boolean;
}

const DecisionModal: React.FC<DecisionModalProps> = ({
    request, employeeName, note, onNoteChange, onApprove, onDecline, onClose, busy,
}) => (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <header className="px-5 py-4 border-b border-slate-200">
                <h3 className="font-black text-lg text-slate-900">Decide request</h3>
                <p className="text-xs text-slate-500 mt-1">
                    {employeeName} · {request.start_date}{request.start_date !== request.end_date && ` → ${request.end_date}`}
                </p>
            </header>
            <div className="px-5 py-4 space-y-3">
                <label className="block">
                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Note to {employeeName.split(' ')[0]}</span>
                    <textarea
                        value={note}
                        onChange={e => onNoteChange(e.target.value)}
                        rows={3}
                        placeholder="Optional — appears in the decision email."
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                    />
                </label>
                <p className="text-[11px] text-slate-400">
                    <MailCheck className="w-3 h-3 inline-block mr-1" />
                    Decision will be emailed to the employee.
                </p>
            </div>
            <footer className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                <button onClick={onClose} disabled={busy} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onDecline}
                        disabled={busy}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        Decline
                    </button>
                    <button
                        onClick={onApprove}
                        disabled={busy}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Approve
                    </button>
                </div>
            </footer>
        </div>
    </div>
);

interface ManualEntryModalProps {
    employees: RotaEmployee[];
    onClose: () => void;
    onCreated: (req: {
        user_id: string;
        type: 'holiday' | 'sick' | 'unpaid' | 'other';
        start_date: string;
        end_date: string;
        half_day: 'am' | 'pm' | null;
        reason: string;
    }) => void;
}

const ManualEntryModal: React.FC<ManualEntryModalProps> = ({ employees, onClose, onCreated }) => {
    const [userId, setUserId] = useState<string>(employees[0]?.user_id || '');
    const [type, setType] = useState<'holiday' | 'sick' | 'unpaid' | 'other'>('holiday');
    const [start, setStart] = useState<string>('');
    const [end, setEnd] = useState<string>('');
    const [halfDay, setHalfDay] = useState<'am' | 'pm' | null>(null);
    const [reason, setReason] = useState('');

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-black text-lg text-slate-900">Log time off on behalf</h3>
                </header>
                <div className="px-5 py-4 space-y-3">
                    <select value={userId} onChange={e => setUserId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none">
                        {employees.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name}</option>)}
                    </select>
                    <select value={type} onChange={e => setType(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none">
                        <option value="holiday">Holiday</option>
                        <option value="sick">Sick</option>
                        <option value="unpaid">Unpaid</option>
                        <option value="other">Other</option>
                    </select>
                    <div className="grid grid-cols-2 gap-3">
                        <input type="date" value={start} onChange={e => setStart(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                    </div>
                    {start && start === end && (
                        <select value={halfDay || ''} onChange={e => setHalfDay((e.target.value || null) as any)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none">
                            <option value="">Full day</option>
                            <option value="am">Morning only (AM)</option>
                            <option value="pm">Afternoon only (PM)</option>
                        </select>
                    )}
                    <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Reason (optional)" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                </div>
                <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                    <button
                        onClick={() => {
                            if (!userId || !start || !end) return;
                            onCreated({ user_id: userId, type, start_date: start, end_date: end, half_day: halfDay, reason });
                        }}
                        disabled={!userId || !start || !end}
                        className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                        Save
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default RotaTimeOffInbox;
