import { formatPaymentInstructions } from '../constants/statementBranding';

// ─── Open-item statement builder (QuickBooks AR → copy/paste + email) ─────
// QBO has no “create statement PDF” API; we assemble open invoices into a
// plain-text statement and a ready-to-paste email shell for accounts staff.

export interface OpenItemInvoice {
  id: string;
  docNumber: string | null;
  customerName: string;
  customerId: string;
  balance: number;
  totalAmount: number;
  dueDate: string | null;
  txnDate: string | null;
}

export interface AgingSummary {
  current: number;
  pastDue1_30: number;
  pastDue31_60: number;
  pastDue61_90: number;
  pastDue90Plus: number;
  total: number;
}

export interface OpenItemStatement {
  customerName: string;
  customerId: string;
  /** Long form for email, e.g. "20 May 2026" */
  asAtDate: string;
  /** DD/MM/YYYY for PDF header */
  asAtDateShort: string;
  statementNumber: string;
  customerAddressLines: string[];
  lines: OpenItemLine[];
  totalOutstanding: number;
  aging: AgingSummary;
}

export interface OpenItemLine {
  invoiceId: string;
  docNumber: string;
  /** DD/MM/YYYY — transaction / invoice date column */
  txnDateShort: string;
  dueDateShort: string;
  /** e.g. "Invoice No.218412: Due 06/04/2024." */
  description: string;
  daysPastDue: number;
  amountDue: number;
}

const formatMoney = (v: number) =>
  '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatMoneyPlain = (v: number) =>
  v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatDateGb(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** DD/MM/YYYY as on QBO printed statements */
export function formatDateSlash(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Days past due date (negative = not yet due → “current”) */
export function daysPastDue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const today = new Date();
  if (Number.isNaN(due.getTime())) return 0;
  due.setHours(12, 0, 0, 0);
  today.setHours(12, 0, 0, 0);
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}

export type AgingBucketKey = 'current' | 'pastDue1_30' | 'pastDue31_60' | 'pastDue61_90' | 'pastDue90Plus';

export function agingBucketForDueDate(dueDate: string | null): AgingBucketKey {
  const dpd = daysPastDue(dueDate);
  if (dpd <= 0) return 'current';
  if (dpd <= 30) return 'pastDue1_30';
  if (dpd <= 60) return 'pastDue31_60';
  if (dpd <= 90) return 'pastDue61_90';
  return 'pastDue90Plus';
}

export function buildAgingSummary(
  invoices: OpenItemInvoice[],
): AgingSummary {
  const summary: AgingSummary = {
    current: 0,
    pastDue1_30: 0,
    pastDue31_60: 0,
    pastDue61_90: 0,
    pastDue90Plus: 0,
    total: 0,
  };
  for (const inv of invoices) {
    if (inv.balance <= 0.005) continue;
    const bucket = agingBucketForDueDate(inv.dueDate);
    summary[bucket] += inv.balance;
    summary.total += inv.balance;
  }
  return summary;
}

/** QBO-style statement number (e.g. customer Id 527 → 1527). */
export function statementNumberFor(customerId: string): string {
  const idNum = parseInt(String(customerId).replace(/\D/g, ''), 10);
  if (!Number.isFinite(idNum) || idNum <= 0) return '1000';
  return String(1000 + (idNum % 8999));
}

export function invoiceDescription(docNumber: string, dueDateIso: string | null): string {
  const due = formatDateSlash(dueDateIso);
  return `Invoice No.${docNumber}: Due ${due}.`;
}

/** Match QB invoices to a Deco/finance customer display name. */
export function invoicesForCustomer(
  invoices: OpenItemInvoice[],
  customerName: string,
  customerId?: string,
): OpenItemInvoice[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = norm(customerName);
  return invoices.filter(inv => {
    if (customerId && inv.customerId === customerId) return true;
    return norm(inv.customerName) === target;
  });
}

export function buildOpenItemStatement(
  customerName: string,
  customerId: string,
  invoices: OpenItemInvoice[],
  asAt: Date = new Date(),
  customerAddressLines: string[] = [],
): OpenItemStatement | null {
  const open = invoices
    .filter(inv => inv.balance > 0.005)
    .sort((a, b) => {
      const da = a.txnDate || a.dueDate || '';
      const db = b.txnDate || b.dueDate || '';
      return da.localeCompare(db);
    });

  if (open.length === 0) return null;

  const lines: OpenItemLine[] = open.map(inv => {
    const docNumber = inv.docNumber || inv.id;
    return {
      invoiceId: inv.id,
      docNumber,
      txnDateShort: formatDateSlash(inv.txnDate),
      dueDateShort: formatDateSlash(inv.dueDate),
      description: invoiceDescription(docNumber, inv.dueDate),
      daysPastDue: daysPastDue(inv.dueDate),
      amountDue: inv.balance,
    };
  });

  const totalOutstanding = lines.reduce((s, l) => s + l.amountDue, 0);
  const norm = (s: string) => s.trim().toLowerCase();
  const rawAddr = customerAddressLines.length > 0 ? customerAddressLines : [customerName];
  const addrOnly = rawAddr.filter(l => norm(l) !== norm(customerName));
  const address = [customerName, customerName, ...addrOnly];

  return {
    customerName,
    customerId,
    asAtDate: asAt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
    asAtDateShort: (() => {
      const d = asAt;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    })(),
    statementNumber: statementNumberFor(customerId),
    customerAddressLines: address,
    lines,
    totalOutstanding,
    aging: buildAgingSummary(open),
  };
}

/** Plain-text statement for copy or email body. */
export function formatStatementText(
  statement: OpenItemStatement,
  companyName = 'Marx Corporate',
): string {
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
  const header = [
    'OPEN ITEM STATEMENT',
    `${companyName}`,
    '',
    `Customer: ${statement.customerName}`,
    `Statement no. ${statement.statementNumber} · ${statement.asAtDateShort}`,
    '',
    pad('Date', 12) + pad('Description', 36) + 'Amount',
    '-'.repeat(62),
  ];

  const rows = statement.lines.map(l =>
    pad(l.txnDateShort, 12) + pad(l.description, 36) + formatMoneyPlain(l.amountDue),
  );

  return [
    ...header,
    ...rows,
    '-'.repeat(62),
    pad('TOTAL DUE GBP', 48) + formatMoneyPlain(statement.totalOutstanding),
  ].join('\n');
}

export interface EmailTemplateOptions {
  companyName?: string;
  accountsEmail?: string;
  contactName?: string;
  customIntro?: string;
  attachPdf?: boolean;
  pdfFilename?: string;
}

/** Subject + body for Outlook / Gmail paste. */
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

  const attachPdf = opts.attachPdf !== false;
  const pdfName = opts.pdfFilename || `Statement - ${statement.customerName}.pdf`;

  const intro =
    opts.customIntro?.trim() ||
    (attachPdf
      ? `Please find attached your account statement (${pdfName}) dated ${statement.asAtDateShort}. Total amount due: GBP ${formatMoneyPlain(statement.totalOutstanding)}.`
      : `Please find below your account statement dated ${statement.asAtDateShort}. Total amount due: GBP ${formatMoneyPlain(statement.totalOutstanding)}.`);

  const bodyParts = [greeting, '', intro, ''];

  if (!attachPdf) {
    const statementBlock = formatStatementText(statement, company);
    bodyParts.push('---', statementBlock, '---', '');
  } else {
    bodyParts.push(
      'A PDF copy of the statement is attached to this email for your records.',
      '',
    );
  }

  bodyParts.push(formatPaymentInstructions(), '');

  bodyParts.push(
    'If you have already remitted payment for any of these items, please send remittance advice to ' +
      accounts +
      ' so we can allocate it promptly.',
    '',
    'Kind regards,',
    'Accounts',
    company,
  );

  const body = bodyParts.join('\n');

  const subject = `Statement ${statement.statementNumber} — ${statement.customerName} — ${statement.asAtDateShort}`;

  return { subject, body, to: toEmail.trim() };
}

export function mailtoLink(subject: string, body: string, to: string): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const q = params.toString();
  const addr = encodeURIComponent(to);
  return `mailto:${addr}${q ? `?${q}` : ''}`;
}
