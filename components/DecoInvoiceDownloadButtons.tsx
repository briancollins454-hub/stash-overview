import React, { useState } from 'react';
import { FileText, Loader2, Euro } from 'lucide-react';
import type { InvoiceConfig } from '../utils/invoiceSettings';
import { downloadDecoInvoicePdf, downloadDecoInvoiceEurPdf } from '../services/decoInvoiceDownload';

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
  const [loading, setLoading] = useState<'deco' | 'eur' | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  const run = async (kind: 'deco' | 'eur') => {
    setLoading(kind);
    setErr(null);
    try {
      if (kind === 'deco') await downloadDecoInvoicePdf(orderId);
      else await downloadDecoInvoiceEurPdf(orderId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          title="Download original DecoNetwork invoice (GBP PDF)"
          disabled={!!loading}
          onClick={() => run('deco')}
          className={btn}
        >
          {loading === 'deco' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          Deco PDF
        </button>
        {invoiceConfig.eurInvoicesEnabled && (
          <button
            type="button"
            title={`Download Stash EUR invoice (rate ${invoiceConfig.gbpToEurRate})`}
            disabled={!!loading}
            onClick={() => run('eur')}
            className={btn}
          >
            {loading === 'eur' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Euro className="w-3 h-3" />}
            EUR PDF
          </button>
        )}
      </div>
      {err && (
        <span className="text-[10px] text-red-500 max-w-[200px] leading-tight" title={err}>
          {err.slice(0, 80)}
        </span>
      )}
    </div>
  );
};

export default DecoInvoiceDownloadButtons;
