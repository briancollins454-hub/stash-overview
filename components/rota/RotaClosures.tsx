// ─── RotaClosures ──────────────────────────────────────────────────────────
// Manual editor for bank holidays + one-off company closures. Anything in
// here shades the planner grid + carves days out of the staff calendar.
// Manager keys these by date because Stash is UK-only and the bank-holiday
// list changes infrequently; an automated feed would be overkill.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Loader2, Plus, Save, Trash2, AlertTriangle, CalendarRange,
} from 'lucide-react';
import {
    deleteClosure, fetchClosures, upsertClosure,
} from '../../services/rotaService';
import type { RotaClosure } from '../../utils/rota';

export interface RotaClosuresProps {
    currentUser: { id: string; username: string; displayName: string; role: string };
}

interface EditingClosure {
    closure_date: string;
    label: string;
    paid: boolean;
    notes: string;
    originalDate?: string; // when editing, track the row's pre-edit key
}

const EMPTY = (): EditingClosure => ({
    closure_date: '',
    label: '',
    paid: true,
    notes: '',
});

// UK bank holidays we ship as one-click suggestions. Manager confirms and
// adds them — we don't auto-create rows, because some businesses still
// trade on certain bank holidays and we'd rather under-ship than over-mark.
const SUGGESTED_2026: { date: string; label: string }[] = [
    { date: '2026-01-01', label: 'New Year\u2019s Day' },
    { date: '2026-04-03', label: 'Good Friday' },
    { date: '2026-04-06', label: 'Easter Monday' },
    { date: '2026-05-04', label: 'Early May bank holiday' },
    { date: '2026-05-25', label: 'Spring bank holiday' },
    { date: '2026-08-31', label: 'Summer bank holiday' },
    { date: '2026-12-25', label: 'Christmas Day' },
    { date: '2026-12-28', label: 'Boxing Day (substitute)' },
];

export const RotaClosures: React.FC<RotaClosuresProps> = ({ currentUser }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [closures, setClosures] = useState<RotaClosure[]>([]);
    const [editing, setEditing] = useState<EditingClosure | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setClosures(await fetchClosures());
        } catch (e: any) {
            setError(e?.message || 'Failed to load closures');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const existingDates = useMemo(() => new Set(closures.map(c => c.closure_date)), [closures]);

    const handleSave = async () => {
        if (!editing) return;
        if (!editing.closure_date || !editing.label.trim()) {
            setError('Date and label are required.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            // Date changed → delete old row first, otherwise we end up with
            // two rows. PostgREST upserts on primary key, which is the date.
            if (editing.originalDate && editing.originalDate !== editing.closure_date) {
                await deleteClosure(editing.originalDate);
            }
            const saved = await upsertClosure({
                closure_date: editing.closure_date,
                label: editing.label.trim(),
                paid: !!editing.paid,
                notes: editing.notes || '',
                created_by: currentUser.id,
            });
            if (saved) {
                setClosures(prev => {
                    const without = prev.filter(c => c.closure_date !== saved.closure_date && c.closure_date !== editing.originalDate);
                    return [...without, saved].sort((a, b) => a.closure_date.localeCompare(b.closure_date));
                });
            }
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to save closure');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (date: string) => {
        if (!window.confirm('Delete this closure?')) return;
        await deleteClosure(date);
        setClosures(prev => prev.filter(c => c.closure_date !== date));
    };

    const handleAddSuggested = async (suggestion: { date: string; label: string }) => {
        setSaving(true);
        try {
            const saved = await upsertClosure({
                closure_date: suggestion.date,
                label: suggestion.label,
                paid: true,
                notes: '',
                created_by: currentUser.id,
            });
            if (saved) {
                setClosures(prev => {
                    const without = prev.filter(c => c.closure_date !== saved.closure_date);
                    return [...without, saved].sort((a, b) => a.closure_date.localeCompare(b.closure_date));
                });
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to add closure');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                    <CalendarRange className="w-5 h-5 text-teal-600" />
                    <div>
                        <h2 className="font-black uppercase tracking-widest text-[11px] text-slate-500">Bank holidays &amp; closures</h2>
                        <p className="text-xs text-slate-500">Days you set here are marked as paid leave on the rota and excluded from time-off allowance calculations.</p>
                    </div>
                </div>
                <button
                    onClick={() => setEditing(EMPTY())}
                    className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                >
                    <Plus className="w-4 h-4" />
                    Add closure
                </button>
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>{error}</div>
                </div>
            )}

            <div className="grid md:grid-cols-3 gap-4">
                <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    {loading ? (
                        <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                    ) : closures.length === 0 ? (
                        <div className="p-10 text-center">
                            <p className="text-sm font-bold text-slate-700">No closures yet.</p>
                            <p className="text-xs text-slate-500 mt-2">Add bank holidays from the suggestions on the right.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    <th className="text-left p-3">Date</th>
                                    <th className="text-left p-3">Label</th>
                                    <th className="text-left p-3">Notes</th>
                                    <th className="text-right p-3">Paid?</th>
                                    <th className="p-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {closures.map(c => (
                                    <tr
                                        key={c.closure_date}
                                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                                        onClick={() => setEditing({
                                            closure_date: c.closure_date,
                                            label: c.label,
                                            paid: c.paid,
                                            notes: c.notes,
                                            originalDate: c.closure_date,
                                        })}
                                    >
                                        <td className="p-3 font-bold text-slate-900 tabular-nums">{c.closure_date}</td>
                                        <td className="p-3 text-slate-700">{c.label}</td>
                                        <td className="p-3 text-slate-500 text-xs">{c.notes || '—'}</td>
                                        <td className="p-3 text-right">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${c.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                                                {c.paid ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-right">
                                            <button
                                                onClick={(ev) => { ev.stopPropagation(); handleDelete(c.closure_date); }}
                                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <aside className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                    <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-500 mb-3">UK suggestions · 2026</h3>
                    <ul className="space-y-1.5">
                        {SUGGESTED_2026.map(s => {
                            const exists = existingDates.has(s.date);
                            return (
                                <li key={s.date}>
                                    <button
                                        onClick={() => !exists && handleAddSuggested(s)}
                                        disabled={exists || saving}
                                        className={`w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border text-xs ${exists ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-default' : 'border-slate-200 hover:bg-teal-50 hover:border-teal-300 text-slate-700'}`}
                                    >
                                        <div>
                                            <div className="font-bold">{s.label}</div>
                                            <div className="text-[10px] text-slate-400 tabular-nums">{s.date}</div>
                                        </div>
                                        {exists ? (
                                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Added</span>
                                        ) : (
                                            <Plus className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </aside>
            </div>

            {editing && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <header className="px-5 py-4 border-b border-slate-200">
                            <h3 className="font-black text-lg text-slate-900">{editing.originalDate ? 'Edit closure' : 'Add closure'}</h3>
                        </header>
                        <div className="px-5 py-4 space-y-3">
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Date</span>
                                <input
                                    type="date"
                                    value={editing.closure_date}
                                    onChange={e => setEditing({ ...editing, closure_date: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                />
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Label</span>
                                <input
                                    type="text"
                                    value={editing.label}
                                    onChange={e => setEditing({ ...editing, label: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                />
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Notes</span>
                                <textarea
                                    value={editing.notes}
                                    onChange={e => setEditing({ ...editing, notes: e.target.value })}
                                    rows={2}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                />
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={editing.paid} onChange={e => setEditing({ ...editing, paid: e.target.checked })} />
                                <span>Paid leave (doesn't deduct from holiday allowance)</span>
                            </label>
                        </div>
                        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                            <button onClick={() => setEditing(null)} disabled={saving} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                Save
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </section>
    );
};

export default RotaClosures;
