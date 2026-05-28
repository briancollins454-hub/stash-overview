// ─── RotaBlockedDatesPanel ────────────────────────────────────────────────
// Manager screen for holiday embargoes / reduced-capacity windows.  Used
// by the staff time-off request flow to block or warn submissions.

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Save, ShieldOff, Trash2, X } from 'lucide-react';
import {
    deleteBlockedDate, fetchBlockedDates, saveBlockedDate,
} from '../../services/rotaService';
import type { RotaBlockedDate } from '../../utils/rota';

export interface RotaBlockedDatesPanelProps {
    currentUser: { id: string; displayName: string };
}

interface Editing {
    id?: number;
    start_date: string;
    end_date: string;
    type: 'no_holiday' | 'reduced_capacity';
    reason: string;
    notes: string;
}

const EMPTY = (): Editing => ({
    start_date: '',
    end_date: '',
    type: 'no_holiday',
    reason: '',
    notes: '',
});

export const RotaBlockedDatesPanel: React.FC<RotaBlockedDatesPanelProps> = ({ currentUser }) => {
    const [rows, setRows] = useState<RotaBlockedDate[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setRows(await fetchBlockedDates());
        } catch (e: any) {
            setError(e?.message || 'Failed to load blocked dates');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const handleSave = async () => {
        if (!editing) return;
        if (!editing.start_date || !editing.end_date || !editing.reason.trim()) {
            setError('Start, end, and reason are required.');
            return;
        }
        if (editing.end_date < editing.start_date) {
            setError('End date must be on or after the start date.');
            return;
        }
        setSaving(true);
        try {
            const saved = await saveBlockedDate({
                ...editing,
                created_by: currentUser.id,
            } as any);
            if (saved) {
                setRows(prev => {
                    const without = prev.filter(r => r.id !== saved.id);
                    return [...without, saved].sort((a, b) => a.start_date.localeCompare(b.start_date));
                });
            }
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Remove this blocked-date window?')) return;
        try {
            await deleteBlockedDate(id);
            setRows(prev => prev.filter(r => r.id !== id));
        } catch (e: any) {
            setError(e?.message || 'Failed to delete');
        }
    };

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                    <ShieldOff className="w-5 h-5 text-teal-600" />
                    <div>
                        <h2 className="font-black uppercase tracking-widest text-[11px] text-slate-500">Holiday embargoes</h2>
                        <p className="text-xs text-slate-500">Periods where staff can't (or shouldn't) book holiday. Examples: peak production, year-end stock take, Christmas trading.</p>
                    </div>
                </div>
                <button onClick={() => setEditing(EMPTY())} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                    <Plus className="w-4 h-4" /> Add window
                </button>
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
                ) : rows.length === 0 ? (
                    <div className="p-10 text-center">
                        <p className="text-sm font-bold text-slate-700">No blocked windows.</p>
                        <p className="text-xs text-slate-500 mt-2">Staff can book holiday on any working day.</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <th className="text-left p-3">Dates</th>
                                <th className="text-left p-3">Type</th>
                                <th className="text-left p-3">Reason</th>
                                <th className="text-left p-3">Notes</th>
                                <th className="p-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setEditing({
                                    id: r.id,
                                    start_date: r.start_date,
                                    end_date: r.end_date,
                                    type: r.type,
                                    reason: r.reason,
                                    notes: r.notes,
                                })}>
                                    <td className="p-3 font-bold text-slate-900 tabular-nums">{r.start_date} – {r.end_date}</td>
                                    <td className="p-3">
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${r.type === 'no_holiday' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {r.type === 'no_holiday' ? 'Block' : 'Warn'}
                                        </span>
                                    </td>
                                    <td className="p-3 text-slate-700">{r.reason}</td>
                                    <td className="p-3 text-slate-500 text-xs">{r.notes || '—'}</td>
                                    <td className="p-3 text-right">
                                        <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }} className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {editing && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <header className="px-5 py-4 border-b border-slate-200">
                            <h3 className="font-black text-lg text-slate-900">{editing.id ? 'Edit window' : 'Add blocked-date window'}</h3>
                        </header>
                        <div className="px-5 py-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">From</span>
                                    <input type="date" value={editing.start_date} onChange={e => setEditing({ ...editing, start_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                                </label>
                                <label className="block">
                                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">To</span>
                                    <input type="date" value={editing.end_date} min={editing.start_date} onChange={e => setEditing({ ...editing, end_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                                </label>
                            </div>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Severity</span>
                                <select value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value as any })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none">
                                    <option value="no_holiday">Block — staff cannot submit holiday</option>
                                    <option value="reduced_capacity">Warn — staff see a banner, can still submit</option>
                                </select>
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Reason</span>
                                <input value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} placeholder="e.g. Year-end stock take" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Notes (manager-only)</span>
                                <textarea rows={2} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                            </label>
                        </div>
                        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                            <button onClick={() => setEditing(null)} disabled={saving} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </section>
    );
};

export default RotaBlockedDatesPanel;
