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

export interface OpenItemStatement {
  customerName: string;
  customerId: string;
  asAtDate: string;
  lines: OpenItemLine[];
  totalOutstanding: number;
}

export interface OpenItemLine {
  invoiceId: string;
  docNumber: string;
  txnDate: string;
  dueDate: string;
  daysOutstanding: number;
  amountDue: number;
}

const formatMoney = (v: number) =>
  '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatDateGb = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function daysOutstanding(dueDate: string | null, txnDate: string | null): number {
  const anchor = dueDate || txnDate;
  if (!anchor) return 0;
  const d = new Date(anchor);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
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
): OpenItemStatement | null {
  const open = invoices
    .filter(inv => inv.balance > 0.005)
    .sort((a, b) => {
      const da = a.dueDate || a.txnDate || '';
      const db = b.dueDate || b.txnDate || '';
      return da.localeCompare(db);
    });

  if (open.length === 0) return null;

  const lines: OpenItemLine[] = open.map(inv => ({
    invoiceId: inv.id,
    docNumber: inv.docNumber || inv.id,
    txnDate: formatDateGb(inv.txnDate),
    dueDate: formatDateGb(inv.dueDate),
    daysOutstanding: daysOutstanding(inv.dueDate, inv.txnDate),
    amountDue: inv.balance,
  }));

  const totalOutstanding = lines.reduce((s, l) => s + l.amountDue, 0);

  return {
    customerName,
    customerId,
    asAtDate: asAt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
    lines,
    totalOutstanding,
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
    `As at: ${statement.asAtDate}`,
    '',
    pad('Invoice', 14) + pad('Invoice date', 14) + pad('Due date', 14) + pad('Days', 6) + 'Amount due',
    '-'.repeat(62),
  ];

  const rows = statement.lines.map(l =>
    pad(l.docNumber, 14) +
    pad(l.txnDate, 14) +
    pad(l.dueDate, 14) +
    pad(String(l.daysOutstanding), 6) +
    formatMoney(l.amountDue),
  );

  return [
    ...header,
    ...rows,
    '-'.repeat(62),
    pad('TOTAL OUTSTANDING', 48) + formatMoney(statement.totalOutstanding),
  ].join('\n');
}

export interface EmailTemplateOptions {
  companyName?: string;
  accountsEmail?: string;
  contactName?: string;
  customIntro?: string;
  /** When true, email body refers to an attached PDF instead of inlining the statement. */
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
      ? `Please find attached your open-item statement (${pdfName}) as at ${statement.asAtDate}. The total amount outstanding is ${formatMoney(statement.totalOutstanding)}.`
      : `Please find below your open-item statement as at ${statement.asAtDate}. The total amount outstanding is ${formatMoney(statement.totalOutstanding)}.`);

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

  const subject = `Account statement — ${statement.customerName} — ${statement.asAtDate}`;

  return { subject, body, to: toEmail.trim() };
}

/** `mailto:` link when the user wants to open their mail client. */
export function mailtoLink(subject: string, body: string, to: string): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const q = params.toString();
  const addr = encodeURIComponent(to);
  return `mailto:${addr}${q ? `?${q}` : ''}`;
}
