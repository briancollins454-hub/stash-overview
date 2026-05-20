import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (
    origin === 'https://stashoverview.co.uk'
    || origin === 'https://www.stashoverview.co.uk'
    || origin === 'http://localhost:3000'
    || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');
}

function normalizeRecipients(to: unknown): string[] {
  if (typeof to === 'string' && to.trim()) return [to.trim().toLowerCase()];
  if (!Array.isArray(to)) return [];
  return to
    .filter((e): e is string => typeof e === 'string')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const body = (req.body || {}) as Record<string, unknown>;
  const recipients = normalizeRecipients(body.to);
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const text = typeof body.text === 'string' ? body.text : undefined;
  const replyTo = typeof body.replyTo === 'string' ? body.replyTo.trim() : undefined;
  const kind = body.kind === 'statement' ? 'statement' : 'digest';

  if (recipients.length === 0) return res.status(400).json({ error: 'Missing recipients' });
  if (!subject || !html) return res.status(400).json({ error: 'Missing subject or html' });

  for (const email of recipients) {
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: `Invalid email: ${email}` });
    }
  }

  if (replyTo && !EMAIL_RE.test(replyTo)) {
    return res.status(400).json({ error: 'Invalid replyTo address' });
  }

  const fromAddress = kind === 'statement'
    ? (process.env.STATEMENT_FROM_EMAIL || process.env.DIGEST_FROM_EMAIL || 'Marx Accounts <accounts@marxcorporate.com>')
    : (process.env.DIGEST_FROM_EMAIL || 'Stash Overview <digest@stashoverview.co.uk>');

  type ResendAttachment = { filename: string; content: string };
  const attachments: ResendAttachment[] = [];
  const rawAttachments = body.attachments;
  if (Array.isArray(rawAttachments)) {
    for (const item of rawAttachments.slice(0, 5)) {
      if (!item || typeof item !== 'object') continue;
      const att = item as Record<string, unknown>;
      const filename = typeof att.filename === 'string' ? att.filename.trim() : '';
      const content = typeof att.content === 'string' ? att.content : '';
      if (!filename || !content || content.length > 12_000_000) continue;
      if (!/^[a-zA-Z0-9._ -]+\.pdf$/i.test(filename)) {
        return res.status(400).json({ error: `Invalid attachment filename: ${filename}` });
      }
      attachments.push({ filename, content });
    }
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: recipients,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, id: data?.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    return res.status(500).json({ error: message });
  }
}
