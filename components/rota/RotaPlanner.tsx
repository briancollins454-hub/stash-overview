// ─── RotaPlanner ───────────────────────────────────────────────────────────
// Manager-facing planner. Three views (day / week / month), filters, drag &
// drop, draft / publish workflow, conflict detection, open shifts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronLeft, ChevronRight, CalendarDays, Plus, Trash2, X, Copy, Loader2,
    Save, Clock, AlertTriangle, Send, Printer, FileDown, Filter, CalendarRange,
    LayoutGrid, Calendar as CalendarIcon, EyeOff, Eye, Sparkles, UserMinus,
} from 'lucide-react';
import {
    addDays, isoDate, shortDateLabel,
    timeToMinutes, shiftLengthHours, weeklyHoursFor,
    closuresForDay, timeOffForDay, isoToTime, isoToDate,
    DEFAULT_SHIFT_PRESETS, buildShiftRange, detectShiftConflicts, diffShiftPayloads,
    isShiftAcknowledged, ackedByUser, rangeForView,
    type RotaShift, type RotaEmployee, type RotaTimeOff, type RotaClosure,
    type RotaBlockedDate, type RotaShiftAck, type ShiftConflict, type PlannerView,
} from '../../utils/rota';
import {
    appendAudit,
    bulkInsertShifts, deleteShift, dispatchRotaEmail, fetchAcksForShifts,
    fetchBlockedDates, fetchClosures, fetchEmployees, fetchShiftsInRange,
    fetchTimeOff, publishShiftsInRange, releaseToOpen, saveShift,
} from '../../services/rotaService';
import { downloadRotaCsv, openRotaPrint } from '../../utils/rotaPrint';

export interface RotaPlannerProps {
    currentUser: { id: string; username: string; displayName: string; role: string };
}

interface EditingShift {
    id?: number;
    user_id: string | null;
    date: string;
    start: string;
    end: string;
    role: string;
    location: string;
    notes: string;
    template_key: string | null;
    published: boolean;
    requires_count?: number;
}

const emptyShift = (userId: string | null, date: string, employee?: RotaEmployee): EditingShift => ({
    user_id: userId,
    date,
    start: '09:00',
    end: '17:00',
    role: employee?.default_role || '',
    location: employee?.location || '',
    notes: '',
    template_key: null,
    published: false,
});

const dayKey = (userId: string | null, day: Date) => `${userId ?? '__open__'}|${isoDate(day)}`;

export const RotaPlanner: React.FC<RotaPlannerProps> = ({ currentUser }) => {
    const [view, setView] = useState<PlannerView>('week');
    const [anchor, setAnchor] = useState(new Date());
    const [showDrafts, setShowDrafts] = useState(true);

    const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [employees, setEmployees] = useState<RotaEmployee[]>([]);
    const [shifts, setShifts] = useState<RotaShift[]>([]);
    const [timeOff, setTimeOff] = useState<RotaTimeOff[]>([]);
    const [closures, setClosures] = useState<RotaClosure[]>([]);
    const [blockedDates, setBlockedDates] = useState<RotaBlockedDate[]>([]);
    const [acks, setAcks] = useState<RotaShiftAck[]>([]);
    const [editing, setEditing] = useState<EditingShift | null>(null);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);

    const [teamFilter, setTeamFilter] = useState('all');
    const [locationFilter, setLocationFilter] = useState('all');
    const [employeeSearch, setEmployeeSearch] = useState('');

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [emps, sh, off, cl, bd] = await Promise.all([
                fetchEmployees(),
                fetchShiftsInRange(range.isoStart, range.isoEnd),
                fetchTimeOff(),
                fetchClosures(),
                fetchBlockedDates(),
            ]);
            setEmployees(emps.filter(e => e.is_active));
            setShifts(sh);
            setTimeOff(off);
            setClosures(cl);
            setBlockedDates(bd);
            const ids = sh.map(s => s.id);
            if (ids.length) {
                const a = await fetchAcksForShifts(ids);
                setAcks(a);
            } else {
                setAcks([]);
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to load rota data');
        } finally {
            setLoading(false);
        }
    }, [range.isoStart, range.isoEnd]);

    useEffect(() => { reload(); }, [reload]);

    const filteredEmployees = useMemo(() => {
        const q = employeeSearch.trim().toLowerCase();
        return employees.filter(emp => {
            if (teamFilter !== 'all' && (emp.team || '') !== teamFilter) return false;
            if (locationFilter !== 'all' && (emp.location || '') !== locationFilter) return false;
            if (q && !`${emp.display_name} ${emp.job_title} ${emp.team}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [employees, teamFilter, locationFilter, employeeSearch]);

    const visibleShifts = useMemo(
        () => shifts.filter(s => showDrafts || s.published),
        [shifts, showDrafts],
    );

    const shiftsByCell = useMemo(() => {
        const map = new Map<string, RotaShift[]>();
        for (const s of visibleShifts) {
            const key = `${s.user_id ?? '__open__'}|${isoToDate(s.start_at)}`;
            const list = map.get(key) || [];
            list.push(s);
            map.set(key, list);
        }
        return map;
    }, [visibleShifts]);

    const openShifts = useMemo(() => visibleShifts.filter(s => !s.user_id), [visibleShifts]);
    const draftCount = useMemo(() => shifts.filter(s => !s.published).length, [shifts]);
    const teamOptions = useMemo(() => {
        const set = new Set<string>();
        for (const e of employees) if (e.team) set.add(e.team);
        return Array.from(set).sort();
    }, [employees]);
    const locationOptions = useMemo(() => {
        const set = new Set<string>();
        for (const e of employees) if (e.location) set.add(e.location);
        return Array.from(set).sort();
    }, [employees]);

    const handleCellClick = (userId: string | null, day: Date, existingShift?: RotaShift) => {
        const emp = userId ? employees.find(e => e.user_id === userId) : undefined;
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
                published: existingShift.published,
                requires_count: existingShift.requires_count || 1,
            });
        } else {
            setEditing(emptyShift(userId, isoDate(day), emp));
        }
    };

    const editingConflicts: ShiftConflict[] = useMemo(() => {
        if (!editing) return [];
        const { start, end } = buildShiftRange(editing.date, editing.start, editing.end);
        const emp = editing.user_id ? employees.find(e => e.user_id === editing.user_id) : undefined;
        return detectShiftConflicts({
            userId: editing.user_id,
            startIso: start,
            endIso: end,
            excludeShiftId: editing.id,
            weeklyHoursLimit: Number(emp?.weekly_hours || 0),
            existingShifts: shifts,
            timeOff,
            closures,
            blockedDates,
        });
    }, [editing, employees, shifts, timeOff, closures, blockedDates]);

    const hardConflict = editingConflicts.some(c => c.severity === 'error');

    const handleSave = async () => {
        if (!editing) return;
        if (hardConflict) {
            setError('Resolve the errors below before saving.');
            return;
        }
        const sm = timeToMinutes(editing.start);
        const em = timeToMinutes(editing.end);
        if (!Number.isFinite(sm) || !Number.isFinite(em)) {
            setError('Invalid start / end time.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const before = editing.id ? shifts.find(s => s.id === editing.id) : null;
            const { start, end } = buildShiftRange(editing.date, editing.start, editing.end);
            const saved = await saveShift({
                id: editing.id,
                user_id: editing.user_id,
                start_at: start,
                end_at: end,
                role: editing.role,
                location: editing.location,
                notes: editing.notes,
                published: editing.published,
                template_key: editing.template_key,
                created_by: currentUser.id,
                published_at: editing.published ? (before?.published_at || new Date().toISOString()) : null,
                published_by: editing.published ? (before?.published_by || currentUser.id) : null,
                claimed_by: before?.claimed_by ?? null,
                claimed_at: before?.claimed_at ?? null,
                shift_color: before?.shift_color ?? null,
                requires_count: editing.requires_count || 1,
            });
            if (saved) {
                setShifts(prev => {
                    const without = prev.filter(s => s.id !== saved.id);
                    return [...without, saved].sort((a, b) => a.start_at.localeCompare(b.start_at));
                });
                void appendAudit({
                    entity: editing.user_id ? 'shift' : 'open_shift',
                    entity_id: String(saved.id),
                    action: editing.id ? 'update' : 'create',
                    diff: diffShiftPayloads(before, saved),
                    actor_id: currentUser.id,
                    actor_name: currentUser.displayName,
                    note: '',
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
            const before = shifts.find(s => s.id === editing.id) || null;
            await deleteShift(editing.id);
            setShifts(prev => prev.filter(s => s.id !== editing.id));
            void appendAudit({
                entity: 'shift',
                entity_id: String(editing.id),
                action: 'delete',
                diff: diffShiftPayloads(before, null),
                actor_id: currentUser.id,
                actor_name: currentUser.displayName,
                note: '',
            });
            setEditing(null);
        } catch (e: any) {
            setError(e?.message || 'Failed to delete shift');
        } finally {
            setSaving(false);
        }
    };

    const handleCopyPrevWeek = async () => {
        const prevStart = addDays(range.start, -7);
        const prevEnd = addDays(prevStart, 7);
        setSaving(true);
        setError(null);
        try {
            const previous = await fetchShiftsInRange(prevStart.toISOString(), prevEnd.toISOString());
            if (previous.length === 0) {
                setError('No shifts in the previous week to copy.');
                return;
            }
            const existingKeys = new Set(shifts.map(s => `${s.user_id ?? '__open__'}|${isoToDate(s.start_at)}|${isoToTime(s.start_at)}|${isoToTime(s.end_at)}`));
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
                        published: false,
                        template_key: s.template_key,
                        created_by: currentUser.id,
                        published_at: null,
                        published_by: null,
                        claimed_by: null,
                        claimed_at: null,
                        shift_color: s.shift_color,
                        requires_count: s.requires_count,
                    };
                })
                .filter(s => !existingKeys.has(`${s.user_id ?? '__open__'}|${isoToDate(s.start_at)}|${isoToTime(s.start_at)}|${isoToTime(s.end_at)}`));
            if (inserts.length === 0) {
                setError('Previous-week shifts already exist this period.');
                return;
            }
            const created = await bulkInsertShifts(inserts);
            setShifts(prev => [...prev, ...created]);
            setInfo(`${created.length} shifts copied as drafts — publish when ready.`);
        } catch (e: any) {
            setError(e?.message || 'Failed to copy previous week');
        } finally {
            setSaving(false);
        }
    };

    const handlePublish = async () => {
        if (draftCount === 0) {
            setInfo('Nothing to publish — every shift in this window is already live.');
            return;
        }
        if (!window.confirm(`Publish ${draftCount} draft shift${draftCount === 1 ? '' : 's'} for ${shortDateLabel(range.days[0])} – ${shortDateLabel(range.days[range.days.length - 1])}? Staff will be emailed and the rota will appear in their app.`)) return;
        setPublishing(true);
        setError(null);
        try {
            const updated = await publishShiftsInRange(range.isoStart, range.isoEnd, currentUser.id);
            if (updated.length > 0) {
                setShifts(prev => prev.map(s => updated.find(u => u.id === s.id) || s));
                const recipients = employees
                    .filter(e => e.notify_email !== false)
                    .filter(e => updated.some(u => u.user_id === e.user_id))
                    .map(e => ({ display_name: e.display_name, email: e.email, user_id: e.user_id }));
                dispatchRotaEmail({
                    kind: 'shifts_published',
                    employees: recipients as any,
                    publishWindow: { start: range.isoStart, end: range.isoEnd },
                    publishedShifts: updated,
                });
                for (const s of updated) {
                    void appendAudit({
                        entity: 'shift',
                        entity_id: String(s.id),
                        action: 'publish',
                        diff: { published: { from: false, to: true } },
                        actor_id: currentUser.id,
                        actor_name: currentUser.displayName,
                        note: '',
                    });
                }
                setInfo(`${updated.length} shifts published. ${recipients.length} staff notified by email.`);
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to publish');
        } finally {
            setPublishing(false);
        }
    };

    const handleReleaseToOpen = async () => {
        if (!editing?.id || !editing.user_id) return;
        if (!window.confirm('Release this shift back to the Open shifts pool so anyone can claim it?')) return;
        setSaving(true);
        try {
            const before = shifts.find(s => s.id === editing.id) || null;
            const next = await releaseToOpen(editing.id);
            if (next) {
                setShifts(prev => prev.map(s => s.id === next.id ? next : s));
                void appendAudit({
                    entity: 'shift',
                    entity_id: String(editing.id),
                    action: 'release',
                    diff: diffShiftPayloads(before, next),
                    actor_id: currentUser.id,
                    actor_name: currentUser.displayName,
                    note: '',
                });
                setEditing(null);
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to release shift');
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

    // ─── Drag and drop ────────────────────────────────────────────────────
    const dragRef = useRef<{ shift: RotaShift; copy: boolean } | null>(null);

    const onShiftDragStart = (e: React.DragEvent, shift: RotaShift) => {
        dragRef.current = { shift, copy: e.altKey || e.ctrlKey || e.metaKey };
        e.dataTransfer.effectAllowed = dragRef.current.copy ? 'copy' : 'move';
        try { e.dataTransfer.setData('text/plain', String(shift.id)); } catch { /* */ }
    };

    const onCellDragOver = (e: React.DragEvent) => {
        if (!dragRef.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dragRef.current.copy ? 'copy' : 'move';
    };

    const onCellDrop = async (e: React.DragEvent, userId: string | null, day: Date) => {
        if (!dragRef.current) return;
        e.preventDefault();
        const { shift, copy } = dragRef.current;
        dragRef.current = null;
        const oldStart = new Date(shift.start_at);
        const oldEnd = new Date(shift.end_at);
        const lengthMs = oldEnd.getTime() - oldStart.getTime();
        const newStart = new Date(day);
        newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
        const newEnd = new Date(newStart.getTime() + lengthMs);
        if (copy) {
            try {
                const inserts = [{
                    user_id: userId,
                    start_at: newStart.toISOString(),
                    end_at: newEnd.toISOString(),
                    role: shift.role,
                    location: shift.location,
                    notes: shift.notes,
                    published: false,
                    template_key: shift.template_key,
                    created_by: currentUser.id,
                    published_at: null,
                    published_by: null,
                    claimed_by: null,
                    claimed_at: null,
                    shift_color: shift.shift_color || null,
                    requires_count: shift.requires_count || 1,
                }];
                const created = await bulkInsertShifts(inserts);
                setShifts(prev => [...prev, ...created]);
                for (const s of created) {
                    void appendAudit({
                        entity: userId ? 'shift' : 'open_shift',
                        entity_id: String(s.id),
                        action: 'create',
                        diff: { note: { from: null, to: 'drag-copied' } },
                        actor_id: currentUser.id,
                        actor_name: currentUser.displayName,
                        note: 'Drag-copied',
                    });
                }
            } catch (err: any) {
                setError(err?.message || 'Drag-copy failed');
            }
        } else {
            try {
                const saved = await saveShift({
                    ...shift,
                    user_id: userId,
                    start_at: newStart.toISOString(),
                    end_at: newEnd.toISOString(),
                });
                if (saved) {
                    setShifts(prev => prev.map(s => s.id === saved.id ? saved : s));
                    void appendAudit({
                        entity: 'shift',
                        entity_id: String(shift.id),
                        action: 'update',
                        diff: diffShiftPayloads(shift, saved),
                        actor_id: currentUser.id,
                        actor_name: currentUser.displayName,
                        note: 'Drag-moved',
                    });
                }
            } catch (err: any) {
                setError(err?.message || 'Drag-move failed');
            }
        }
    };

    const handlePrint = () => {
        openRotaPrint({
            week: range,
            employees: filteredEmployees,
            shifts: visibleShifts,
            timeOff,
            closures,
            title: `Weekly rota — ${shortDateLabel(range.days[0])} – ${shortDateLabel(range.days[range.days.length - 1])}`,
            includeOpen: true,
            onlyPublished: !showDrafts,
        });
    };

    const handleCsv = () => {
        downloadRotaCsv({
            week: range,
            employees: filteredEmployees,
            shifts: visibleShifts,
            timeOff,
            fileLabel: 'rota',
        });
    };

    const stepRange = (delta: number) => {
        const next = new Date(anchor);
        if (view === 'day') next.setDate(next.getDate() + delta);
        else if (view === 'month') next.setMonth(next.getMonth() + delta);
        else next.setDate(next.getDate() + delta * 7);
        setAnchor(next);
    };

    const renderHeaderCell = (day: Date) => {
        const closure = closuresForDay(closures, day)[0];
        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
        return (
            <th
                key={day.toISOString()}
                className={`p-3 text-left font-black uppercase text-[10px] tracking-widest min-w-[140px] ${isWeekend ? 'bg-slate-100/70' : ''} ${closure ? 'bg-rose-50' : ''}`}
            >
                <div className="text-slate-700">{shortDateLabel(day)}</div>
                {closure && <div className="text-[9px] text-rose-700 normal-case font-bold tracking-normal mt-0.5">{closure.label}</div>}
            </th>
        );
    };

    const renderPill = (s: RotaShift, ownerId: string | null) => {
        const isAcked = isShiftAcknowledged(s, acks);
        const isOpen = !s.user_id;
        const isDraft = !s.published;
        const presetColor = DEFAULT_SHIFT_PRESETS.find(p => p.key === s.template_key)?.color
            || 'bg-teal-100 text-teal-800 border-teal-300';
        return (
            <div
                key={s.id}
                draggable
                onDragStart={(e) => onShiftDragStart(e, s)}
                className={`mb-1 px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-grab active:cursor-grabbing transition-shadow ${
                    isOpen ? 'bg-pink-100 text-pink-900 border-pink-300 border-dashed' : presetColor
                } ${isDraft ? 'opacity-70 ring-2 ring-amber-300/60' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleCellClick(ownerId, new Date(s.start_at), s); }}
                title={isDraft ? 'Draft — not yet published to staff' : ''}
            >
                <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {isoToTime(s.start_at)}–{isoToTime(s.end_at)}
                    {isOpen && s.requires_count && s.requires_count > 1 && (
                        <span className="ml-auto px-1 rounded bg-pink-200 text-[9px]">×{s.requires_count}</span>
                    )}
                </div>
                {s.role && <div className="text-[10px] opacity-80 truncate">{s.role}</div>}
                <div className="flex items-center gap-1 mt-0.5 text-[9px] opacity-80">
                    {isDraft && <span className="px-1 rounded bg-amber-200 text-amber-900 font-black uppercase tracking-wider">Draft</span>}
                    {!isDraft && !isOpen && (
                        isAcked
                            ? <span className="px-1 rounded bg-emerald-200/70 text-emerald-900 font-black uppercase tracking-wider">✓ Seen</span>
                            : <span className="px-1 rounded bg-slate-200 text-slate-700 font-black uppercase tracking-wider">Awaiting</span>
                    )}
                    {isOpen && <span className="px-1 rounded bg-pink-200 text-pink-900 font-black uppercase tracking-wider">Open</span>}
                </div>
            </div>
        );
    };

    return (
        <section>
            {/* Toolbar */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 sm:p-4 mb-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <button onClick={() => stepRange(-1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
                        <div className="px-3 py-2 rounded-lg bg-slate-100 flex items-center gap-2 text-sm font-bold text-slate-700">
                            <CalendarDays className="w-4 h-4 text-teal-600" />
                            {view === 'day'
                                ? shortDateLabel(range.days[0])
                                : view === 'month'
                                    ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                                    : `${shortDateLabel(range.days[0])} — ${shortDateLabel(range.days[range.days.length - 1])}`}
                        </div>
                        <button onClick={() => stepRange(1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
                        <button onClick={() => setAnchor(new Date())} className="ml-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-teal-700 hover:bg-teal-50">Today</button>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 text-[11px] font-black uppercase tracking-widest">
                        {([
                            { id: 'day', label: 'Day', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
                            { id: 'week', label: 'Week', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
                            { id: 'month', label: 'Month', icon: <CalendarRange className="w-3.5 h-3.5" /> },
                        ] as const).map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setView(opt.id)}
                                className={`flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors ${view === opt.id ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                            >
                                {opt.icon}{opt.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        <input
                            type="search"
                            placeholder="Search employee"
                            value={employeeSearch}
                            onChange={e => setEmployeeSearch(e.target.value)}
                            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    {teamOptions.length > 0 && (
                        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold">
                            <option value="all">All teams</option>
                            {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    )}
                    {locationOptions.length > 0 && (
                        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold">
                            <option value="all">All locations</option>
                            {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    )}
                    <button
                        onClick={() => setShowDrafts(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg border ${showDrafts ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600'}`}
                    >
                        {showDrafts ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        Drafts {showDrafts ? 'shown' : 'hidden'} ({draftCount})
                    </button>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button onClick={() => handleCellClick(null, range.days[0])} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg border border-pink-300 text-pink-700 hover:bg-pink-50">
                            <Sparkles className="w-3.5 h-3.5" /> Open shift
                        </button>
                        <button onClick={handleCopyPrevWeek} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                            <Copy className="w-3.5 h-3.5" /> Copy last
                        </button>
                        <button onClick={handleCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                            <FileDown className="w-3.5 h-3.5" /> CSV
                        </button>
                        <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                            <Printer className="w-3.5 h-3.5" /> Print
                        </button>
                        <button onClick={handlePublish} disabled={publishing || draftCount === 0} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                            {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Publish {draftCount > 0 ? `(${draftCount})` : ''}
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1">{error}</div>
                    <button onClick={() => setError(null)} className="text-amber-700"><X className="w-4 h-4" /></button>
                </div>
            )}
            {info && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-xl border border-teal-300 bg-teal-50 text-teal-900 text-sm">
                    <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1">{info}</div>
                    <button onClick={() => setInfo(null)} className="text-teal-700"><X className="w-4 h-4" /></button>
                </div>
            )}

            {/* Open shifts strip */}
            {openShifts.length > 0 && (
                <div className="mb-4 rounded-2xl border-2 border-pink-200 bg-pink-50 p-3">
                    <header className="flex items-center justify-between mb-2">
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-pink-900 flex items-center gap-2">
                            <Sparkles className="w-4 h-4" /> Open shifts in this window — {openShifts.length}
                        </h3>
                        <span className="text-[10px] text-pink-800">Staff can claim from My Rota.</span>
                    </header>
                    <div className="flex flex-wrap gap-2">
                        {openShifts.map(s => (
                            <button
                                key={s.id}
                                onClick={() => handleCellClick(null, new Date(s.start_at), s)}
                                className="px-3 py-2 rounded-lg border-2 border-dashed border-pink-300 bg-white text-left text-xs font-bold text-pink-900 hover:bg-pink-100"
                            >
                                <div>{shortDateLabel(new Date(s.start_at))}</div>
                                <div className="font-black">{isoToTime(s.start_at)}–{isoToTime(s.end_at)}</div>
                                {s.role && <div className="text-[10px] font-semibold opacity-80">{s.role}</div>}
                                {s.requires_count && s.requires_count > 1 && <div className="text-[10px] text-pink-700">×{s.requires_count} slots</div>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Grid */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                ) : filteredEmployees.length === 0 ? (
                    <EmptyEmployeesNotice />
                ) : view === 'month' ? (
                    <MonthGrid
                        range={range}
                        anchor={anchor}
                        shiftsByCell={shiftsByCell}
                        employees={filteredEmployees}
                        closures={closures}
                        timeOff={timeOff}
                        onAdd={handleCellClick}
                        renderPill={renderPill}
                        ackedByUser={(shiftId, userId) => ackedByUser(acks, shiftId, userId)}
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="text-left p-3 font-black uppercase text-[10px] tracking-widest text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[180px]">Employee</th>
                                    {range.days.map(renderHeaderCell)}
                                    <th className="p-3 text-right font-black uppercase text-[10px] tracking-widest text-slate-500 min-w-[80px]">Hours</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEmployees.map(emp => {
                                    const weeklyHours = weeklyHoursFor(visibleShifts, emp.user_id, range);
                                    const contract = Number(emp.weekly_hours || 0);
                                    const overContract = contract > 0 && weeklyHours > contract;
                                    return (
                                        <tr key={emp.user_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                                            <td className="p-3 sticky left-0 bg-white z-10 border-r border-slate-100">
                                                <div className="font-bold text-slate-900 text-sm">{emp.display_name}</div>
                                                {emp.job_title && <div className="text-xs text-slate-500">{emp.job_title}</div>}
                                                {emp.team && <div className="text-[10px] text-slate-400 mt-0.5">{emp.team}</div>}
                                            </td>
                                            {range.days.map(day => {
                                                const cellShifts = shiftsByCell.get(dayKey(emp.user_id, day)) || [];
                                                const offsForDay = timeOffForDay(timeOff, emp.user_id, day);
                                                const closure = closuresForDay(closures, day)[0];
                                                return (
                                                    <td
                                                        key={day.toISOString()}
                                                        onClick={() => handleCellClick(emp.user_id, day, cellShifts[0])}
                                                        onDragOver={onCellDragOver}
                                                        onDrop={(e) => onCellDrop(e, emp.user_id, day)}
                                                        className={`p-1.5 align-top cursor-pointer hover:bg-teal-50/60 border-r border-slate-100 ${closure ? 'bg-rose-50/40' : ''}`}
                                                    >
                                                        {offsForDay.length > 0 && (
                                                            <div className={`mb-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest border ${offsForDay[0].status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                                                                {offsForDay[0].type}{offsForDay[0].status === 'pending' ? ' · pending' : ''}
                                                            </div>
                                                        )}
                                                        {cellShifts.length === 0 ? (
                                                            <div className="text-[11px] text-slate-300 font-bold uppercase tracking-widest opacity-0 hover:opacity-100">+ Add</div>
                                                        ) : (
                                                            cellShifts.map(s => renderPill(s, emp.user_id))
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-3 text-right font-black text-slate-700 tabular-nums">
                                                <span className={overContract ? 'text-rose-600' : ''}>{weeklyHours.toFixed(weeklyHours % 1 === 0 ? 0 : 2)}h</span>
                                                <div className="text-[10px] font-normal text-slate-400">/ {contract || 0}h</div>
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
                    onReleaseToOpen={handleReleaseToOpen}
                    saving={saving}
                    conflicts={editingConflicts}
                    hardConflict={hardConflict}
                />
            )}
        </section>
    );
};

const EmptyEmployeesNotice: React.FC = () => (
    <div className="p-10 text-center">
        <p className="text-sm font-bold text-slate-700">No employees match your filters.</p>
        <p className="text-xs text-slate-500 mt-2">Clear the search / team / location filters, or add new team members under <strong>Employees</strong>.</p>
    </div>
);

interface MonthGridProps {
    range: ReturnType<typeof rangeForView>;
    anchor: Date;
    shiftsByCell: Map<string, RotaShift[]>;
    employees: RotaEmployee[];
    closures: RotaClosure[];
    timeOff: RotaTimeOff[];
    onAdd: (userId: string | null, day: Date, existing?: RotaShift) => void;
    renderPill: (s: RotaShift, ownerId: string | null) => React.ReactNode;
    ackedByUser: (shiftId: number, userId: string) => boolean;
}

const MonthGrid: React.FC<MonthGridProps> = ({ range, shiftsByCell, employees, closures, timeOff, onAdd }) => {
    const monthStart = range.start;
    const firstWeekday = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1; // Monday=0
    const cells: (Date | null)[] = Array(firstWeekday).fill(null).concat(range.days);
    while (cells.length % 7 !== 0) cells.push(null);

    return (
        <div className="p-3">
            <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="px-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                    if (!day) return <div key={i} className="min-h-[120px] bg-slate-50 rounded-md border border-slate-100" />;
                    const closure = closuresForDay(closures, day)[0];
                    const isToday = isoDate(new Date()) === isoDate(day);
                    const allShifts: { shift: RotaShift; ownerId: string | null }[] = [];
                    for (const emp of employees) {
                        for (const s of (shiftsByCell.get(dayKey(emp.user_id, day)) || [])) {
                            allShifts.push({ shift: s, ownerId: emp.user_id });
                        }
                    }
                    for (const s of (shiftsByCell.get(dayKey(null, day)) || [])) {
                        allShifts.push({ shift: s, ownerId: null });
                    }
                    const dayOffs = timeOff.filter(r => isoDate(day) >= r.start_date && isoDate(day) <= r.end_date && r.status !== 'declined' && r.status !== 'cancelled');
                    return (
                        <div
                            key={i}
                            onClick={() => onAdd(null, day)}
                            className={`min-h-[120px] p-2 rounded-md border ${isToday ? 'border-teal-400 bg-teal-50/30' : 'border-slate-200 bg-white'} ${closure ? 'bg-rose-50/30 border-rose-200' : ''} hover:bg-slate-50 cursor-pointer`}
                        >
                            <div className="flex items-center justify-between text-[11px] font-black text-slate-700 mb-1">
                                <span>{day.getDate()}</span>
                                {closure && <span className="text-[9px] text-rose-600 font-bold normal-case truncate ml-1">{closure.label}</span>}
                            </div>
                            {dayOffs.length > 0 && (
                                <div className="text-[9px] text-amber-700 font-bold uppercase mb-1">{dayOffs.length} on leave</div>
                            )}
                            <div className="space-y-0.5">
                                {allShifts.slice(0, 4).map(({ shift, ownerId }) => (
                                    <div key={shift.id} onClick={(e) => { e.stopPropagation(); onAdd(ownerId, new Date(shift.start_at), shift); }}>
                                        <div className={`text-[10px] truncate px-1 py-0.5 rounded ${shift.user_id ? 'bg-teal-100 text-teal-800' : 'bg-pink-100 text-pink-900 border border-dashed border-pink-300'} ${!shift.published ? 'opacity-60' : ''}`}>
                                            <span className="font-bold">{isoToTime(shift.start_at)}</span>{' '}
                                            <span className="opacity-80">
                                                {shift.user_id ? (employees.find(e => e.user_id === shift.user_id)?.display_name.split(' ')[0] || '?') : 'Open'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {allShifts.length > 4 && <div className="text-[9px] text-slate-500">+{allShifts.length - 4} more</div>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface ShiftEditorModalProps {
    employees: RotaEmployee[];
    editing: EditingShift;
    onChange: (next: EditingShift) => void;
    onSave: () => void;
    onDelete: () => void;
    onClose: () => void;
    onPreset: (key: string) => void;
    onReleaseToOpen: () => void;
    saving: boolean;
    conflicts: ShiftConflict[];
    hardConflict: boolean;
}

const ShiftEditorModal: React.FC<ShiftEditorModalProps> = ({
    employees, editing, onChange, onSave, onDelete, onClose, onPreset, onReleaseToOpen, saving, conflicts, hardConflict,
}) => {
    const emp = editing.user_id ? employees.find(e => e.user_id === editing.user_id) : null;
    const { start, end } = buildShiftRange(editing.date, editing.start, editing.end);
    const hours = shiftLengthHours(start, end);
    const overnight = isoToDate(start) !== isoToDate(end);
    const isOpen = !editing.user_id;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <div>
                        <h3 className="font-black text-lg text-slate-900">
                            {editing.id ? 'Edit shift' : isOpen ? 'New open shift' : 'New shift'}
                        </h3>
                        <p className="text-xs text-slate-500">
                            {emp?.display_name || (isOpen ? 'Unassigned · staff can claim' : 'Employee')} · {editing.date}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
                </header>

                <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    {!editing.id && (
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Assignee</label>
                            <select
                                value={editing.user_id || ''}
                                onChange={e => onChange({ ...editing, user_id: e.target.value || null })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            >
                                <option value="">— Open shift (any staff can claim) —</option>
                                {employees.filter(e => e.is_active).map(e => (
                                    <option key={e.user_id} value={e.user_id}>{e.display_name}</option>
                                ))}
                            </select>
                        </div>
                    )}

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
                            <input type="time" value={editing.start} onChange={e => onChange({ ...editing, start: e.target.value, template_key: null })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">End</label>
                            <input type="time" value={editing.end} onChange={e => onChange({ ...editing, end: e.target.value, template_key: null })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Role</label>
                            <input type="text" placeholder="Optional" value={editing.role} onChange={e => onChange({ ...editing, role: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Location</label>
                            <input type="text" placeholder="Optional" value={editing.location} onChange={e => onChange({ ...editing, location: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                        </div>
                    </div>

                    {isOpen && (
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Number of slots</label>
                            <input type="number" min={1} max={20} value={editing.requires_count || 1} onChange={e => onChange({ ...editing, requires_count: Math.max(1, parseInt(e.target.value, 10) || 1) })} className="w-24 px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                            <p className="text-[10px] text-slate-500 mt-1">Set &gt; 1 for "we need 3 people" type shifts.</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Notes (private to manager)</label>
                        <textarea value={editing.notes} onChange={e => onChange({ ...editing, notes: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none" />
                    </div>

                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input type="checkbox" checked={editing.published} onChange={e => onChange({ ...editing, published: e.target.checked })} />
                        Publish immediately (otherwise saved as a draft)
                    </label>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Shift length{overnight ? ' (overnight)' : ''}</span>
                        <span className="font-bold text-slate-700 tabular-nums">{hours.toFixed(hours % 1 === 0 ? 0 : 2)}h</span>
                    </div>

                    {conflicts.length > 0 && (
                        <ul className="space-y-1.5">
                            {conflicts.map((c, idx) => (
                                <li key={idx} className={`flex items-start gap-2 p-2 rounded text-[11px] font-semibold ${c.severity === 'error' ? 'bg-rose-50 border border-rose-200 text-rose-900' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>{c.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <footer className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2">
                        {editing.id && (
                            <button onClick={onDelete} disabled={saving} className="flex items-center gap-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                        )}
                        {editing.id && editing.user_id && (
                            <button onClick={onReleaseToOpen} disabled={saving} className="flex items-center gap-1 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-pink-700 hover:bg-pink-50 disabled:opacity-50">
                                <UserMinus className="w-3.5 h-3.5" /> Make open
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} disabled={saving} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg text-slate-700 hover:bg-slate-100">Cancel</button>
                        <button onClick={onSave} disabled={saving || hardConflict} className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editing.id ? <Save className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                            {editing.id ? 'Save' : isOpen ? 'Save open shift' : 'Add shift'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default RotaPlanner;
