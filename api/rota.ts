import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

// ─── /api/rota ─────────────────────────────────────────────────────────────
// Server-side concerns for the Stash Rota module that *aren't* plain
// Supabase CRUD (those go through /api/supabase-data). Today this is just
// transactional email — manager pings when staff submit time-off, staff
// pings when manager decides.
//
// Resend is reused from the digest feature (RESEND_API_KEY env). DIGEST_FROM_EMAIL
// supplies the From header. ROTA_MANAGER_EMAIL is the single rota manager who
// receives all incoming requests.

const ALLOWED_ORIGINS = (origin: string) =>
    origin === 'https://stashoverview.co.uk' ||
    origin === 'https://www.stashoverview.co.uk' ||
    origin === 'http://localhost:3000' ||
    (origin.endsWith('.vercel.app') && origin.includes('stash-overview'));

function escapeHtml(s: string): string {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return iso;
    }
}

function buildRequestEmail(payload: any): { subject: string; html: string } {
    const employeeName = payload.employee?.display_name || 'A team member';
    const req = payload.request || {};
    const type = String(req.type || 'holiday');
    const start = formatDate(req.start_date);
    const end = formatDate(req.end_date);
    const sameDay = req.start_date === req.end_date;
    const halfNote = req.half_day ? ` (${req.half_day.toUpperCase()} only)` : '';
    const days = Number(req.days_count || 0);
    const reason = (req.reason || '').trim();
    const subject = `New ${type} request: ${employeeName} — ${start}${sameDay ? halfNote : ` → ${end}`}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#0f172a;max-width:520px;line-height:1.5">
            <h2 style="margin:0 0 12px;font-size:18px;color:#0f766e">New time-off request</h2>
            <p style="margin:0 0 8px">
                <strong>${escapeHtml(employeeName)}</strong> has submitted a
                <strong>${escapeHtml(type)}</strong> request.
            </p>
            <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px">
                <tr><td style="padding:6px 0;color:#64748b">Dates</td><td style="padding:6px 0">${escapeHtml(start)}${sameDay ? escapeHtml(halfNote) : ` &nbsp;→&nbsp; ${escapeHtml(end)}`}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b">Working days</td><td style="padding:6px 0">${days}</td></tr>
                ${reason ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">Reason</td><td style="padding:6px 0">${escapeHtml(reason)}</td></tr>` : ''}
            </table>
            <p style="margin:16px 0 8px;font-size:14px">
                Approve or decline this request in
                <a href="https://stashoverview.co.uk/?tab=rota&amp;sub=time-off" style="color:#0f766e;font-weight:600">Stash &rsaquo; Rota &rsaquo; Time off</a>.
            </p>
            <p style="margin-top:24px;font-size:12px;color:#94a3b8">Stash Rota — automated notification</p>
        </div>
    `;
    return { subject, html };
}

function buildDecisionEmail(payload: any): { subject: string; html: string } {
    const employeeName = payload.employee?.display_name || 'there';
    const req = payload.request || {};
    const status: string = String(req.status || 'approved');
    const decidedByName = payload.decidedByDisplayName || 'your manager';
    const start = formatDate(req.start_date);
    const end = formatDate(req.end_date);
    const sameDay = req.start_date === req.end_date;
    const note = (req.decided_note || '').trim();
    const colour = status === 'approved' ? '#16a34a' : status === 'declined' ? '#dc2626' : '#64748b';
    const subject = `Your time-off request was ${status} — ${start}${sameDay ? '' : ` → ${end}`}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#0f172a;max-width:520px;line-height:1.5">
            <h2 style="margin:0 0 12px;font-size:18px;color:${colour}">Time-off ${escapeHtml(status)}</h2>
            <p style="margin:0 0 8px">
                Hi ${escapeHtml(employeeName)}, ${escapeHtml(decidedByName)} has
                <strong style="color:${colour}">${escapeHtml(status)}</strong> your time-off request.
            </p>
            <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px">
                <tr><td style="padding:6px 0;color:#64748b">Dates</td><td style="padding:6px 0">${escapeHtml(start)}${sameDay ? '' : ` &nbsp;→&nbsp; ${escapeHtml(end)}`}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b">Type</td><td style="padding:6px 0">${escapeHtml(String(req.type || 'holiday'))}</td></tr>
                ${note ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">Manager note</td><td style="padding:6px 0">${escapeHtml(note)}</td></tr>` : ''}
            </table>
            <p style="margin:16px 0 8px;font-size:14px">
                See your full booking history in
                <a href="https://stashoverview.co.uk/?surface=rota" style="color:#0f766e;font-weight:600">Stash Rota</a>.
            </p>
            <p style="margin-top:24px;font-size:12px;color:#94a3b8">Stash Rota — automated notification</p>
        </div>
    `;
    return { subject, html };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { action } = req.body || {};
    if (action !== 'notify') {
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        // Soft-fail. The frontend treats /api/rota as best-effort.
        return res.status(200).json({ skipped: true, reason: 'RESEND_API_KEY not configured' });
    }

    const fromAddress = process.env.DIGEST_FROM_EMAIL || 'Stash Rota <rota@stashoverview.co.uk>';
    const managerEmail = (req.body.managerEmail || process.env.ROTA_MANAGER_EMAIL || '').trim();

    try {
        const kind = String(req.body.kind || '');
        let to: string[] = [];
        let subject = '';
        let html = '';

        if (kind === 'time_off_requested') {
            if (!managerEmail) {
                return res.status(200).json({ skipped: true, reason: 'No manager email configured' });
            }
            to = [managerEmail];
            const built = buildRequestEmail(req.body);
            subject = built.subject;
            html = built.html;
        } else if (kind === 'time_off_decided') {
            const employeeEmail = req.body.employee?.email || '';
            if (!employeeEmail) {
                return res.status(200).json({ skipped: true, reason: 'No employee email on file' });
            }
            to = [employeeEmail];
            const built = buildDecisionEmail(req.body);
            subject = built.subject;
            html = built.html;
        } else {
            return res.status(400).json({ error: `Unknown notify kind: ${kind}` });
        }

        const resend = new Resend(apiKey);
        const { data, error } = await resend.emails.send({ from: fromAddress, to, subject, html });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, id: data?.id });
    } catch (err: any) {
        return res.status(500).json({ error: err?.message || 'Failed to send rota email' });
    }
}
