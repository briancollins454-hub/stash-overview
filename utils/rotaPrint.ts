import type { RotaClosure, RotaEmployee, RotaShift, RotaTimeOff, WeekRange } from './rota';
import {
    DEFAULT_SHIFT_PRESETS, closuresForDay, isoDate, isoToTime, shiftLengthHours,
    shiftsForDay, shortDateLabel, timeOffForDay, weeklyHoursFor,
} from './rota';

function esc(raw: string): string {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function presetColor(templateKey: string | null | undefined): string {
    if (!templateKey) return '#e0f2fe; color:#075985; border-color:#7dd3fc';
    const preset = DEFAULT_SHIFT_PRESETS.find(p => p.key === templateKey);
    if (!preset) return '#e0f2fe; color:#075985; border-color:#7dd3fc';
    // Translate the tailwind preset class set into rough hex equivalents for
    // print. Defaults to a calm blue if we can't map it cleanly.
    const map: Record<string, string> = {
        day_full: '#dcfce7; color:#166534; border-color:#86efac',
        day_early: '#e0f2fe; color:#075985; border-color:#7dd3fc',
        day_late: '#ede9fe; color:#5b21b6; border-color:#c4b5fd',
        half_am: '#fef3c7; color:#92400e; border-color:#fcd34d',
        half_pm: '#ffedd5; color:#9a3412; border-color:#fdba74',
    };
    return map[templateKey] || '#e0f2fe; color:#075985; border-color:#7dd3fc';
}

export interface PrintRotaOpts {
    week: WeekRange;
    employees: RotaEmployee[];
    shifts: RotaShift[];
    timeOff: RotaTimeOff[];
    closures: RotaClosure[];
    title?: string;
    includeOpen?: boolean;
    onlyPublished?: boolean;
}

export function openRotaPrint(opts: PrintRotaOpts): void {
    const {
        week, employees, shifts, timeOff, closures,
        title = 'Weekly rota',
        includeOpen = true,
        onlyPublished = true,
    } = opts;

    const filteredShifts = shifts.filter(s => onlyPublished ? s.published : true);
    const activeEmployees = employees.filter(e => e.is_active);
    const openShifts = includeOpen ? filteredShifts.filter(s => !s.user_id) : [];

    const head = `
        <thead>
            <tr>
                <th class="employee-col">Employee</th>
                ${week.days.map(d => {
                    const closure = closuresForDay(closures, d)[0];
                    return `<th class="${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''} ${closure ? 'closure' : ''}">
                        <div class="day-label">${esc(shortDateLabel(d))}</div>
                        ${closure ? `<div class="closure-label">${esc(closure.label)}</div>` : ''}
                    </th>`;
                }).join('')}
                <th class="num">Hours</th>
            </tr>
        </thead>
    `;

    const employeeRows = activeEmployees.map(emp => {
        const hours = weeklyHoursFor(filteredShifts, emp.user_id, week);
        return `<tr>
            <td class="employee-cell">
                <div class="emp-name">${esc(emp.display_name)}</div>
                ${emp.job_title ? `<div class="emp-meta">${esc(emp.job_title)}</div>` : ''}
            </td>
            ${week.days.map(day => {
                const cellShifts = shiftsForDay(filteredShifts, emp.user_id, day);
                const offs = timeOffForDay(timeOff, emp.user_id, day);
                if (cellShifts.length === 0 && offs.length === 0) return '<td>&nbsp;</td>';
                const offBlock = offs.map(o => `<div class="off-badge">${esc(o.type)}${o.status === 'pending' ? ' · pending' : ''}</div>`).join('');
                const shiftBlocks = cellShifts.map(s => `
                    <div class="shift-pill" style="background:${presetColor(s.template_key)}">
                        <div class="time">${isoToTime(s.start_at)}–${isoToTime(s.end_at)}</div>
                        ${s.role ? `<div class="role">${esc(s.role)}</div>` : ''}
                        ${s.location ? `<div class="loc">@ ${esc(s.location)}</div>` : ''}
                    </div>
                `).join('');
                return `<td>${offBlock}${shiftBlocks}</td>`;
            }).join('')}
            <td class="num"><strong>${hours.toFixed(hours % 1 === 0 ? 0 : 2)}h</strong>${emp.weekly_hours ? `<div class="contract">/ ${Number(emp.weekly_hours)}h</div>` : ''}</td>
        </tr>`;
    }).join('');

    const openSection = openShifts.length === 0 ? '' : `
        <section class="open-shifts">
            <h2>Open shifts (${openShifts.length})</h2>
            <p>These shifts are unassigned — anyone can claim them in Stash.</p>
            <ul>
                ${openShifts.map(s => `<li>
                    <strong>${esc(shortDateLabel(new Date(s.start_at)))}</strong> ·
                    ${isoToTime(s.start_at)}–${isoToTime(s.end_at)} ·
                    ${esc(s.role || 'Open shift')}
                    ${s.location ? ` · ${esc(s.location)}` : ''}
                    ${s.requires_count && s.requires_count > 1 ? ` <em>(${s.requires_count} slots)</em>` : ''}
                </li>`).join('')}
            </ul>
        </section>
    `;

    const totals = activeEmployees.reduce((acc, emp) => acc + weeklyHoursFor(filteredShifts, emp.user_id, week), 0);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>${esc(title)} — ${esc(shortDateLabel(week.days[0]))} – ${esc(shortDateLabel(week.days[week.days.length - 1]))}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; color: #0f172a; font-size: 11px; }
        .toolbar { position: sticky; top: 0; background: #0f172a; color: #fff; padding: 12px 16px; margin: -24px -24px 18px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; z-index: 5; }
        .toolbar button { padding: 10px 18px; border: none; border-radius: 8px; background: #0d9488; color: #fff; font-weight: 800; font-size: 12px; cursor: pointer; }
        h1 { margin: 0 0 4px; font-size: 20px; }
        .meta { color: #475569; margin-bottom: 16px; line-height: 1.5; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
        th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        th.weekend, th.closure { background: #e2e8f0; }
        th.closure { background: #fee2e2; color: #991b1b; }
        .day-label { font-weight: 700; }
        .closure-label { font-size: 9px; color: #991b1b; font-weight: 600; margin-top: 2px; }
        .employee-col { background: #f1f5f9; min-width: 160px; }
        .employee-cell { background: #fafbfc; }
        .emp-name { font-weight: 800; font-size: 12px; }
        .emp-meta { color: #64748b; font-size: 10px; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; }
        .contract { font-size: 9px; color: #94a3b8; font-weight: 500; }
        .shift-pill { border: 1px solid; border-radius: 4px; padding: 3px 5px; margin-bottom: 3px; font-size: 10px; font-weight: 600; line-height: 1.25; }
        .shift-pill .time { font-weight: 800; }
        .shift-pill .role, .shift-pill .loc { font-weight: 400; opacity: 0.85; }
        .off-badge { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; padding: 2px 4px; border-radius: 4px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; font-weight: 700; }
        .open-shifts { background: #fdf2f8; border: 2px solid #f9a8d4; border-radius: 10px; padding: 14px; margin-top: 18px; }
        .open-shifts h2 { color: #831843; margin: 0 0 4px; font-size: 14px; }
        .open-shifts ul { margin: 6px 0 0; padding-left: 18px; }
        @media print {
            .toolbar { display: none; }
            body { padding: 12px; font-size: 10px; }
            @page { size: A3 landscape; }
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <span>Rota — use Print → Save as PDF (A3 landscape recommended)</span>
        <button type="button" onclick="window.print()">Print / Save as PDF</button>
    </div>
    <h1>${esc(title)}</h1>
    <p class="meta">
        Week of <strong>${esc(shortDateLabel(week.days[0]))} – ${esc(shortDateLabel(week.days[week.days.length - 1]))}</strong> · Generated ${new Date().toLocaleString('en-GB')}
        <br />Total scheduled hours: <strong>${totals.toFixed(totals % 1 === 0 ? 0 : 2)}h</strong>
        ${onlyPublished ? '<br /><em>Published shifts only.</em>' : '<br /><em>Includes draft shifts.</em>'}
    </p>
    <table>
        ${head}
        <tbody>${employeeRows || '<tr><td colspan="9">No employees on the rota.</td></tr>'}</tbody>
    </table>
    ${openSection}
</body>
</html>`;

    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) {
        window.alert('Please allow pop-ups to print the rota.');
        return;
    }
    win.document.write(html);
    win.document.close();
}

// ─── CSV / payroll export ──────────────────────────────────────────────────
function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export interface RotaCsvOpts {
    week: WeekRange;
    employees: RotaEmployee[];
    shifts: RotaShift[];
    timeOff: RotaTimeOff[];
    fileLabel?: string;
}

/**
 * Wide CSV with one row per (employee, day) and shift/time-off summary —
 * suitable for dropping into payroll.  Includes total hours.
 */
export function downloadRotaCsv(opts: RotaCsvOpts): void {
    const { week, employees, shifts, timeOff, fileLabel = 'rota' } = opts;
    const header = [
        'employee', 'user_id', 'job_title', 'date', 'day',
        'shift_count', 'shift_hours', 'first_start', 'last_end',
        'time_off_type', 'time_off_status',
    ];
    const rows: (string | number)[][] = [];
    for (const emp of employees) {
        for (const day of week.days) {
            const cellShifts = shiftsForDay(shifts, emp.user_id, day);
            const offs = timeOffForDay(timeOff, emp.user_id, day);
            const hrs = cellShifts.reduce((s, x) => s + shiftLengthHours(x.start_at, x.end_at), 0);
            const sorted = [...cellShifts].sort((a, b) => a.start_at.localeCompare(b.start_at));
            rows.push([
                emp.display_name,
                emp.user_id,
                emp.job_title || '',
                isoDate(day),
                day.toLocaleDateString('en-GB', { weekday: 'short' }),
                cellShifts.length,
                hrs,
                sorted[0] ? isoToTime(sorted[0].start_at) : '',
                sorted[sorted.length - 1] ? isoToTime(sorted[sorted.length - 1].end_at) : '',
                offs[0]?.type || '',
                offs[0]?.status || '',
            ]);
        }
    }
    const meta = [
        `# generated,${new Date().toISOString()}`,
        `# week_start,${isoDate(week.days[0])}`,
        `# week_end,${isoDate(week.days[week.days.length - 1])}`,
    ].join('\r\n');
    const body = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
    const csv = `${meta}\r\n${body}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileLabel}-${isoDate(week.days[0])}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
