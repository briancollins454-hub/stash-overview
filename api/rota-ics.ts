import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── /api/rota-ics ─────────────────────────────────────────────────────────
// Serves a per-employee iCalendar feed so staff can subscribe in Apple
// Calendar / Google Calendar / Outlook and see their published shifts in
// their personal diary.  The URL is bound to their random ical_token; if it
// leaks the manager can rotate it from the Employees screen.
//
//   GET /api/rota-ics?token=<ical_token>
//
// Requires SUPABASE_URL + SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY) so the
// edge function can call PostgREST directly — no browser session involved.

interface EmployeeRow {
    user_id: string;
    display_name: string;
    ical_token: string;
}

interface ShiftRow {
    id: number;
    user_id: string | null;
    start_at: string;
    end_at: string;
    role: string;
    location: string;
    notes: string;
    published: boolean;
}

function icsEscape(text: string): string {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function icsDate(iso: string): string {
    const d = new Date(iso);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

async function supabaseGet<T>(
    path: string,
    url: string,
    key: string,
): Promise<T[]> {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
        },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ error: 'GET only' });
        return;
    }

    const token = String(req.query.token || '').trim();
    if (!token || !/^[a-f0-9]{12,128}$/i.test(token)) {
        res.status(400).json({ error: 'Missing or malformed token' });
        return;
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY
        || process.env.SUPABASE_ANON_KEY
        || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        res.status(500).json({ error: 'Supabase env vars not configured for iCal feed' });
        return;
    }

    const employees = await supabaseGet<EmployeeRow>(
        `stash_rota_employees?select=user_id,display_name,ical_token&ical_token=eq.${encodeURIComponent(token)}&limit=1`,
        supabaseUrl,
        supabaseKey,
    );
    const employee = employees[0];
    if (!employee) {
        res.status(404).json({ error: 'Unknown token' });
        return;
    }

    // Fetch shifts from 3 months back to 12 months ahead — enough for diary
    // subscriptions, doesn't drown the response.
    const now = new Date();
    const startWindow = new Date(now); startWindow.setMonth(startWindow.getMonth() - 3);
    const endWindow = new Date(now); endWindow.setMonth(endWindow.getMonth() + 12);

    const shifts = await supabaseGet<ShiftRow>(
        `stash_rota_shifts?select=id,user_id,start_at,end_at,role,location,notes,published`
        + `&user_id=eq.${encodeURIComponent(employee.user_id)}`
        + `&published=eq.true`
        + `&start_at=gte.${encodeURIComponent(startWindow.toISOString())}`
        + `&start_at=lt.${encodeURIComponent(endWindow.toISOString())}`
        + `&order=start_at.asc`,
        supabaseUrl,
        supabaseKey,
    );

    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Stash//Rota//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:Stash Rota — ${icsEscape(employee.display_name)}`,
        'X-WR-TIMEZONE:Europe/London',
    ];

    const stamp = icsDate(new Date().toISOString());
    for (const s of shifts) {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:stash-rota-${s.id}@stashoverview.co.uk`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`DTSTART:${icsDate(s.start_at)}`);
        lines.push(`DTEND:${icsDate(s.end_at)}`);
        const summary = s.role ? `Shift — ${s.role}` : 'Stash shift';
        lines.push(`SUMMARY:${icsEscape(summary)}`);
        if (s.location) lines.push(`LOCATION:${icsEscape(s.location)}`);
        if (s.notes) lines.push(`DESCRIPTION:${icsEscape(s.notes)}`);
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const body = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="stash-rota-${employee.user_id}.ics"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(body);
}
