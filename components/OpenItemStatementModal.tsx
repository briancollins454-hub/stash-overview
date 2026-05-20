import React, { useCallback, useMemo, useState } from 'react';
import {
  X, Copy, Check, Mail, FileText, AlertTriangle, ExternalLink,
} from 'lucide-react';
import {
  buildOpenItemStatement,
  buildStatementEmailTemplate,
  formatStatementText,
  invoicesForCustomer,
  mailtoLink,
  type OpenItemInvoice,
} from '../utils/openItemStatement';

export interface OpenItemStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  customerId: string;
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
  qbInvoices,
  defaultEmail = '',
  isDark,
  companyName,
  accountsEmail,
}) => {
  const [toEmail, setToEmail] = useState(defaultEmail);
  const [contactName, setContactName] = useState('');
  const [copied, setCopied] = useState<CopyTarget>(null);

  React.useEffect(() => {
    if (isOpen) {
      setToEmail(defaultEmail);
      setContactName('');
      setCopied(null);
    }
  }, [isOpen, defaultEmail, customerName]);

  const matchedInvoices = useMemo(
    () => invoicesForCustomer(qbInvoices, customerName, customerId),
    [qbInvoices, customerName, customerId],
  );

  const statement = useMemo(() => {
    if (!isOpen) return null;
    return buildOpenItemStatement(customerName, customerId, matchedInvoices);
  }, [isOpen, customerName, customerId, matchedInvoices]);

  const emailTemplate = useMemo(() => {
    if (!statement) return null;
    return buildStatementEmailTemplate(statement, toEmail, {
      companyName,
      accountsEmail,
      contactName,
    });
  }, [statement, toEmail, companyName, accountsEmail, contactName]);

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
      /* fallback ignored — user can select manually */
    }
  }, []);

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
              Built from QuickBooks open invoices · copy email or statement for accounts chase
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
                        <td className="p-2">{line.txnDate}</td>
                        <td className="p-2">{line.dueDate}</td>
                        <td className="p-2 text-right tabular-nums">{line.daysOutstanding}</td>
                        <td className="p-2 text-right font-bold tabular-nums text-red-600 dark:text-red-400">
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
                        £{statement.totalOutstanding.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {emailTemplate && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Email subject</span>
                    <button
                      type="button"
                      onClick={() => copyText(emailTemplate.subject, 'subject')}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-500"
                    >
                      {copied === 'subject' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      Copy subject
                    </button>
                  </div>
                  <p className={`text-sm font-medium px-3 py-2 rounded-lg border ${preBg}`}>{emailTemplate.subject}</p>
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Statement only</span>
                  <button
                    type="button"
                    onClick={() => copyText(statementText, 'statement')}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-500"
                  >
                    {copied === 'statement' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    Copy statement
                  </button>
                </div>
                <pre className={`text-[11px] leading-relaxed p-3 rounded-lg border overflow-x-auto whitespace-pre font-mono ${preBg}`}>
                  {statementText}
                </pre>
              </div>

              {emailTemplate && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Full email (paste into Outlook)</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(emailTemplate.body, 'email')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        {copied === 'email' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        Copy full email
                      </button>
                      {toEmail.includes('@') && (
                        <a
                          href={mailtoLink(emailTemplate.subject, emailTemplate.body, toEmail)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${isDark ? 'border-slate-600 hover:bg-slate-800' : 'border-gray-300 hover:bg-gray-50'}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open in mail app
                        </a>
                      )}
                    </div>
                  </div>
                  <pre className={`text-[11px] leading-relaxed p-3 rounded-lg border overflow-x-auto whitespace-pre-wrap max-h-48 ${preBg}`}>
                    {emailTemplate.body}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        <footer className={`px-5 py-3 border-t shrink-0 flex justify-end ${isDark ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'}`}>
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

export default OpenItemStatementModal;
