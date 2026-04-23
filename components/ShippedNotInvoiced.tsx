import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package, Search, ArrowUpDown, AlertTriangle, ExternalLink, Download,
  RefreshCw, Check, Eye, EyeOff, Copy, Undo2, Printer, UserRound, ChevronDown,
} from 'lucide-react';
import { DecoJob } from '../types';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';
import { ApiSettings } from './SettingsModal';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  settings: ApiSettings;
  onNavigateToOrder?: (orderNumber: string) => void;
  currentUserEmail?: string;
}

type SortKey = 'jobNumber' | 'customerName' | 'outstandingBalance' | 'dateShipped' | 'daysSinceShipped' | 'paymentRequestSentAt' | 'salesPerson';
type SortDir = 'asc' | 'desc';

// Sentinel value used in the responsible-person dropdown to represent jobs
// with no salesperson attached. Non-printable so it can never clash with a
// real name.
const UNASSIGNED = '\u0000__UNASSIGNED__';

interface PaymentRequestRow {
  job_number: string;
  sent_at: string;
  sent_by: string | null;
}

// ─── Click-to-copy badge ────────────────────────────────────────────────────
// Mirrors the pattern used in PriorityBoard so the UX feels consistent: click
// the job number and it flashes "Copied" for ~1.2s while the value lands on
// the clipboard. Falls back to execCommand for older / non-HTTPS browsers so
// we don't silently fail.
const CopyableJobNum: React.FC<{ jobNumber: string; onNavigate?: () => void }> = ({ jobNumber, onNavigate }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jobNumber);
      } else {
        const ta = document.createElement('textarea');
        ta.value = jobNumber;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* silently ignore — clipboard denied */ }
  };
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Click to copy job number'}
        className={`font-mono font-medium text-xs flex items-center gap-1 transition-colors ${copied ? 'text-emerald-400' : 'text-indigo-400 hover:text-indigo-300'}`}
      >
        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> {jobNumber}</>}
      </button>
      {onNavigate && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
          title="Go to order"
          className="text-slate-500 hover:text-indigo-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

const ShippedNotInvoiced: React.FC<Props> = ({ decoJobs, isDark, settings, onNavigateToOrder, currentUserEmail }) => {
  const [search, setSearch] = useState('');
  // Default to newest ship date first — staff asked for this because the
  // previous default (daysSinceShipped desc) buries freshly-shipped jobs
  // under old ones.
  const [sortKey, setSortKey] = useState<SortKey>('dateShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);

  // Payment-request audit state: map jobNumber → {sent_at, sent_by}. Only
  // sent jobs are in the map; absence means "not sent". Loaded once from
  // Supabase on mount and kept locally in sync with every tick/untick.
  const [paymentSent, setPaymentSent] = useState<Record<string, PaymentRequestRow>>({});
  const [showSent, setShowSent] = useState(false);
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);

  // Responsible-person filter. '' means "show all". Selecting a specific
  // name narrows the table (and the PDF export) to that staff member so
  // they can print just their own shipped-but-not-invoiced orders.
  const [responsibleFilter, setResponsibleFilter] = useState<string>('');

  // Load from the FinancialDashboard's Supabase cache (finance_jobs) —
  // keeps us decoupled from the Finance tab's sync cycle.
  const loadFromFinanceCache = useCallback(async () => {
    if (!isSupabaseReady()) { setNoCache(true); return; }
    setIsLoading(true);
    try {
      const res = await supabaseFetch(
        'stash_finance_cache?id=eq.finance_jobs&select=data,last_synced', 'GET'
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data) && rows[0].data.length > 0) {
        setAllJobs(rows[0].data);
        setLastSynced(rows[0].last_synced);
        setNoCache(false);
      } else {
        setNoCache(true);
      }
    } catch {
      setNoCache(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadPaymentSent = useCallback(async () => {
    if (!isSupabaseReady()) return;
    try {
      const res = await supabaseFetch(
        'stash_payment_requests_sent?select=job_number,sent_at,sent_by', 'GET'
      );
      const rows: PaymentRequestRow[] = await res.json();
      if (!Array.isArray(rows)) return;
      const map: Record<string, PaymentRequestRow> = {};
      for (const r of rows) map[r.job_number] = r;
      setPaymentSent(map);
    } catch {
      // Non-fatal — checkbox column just defaults to "not sent".
    }
  }, []);

  useEffect(() => {
    loadFromFinanceCache();
    loadPaymentSent();
  }, [loadFromFinanceCache, loadPaymentSent]);

  const markSent = useCallback(async (jobNumber: string, customerName: string) => {
    if (!isSupabaseReady() || isTogglingId) return;

    // Guardrail — staff specifically asked for a confirm step so a stray
    // click can't silently mark a job as "payment request sent" when no
    // email has actually gone out.
    const ok = window.confirm(
      `Mark payment request as SENT for job #${jobNumber} (${customerName})?\n\n` +
      `This will hide it from the list and record your email + a timestamp. ` +
      `You can undo it from the "Showing sent" view if needed.`
    );
    if (!ok) return;

    setIsTogglingId(jobNumber);

    // Optimistic update so the row can fade out immediately; we roll back if
    // the Supabase write fails.
    const now = new Date().toISOString();
    const optimistic: PaymentRequestRow = { job_number: jobNumber, sent_at: now, sent_by: currentUserEmail || null };
    setPaymentSent(prev => ({ ...prev, [jobNumber]: optimistic }));

    try {
      await supabaseFetch(
        'stash_payment_requests_sent',
        'POST',
        { job_number: jobNumber, sent_at: now, sent_by: currentUserEmail || null, updated_at: now },
        'resolution=merge-duplicates'
      );
    } catch (e) {
      // Roll back — silent alert, row reappears.
      setPaymentSent(prev => {
        const next = { ...prev };
        delete next[jobNumber];
        return next;
      });
      console.error('Failed to mark payment request sent', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [currentUserEmail, isTogglingId]);

  const unmarkSent = useCallback(async (jobNumber: string) => {
    if (!isSupabaseReady() || isTogglingId) return;
    setIsTogglingId(jobNumber);

    // Snapshot so we can restore on error.
    const prevRow = paymentSent[jobNumber];
    setPaymentSent(prev => {
      const next = { ...prev };
      delete next[jobNumber];
      return next;
    });

    try {
      await supabaseFetch(
        `stash_payment_requests_sent?job_number=eq.${encodeURIComponent(jobNumber)}`,
        'DELETE'
      );
    } catch (e) {
      if (prevRow) setPaymentSent(prev => ({ ...prev, [jobNumber]: prevRow }));
      console.error('Failed to unmark payment request', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [paymentSent, isTogglingId]);

  const jobs = useMemo(() => {
    return allJobs.filter(j => {
      const bal = typeof j.outstandingBalance === 'string' ? parseFloat(j.outstandingBalance) : (j.outstandingBalance || 0);
      return !!j.dateShipped && bal > 0 && j.status !== 'Cancelled';
    }).map(j => {
      const outstanding = typeof j.outstandingBalance === 'string'
        ? parseFloat(j.outstandingBalance as any)
        : (j.outstandingBalance || 0);
      const sentRow = paymentSent[j.jobNumber];
      return {
        ...j,
        outstandingBalance: outstanding,
        daysSinceShipped: j.dateShipped
          ? Math.floor((Date.now() - new Date(j.dateShipped).getTime()) / 86400000)
          : 0,
        paymentRequestSentAt: sentRow?.sent_at || null,
        paymentRequestSentBy: sentRow?.sent_by || null,
      };
    });
  }, [allJobs, paymentSent]);

  // Unique salespeople across the currently-searched (but pre-responsible-filtered)
  // rows. Computing this from the post-search list keeps the dropdown
  // contextual — if staff search for a customer, the dropdown only shows
  // the people attached to those jobs.
  const salesPeople = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;
    if (!showSent) list = list.filter(j => !j.paymentRequestSentAt);
    if (q) {
      list = list.filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.poNumber?.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.jobName.toLowerCase().includes(q)
      );
    }
    const set = new Set<string>();
    let hasUnassigned = false;
    for (const j of list) {
      const sp = (j.salesPerson || '').trim();
      if (sp) set.add(sp); else hasUnassigned = true;
    }
    return { names: Array.from(set).sort((a, b) => a.localeCompare(b)), hasUnassigned };
  }, [jobs, search, showSent]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;

    // Hide rows that have had their payment request sent unless the user has
    // explicitly asked to see the archive. Keeping this as a boolean toggle
    // (rather than a separate tab) keeps the layout simple and means the
    // headline "total outstanding" naturally reflects what's still pending.
    if (!showSent) {
      list = list.filter(j => !j.paymentRequestSentAt);
    }

    if (q) {
      list = list.filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.poNumber?.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.jobName.toLowerCase().includes(q)
      );
    }

    if (responsibleFilter) {
      list = list.filter(j => {
        const sp = (j.salesPerson || '').trim();
        if (responsibleFilter === UNASSIGNED) return !sp;
        return sp === responsibleFilter;
      });
    }

    list = [...list].sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'jobNumber': av = a.jobNumber; bv = b.jobNumber; break;
        case 'customerName': av = a.customerName; bv = b.customerName; break;
        case 'outstandingBalance': av = a.outstandingBalance || 0; bv = b.outstandingBalance || 0; break;
        case 'dateShipped': av = a.dateShipped || ''; bv = b.dateShipped || ''; break;
        case 'daysSinceShipped': av = a.daysSinceShipped; bv = b.daysSinceShipped; break;
        case 'paymentRequestSentAt': av = a.paymentRequestSentAt || ''; bv = b.paymentRequestSentAt || ''; break;
        case 'salesPerson': av = (a.salesPerson || '').toLowerCase(); bv = (b.salesPerson || '').toLowerCase(); break;
        default: av = 0; bv = 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [jobs, search, sortKey, sortDir, showSent, responsibleFilter]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, j) => s + (j.outstandingBalance || 0), 0), [filtered]);
  const sentCount = useMemo(() => Object.keys(paymentSent).length, [paymentSent]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fmt = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (d?: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const exportCsv = () => {
    const header = ['Job Number', 'PO Number', 'Customer', 'Job Name', 'Responsible', 'Outstanding', 'Date Shipped', 'Days Since Shipped', 'Payment Request Sent', 'Sent At', 'Sent By'];
    const rows = filtered.map(j => [
      j.jobNumber,
      j.poNumber || '',
      j.customerName,
      j.jobName,
      j.salesPerson || '',
      (j.outstandingBalance || 0).toFixed(2),
      j.dateShipped || '',
      j.daysSinceShipped.toString(),
      j.paymentRequestSentAt ? 'Yes' : 'No',
      j.paymentRequestSentAt || '',
      j.paymentRequestSentBy || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipped-not-invoiced-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Invoice-chase PDF ─────────────────────────────────────────────
  // Opens a print-ready HTML document in a new window so the responsible
  // staff member can print a paper sheet of their own jobs that shipped
  // without an invoice — the goal is to prompt them to raise and send
  // the invoice. Scopes to whatever's currently on screen (respecting
  // search + responsible + showSent filters).
  const printChaseList = () => {
    if (filtered.length === 0) return;

    const esc = (s: unknown) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const whoLabel = responsibleFilter
      ? (responsibleFilter === UNASSIGNED ? 'Unassigned jobs' : responsibleFilter)
      : 'All staff';

    const fmtMoney = (n: number) =>
      '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const fmtDay = (d?: string | null) => {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    };

    const totalOut = filtered.reduce((s, r) => s + (r.outstandingBalance || 0), 0);
    const overdueCount = filtered.filter(r => r.daysSinceShipped > 14).length;

    const rowsHtml = filtered.map(j => {
      const overdue = j.daysSinceShipped > 14;
      const dueSoon = !overdue && j.daysSinceShipped > 7;
      const dayClass = overdue ? 'days-overdue' : dueSoon ? 'days-soon' : '';
      const sentBadge = j.paymentRequestSentAt
        ? `<span class="sent-badge">Sent ${esc(fmtDay(j.paymentRequestSentAt))}</span>`
        : '';
      return `
        <tr>
          <td class="job-num">${esc(j.jobNumber)}</td>
          <td>${esc(j.poNumber || '—')}</td>
          <td>${esc(j.customerName)}</td>
          <td class="job-name">${esc(j.jobName || '—')}</td>
          <td>${esc(j.salesPerson || '—')}</td>
          <td class="num owed">${esc(fmtMoney(j.outstandingBalance || 0))}</td>
          <td>${esc(fmtDay(j.dateShipped))}</td>
          <td class="num ${dayClass}">${j.daysSinceShipped}d</td>
          <td class="status-col">${sentBadge}</td>
          <td class="notes-col"></td>
        </tr>
      `;
    }).join('');

    const styles = `
      * { box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; margin: 24px; background: #fff; }
      h1 { margin: 0 0 4px 0; font-size: 22px; }
      .brand { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #6366f1; font-weight: 700; margin-bottom: 6px; }
      .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid #e5e7eb; }
      .meta { text-align: right; font-size: 12px; color: #4b5563; line-height: 1.5; }
      .meta strong { color: #111827; }
      .summary { display: flex; gap: 12px; margin-bottom: 20px; }
      .tile { flex: 1; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; }
      .tile-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; }
      .tile-value { font-size: 18px; font-weight: 700; color: #111827; margin-top: 2px; }
      .tile-value.amber { color: #d97706; }
      .tile-value.rose { color: #e11d48; }
      .section-banner { padding: 8px 12px; font-size: 13px; background: #fef3c7; color: #92400e; border-left: 4px solid #d97706; border-radius: 4px 4px 0 0; display: flex; justify-content: space-between; align-items: center; }
      .section-banner strong { font-size: 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #f3f4f6; text-align: left; padding: 6px 8px; border-bottom: 2px solid #d1d5db; font-weight: 600; color: #374151; }
      td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.job-num { font-family: 'SF Mono', Menlo, monospace; font-weight: 600; color: #4f46e5; white-space: nowrap; }
      td.job-name { max-width: 180px; }
      td.owed { color: #d97706; font-weight: 700; }
      td.days-overdue { color: #dc2626; font-weight: 700; }
      td.days-soon { color: #d97706; font-weight: 600; }
      td.status-col { white-space: nowrap; }
      td.notes-col { width: 160px; }
      .sent-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; background: #d1fae5; color: #065f46; font-size: 10px; font-weight: 600; }
      .actions { background: #eef2ff; border: 1px solid #c7d2fe; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
      .actions button { background: #4f46e5; color: #fff; border: 0; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }
      .print-footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #6b7280; text-align: center; }
      @media print {
        body { margin: 12mm; }
        .no-print { display: none !important; }
        thead { display: table-header-group; }
      }
    `;

    const bodyHtml = `
      <div class="actions no-print">
        <span>Invoice-to-send list — use your browser's print dialog to save as PDF or send to the printer.</span>
        <button onclick="window.print()">Print / Save as PDF</button>
      </div>

      <div class="report-header">
        <div>
          <div class="brand">Stash · Invoice-to-send</div>
          <h1>Shipped Not Invoiced — Chase List</h1>
          <div style="font-size:13px;color:#4b5563;margin-top:4px;">Responsible: <strong style="color:#111827;">${esc(whoLabel)}</strong></div>
        </div>
        <div class="meta">
          <strong>${esc(dateStr)}</strong><br>
          Generated ${esc(timeStr)}<br>
          ${filtered.length} ${filtered.length === 1 ? 'order' : 'orders'} need${filtered.length === 1 ? 's' : ''} an invoice
        </div>
      </div>

      <div class="summary">
        <div class="tile">
          <div class="tile-label">Orders to invoice</div>
          <div class="tile-value">${filtered.length}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Total outstanding</div>
          <div class="tile-value amber">${esc(fmtMoney(totalOut))}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Shipped &gt; 14 days ago</div>
          <div class="tile-value rose">${overdueCount}</div>
        </div>
      </div>

      <div class="section-banner">
        <strong>Shipped without an invoice</strong>
        <span>Raise &amp; email the invoice, then tick "Mark sent" in the app</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Job #</th>
            <th>PO</th>
            <th>Customer</th>
            <th>Job Name</th>
            <th>Responsible</th>
            <th class="num">Outstanding</th>
            <th>Shipped</th>
            <th class="num">Days Ago</th>
            <th>Payment Req.</th>
            <th class="notes-col">Notes / Action taken</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="print-footer">
        Stash Shipped-Not-Invoiced · Chase list for ${esc(whoLabel)} · ${esc(dateStr)} ${esc(timeStr)} · Raise the invoice, email it to the customer, then mark the job as sent in Stash.
      </div>
    `;

    const win = window.open('', '_blank');
    if (!win) {
      alert('Please allow pop-ups for this site to generate the invoice chase list PDF.');
      return;
    }
    const scopeTag = responsibleFilter
      ? (responsibleFilter === UNASSIGNED ? 'unassigned' : responsibleFilter.replace(/\s+/g, '_'))
      : 'all-staff';
    const title = `Shipped Not Invoiced — ${scopeTag} — ${dateStr}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${styles}</style></head><body>${bodyHtml}</body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* user can click the button */ } }, 300);
  };

  const cardBg = isDark ? 'bg-[#232347]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-indigo-300' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const hoverRow = isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Package className="w-5 h-5 text-amber-500" />
            Shipped Not Invoiced
          </h2>
          <p className={`text-sm ${textSecondary} mt-0.5`}>
            {isLoading ? 'Loading from cache...' : noCache
              ? 'No data yet — run a Full Sync from the Finance tab first'
              : lastSynced
                ? `Data from Finance sync: ${new Date(lastSynced).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : 'Jobs shipped with outstanding balance but no invoice sent'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadFromFinanceCache} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} ${cardBg} text-xs font-medium ${textSecondary} ${isLoading ? 'opacity-50' : 'hover:bg-white/10'} transition-colors`} title="Reload from Finance cache">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Total Outstanding</span>
            <p className="text-lg font-bold text-amber-500">{fmt(totalOutstanding)}</p>
          </div>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Jobs</span>
            <p className={`text-lg font-bold ${textPrimary}`}>{filtered.length}</p>
          </div>
        </div>
      </div>

      {/* Search + Responsible filter + toggles + Exports */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
          <input
            type="text"
            placeholder="Search by job number, customer, PO..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 rounded-lg border ${borderColor} ${cardBg} ${textPrimary} text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none`}
          />
        </div>

        <div className="relative">
          <UserRound className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary} pointer-events-none`} />
          <select
            value={responsibleFilter}
            onChange={e => setResponsibleFilter(e.target.value)}
            className={`pl-9 pr-8 py-2 rounded-lg border ${borderColor} ${cardBg} ${textPrimary} text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none`}
            title="Filter by the staff member responsible for each job"
          >
            <option value="">Responsible: All staff</option>
            {salesPeople.names.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
            {salesPeople.hasUnassigned && (
              <option value={UNASSIGNED}>— Unassigned —</option>
            )}
          </select>
          <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary} pointer-events-none`} />
        </div>

        <button
          onClick={() => setShowSent(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} text-xs font-medium transition-colors ${showSent
            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            : `${cardBg} ${textSecondary} hover:bg-white/10`}`}
          title={showSent ? 'Hide jobs where payment request has been sent' : 'Include jobs where payment request has been sent'}
        >
          {showSent ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showSent ? `Showing sent (${sentCount})` : `Hiding ${sentCount} sent`}
        </button>

        <button
          onClick={printChaseList}
          disabled={filtered.length === 0}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            filtered.length === 0
              ? 'bg-slate-500/40 text-white/60 cursor-not-allowed'
              : 'bg-amber-600 text-white hover:bg-amber-700'
          }`}
          title={responsibleFilter
            ? `Print an invoice chase list for ${responsibleFilter === UNASSIGNED ? 'unassigned jobs' : responsibleFilter}`
            : 'Print an invoice chase list for the currently shown jobs'}
        >
          <Printer className="w-3.5 h-3.5" /> Chase list PDF
        </button>

        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>

        {responsibleFilter && (
          <button
            onClick={() => setResponsibleFilter('')}
            className={`text-xs ${textSecondary} hover:underline`}
            title="Clear responsible filter"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Table */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package className={`w-12 h-12 ${textSecondary} opacity-40 mb-3`} />
            <p className={`text-sm font-medium ${textSecondary}`}>
              {search
                ? 'No results matching your search'
                : noCache
                  ? 'Run a Full Sync from the Finance tab to populate this report'
                  : sentCount > 0 && !showSent
                    ? 'All caught up — all shipped jobs have had payment requests sent'
                    : 'No shipped jobs awaiting invoicing'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${borderColor} ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  {([
                    ['jobNumber', 'Job #'],
                    ['customerName', 'Customer'],
                    ['', 'Job Name'],
                    ['salesPerson', 'Responsible'],
                    ['outstandingBalance', 'Outstanding'],
                    ['dateShipped', 'Shipped'],
                    ['daysSinceShipped', 'Days Ago'],
                    ['paymentRequestSentAt', 'Payment Req.'],
                  ] as [SortKey | '', string][]).map(([key, label]) => (
                    <th
                      key={label}
                      onClick={key ? () => toggleSort(key as SortKey) : undefined}
                      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${textSecondary} ${key ? 'cursor-pointer select-none hover:text-indigo-400' : ''}`}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {key && sortKey === key && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(j => {
                  const sent = !!j.paymentRequestSentAt;
                  const toggling = isTogglingId === j.jobNumber;
                  return (
                    <tr
                      key={j.jobNumber}
                      className={`border-b ${borderColor} ${hoverRow} transition-colors ${sent ? 'opacity-60' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <CopyableJobNum
                          jobNumber={j.jobNumber}
                          onNavigate={onNavigateToOrder ? () => onNavigateToOrder(j.poNumber || j.jobNumber) : undefined}
                        />
                      </td>
                      <td className={`px-4 py-3 font-medium ${textPrimary}`}>{j.customerName}</td>
                      <td className={`px-4 py-3 ${textSecondary} max-w-[200px] truncate`}>{j.jobName}</td>
                      <td className={`px-4 py-3 ${textSecondary} whitespace-nowrap`}>
                        {j.salesPerson ? (
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="w-3 h-3" />
                            {j.salesPerson}
                          </span>
                        ) : (
                          <span className="italic opacity-60">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold text-amber-500">{fmt(j.outstandingBalance || 0)}</td>
                      <td className={`px-4 py-3 ${textSecondary}`}>{fmtDate(j.dateShipped)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          j.daysSinceShipped > 14
                            ? 'bg-red-500/20 text-red-400'
                            : j.daysSinceShipped > 7
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-green-500/20 text-green-400'
                        }`}>
                          {j.daysSinceShipped > 14 && <AlertTriangle className="w-3 h-3" />}
                          {j.daysSinceShipped}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {sent ? (
                          // When sent, show the timestamp + who, plus a small
                          // undo so accidental ticks can be reverted without
                          // a page round-trip.
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                              <Check className="w-3 h-3" />
                              Sent {fmtDateTime(j.paymentRequestSentAt)}
                            </span>
                            <button
                              onClick={() => unmarkSent(j.jobNumber)}
                              disabled={toggling}
                              title={`Undo — sent by ${j.paymentRequestSentBy || 'unknown'}`}
                              className="text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-40"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => markSent(j.jobNumber, j.customerName)}
                            disabled={toggling}
                            title="Mark payment request as sent"
                            className={`flex items-center gap-1.5 px-2 py-1 rounded border ${borderColor} text-xs font-medium ${textSecondary} hover:bg-indigo-500/20 hover:text-indigo-300 hover:border-indigo-500/40 transition-colors disabled:opacity-40`}
                          >
                            <div className="w-3.5 h-3.5 rounded-sm border border-current flex items-center justify-center">
                              {toggling && <Check className="w-2.5 h-2.5" />}
                            </div>
                            Mark sent
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShippedNotInvoiced;
