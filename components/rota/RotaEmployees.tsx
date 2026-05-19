// ─── RotaEmployees ─────────────────────────────────────────────────────────
// Manager editor for the HR profile attached to each staff member. Reads
// stash_users for the username pool (existing Stash accounts), reads
// stash_rota_employees for the rota-specific fields. New entries upsert
// against user_id.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Search, UserMinus, X, AlertTriangle } from 'lucide-react';
import {
    fetchEmployees, upsertEmployee, deactivateEmployee,
} from '../../services/rotaService';
import type { RotaEmployee } from '../../utils/rota';

export interface RotaEmployeesProps {
    currentUser: { id: string; username: string; displayName: string; role: string };
}

interface StashUser {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    displayName: string;
}

interface EditingEmployee extends Partial<RotaEmployee> {
    user_id: string;
    display_name: string;
}

const EMPTY: EditingEmployee = {
    user_id: '',
    display_name: '',
    job_title: '',
    team: '',
    location: '',
    start_date: null,
    weekly_hours: 40,
    holiday_allowance_days: 28,
    carried_over_days: 0,
    manager_user_id: null,
    is_active: true,
    email: '',
    notes: '',
};

export const RotaEmployees: React.FC<RotaEmployeesProps> = ({ currentUser }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [stashUsers, setStashUsers] = useState<StashUser[]>([]);
    const [editing, setEditing] = useState<EditingEmployee | null>(null);
    const [search, setSearch] = useState('');

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [emps, usersResp] = await Promise.all([
                fetchEmployees(),
                fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'list_basic' }),
                }).then(r => r.json()).catch(() => []),
            ]);
            setEmployees(emps);
            setStashUsers(Array.isArray(usersResp) ? usersResp : []);
        } catch (e: any) {
            setError(e?.message || 'Failed to load employees');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(e =>
            e.display_name.toLowerCase().includes(q) ||
            e.job_title.toLowerCase().includes(q) ||
            (e.email || '').toLowerCase().includes(q) ||
            e.team.toLowerCase().includes(q),
        );
    }, [employees, search]);

    const handleSave = async () => {
        if (!editing) return;
        if (!editing.user_id || !editing.display_name) {
            setError('Username and display name are required.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const saved = await upsertEmployee({
                user_id: editing.user_id,
                display_name: editing.display_name,
                job_title: editing.job_title || '',
                team: editing.team || '',
                location: editing.location || '',
                start_date: editing.start_date || null,
                weekly_hours: Number(editing.weekly_hours || 0),
                holiday_allowance_days: Number(editing.holiday_allowance_days || 0),
                carried_over_days: Number(editing.carried_over_days || 0),
                manager_user_id: editing.manager_user_id || null,
                is_active: editing.is_active ?? true,
                email: editing.email || null,
                notes: editing.notes || '',
                rotacloud_id: editing.rotacloud_id || null,
            });
            if (saved) {
                setEmployees(prev => {
                    const without = prev.filter(e => e.user_id !== saved.user_id);
                    return [...without, saved].sort((a, b) => a.display_name.localeCompare(b.display_name));
                });
            }
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to save employee');
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (userId: string) => {
        if (!window.confirm('Deactivate this employee? Their existing shifts stay on the rota; they just stop appearing in pickers.')) return;
        await deactivateEmployee(userId);
        setEmployees(prev => prev.map(e => e.user_id === userId ? { ...e, is_active: false } : e));
    };

    const handleAddNew = () => {
        setEditing({ ...EMPTY });
    };

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                        type="search"
                        placeholder="Search by name, team, email"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                    />
                </div>
                <button
                    onClick={handleAddNew}
                    className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                >
                    <Plus className="w-4 h-4" />
                    Add employee
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
                        <p className="text-sm font-bold text-slate-700">No employees yet.</p>
                        <p className="text-xs text-slate-500 mt-2">Add team members or import from RotaCloud.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    <th className="text-left p-3">Name</th>
                                    <th className="text-left p-3">Job title</th>
                                    <th className="text-left p-3">Team</th>
                                    <th className="text-right p-3">Weekly hrs</th>
                                    <th className="text-right p-3">Holiday allowance</th>
                                    <th className="text-left p-3">Email</th>
                                    <th className="text-right p-3">Status</th>
                                    <th className="p-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(e => (
                                    <tr
                                        key={e.user_id}
                                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                                        onClick={() => setEditing({ ...e })}
                                    >
                                        <td className="p-3 font-bold text-slate-900">{e.display_name}</td>
                                        <td className="p-3 text-slate-700">{e.job_title || '—'}</td>
                                        <td className="p-3 text-slate-700">{e.team || '—'}</td>
                                        <td className="p-3 text-right tabular-nums font-bold text-slate-700">{Number(e.weekly_hours || 0)}h</td>
                                        <td className="p-3 text-right tabular-nums font-bold text-slate-700">{Number(e.holiday_allowance_days || 0)}d</td>
                                        <td className="p-3 text-slate-600">{e.email || '—'}</td>
                                        <td className="p-3 text-right">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${e.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                                                {e.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-right">
                                            {e.is_active && (
                                                <button
                                                    onClick={(ev) => { ev.stopPropagation(); handleDeactivate(e.user_id); }}
                                                    className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                                    title="Deactivate"
                                                >
                                                    <UserMinus className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing && (
                <EmployeeEditor
                    editing={editing}
                    onChange={setEditing}
                    onClose={() => setEditing(null)}
                    onSave={handleSave}
                    saving={saving}
                    stashUsers={stashUsers}
                    existingIds={new Set(employees.map(e => e.user_id))}
                />
            )}
        </section>
    );
};

interface EmployeeEditorProps {
    editing: EditingEmployee;
    onChange: (next: EditingEmployee) => void;
    onClose: () => void;
    onSave: () => void;
    saving: boolean;
    stashUsers: StashUser[];
    existingIds: Set<string>;
}

const EmployeeEditor: React.FC<EmployeeEditorProps> = ({
    editing, onChange, onClose, onSave, saving, stashUsers, existingIds,
}) => {
    const isNew = !existingIds.has(editing.user_id);
    const availableUsers = useMemo(() => {
        if (!isNew) return stashUsers;
        return stashUsers.filter(u => !existingIds.has(u.username));
    }, [stashUsers, existingIds, isNew]);

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <h3 className="font-black text-lg text-slate-900">
                        {isNew ? 'Add employee' : `Edit ${editing.display_name}`}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </header>

                <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
                    {isNew ? (
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Link to Stash account</label>
                            <select
                                value={editing.user_id}
                                onChange={e => {
                                    const selected = availableUsers.find(u => u.username === e.target.value);
                                    onChange({
                                        ...editing,
                                        user_id: e.target.value,
                                        display_name: selected?.displayName || editing.display_name,
                                    });
                                }}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            >
                                <option value="">— Select user —</option>
                                {availableUsers.map(u => (
                                    <option key={u.username} value={u.username}>
                                        {u.displayName} (@{u.username})
                                    </option>
                                ))}
                                <option value="__custom__">Custom (no Stash account yet)</option>
                            </select>
                            {editing.user_id === '__custom__' && (
                                <input
                                    type="text"
                                    placeholder="username (no spaces)"
                                    value=""
                                    onChange={e => onChange({ ...editing, user_id: e.target.value })}
                                    className="w-full mt-2 px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                />
                            )}
                        </div>
                    ) : (
                        <div className="text-xs text-slate-500">
                            Linked to <span className="font-bold text-slate-700">@{editing.user_id}</span>
                        </div>
                    )}

                    <Field label="Display name">
                        <input
                            type="text"
                            value={editing.display_name}
                            onChange={e => onChange({ ...editing, display_name: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Job title">
                            <input
                                type="text"
                                value={editing.job_title || ''}
                                onChange={e => onChange({ ...editing, job_title: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                        <Field label="Team">
                            <input
                                type="text"
                                value={editing.team || ''}
                                onChange={e => onChange({ ...editing, team: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Email (for notifications)">
                            <input
                                type="email"
                                value={editing.email || ''}
                                onChange={e => onChange({ ...editing, email: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                        <Field label="Start date">
                            <input
                                type="date"
                                value={editing.start_date || ''}
                                onChange={e => onChange({ ...editing, start_date: e.target.value || null })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Weekly hrs">
                            <input
                                type="number"
                                step="0.5"
                                value={editing.weekly_hours ?? 0}
                                onChange={e => onChange({ ...editing, weekly_hours: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                        <Field label="Holiday days">
                            <input
                                type="number"
                                step="0.5"
                                value={editing.holiday_allowance_days ?? 0}
                                onChange={e => onChange({ ...editing, holiday_allowance_days: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                        <Field label="Carried over">
                            <input
                                type="number"
                                step="0.5"
                                value={editing.carried_over_days ?? 0}
                                onChange={e => onChange({ ...editing, carried_over_days: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </Field>
                    </div>

                    <Field label="Notes (manager only)">
                        <textarea
                            value={editing.notes || ''}
                            onChange={e => onChange({ ...editing, notes: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </Field>
                </div>

                <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSave}
                        disabled={saving || !editing.user_id}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                    </button>
                </footer>
            </div>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{label}</label>
        {children}
    </div>
);

export default RotaEmployees;
