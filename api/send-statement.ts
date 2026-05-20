import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import {
  buildStatementEmailHtml,
  buildStatementEmailTemplate,
  type OpenItemStatement,
} from '../utils/openItemStatement';
import {
  generateOpenItemStatementPdfBase64,
  statementPdfFilename,
} from '../utils/openItemStatementPdf';

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

function isOpenItemStatement(v: unknown): v is OpenItemStatement {
  if (!v || typeof v !== 'object') return false;
  const s = v as OpenItemStatement;
  return (
    typeof s.customerName === 'string'
    && Array.isArray(s.lines)
    && typeof s.totalOutstanding === 'number'
    && s.customer
    && typeof s.customer.displayName === 'string'
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const body = (req.body || {}) as Record<string, unknown>;
  const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  const statement = body.statement;
  const contactName = typeof body.contactName === 'string' ? body.contactName : '';
  const companyName = typeof body.companyName === 'string' ? body.companyName : undefined;
  const accountsEmail = typeof body.accountsEmail === 'string' ? body.accountsEmail : undefined;

  if (!to || !EMAIL_RE.test(to)) {
    return res.status(400).json({ error: 'Valid recipient email required' });
  }
  if (!isOpenItemStatement(statement)) {
    return res.status(400).json({ error: 'Invalid statement payload' });
  }

  const emailOpts = { companyName, accountsEmail, contactName, attachPdf: true as const };
  const template = buildStatementEmailTemplate(statement, to, emailOpts);
  const html = buildStatementEmailHtml(statement, emailOpts);
  const filename = statementPdfFilename(statement.customerName)
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_');

  try {
    const { base64 } = await generateOpenItemStatementPdfBase64(statement, {
      companyName,
      accountsEmail,
    });
    if (!base64) {
      return res.status(500).json({ error: 'Failed to generate statement PDF' });
    }

    const fromAddress = process.env.STATEMENT_FROM_EMAIL
      || process.env.DIGEST_FROM_EMAIL
      || 'Marx Accounts <accounts@marxcorporate.com>';

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject: template.subject,
      html,
      text: template.body,
      ...(accountsEmail && EMAIL_RE.test(accountsEmail) ? { replyTo: accountsEmail } : {}),
      attachments: [{ filename, content: base64 }],
    });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, id: data?.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send statement';
    return res.status(500).json({ error: message });
  }
}
