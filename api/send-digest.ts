import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const { to, subject, html } = req.body || {};
  if (!to || !Array.isArray(to) || to.length === 0) return res.status(400).json({ error: 'Missing recipients' });
  if (!subject || !html) return res.status(400).json({ error: 'Missing subject or html' });

  // Validate email addresses
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const email of to) {
    if (typeof email !== 'string' || !emailRegex.test(email)) {
      return res.status(400).json({ error: `Invalid email: ${email}` });
    }
  }

  const fromAddress = process.env.DIGEST_FROM_EMAIL || 'Stash Overview <digest@stashoverview.co.uk>';

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject,
      html,
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, id: data?.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to send email' });
  }
}
