// ─── RotaCloudImporter ─────────────────────────────────────────────────────
// One-time data migration screen for moving off RotaCloud. Accepts three
// CSV shapes from RotaCloud's "Export" feature:
//
//   • Employees export — name, email, holiday entitlement, etc.
//   • Schedule (shifts) export — staff name, start, end, role
//   • Holidays / time-off export — staff name, type, start, end
//
// The importer parses, lets the manager preview + map columns, then writes
// rows in batches via the rotaService. RotaCloud's exact column headers
// shift between formats, so we accept several aliases for each field and
// fall back to fuzzy matching by lower-casing + stripping punctuation.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Upload, Users, CalendarRange, Plane, Loader2, AlertTriangle, CheckCircle2,
    FileSpreadsheet, X,
} from 'lucide-react';
import {
    bulkInsertShifts, fetchEmployees, submitTimeOff, upsertEmployee,
} from '../../services/rotaService';
import {
    combineDateTime, daysCountFor, isoDate, isoToDate,
    type RotaEmployee,
} from '../../utils/rota';

export interface RotaCloudImporterProps {
    currentUser: { id: string; username: string; displayName: string; role: string };
}

type ImportKind = 'employees' | 'shifts' | 'time_off';

interface ParsedCsv {
    headers: string[];
    rows: Record<string, string>[];
}

interface ImportSummary {
    kind: ImportKind;
    ok: number;
    skipped: number;
    errors: string[];
}

// ─── Header alias map ──────────────────────────────────────────────────────
// Each canonical field has a list of header substrings we'll accept (case-
// insensitive). The first match in `headers` wins.
const FIELD_ALIASES: Record<string, string[]> = {
    name:            ['name', 'employee', 'full name', 'staff'],
    email:           ['email', 'work email'],
    job_title:       ['job title', 'role', 'position'],
    team:            ['team', 'department'],
    holiday_days:    ['holiday entitlement', 'allowance', 'holiday allowance'],
    weekly_hours:    ['contracted hours', 'weekly hours', 'hours per week'],
    start_date:      ['start date', 'employment start'],
    rotacloud_id:    ['employee id', 'rota id', 'staff id', 'id'],

    // shifts
    shift_date:      ['date', 'shift date'],
    shift_start:     ['start time', 'starts at', 'start'],
    shift_end:       ['end time', 'ends at', 'end'],
    shift_location:  ['location', 'site'],
    shift_role:      ['role', 'job role'],

    // time off
    leave_start:     ['from', 'leave start', 'holiday start', 'start date', 'starting'],
    leave_end:       ['to', 'leave end', 'holiday end', 'end date', 'ending'],
    leave_type:      ['type', 'leave type', 'category'],
    leave_reason:    ['note', 'comment', 'reason'],
    leave_status:    ['status', 'approval'],
    leave_half:      ['half day', 'half-day'],
};

function findColumn(headers: string[], canonical: string): string | null {
    const aliases = FIELD_ALIASES[canonical] || [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalisedHeaders = headers.map(h => ({ raw: h, norm: norm(h) }));
    for (const alias of aliases) {
        const an = norm(alias);
        const exact = normalisedHeaders.find(h => h.norm === an);
        if (exact) return exact.raw;
        const partial = normalisedHeaders.find(h => h.norm.includes(an));
        if (partial) return partial.raw;
    }
    return null;
}

// ─── CSV parser (minimal — handles quoted commas, doubled quotes) ─────────
function parseCsv(text: string): ParsedCsv {
    const rows: string[][] = [];
    let cur: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            cur.push(field); field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            cur.push(field); field = '';
            if (cur.some(c => c.length > 0)) rows.push(cur);
            cur = [];
        } else {
            field += ch;
        }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
    if (rows.length === 0) return { headers: [], rows: [] };
    const headers = rows[0].map(h => h.trim());
    const out: Record<string, string>[] = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const obj: Record<string, string> = {};
        for (let c = 0; c < headers.length; c++) {
            obj[headers[c]] = (row[c] ?? '').trim();
        }
        out.push(obj);
    }
    return { headers, rows: out };
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '');
}

function parseLooseDate(s: string): string | null {
    if (!s) return null;
    // Common: 03/05/2026, 03-05-2026, 2026-05-03
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (dmy) {
        let [, d, m, y] = dmy;
        if (y.length === 2) y = String(2000 + parseInt(y, 10));
        return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymd) {
        const [, y, m, d] = ymd;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const native = new Date(s);
    if (!Number.isNaN(native.getTime())) return isoDate(native);
    return null;
}

function parseLooseTime(s: string): string | null {
    if (!s) return null;
    const m = s.match(/(\d{1,2}):?(\d{2})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export const RotaCloudImporter: React.FC<RotaCloudImporterProps> = ({ currentUser }) => {
    const [kind, setKind] = useState<ImportKind>('employees');
    const [parsed, setParsed] = useState<ParsedCsv | null>(null);
    const [busy, setBusy] = useState(false);
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const handleFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || '');
            setParsed(parseCsv(text));
            setSummary(null);
            setError(null);
        };
        reader.readAsText(file);
    };

    const detected = useMemo(() => {
        if (!parsed) return null;
        const requiredByKind: Record<ImportKind, string[]> = {
            employees: ['name'],
            shifts: ['name', 'shift_date', 'shift_start', 'shift_end'],
            time_off: ['name', 'leave_start', 'leave_end'],
        };
        const required = requiredByKind[kind];
        return required.map(field => ({ field, header: findColumn(parsed.headers, field) }));
    }, [parsed, kind]);

    const missing = useMemo(() => (detected || []).filter(d => !d.header).map(d => d.field), [detected]);

    const runImport = useCallback(async () => {
        if (!parsed) return;
        setBusy(true);
        setError(null);
        setSummary(null);
        try {
            if (kind === 'employees') {
                setSummary(await importEmployees(parsed));
            } else if (kind === 'shifts') {
                setSummary(await importShifts(parsed, currentUser.id));
            } else {
                setSummary(await importTimeOff(parsed, currentUser.id));
            }
        } catch (e: any) {
            setError(e?.message || 'Import failed');
        } finally {
            setBusy(false);
        }
    }, [parsed, kind, currentUser.id]);

    return (
        <section>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 mb-4">
                <div className="flex items-center gap-2 mb-3">
                    <Upload className="w-5 h-5 text-teal-600" />
                    <div>
                        <h2 className="font-black text-sm text-slate-900">Import from RotaCloud</h2>
                        <p className="text-xs text-slate-500">Export employees, schedule, and holidays as CSV from RotaCloud, then upload each below.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <KindButton current={kind} value="employees" onClick={setKind} icon={Users} label="Employees" />
                    <KindButton current={kind} value="shifts" onClick={setKind} icon={CalendarRange} label="Shifts" />
                    <KindButton current={kind} value="time_off" onClick={setKind} icon={Plane} label="Holidays / time off" />
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                <input
                    type="file"
                    accept=".csv,text/csv"
                    ref={fileInput}
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                    className="hidden"
                />
                {!parsed ? (
                    <button
                        onClick={() => fileInput.current?.click()}
                        className="w-full flex flex-col items-center gap-2 py-12 border-2 border-dashed border-slate-200 rounded-2xl hover:bg-teal-50/30 hover:border-teal-300 text-slate-500"
                    >
                        <FileSpreadsheet className="w-8 h-8" />
                        <span className="text-sm font-bold">Click to upload a {kind.replace('_', ' ')} CSV</span>
                        <span className="text-xs text-slate-400">UTF-8, comma-separated, first row is headers</span>
                    </button>
                ) : (
                    <>
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm font-bold text-slate-700">
                                {parsed.rows.length} rows · {parsed.headers.length} columns
                            </p>
                            <button
                                onClick={() => { setParsed(null); setSummary(null); setError(null); fileInput.current && (fileInput.current.value = ''); }}
                                className="text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600 flex items-center gap-1"
                            >
                                <X className="w-3.5 h-3.5" />
                                Clear
                            </button>
                        </div>

                        {missing.length > 0 ? (
                            <div className="flex items-start gap-2 p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 text-sm">
                                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                <div>
                                    Missing required column{missing.length === 1 ? '' : 's'}: <strong>{missing.join(', ')}</strong>.
                                    Re-export from RotaCloud and try again.
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Column mapping</h4>
                                <ul className="text-xs text-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {detected?.map(d => (
                                        <li key={d.field} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                                            <span className="font-bold text-slate-600">{d.field}</span>
                                            <span className="text-slate-500">{d.header}</span>
                                        </li>
                                    ))}
                                </ul>

                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-4">Preview</h4>
                                <div className="overflow-x-auto rounded-xl border border-slate-200">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                {parsed.headers.slice(0, 6).map(h => (
                                                    <th key={h} className="text-left p-2 font-black uppercase tracking-widest text-[10px] text-slate-500">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {parsed.rows.slice(0, 5).map((row, i) => (
                                                <tr key={i} className="border-t border-slate-100">
                                                    {parsed.headers.slice(0, 6).map(h => (
                                                        <td key={h} className="p-2 text-slate-700">{row[h] || ''}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <button
                                    onClick={runImport}
                                    disabled={busy}
                                    className="mt-4 flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-widest rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                    Import {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {error && (
                    <div className="mt-4 flex items-start gap-2 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>{error}</div>
                    </div>
                )}

                {summary && (
                    <div className="mt-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                            <CheckCircle2 className="w-4 h-4" />
                            <strong>Import complete</strong>
                        </div>
                        <p>
                            {summary.ok} row{summary.ok === 1 ? '' : 's'} imported
                            {summary.skipped > 0 && `, ${summary.skipped} skipped`}.
                        </p>
                        {summary.errors.length > 0 && (
                            <details className="mt-2 text-xs">
                                <summary>Show {summary.errors.length} warning{summary.errors.length === 1 ? '' : 's'}</summary>
                                <ul className="mt-1 space-y-1 list-disc list-inside text-amber-900">
                                    {summary.errors.slice(0, 25).map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </details>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
};

const KindButton: React.FC<{
    current: ImportKind;
    value: ImportKind;
    onClick: (k: ImportKind) => void;
    icon: any;
    label: string;
}> = ({ current, value, onClick, icon: Icon, label }) => (
    <button
        onClick={() => onClick(value)}
        className={`flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg ${current === value ? 'bg-teal-600 text-white' : 'text-slate-700 hover:bg-slate-50 border border-slate-200'}`}
    >
        <Icon className="w-3.5 h-3.5" />
        {label}
    </button>
);

// ─── Import implementations ───────────────────────────────────────────────
async function importEmployees(parsed: ParsedCsv): Promise<ImportSummary> {
    const headers = parsed.headers;
    const nameCol = findColumn(headers, 'name');
    const emailCol = findColumn(headers, 'email');
    const jobTitleCol = findColumn(headers, 'job_title');
    const teamCol = findColumn(headers, 'team');
    const holidayCol = findColumn(headers, 'holiday_days');
    const hoursCol = findColumn(headers, 'weekly_hours');
    const startCol = findColumn(headers, 'start_date');
    const idCol = findColumn(headers, 'rotacloud_id');

    if (!nameCol) throw new Error('Could not find a name column.');

    let ok = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of parsed.rows) {
        const name = (row[nameCol] || '').trim();
        if (!name) { skipped++; continue; }
        const userId = slugify(name);
        try {
            await upsertEmployee({
                user_id: userId,
                display_name: name,
                email: emailCol ? row[emailCol] || null : null,
                job_title: jobTitleCol ? row[jobTitleCol] : '',
                team: teamCol ? row[teamCol] : '',
                holiday_allowance_days: holidayCol ? Number(row[holidayCol] || 0) : 28,
                weekly_hours: hoursCol ? Number(row[hoursCol] || 0) : 40,
                start_date: startCol ? parseLooseDate(row[startCol]) : null,
                rotacloud_id: idCol ? row[idCol] : null,
                is_active: true,
            });
            ok++;
        } catch (e: any) {
            errors.push(`${name}: ${e?.message || 'failed'}`);
            skipped++;
        }
    }

    return { kind: 'employees', ok, skipped, errors };
}

async function importShifts(parsed: ParsedCsv, createdBy: string): Promise<ImportSummary> {
    const headers = parsed.headers;
    const nameCol = findColumn(headers, 'name');
    const dateCol = findColumn(headers, 'shift_date');
    const startCol = findColumn(headers, 'shift_start');
    const endCol = findColumn(headers, 'shift_end');
    const roleCol = findColumn(headers, 'shift_role');
    const locCol = findColumn(headers, 'shift_location');
    if (!nameCol || !dateCol || !startCol || !endCol) {
        throw new Error('Need name, date, start, end columns.');
    }

    const employees = await fetchEmployees();
    const byUserId = new Map(employees.map(e => [e.user_id, e]));
    const byDisplayName = new Map(employees.map(e => [e.display_name.toLowerCase(), e]));

    let ok = 0;
    let skipped = 0;
    const errors: string[] = [];
    const inserts: any[] = [];

    for (const row of parsed.rows) {
        const name = (row[nameCol] || '').trim();
        if (!name) { skipped++; continue; }
        const emp = byUserId.get(slugify(name)) || byDisplayName.get(name.toLowerCase());
        if (!emp) { errors.push(`${name}: no matching employee — add them first`); skipped++; continue; }

        const date = parseLooseDate(row[dateCol]);
        const start = parseLooseTime(row[startCol]);
        const end = parseLooseTime(row[endCol]);
        if (!date || !start || !end) {
            errors.push(`${name} ${row[dateCol]}: invalid date or time`);
            skipped++;
            continue;
        }
        const startIso = combineDateTime(date, start);
        let endIso = combineDateTime(date, end);
        if (Date.parse(endIso) <= Date.parse(startIso)) {
            // Roll into next day — RotaCloud sometimes exports midnight crossings.
            const d = new Date(endIso);
            d.setDate(d.getDate() + 1);
            endIso = d.toISOString();
        }
        inserts.push({
            user_id: emp.user_id,
            start_at: startIso,
            end_at: endIso,
            role: roleCol ? row[roleCol] : '',
            location: locCol ? row[locCol] : '',
            notes: '',
            published: true,
            template_key: null,
            created_by: createdBy,
        });
    }

    if (inserts.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < inserts.length; i += BATCH) {
            const batch = inserts.slice(i, i + BATCH);
            try {
                const created = await bulkInsertShifts(batch);
                ok += created.length;
            } catch (e: any) {
                errors.push(`Batch ${i}-${i + batch.length}: ${e?.message || 'failed'}`);
                skipped += batch.length;
            }
        }
    }

    return { kind: 'shifts', ok, skipped, errors };
}

async function importTimeOff(parsed: ParsedCsv, decidedBy: string): Promise<ImportSummary> {
    const headers = parsed.headers;
    const nameCol = findColumn(headers, 'name');
    const startCol = findColumn(headers, 'leave_start');
    const endCol = findColumn(headers, 'leave_end');
    const typeCol = findColumn(headers, 'leave_type');
    const reasonCol = findColumn(headers, 'leave_reason');
    const statusCol = findColumn(headers, 'leave_status');
    const halfCol = findColumn(headers, 'leave_half');
    if (!nameCol || !startCol || !endCol) {
        throw new Error('Need name, from, to columns.');
    }

    const employees = await fetchEmployees();
    const byUserId = new Map(employees.map(e => [e.user_id, e]));
    const byDisplayName = new Map(employees.map(e => [e.display_name.toLowerCase(), e]));

    let ok = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of parsed.rows) {
        const name = (row[nameCol] || '').trim();
        if (!name) { skipped++; continue; }
        const emp = byUserId.get(slugify(name)) || byDisplayName.get(name.toLowerCase());
        if (!emp) { errors.push(`${name}: no matching employee — add them first`); skipped++; continue; }

        const start = parseLooseDate(row[startCol]);
        const end = parseLooseDate(row[endCol]) || start;
        if (!start || !end) { errors.push(`${name}: invalid date`); skipped++; continue; }

        const rawType = (typeCol ? row[typeCol] : 'holiday').toLowerCase();
        const type: 'holiday' | 'sick' | 'unpaid' | 'other' =
            /sick|illness/.test(rawType) ? 'sick' :
            /unpaid/.test(rawType) ? 'unpaid' :
            /holiday|annual|leave/.test(rawType) ? 'holiday' :
            'other';

        const rawStatus = (statusCol ? row[statusCol] : 'approved').toLowerCase();
        const status: 'approved' | 'pending' | 'declined' | 'cancelled' =
            /pending|requested|awaiting/.test(rawStatus) ? 'pending' :
            /declin|reject/.test(rawStatus) ? 'declined' :
            /cancel/.test(rawStatus) ? 'cancelled' :
            'approved';

        const halfRaw = halfCol ? row[halfCol].toLowerCase() : '';
        const halfDay: 'am' | 'pm' | null = /am|morning/.test(halfRaw) ? 'am' : /pm|afternoon/.test(halfRaw) ? 'pm' : null;

        try {
            await submitTimeOff({
                user_id: emp.user_id,
                type,
                start_date: start,
                end_date: end,
                half_day: halfDay,
                reason: reasonCol ? row[reasonCol] : '',
                status,
                decided_by: status === 'approved' ? decidedBy : null,
                decided_at: status === 'approved' ? new Date().toISOString() : null,
                decided_note: 'Imported from RotaCloud',
                days_count: daysCountFor(start, end, halfDay),
            });
            ok++;
        } catch (e: any) {
            errors.push(`${name} ${start}: ${e?.message || 'failed'}`);
            skipped++;
        }
    }

    return { kind: 'time_off', ok, skipped, errors };
}

export default RotaCloudImporter;
