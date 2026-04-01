import React, { useMemo } from 'react';
import { UnifiedOrder } from '../types';
import { CreditCard, AlertTriangle, CheckCircle2, Clock, XCircle, RefreshCw } from 'lucide-react';

interface Props {
  orders: UnifiedOrder[];
  onNavigateToOrder?: (orderNumber: string) => void;
}

interface SyncRow {
  orderNumber: string;
  customerName: string;
  shopifyPayment: string;
  decoPayment: string;
  shopifyTotal: string;
  decoTotal: number | null;
  totalDiff: number | null;
  isMismatch: boolean;
  severity: 'ok' | 'warning' | 'error';
  date: string;
}

const PaymentStatusSync: React.FC<Props> = ({ orders, onNavigateToOrder }) => {
  const { rows, summary, hasData } = useMemo(() => {
    const all: SyncRow[] = [];

    for (const o of orders) {
      if (!o.deco) continue;

      const shopifyPayment = o.shopify.paymentStatus;
      const decoPayment = o.deco.paymentStatus || 'unknown';
      const shopifyTotal = parseFloat(o.shopify.totalPrice) || 0;
      const decoTotal = o.deco.orderTotal ?? null;

      // Normalize for comparison
      const shopNorm = shopifyPayment.toLowerCase();
      const decoNorm = decoPayment.toLowerCase();

      let isMismatch = false;
      let severity: SyncRow['severity'] = 'ok';

      // Check payment status mismatch
      if (decoNorm !== 'unknown') {
        const shopPaid = shopNorm === 'paid';
        const decoPaid = decoNorm === 'paid' || decoNorm === 'complete' || decoNorm === 'completed';
        if (shopPaid !== decoPaid) {
          isMismatch = true;
          severity = 'error';
        }
      }

      // Check total mismatch
      let totalDiff: number | null = null;
      if (decoTotal !== null && shopifyTotal > 0) {
        totalDiff = shopifyTotal - decoTotal;
        if (Math.abs(totalDiff) > 1.0) {
          isMismatch = true;
          if (severity !== 'error') severity = 'warning';
        }
      }

      all.push({
        orderNumber: o.shopify.orderNumber,
        customerName: o.shopify.customerName,
        shopifyPayment: shopifyPayment,
        decoPayment,
        shopifyTotal: o.shopify.totalPrice,
        decoTotal,
        totalDiff,
        isMismatch,
        severity,
        date: o.shopify.date,
      });
    }

    // Sort mismatches first
    all.sort((a, b) => {
      const sevOrder = { error: 0, warning: 1, ok: 2 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });

    const mismatches = all.filter(r => r.isMismatch).length;
    const decoDataAvailable = all.filter(r => r.decoPayment !== 'unknown').length;
    const totalMismatch = all.filter(r => r.totalDiff !== null && Math.abs(r.totalDiff) > 1.0).length;
    const paymentMismatch = all.filter(r => r.severity === 'error').length;

    return {
      rows: all,
      summary: { total: all.length, mismatches, decoDataAvailable, totalMismatch, paymentMismatch },
      hasData: decoDataAvailable > 0 || all.some(r => r.decoTotal !== null)
    };
  }, [orders]);

  const fmt = (n: number) => `£${n.toFixed(2)}`;

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'paid' || s === 'complete' || s === 'completed')
      return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" />{status}</span>;
    if (s === 'pending' || s === 'awaiting' || s === 'partial')
      return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"><Clock className="w-3 h-3" />{status}</span>;
    if (s === 'refunded')
      return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"><RefreshCw className="w-3 h-3" />{status}</span>;
    if (s === 'unknown')
      return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{status}</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{status}</span>;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Payment Status Sync</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Shopify ↔ DecoNetwork payment reconciliation</p>
            </div>
          </div>
          {summary.mismatches > 0 && (
            <span className="flex items-center gap-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-1.5 rounded-full font-medium">
              <AlertTriangle className="w-4 h-4" /> {summary.mismatches} mismatch{summary.mismatches !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
      </div>

      {!hasData ? (
        <div className="p-12 text-center">
          <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No payment sync data available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Payment sync appears when DecoNetwork orders include payment status or totals</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">{summary.total}</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400">Linked Orders</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{summary.decoDataAvailable}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">With Deco Status</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${summary.paymentMismatch > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <p className={`text-2xl font-bold ${summary.paymentMismatch > 0 ? 'text-red-900 dark:text-red-100' : 'text-emerald-900 dark:text-emerald-100'}`}>{summary.paymentMismatch}</p>
              <p className={`text-xs ${summary.paymentMismatch > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Status Mismatches</p>
            </div>
            <div className={`rounded-xl p-4 text-center ${summary.totalMismatch > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <p className={`text-2xl font-bold ${summary.totalMismatch > 0 ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100'}`}>{summary.totalMismatch}</p>
              <p className={`text-xs ${summary.totalMismatch > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Total Mismatches</p>
            </div>
          </div>

          {/* Table */}
          <div className="px-6 pb-6">
            <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs font-medium text-gray-500 uppercase">
                <span>Order</span><span>Shopify</span><span>Deco</span><span>Shopify £</span><span>Deco £</span><span>Diff</span>
              </div>
              {rows.filter(r => r.isMismatch || r.decoPayment !== 'unknown').slice(0, 50).map(row => (
                <div key={row.orderNumber} className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-3 items-center border-t dark:border-gray-700 text-sm
                  ${row.severity === 'error' ? 'bg-red-50/50 dark:bg-red-900/10' : row.severity === 'warning' ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                  <div>
                    <button onClick={() => onNavigateToOrder?.(row.orderNumber)}
                      className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline text-sm">#{row.orderNumber}</button>
                    <span className="text-xs text-gray-400 ml-2">{row.customerName}</span>
                  </div>
                  {getStatusBadge(row.shopifyPayment)}
                  {getStatusBadge(row.decoPayment)}
                  <span className="text-xs font-mono text-gray-600 dark:text-gray-300">{fmt(parseFloat(row.shopifyTotal))}</span>
                  <span className="text-xs font-mono text-gray-600 dark:text-gray-300">{row.decoTotal !== null ? fmt(row.decoTotal) : '—'}</span>
                  <span className={`text-xs font-mono font-semibold ${row.totalDiff === null ? 'text-gray-400' : Math.abs(row.totalDiff) <= 1 ? 'text-emerald-600' : row.totalDiff > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {row.totalDiff !== null ? `${row.totalDiff > 0 ? '+' : ''}${fmt(row.totalDiff)}` : '—'}
                  </span>
                </div>
              ))}
              {rows.filter(r => r.isMismatch || r.decoPayment !== 'unknown').length === 0 && (
                <div className="p-6 text-center text-sm text-gray-400">All payments in sync</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PaymentStatusSync;
