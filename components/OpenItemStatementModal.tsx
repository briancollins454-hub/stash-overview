import React, { useCallback, useMemo, useState } from 'react';
import {
  X, Copy, Check, Mail, FileText, AlertTriangle, ExternalLink, Download, Loader2,
} from 'lucide-react';
import {
  buildOpenItemStatement,
  buildStatementEmailTemplate,
  formatStatementText,
  invoicesForCustomer,
  mailtoLink,
  qbCustomerIdFromInvoices,
  qboCustomerToStatementInfo,
  customerHasPhysicalAddress,
  type OpenItemInvoice,
  type StatementCustomerInfo,
} from '../utils/openItemStatement';
import {
  downloadOpenItemStatementPdf,
  statementPdfFilename,
} from '../utils/openItemStatementPdf';

export interface OpenItemStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  customerId: string;
  customerInfo?: StatementCustomerInfo;
  qbInvoices: OpenItemInvoice[];
  defaultEmail?: string;
  isDark: boolean;
  companyName?: string;
  accountsEmail?: string;
}

type CopyTarget = 'email' | 'statement' | 'subject' | null;

export const OpenItemStatementModal: React.FC<OpenItemStatementModalProps> = ({
  isOpen,
  onClose,
  customerName,
  customerId,
  customerInfo,
  qbInvoices,
  defaultEmail = '',
  isDark,
  companyName,
  accountsEmail,
}) => {
  const [toEmail, setToEmail] = useState(defaultEmail);
  const [contactName, setContactName] = useState('');
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [resolvedCustomer, setResolvedCustomer] = useState<StatementCustomerInfo | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerFetchError, setCustomerFetchError] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setToEmail(defaultEmail);
      setContactName('');
      setCopied(null);
      setPdfBusy(false);
      setPdfError(null);
      setShowTextFallback(false);
      setResolvedCustomer(null);
      setCustomerFetchError(null);
    }
  }, [isOpen, defaultEmail, customerName]);

  const matchedInvoices = useMemo(
    () => invoicesForCustomer(qbInvoices, customerName, customerId),
    [qbInvoices, customerName, customerId],
  );

  const qbIdForFetch = useMemo(() => {
    const fromMatchedRow = matchedInvoices.find(i => /^\d+$/.test(String(i.customerId || '')));
    if (fromMatchedRow?.customerId) return fromMatchedRow.customerId;
    const fromInvoices = qbCustomerIdFromInvoices(matchedInvoices, customerName)
      || qbCustomerIdFromInvoices(qbInvoices, customerName);
    if (fromInvoices && /^\d+$/.test(fromInvoices)) return fromInvoices;
    if (customerId && /^\d+$/.test(customerId)) return customerId;
    return null;
  }, [matchedInvoices, qbInvoices, customerName, customerId]);

  React.useEffect(() => {
    if (!isOpen) return;

    if (!qbIdForFetch) {
      setResolvedCustomer(customerInfo ?? null);
      setCustomerLoading(false);
      return;
    }

    let cancelled = false;
    setCustomerLoading(true);
    setCustomerFetchError(null);

    fetch('/api/quickbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'customer-by-id', customerId: qbIdForFetch }),
    })
      .then(async res => {
        const text = await res.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(text.slice(0, 120) || `Lookup failed (${res.status})`);
        }
        if (!res.ok) throw new Error(String(data.error || `Lookup failed (${res.status})`));
        return data;
      })
      .then(data => {
        if (cancelled) return;
        if (data.ok && data.customer) {
          const info = qboCustomerToStatementInfo(data.customer, customerName);
          setResolvedCustomer({
            ...info,
            email: info.email || customerInfo?.email || defaultEmail || null,
          });
        } else {
          setResolvedCustomer(customerInfo ?? null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCustomerFetchError(e instanceof Error ? e.message : 'Could not load customer from QuickBooks');
        setResolvedCustomer(customerInfo ?? null);
      })
      .finally(() => {
        if (!cancelled) setCustomerLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, qbIdForFetch, customerName, customerInfo, defaultEmail]);

  const effectiveCustomer = resolvedCustomer ?? customerInfo ?? null;

  const billToLines = useMemo(() => {
    if (!effectiveCustomer) return [];
    return effectiveCustomer.addressLines.filter(l => l.trim());
  }, [effectiveCustomer]);

  const hasStreetAddress = useMemo(() => {
    if (!effectiveCustomer) return false;
    const company = billToLines.find(
      (l, i) => i > 0 && l !== effectiveCustomer.displayName,
    );
    return customerHasPhysicalAddress(
      billToLines,
      effectiveCustomer.displayName,
      company ?? null,
    );
  }, [billToLines, effectiveCustomer]);

  const statement = useMemo(() => {
    if (!isOpen) return null;
    return buildOpenItemStatement(
      customerName,
      qbIdForFetch || customerId,
      matchedInvoices,
      new Date(),
      effectiveCustomer ?? undefined,
    );
  }, [isOpen, customerName, customerId, qbIdForFetch, matchedInvoices, effectiveCustomer]);

  const pdfFilename = useMemo(
    () => (statement ? statementPdfFilename(statement.customerName) : ''),
    [statement],
  );

  const emailTemplate = useMemo(() => {
    if (!statement) return null;
    return buildStatementEmailTemplate(statement, toEmail, {
      companyName,
      accountsEmail,
      contactName,
      attachPdf: true,
      pdfFilename,
    });
  }, [statement, toEmail, companyName, accountsEmail, contactName, pdfFilename]);

  const statementText = useMemo(
    () => (statement ? formatStatementText(statement, companyName) : ''),
    [statement, companyName],
  );

  const copyText = useCallback(async (text: string, target: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* user can select manually */
    }
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (!statement) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      await downloadOpenItemStatementPdf(statement, {
        companyName,
        accountsEmail,
      });
    } catch (e: unknown) {
      setPdfError(e instanceof Error ? e.message : 'Failed to generate PDF');
    } finally {
      setPdfBusy(false);
    }
  }, [statement, companyName, accountsEmail]);

  if (!isOpen) return null;

  const card = isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900';
  const inputCls = isDark
    ? 'bg-slate-800 border-slate-600 text-white placeholder:text-gray-500'
    : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400';
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const preBg = isDark ? 'bg-slate-950 border-slate-700' : 'bg-gray-50 border-gray-200';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border shadow-2xl flex flex-col ${card}`}>
        <header className={`flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Open item statement</p>
            <h2 className="text-lg font-black">{customerName}</h2>
            <p className={`text-xs mt-0.5 ${muted}`}>
              Download a PDF from QuickBooks open invoices, then attach it when you email the customer
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-lg ${isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!statement ? (
            <div className={`flex items-start gap-3 p-4 rounded-xl border ${isDark ? 'bg-amber-900/20 border-amber-800 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold">No open QuickBooks invoices for this customer</p>
                <p className={`text-xs mt-1 ${muted}`}>
                  {matchedInvoices.length === 0
                    ? 'Name may not match QBO — check the customer exists in QuickBooks with the same display name, or refresh QB data.'
                    : 'All matched invoices are fully paid in QuickBooks.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Primary action: PDF */}
              <div className={`rounded-xl border p-4 ${isDark ? 'border-indigo-800 bg-indigo-950/40' : 'border-indigo-200 bg-indigo-50/80'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-indigo-700 dark:text-indigo-300">
                      {formatMoneyDisplay(statement.totalOutstanding)} outstanding
                    </p>
                    <p className={`text-xs mt-1 ${muted}`}>
                      {statement.lines.length} open invoice{statement.lines.length === 1 ? '' : 's'} · {pdfFilename}
                    </p>
                    {customerLoading && (
                      <p className={`text-xs mt-2 flex items-center gap-1.5 ${muted}`}>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading billing address from QuickBooks…
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={pdfBusy}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 shadow-md"
                  >
                    {pdfBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Download PDF
                  </button>
                </div>
                {pdfError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-2">{pdfError}</p>
                )}
                <p className={`text-[11px] mt-3 leading-relaxed ${muted}`}>
                  In Outlook: compose email → attach the downloaded PDF → paste the email text below (Copy email).
                </p>
              </div>

              {/* Bill to — address for PDF TO block */}
              <div className={`rounded-xl border p-4 space-y-2 ${isDark ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest">Bill to (on PDF)</span>
                  {qbIdForFetch ? (
                    <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">
                      QBO #{qbIdForFetch}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      QBO not linked — sync QB &amp; check customer name
                    </span>
                  )}
                </div>
                {customerLoading && (
                  <p className={`text-xs flex items-center gap-1.5 ${muted}`}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading from QuickBooks…
                  </p>
                )}
                {!customerLoading && billToLines.length > 0 && (
                  <div className={`text-sm leading-relaxed whitespace-pre-line ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>
                    {billToLines.join('\n')}
                    {effectiveCustomer?.email ? `\n${effectiveCustomer.email}` : ''}
                    {effectiveCustomer?.phone ? `\n${effectiveCustomer.phone}` : ''}
                  </div>
                )}
                {!customerLoading && !hasStreetAddress && qbIdForFetch && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Could not load a street address from QuickBooks for QBO #{qbIdForFetch}. Check Billing address on that customer (or on their open invoices), then sync again.
                  </p>
                )}
                {!customerLoading && !qbIdForFetch && matchedInvoices.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Invoices matched by name but no QBO customer id — refresh QuickBooks data on Finance.
                  </p>
                )}
                {customerFetchError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{customerFetchError}</p>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className={`block text-[10px] font-black uppercase tracking-widest mb-1 ${muted}`}>
                    To (customer email)
                  </span>
                  <input
                    type="email"
                    value={toEmail}
                    onChange={e => setToEmail(e.target.value)}
                    placeholder="accounts@customer.co.uk"
                    className={`w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-indigo-500 outline-none ${inputCls}`}
                  />
                </label>
                <label className="block">
                  <span className={`block text-[10px] font-black uppercase tracking-widest mb-1 ${muted}`}>
                    Greeting name (optional)
                  </span>
                  <input
                    type="text"
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder="e.g. Sarah"
                    className={`w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-indigo-500 outline-none ${inputCls}`}
                  />
                </label>
              </div>

              {/* Preview table */}
              <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                <table className="w-full text-xs">
                  <thead className={isDark ? 'bg-slate-800' : 'bg-gray-100'}>
                    <tr>
                      <th className="text-left p-2 font-black uppercase tracking-widest text-[9px]">Invoice</th>
                      <th className="text-left p-2 font-black uppercase tracking-widest text-[9px]">Date</th>
                      <th className="text-left p-2 font-black uppercase tracking-widest text-[9px]">Due</th>
                      <th className="text-right p-2 font-black uppercase tracking-widest text-[9px]">Days</th>
                      <th className="text-right p-2 font-black uppercase tracking-widest text-[9px]">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map(line => (
                      <tr key={line.invoiceId} className={`border-t ${isDark ? 'border-slate-700/50' : 'border-gray-100'}`}>
                        <td className="p-2 font-mono font-bold">{line.docNumber}</td>
                        <td className="p-2 tabular-nums">{line.txnDateShort}</td>
                        <td className={`p-2 tabular-nums ${line.isOverdue ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}>
                          {line.dueDateShort}
                        </td>
                        <td className={`p-2 text-right tabular-nums ${line.isOverdue ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}>
                          {line.daysPastDue > 0 ? line.daysPastDue : '—'}
                        </td>
                        <td className="p-2 text-right font-bold tabular-nums">
                          £{line.amountDue.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className={isDark ? 'bg-slate-800' : 'bg-indigo-50'}>
                    <tr>
                      <td colSpan={4} className="p-2 text-right font-black uppercase text-[10px] tracking-widest">
                        Total outstanding
                      </td>
                      <td className="p-2 text-right font-black text-red-600 dark:text-red-400">
                        {formatMoneyDisplay(statement.totalOutstanding)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Email for attach workflow */}
              {emailTemplate && (
                <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-indigo-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Email to send with PDF</span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${muted}`}>Subject</span>
                      <button
                        type="button"
                        onClick={() => copyText(emailTemplate.subject, 'subject')}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-500"
                      >
                        {copied === 'subject' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <p className={`text-sm font-medium px-3 py-2 rounded-lg border ${preBg}`}>{emailTemplate.subject}</p>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${muted}`}>Message body</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyText(emailTemplate.body, 'email')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          {copied === 'email' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          Copy email
                        </button>
                        {toEmail.includes('@') && (
                          <a
                            href={mailtoLink(emailTemplate.subject, emailTemplate.body, toEmail)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${isDark ? 'border-slate-600 hover:bg-slate-800' : 'border-gray-300 hover:bg-gray-50'}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Mail app
                          </a>
                        )}
                      </div>
                    </div>
                    <pre className={`text-[11px] leading-relaxed p-3 rounded-lg border overflow-x-auto whitespace-pre-wrap max-h-36 ${preBg}`}>
                      {emailTemplate.body}
                    </pre>
                  </div>
                </div>
              )}

              {/* Collapsible plain-text fallback */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowTextFallback(v => !v)}
                  className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${muted} hover:text-indigo-600`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {showTextFallback ? 'Hide' : 'Show'} plain-text fallback (no PDF)
                </button>
                {showTextFallback && (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => copyText(statementText, 'statement')}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600"
                    >
                      {copied === 'statement' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      Copy statement text
                    </button>
                    <pre className={`text-[11px] leading-relaxed p-3 rounded-lg border overflow-x-auto whitespace-pre font-mono max-h-32 ${preBg}`}>
                      {statementText}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className={`px-5 py-3 border-t shrink-0 flex justify-end gap-2 ${isDark ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'}`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest ${isDark ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};

function formatMoneyDisplay(v: number): string {
  return '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default OpenItemStatementModal;
