import React, { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import type { InvoiceConfig } from '../utils/invoiceSettings';
import { downloadDecoInvoicePdf } from '../services/decoInvoiceDownload';

interface Props {
  orderId: string;
  invoiceConfig: InvoiceConfig;
  isDark?: boolean;
  compact?: boolean;
}

const DecoInvoiceDownloadButtons: React.FC<Props> = ({
  orderId,
  invoiceConfig,
  isDark = true,
  compact = true,
}) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const eurOn = invoiceConfig.eurInvoicesEnabled;

  const btn = compact
    ? `inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium transition-colors disabled:opacity-40 ${
      isDark
        ? 'border-slate-600 text-slate-300 hover:bg-slate-700/50'
        : 'border-gray-300 text-gray-700 hover:bg-gray-100'
    }`
    : `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${
      isDark
        ? 'border-slate-600 text-slate-300 hover:bg-slate-700/50'
        : 'border-gray-300 text-gray-700 hover:bg-gray-100'
    }`;

  const link = `text-[10px] underline opacity-70 hover:opacity-100 ${isDark ? 'text-slate-400' : 'text-gray-500'}`;

  const run = async (forceGbp: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      await downloadDecoInvoicePdf(orderId, { forceGbp });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title={
            eurOn
              ? `Download Deco invoice with amounts converted to EUR (rate ${invoiceConfig.gbpToEurRate})`
              : 'Download Deco invoice (GBP)'
          }
          disabled={loading}
          onClick={() => run(false)}
          className={btn}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          Invoice{eurOn ? ' (EUR)' : ''}
        </button>
        {eurOn && (
          <button
            type="button"
            title="Download original Deco PDF without EUR conversion"
            disabled={loading}
            onClick={() => run(true)}
            className={link}
          >
            GBP original
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

export default DecoInvoiceDownloadButtons;
