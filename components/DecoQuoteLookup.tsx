import React, { useState } from 'react';
import { FileText, Loader2, Search } from 'lucide-react';
import type { InvoiceConfig } from '../utils/invoiceSettings';
import { downloadDecoInvoicePdf } from '../services/decoInvoiceDownload';

interface Props {
  invoiceConfig: InvoiceConfig;
  isDark?: boolean;
}

/**
 * Download any Deco quote or invoice by its number — not just shipped orders.
 * Quotes never appear in the Unpaid Orders list (no ship date), so this gives a
 * direct way to pull one and convert it to EUR with the same in-place amend.
 */
const DecoQuoteLookup: React.FC<Props> = ({ invoiceConfig, isDark = true }) => {
  const [num, setNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const eurOn = invoiceConfig.eurInvoicesEnabled;

  const borderColor = isDark ? 'border-slate-600' : 'border-gray-300';
  const cardBg = isDark ? 'bg-slate-800/50' : 'bg-white';
  const textSecondary = isDark ? 'text-slate-300' : 'text-gray-700';

  const run = async (forceGbp: boolean) => {
    const id = num.trim();
    if (!id) {
      setErr('Enter a quote / order number');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await downloadDecoInvoicePdf(id, { forceGbp, filenamePrefix: 'Deco-Quote' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className={`flex items-center gap-1.5 rounded-lg border ${borderColor} ${cardBg} px-2 py-1`}>
        <Search className={`w-3.5 h-3.5 ${textSecondary} opacity-60`} />
        <input
          type="text"
          inputMode="numeric"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(false);
          }}
          placeholder="Quote # → EUR"
          aria-label="Deco quote or invoice number"
          className={`w-[110px] bg-transparent text-xs outline-none ${textSecondary} placeholder:opacity-50`}
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => run(false)}
          title={
            eurOn
              ? `Download Deco quote/invoice converted to EUR (rate ${invoiceConfig.gbpToEurRate})`
              : 'Download Deco quote/invoice (GBP)'
          }
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors disabled:opacity-40 ${
            isDark
              ? 'border-slate-600 text-slate-200 hover:bg-slate-700/50'
              : 'border-gray-300 text-gray-700 hover:bg-gray-100'
          }`}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          Get{eurOn ? ' (EUR)' : ''}
        </button>
        {eurOn && (
          <button
            type="button"
            disabled={loading}
            onClick={() => run(true)}
            title="Download original Deco PDF without EUR conversion"
            className={`text-[10px] underline opacity-70 hover:opacity-100 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}
          >
            GBP
          </button>
        )}
      </div>
      {err && (
        <span className="text-[10px] text-red-500 max-w-[220px] leading-tight" title={err}>
          {err.slice(0, 100)}
        </span>
      )}
    </div>
  );
};

export default DecoQuoteLookup;
