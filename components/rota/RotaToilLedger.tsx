// ─── RotaToilLedger ───────────────────────────────────────────────────────
// Manager view of "time off in lieu" balances per employee with a running
// ledger and add/spend entry form.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
    addToilEntry, deleteToilEntry, fetchEmployees, fetchToilEntries,
} from '../../services/rotaService';
import { toilBalance, type RotaEmployee, type RotaToilEntry } from '../../utils/rota';

export interface RotaToilLedgerProps {
    currentUser: { id: string; displayName: string };
}

interface Editing {
    user_id: string;
    hours: string;     // negative = spent, positive = earned
    reason: string;
    earned_on: string;
    expires_on: string;
}

const EMPTY = (uid: string): Editing => ({
    user_id: uid,
    hours: '',
    reason: '',
    earned_on: new Date().toISOString().slice(0, 10),
    expires_on: '',
});

export const RotaToilLedger: React.FC<RotaToilLedgerProps> = ({ currentUser }) => {
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [entries, setEntries] = useState<RotaToilEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [busy, setBusy] = useState(false);
    const [filterUser, setFilterUser] = useState<string>('all');

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [emps, ents] = await Promise.all([fetchEmployees(), fetchToilEntries()]);
            setEmployees(emps.filter(e => e.is_active));
            setEntries(ents);
        } catch (e: any) {
            setError(e?.message || 'Failed to load TOIL ledger');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const balances = useMemo(() => {
        const out = new Map<string, number>();
        for (const emp of employees) out.set(emp.user_id, toilBalance(entries, emp.user_id));
        return out;
    }, [employees, entries]);

    const filteredEntries = useMemo(
        () => filterUser === 'all' ? entries : entries.filter(e => e.user_id === filterUser),
        [entries, filterUser],
    );

    const handleSave = async () => {
        if (!editing) return;
        const hours = parseFloat(editing.hours);
        if (!Number.isFinite(hours) || hours === 0) {
            setError('Enter a non-zero number of hours (use a negative number to spend TOIL).');
            return;
        }
        if (!editing.reason.trim()) {
            setError('Reason is required.');
            return;
        }
        setBusy(true);
        try {
            const saved = await addToilEntry({
                user_id: editing.user_id,
                hours,
                reason: editing.reason,
                earned_on: editing.earned_on,
                expires_on: editing.expires_on || null,
                shift_id: null,
                created_by: currentUser.id,
            });
            if (saved) setEntries(prev => [saved, ...prev]);
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to save entry');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Remove this TOIL entry? The employee balance will update immediately.')) return;
        try {
            await deleteToilEntry(id);
            setEntries(prev => prev.filter(e => e.id !== id));
        } catch (e: any) {
            setError(e?.message || 'Failed to delete');
        }
    };

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Clock className="w-5 h-5 text-teal-600" />
                    <div>
                        <h2 className="font-black uppercase tracking-widest text-[11px] text-slate-500">TOIL ledger</h2>
                        <p className="text-xs text-slate-500">Time-off in lieu. Add positive hours when staff bank overtime, negative hours when they spend banked time.</p>
                    </div>
                </div>
                {employees.length > 0 && (
                    <button onClick={() => setEditing(EMPTY(employees[0].user_id))} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                        <Plus className="w-4 h-4" /> Add entry
                    </button>
                )}
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div className="flex-1">{error}</div>
                    <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
                </div>
            )}

            <div className="grid md:grid-cols-3 gap-4 mb-4">
                {employees.map(emp => {
                    const bal = balances.get(emp.user_id) || 0;
                    const cls = bal > 0 ? 'border-emerald-200 bg-emerald-50' : bal < 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50';
                    return (
                        <button
                            key={emp.user_id}
                            onClick={() => setFilterUser(emp.user_id)}
                            className={`rounded-xl border p-3 text-left ${cls} ${filterUser === emp.user_id ? 'ring-2 ring-teal-500' : ''}`}
                        >
                            <div className="text-sm font-bold text-slate-900">{emp.display_name}</div>
                            <div className="text-2xl font-black tabular-nums mt-1">{bal.toFixed(bal % 1 === 0 ? 0 : 1)}h</div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Banked balance</div>
                        </button>
                    );
                })}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Ledger</h3>
                    <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="px-2 py-1 rounded border border-slate-300 text-xs font-bold">
                        <option value="all">All employees</option>
                        {employees.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name}</option>)}
                    </select>
                </header>
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                ) : filteredEntries.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No TOIL entries yet.</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <th className="text-left p-3">Date</th>
                                <th className="text-left p-3">Employee</th>
                                <th className="text-right p-3">Hours</th>
                                <th className="text-left p-3">Reason</th>
                                <th className="text-left p-3">Expires</th>
                                <th className="p-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEntries.map(e => {
                                const emp = employees.find(x => x.user_id === e.user_id);
                                return (
                                    <tr key={e.id} className="border-b border-slate-100">
                                        <td className="p-3 tabular-nums">{e.earned_on}</td>
                                        <td className="p-3 font-bold text-slate-700">{emp?.display_name || e.user_id}</td>
                                        <td className={`p-3 text-right font-black tabular-nums ${Number(e.hours) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{Number(e.hours) > 0 ? '+' : ''}{Number(e.hours).toFixed(Number(e.hours) % 1 === 0 ? 0 : 1)}h</td>
                                        <td className="p-3 text-slate-700">{e.reason}</td>
                                        <td className="p-3 text-slate-500 tabular-nums">{e.expires_on || '—'}</td>
                                        <td className="p-3 text-right">
                                            <button onClick={() => handleDelete(e.id)} className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {editing && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <header className="px-5 py-4 border-b border-slate-200">
                            <h3 className="font-black text-lg text-slate-900">Add TOIL entry</h3>
                        </header>
                        <div className="px-5 py-4 space-y-3">
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Employee</span>
                                <select value={editing.user_id} onChange={e => setEditing({ ...editing, user_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold">
                                    {employees.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name}</option>)}
                                </select>
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Hours</span>
                                    <input type="number" step="0.25" placeholder="e.g. 2 or -1" value={editing.hours} onChange={e => setEditing({ ...editing, hours: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                                    <p className="text-[10px] text-slate-500 mt-1">Negative = spent.</p>
                                </label>
                                <label className="block">
                                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Date</span>
                                    <input type="date" value={editing.earned_on} onChange={e => setEditing({ ...editing, earned_on: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold" />
                                </label>
                            </div>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Reason</span>
                                <input value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold" placeholder="e.g. Stayed late for delivery" />
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Expires (optional)</span>
                                <input type="date" value={editing.expires_on} onChange={e => setEditing({ ...editing, expires_on: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                                <p className="text-[10px] text-slate-500 mt-1">Leave blank for no expiry.</p>
                            </label>
                        </div>
                        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                            <button onClick={() => setEditing(null)} disabled={busy} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                            <button onClick={handleSave} disabled={busy} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </section>
    );
};

export default RotaToilLedger;
