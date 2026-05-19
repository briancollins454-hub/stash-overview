// ─── RotaPlanner ───────────────────────────────────────────────────────────
// Manager-facing weekly grid. Rows are employees, columns are the 7 days of
// the current week. Click a cell to add/edit a shift; saved shifts render
// inline. Time-off requests + manual closures are layered on top of cells
// for context (manager sees who's off without flipping screens).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ChevronLeft, ChevronRight, CalendarDays, Plus, Trash2, X, Copy, Loader2,
    Save, Clock, AlertTriangle,
} from 'lucide-react';
import {
    addDays, isoDate, makeWeekRange, shortDateLabel,
    timeToMinutes, shiftLengthHours, weeklyHoursFor, shiftsForDay,
    closuresForDay, timeOffForDay, combineDateTime, isoToTime, isoToDate,
    DEFAULT_SHIFT_PRESETS, RotaShift, RotaEmployee, RotaTimeOff, RotaClosure,
} from '../../utils/rota';
import {
    fetchEmployees, fetchShiftsInRange, saveShift, deleteShift,
    fetchTimeOff, fetchClosures, bulkInsertShifts,
} from '../../services/rotaService';

export interface RotaPlannerProps {
    currentUser: { id: string; username: string; displayName: string; role: string };
}

interface EditingShift {
    id?: number;
    user_id: string;
    date: string;             // YYYY-MM-DD
    start: string;            // HH:MM
    end: string;              // HH:MM
    role: string;
    location: string;
    notes: string;
    template_key: string | null;
}

const emptyShift = (userId: string, date: string): EditingShift => ({
    user_id: userId,
    date,
    start: '09:00',
    end: '17:00',
    role: '',
    location: '',
    notes: '',
    template_key: null,
});

const dayKey = (userId: string, day: Date) => `${userId}|${isoDate(day)}`;

export const RotaPlanner: React.FC<RotaPlannerProps> = ({ currentUser }) => {
    const [anchor, setAnchor] = useState(new Date());
    const week = useMemo(() => makeWeekRange(anchor), [anchor]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [shifts, setShifts] = useState<RotaShift[]>([]);
    const [timeOff, setTimeOff] = useState<RotaTimeOff[]>([]);
    const [closures, setClosures] = useState<RotaClosure[]>([]);
    const [editing, setEditing] = useState<EditingShift | null>(null);
    const [saving, setSaving] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [emps, sh, off, cl] = await Promise.all([
                fetchEmployees(),
                fetchShiftsInRange(week.isoStart, week.isoEnd),
                fetchTimeOff(),
                fetchClosures(),
            ]);
            setEmployees(emps.filter(e => e.is_active));
            setShifts(sh);
            setTimeOff(off);
            setClosures(cl);
        } catch (e: any) {
            setError(e?.message || 'Failed to load rota data');
        } finally {
            setLoading(false);
        }
    }, [week.isoStart, week.isoEnd]);

    useEffect(() => { reload(); }, [reload]);

    const shiftsByCell = useMemo(() => {
        const map = new Map<string, RotaShift[]>();
        for (const s of shifts) {
            const key = `${s.user_id}|${isoToDate(s.start_at)}`;
            const list = map.get(key) || [];
            list.push(s);
            map.set(key, list);
        }
        return map;
    }, [shifts]);

    const handleCellClick = (userId: string, day: Date, existingShift?: RotaShift) => {
        if (existingShift) {
            setEditing({
                id: existingShift.id,
                user_id: existingShift.user_id,
                date: isoToDate(existingShift.start_at),
                start: isoToTime(existingShift.start_at),
                end: isoToTime(existingShift.end_at),
                role: existingShift.role || '',
                location: existingShift.location || '',
                notes: existingShift.notes || '',
                template_key: existingShift.template_key,
            });
        } else {
            setEditing(emptyShift(userId, isoDate(day)));
        }
    };

    const handleSave = async () => {
        if (!editing) return;
        const sm = timeToMinutes(editing.start);
        const em = timeToMinutes(editing.end);
        if (!Number.isFinite(sm) || !Number.isFinite(em) || em <= sm) {
            setError('Shift end must be after start (no overnight shifts in v1).');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const saved = await saveShift({
                id: editing.id,
                user_id: editing.user_id,
                start_at: combineDateTime(editing.date, editing.start),
                end_at: combineDateTime(editing.date, editing.end),
                role: editing.role,
                location: editing.location,
                notes: editing.notes,
                published: true,
                template_key: editing.template_key,
                created_by: currentUser.id,
            });
            if (saved) {
                setShifts(prev => {
                    const without = prev.filter(s => s.id !== saved.id);
                    return [...without, saved].sort((a, b) => a.start_at.localeCompare(b.start_at));
                });
            }
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to save shift');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!editing?.id) { setEditing(null); return; }
        setSaving(true);
        try {
            await deleteShift(editing.id);
            setShifts(prev => prev.filter(s => s.id !== editing.id));
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to delete shift');
        } finally {
            setSaving(false);
        }
    };

    const handleCopyPrevWeek = async () => {
        const prevStart = addDays(week.start, -7);
        const prevEnd = addDays(prevStart, 7);
        setSaving(true);
        setError(null);
        try {
            const previous = await fetchShiftsInRange(prevStart.toISOString(), prevEnd.toISOString());
            if (previous.length === 0) {
                setError('No shifts in the previous week to copy.');
                return;
            }
            // Build the same-shape shifts shifted +7 days. Skip days that
            // already have a shift on this week's grid so re-clicks don't
            // create duplicates.
            const existingKeys = new Set(shifts.map(s => `${s.user_id}|${isoToDate(s.start_at)}|${isoToTime(s.start_at)}|${isoToTime(s.end_at)}`));
            const inserts = previous
                .map(s => {
                    const startDate = new Date(s.start_at);
                    const endDate = new Date(s.end_at);
                    startDate.setDate(startDate.getDate() + 7);
                    endDate.setDate(endDate.getDate() + 7);
                    return {
                        user_id: s.user_id,
                        start_at: startDate.toISOString(),
                        end_at: endDate.toISOString(),
                        role: s.role,
                        location: s.location,
                        notes: s.notes,
                        published: s.published,
                        template_key: s.template_key,
                        created_by: currentUser.id,
                    };
                })
                .filter(s => !existingKeys.has(`${s.user_id}|${isoToDate(s.start_at)}|${isoToTime(s.start_at)}|${isoToTime(s.end_at)}`));
            if (inserts.length === 0) {
                setError('Previous-week shifts already exist this week.');
                return;
            }
            const created = await bulkInsertShifts(inserts);
            setShifts(prev => [...prev, ...created]);
        } catch (e: any) {
            setError(e?.message || 'Failed to copy previous week');
        } finally {
            setSaving(false);
        }
    };

    const handlePresetClick = (presetKey: string) => {
        if (!editing) return;
        const preset = DEFAULT_SHIFT_PRESETS.find(p => p.key === presetKey);
        if (!preset) return;
        setEditing({ ...editing, start: preset.start, end: preset.end, template_key: preset.key });
    };

    return (
        <section>
            {/* Week navigation */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAnchor(prev => addDays(prev, -7))}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
                        aria-label="Previous week"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="px-3 py-2 rounded-lg bg-slate-100 flex items-center gap-2 text-sm font-bold text-slate-700">
                        <CalendarDays className="w-4 h-4 text-teal-600" />
                        {shortDateLabel(week.days[0])} — {shortDateLabel(week.days[6])}
                    </div>
                    <button
                        onClick={() => setAnchor(prev => addDays(prev, 7))}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
                        aria-label="Next week"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setAnchor(new Date())}
                        className="ml-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-teal-700 hover:bg-teal-50"
                    >
                        Today
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCopyPrevWeek}
                        disabled={saving}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        Copy last week
                    </button>
                    <button
                        onClick={reload}
                        className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>{error}</div>
                </div>
            )}

            {/* Grid */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                ) : employees.length === 0 ? (
                    <EmptyEmployeesNotice />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="text-left p-3 font-black uppercase text-[10px] tracking-widest text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[180px]">
                                        Employee
                                    </th>
                                    {week.days.map(day => {
                                        const closure = closuresForDay(closures, day)[0];
                                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                                        return (
                                            <th key={day.toISOString()} className={`p-3 text-left font-black uppercase text-[10px] tracking-widest min-w-[150px] ${isWeekend ? 'bg-slate-100/70' : ''} ${closure ? 'bg-rose-50' : ''}`}>
                                                <div className="text-slate-700">{shortDateLabel(day)}</div>
                                                {closure && <div className="text-[9px] text-rose-700 normal-case font-bold tracking-normal mt-0.5">{closure.label}</div>}
                                            </th>
                                        );
                                    })}
                                    <th className="p-3 text-right font-black uppercase text-[10px] tracking-widest text-slate-500 min-w-[80px]">Hours</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(emp => {
                                    const weeklyHours = weeklyHoursFor(shifts, emp.user_id, week);
                                    return (
                                        <tr key={emp.user_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                                            <td className="p-3 sticky left-0 bg-white z-10 border-r border-slate-100">
                                                <div className="font-bold text-slate-900 text-sm">{emp.display_name}</div>
                                                {emp.job_title && <div className="text-xs text-slate-500">{emp.job_title}</div>}
                                            </td>
                                            {week.days.map(day => {
                                                const cellShifts = shiftsByCell.get(dayKey(emp.user_id, day)) || [];
                                                const offsForDay = timeOffForDay(timeOff, emp.user_id, day);
                                                const closure = closuresForDay(closures, day)[0];
                                                return (
                                                    <td
                                                        key={day.toISOString()}
                                                        onClick={() => handleCellClick(emp.user_id, day, cellShifts[0])}
                                                        className={`p-1.5 align-top cursor-pointer hover:bg-teal-50/60 border-r border-slate-100 ${closure ? 'bg-rose-50/40' : ''}`}
                                                    >
                                                        {offsForDay.length > 0 && (
                                                            <div className="mb-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest border bg-amber-50 text-amber-800 border-amber-200">
                                                                {offsForDay[0].type}{offsForDay[0].status === 'pending' ? ' · pending' : ''}
                                                            </div>
                                                        )}
                                                        {cellShifts.length === 0 ? (
                                                            <div className="text-[11px] text-slate-300 font-bold uppercase tracking-widest opacity-0 hover:opacity-100">+ Add</div>
                                                        ) : (
                                                            cellShifts.map(s => (
                                                                <div
                                                                    key={s.id}
                                                                    className={`mb-1 px-2 py-1.5 rounded-lg border text-[11px] font-bold ${DEFAULT_SHIFT_PRESETS.find(p => p.key === s.template_key)?.color || 'bg-teal-100 text-teal-800 border-teal-300'}`}
                                                                    onClick={(e) => { e.stopPropagation(); handleCellClick(emp.user_id, day, s); }}
                                                                >
                                                                    <div className="flex items-center gap-1">
                                                                        <Clock className="w-3 h-3" />
                                                                        {isoToTime(s.start_at)}–{isoToTime(s.end_at)}
                                                                    </div>
                                                                    {s.role && <div className="text-[10px] opacity-80 truncate">{s.role}</div>}
                                                                </div>
                                                            ))
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-3 text-right font-black text-slate-700 tabular-nums">
                                                {weeklyHours.toFixed(weeklyHours % 1 === 0 ? 0 : 2)}h
                                                <div className="text-[10px] font-normal text-slate-400">/ {Number(emp.weekly_hours || 0)}h</div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing && (
                <ShiftEditorModal
                    employees={employees}
                    editing={editing}
                    onChange={setEditing}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onClose={() => setEditing(null)}
                    onPreset={handlePresetClick}
                    saving={saving}
                />
            )}
        </section>
    );
};

const EmptyEmployeesNotice: React.FC = () => (
    <div className="p-10 text-center">
        <p className="text-sm font-bold text-slate-700">No employees yet.</p>
        <p className="text-xs text-slate-500 mt-2">
            Add team members in the <strong>Employees</strong> tab — or pull your existing staff
            from a RotaCloud CSV via <strong>Import</strong>.
        </p>
    </div>
);

interface ShiftEditorModalProps {
    employees: RotaEmployee[];
    editing: EditingShift;
    onChange: (next: EditingShift) => void;
    onSave: () => void;
    onDelete: () => void;
    onClose: () => void;
    onPreset: (key: string) => void;
    saving: boolean;
}

const ShiftEditorModal: React.FC<ShiftEditorModalProps> = ({
    employees, editing, onChange, onSave, onDelete, onClose, onPreset, saving,
}) => {
    const emp = employees.find(e => e.user_id === editing.user_id);
    const hours = shiftLengthHours(
        combineDateTime(editing.date, editing.start),
        combineDateTime(editing.date, editing.end),
    );
    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <div>
                        <h3 className="font-black text-lg text-slate-900">
                            {editing.id ? 'Edit shift' : 'New shift'}
                        </h3>
                        <p className="text-xs text-slate-500">
                            {emp?.display_name || 'Employee'} · {editing.date}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </header>

                <div className="px-5 py-4 space-y-4">
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Presets</label>
                        <div className="flex flex-wrap gap-1.5">
                            {DEFAULT_SHIFT_PRESETS.map(p => (
                                <button
                                    key={p.key}
                                    onClick={() => onPreset(p.key)}
                                    className={`px-3 py-1.5 rounded-full border text-[11px] font-bold ${editing.template_key === p.key ? p.color : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Start</label>
                            <input
                                type="time"
                                value={editing.start}
                                onChange={e => onChange({ ...editing, start: e.target.value, template_key: null })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">End</label>
                            <input
                                type="time"
                                value={editing.end}
                                onChange={e => onChange({ ...editing, end: e.target.value, template_key: null })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Role</label>
                            <input
                                type="text"
                                placeholder="Optional"
                                value={editing.role}
                                onChange={e => onChange({ ...editing, role: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Location</label>
                            <input
                                type="text"
                                placeholder="Optional"
                                value={editing.location}
                                onChange={e => onChange({ ...editing, location: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Notes (private to manager)</label>
                        <textarea
                            value={editing.notes}
                            onChange={e => onChange({ ...editing, notes: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Shift length</span>
                        <span className="font-bold text-slate-700 tabular-nums">{hours.toFixed(hours % 1 === 0 ? 0 : 2)}h</span>
                    </div>
                </div>

                <footer className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50">
                    {editing.id ? (
                        <button
                            onClick={onDelete}
                            disabled={saving}
                            className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                        </button>
                    ) : <span />}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            disabled={saving}
                            className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editing.id ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                            {editing.id ? 'Save' : 'Add shift'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default RotaPlanner;
