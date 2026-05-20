import { formatPaymentInstructions } from './statement-branding';
import type { OpenItemStatement } from './statement-types';

const formatMoneyPlain = (v: number) =>
  v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface EmailTemplateOptions {
  companyName?: string;
  accountsEmail?: string;
  contactName?: string;
  pdfFilename?: string;
}

export function buildStatementEmailTemplate(
  statement: OpenItemStatement,
  toEmail: string,
  opts: EmailTemplateOptions = {},
): { subject: string; body: string; to: string } {
  const company = opts.companyName || 'Marx Corporate';
  const accounts = opts.accountsEmail || 'accounts@marxcorporate.com';
  const greeting = opts.contactName?.trim()
    ? `Dear ${opts.contactName.trim()},`
    : 'Dear Accounts Payable,';
  const pdfName = opts.pdfFilename || `Statement - ${statement.customerName}.pdf`;

  const intro =
    `Please find attached your account statement (${pdfName}) dated ${statement.asAtDateShort}. ` +
    `Total amount due: GBP ${formatMoneyPlain(statement.totalOutstanding)}.`;

  const body = [
    greeting,
    '',
    intro,
    '',
    'A PDF copy of the statement is attached to this email for your records.',
    '',
    formatPaymentInstructions(),
    '',
    'If you have already remitted payment for any of these items, please send remittance advice to ' +
      accounts +
      ' so we can allocate it promptly.',
    '',
    'Kind regards,',
    'Accounts',
    company,
  ].join('\n');

  const subject = `Statement ${statement.statementNumber} — ${statement.customerName} — ${statement.asAtDateShort}`;
  return { subject, body, to: toEmail.trim() };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>\n');
}

export function buildStatementEmailHtml(
  statement: OpenItemStatement,
  opts: EmailTemplateOptions = {},
): string {
  const plain = buildStatementEmailTemplate(statement, '', opts);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#333;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e5e5">
${nl2br(plain.body)}
</div>
</body>
</html>`;
}
