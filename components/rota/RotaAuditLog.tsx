// ─── RotaAuditLog ──────────────────────────────────────────────────────────
// Read-only log of every shift/time-off/swap mutation. Useful for "who
// changed Sarah's Friday shift?" questions.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, History, Loader2, RefreshCw } from 'lucide-react';
import { fetchAudit } from '../../services/rotaService';
import type { RotaAuditEntry } from '../../utils/rota';

const ACTION_COLOURS: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700',
    update: 'bg-amber-100 text-amber-700',
    delete: 'bg-rose-100 text-rose-700',
    publish: 'bg-teal-100 text-teal-700',
    unpublish: 'bg-slate-200 text-slate-700',
    claim: 'bg-pink-100 text-pink-700',
    release: 'bg-pink-100 text-pink-700',
    swap_request: 'bg-blue-100 text-blue-700',
    swap_accept: 'bg-emerald-100 text-emerald-700',
    swap_decline: 'bg-rose-100 text-rose-700',
    acknowledge: 'bg-slate-100 text-slate-600',
};

export const RotaAuditLog: React.FC = () => {
    const [rows, setRows] = useState<RotaAuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [entityFilter, setEntityFilter] = useState<string>('all');
    const [actorFilter, setActorFilter] = useState<string>('');
    const [actionFilter, setActionFilter] = useState<string>('all');

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchAudit({
                entity: entityFilter === 'all' ? undefined : entityFilter,
                limit: 300,
            });
            setRows(data);
        } catch (e: any) {
            setError(e?.message || 'Failed to load audit log');
        } finally {
            setLoading(false);
        }
    }, [entityFilter]);

    useEffect(() => { reload(); }, [reload]);

    const filtered = useMemo(() => rows.filter(r => {
        if (actionFilter !== 'all' && r.action !== actionFilter) return false;
        if (actorFilter && !(r.actor_name || r.actor_id || '').toLowerCase().includes(actorFilter.toLowerCase())) return false;
        return true;
    }), [rows, actionFilter, actorFilter]);

    const actions = useMemo(() => {
        const set = new Set<string>();
        for (const r of rows) set.add(r.action);
        return Array.from(set).sort();
    }, [rows]);

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4 space-y-3">
                <div className="flex items-center gap-2"><History className="w-5 h-5 text-teal-600" /><h2 className="font-black uppercase tracking-widest text-[11px] text-slate-500">Change history</h2></div>
                <div className="flex flex-wrap items-center gap-2">
                    <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold">
                        <option value="all">All entities</option>
                        <option value="shift">Shifts</option>
                        <option value="open_shift">Open shifts</option>
                        <option value="time_off">Time off</option>
                        <option value="swap">Swaps</option>
                        <option value="employee">Employees</option>
                    </select>
                    <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold">
                        <option value="all">All actions</option>
                        {actions.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <div className="flex items-center gap-1">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        <input
                            type="search"
                            value={actorFilter}
                            onChange={e => setActorFilter(e.target.value)}
                            placeholder="Filter by user"
                            className="px-2 py-1.5 rounded border border-slate-300 text-xs"
                        />
                    </div>
                    <button onClick={reload} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 ml-auto">
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh
                    </button>
                </div>
            </div>

            {error && <div className="mb-4 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">{error}</div>}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 text-teal-500 animate-spin" /></div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">No matching audit entries.</div>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {filtered.map(r => {
                            const cls = ACTION_COLOURS[r.action] || 'bg-slate-100 text-slate-600';
                            const time = new Date(r.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
                            const diffKeys = Object.keys(r.diff || {});
                            return (
                                <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                                    <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${cls} shrink-0`}>{r.action}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-slate-700">
                                            <strong>{r.actor_name || r.actor_id || 'system'}</strong>{' '}
                                            <span className="text-slate-500">{r.entity} #{r.entity_id}</span>
                                            {r.note && <span className="text-slate-500"> — {r.note}</span>}
                                        </p>
                                        {diffKeys.length > 0 && (
                                            <ul className="mt-1 text-[11px] text-slate-500 space-y-0.5">
                                                {diffKeys.slice(0, 5).map(k => {
                                                    const d = r.diff[k];
                                                    const from = d?.from === null || d?.from === undefined ? '—' : String(d.from);
                                                    const to = d?.to === null || d?.to === undefined ? '—' : String(d.to);
                                                    return <li key={k}><strong className="text-slate-700">{k}:</strong> <span className="line-through opacity-60">{from}</span> → <span>{to}</span></li>;
                                                })}
                                                {diffKeys.length > 5 && <li className="text-slate-400">+{diffKeys.length - 5} more changes</li>}
                                            </ul>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-slate-400 tabular-nums shrink-0">{time}</div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
};

export default RotaAuditLog;
