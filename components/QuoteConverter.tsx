import React, { useEffect, useState } from 'react';
import { FileText, Loader2, Search, Settings2, AlertTriangle, Euro } from 'lucide-react';
import type { InvoiceConfig } from '../utils/invoiceSettings';
import { defaultInvoiceConfig } from '../utils/invoiceSettings';
import { fetchInvoiceSettings, downloadDecoInvoicePdf } from '../services/decoInvoiceDownload';
import InvoiceSettingsModal from './InvoiceSettingsModal';

interface Props {
  isDark?: boolean;
  currentUserEmail?: string;
}

/**
 * Quotes — pull any DecoNetwork quote (or order) by its number and download it,
 * converting all £ / GBP amounts to EUR in place when EUR mode is enabled in
 * invoice settings. Quotes never reach Unpaid Orders (no ship date), so this is
 * their dedicated home. The conversion reuses the same in-place PDF amend used
 * for invoices, so Deco's branding and layout are untouched.
 */
const QuoteConverter: React.FC<Props> = ({ isDark = true, currentUserEmail }) => {
  const [invoiceConfig, setInvoiceConfig] = useState<InvoiceConfig>(defaultInvoiceConfig());
  const [num, setNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastDownloaded, setLastDownloaded] = useState<string | null>(null);
  const [showInvoiceSettings, setShowInvoiceSettings] = useState(false);

  useEffect(() => {
    fetchInvoiceSettings().then(setInvoiceConfig).catch(() => {});
  }, []);

  const eurOn = invoiceConfig.eurInvoicesEnabled;
  const borderColor = isDark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = isDark ? 'bg-slate-800/50' : 'bg-white';
  const textPrimary = isDark ? 'text-slate-100' : 'text-gray-900';
  const textSecondary = isDark ? 'text-slate-300' : 'text-gray-600';
  const textMuted = isDark ? 'text-slate-400' : 'text-gray-500';

  const run = async (forceGbp: boolean) => {
    const id = num.trim();
    if (!id) {
      setErr('Enter a quote / order number');
      return;
    }
    setLoading(true);
    setErr(null);
    setLastDownloaded(null);
    try {
      await downloadDecoInvoicePdf(id, { forceGbp, filenamePrefix: 'Deco-Quote' });
      setLastDownloaded(
        `Quote #${id} downloaded${!forceGbp && eurOn ? ' (converted to EUR)' : ' (GBP original)'}.`,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${textPrimary} flex items-center gap-2`}>
            <Euro className="w-6 h-6 text-emerald-500" />
            Quotes
          </h1>
          <p className={`text-sm mt-1 ${textSecondary} max-w-xl`}>
            Download any DecoNetwork quote (or order) by its number.
            {eurOn
              ? ` Amounts are converted to EUR at 1 GBP = ${invoiceConfig.gbpToEurRate} EUR, keeping Deco's branding and layout.`
              : ' EUR conversion is currently off — quotes download as the original GBP PDF.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInvoiceSettings(true)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} ${cardBg} text-xs font-medium ${textSecondary} hover:bg-white/10 transition-colors`}
          title="Deco invoice/quote EUR conversion toggle and exchange rate"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Invoice settings
          {eurOn && <span className="text-[10px] text-emerald-500 font-bold">EUR on</span>}
        </button>
      </div>

      <div className={`rounded-xl border ${borderColor} ${cardBg} p-6 space-y-4`}>
        <label className={`block text-xs font-semibold uppercase tracking-widest ${textMuted}`}>
          Quote / order number
        </label>
        <div className={`flex items-center gap-2 rounded-lg border ${borderColor} px-3 py-2 ${isDark ? 'bg-slate-900/50' : 'bg-gray-50'}`}>
          <Search className={`w-4 h-4 ${textMuted}`} />
          <input
            type="text"
            inputMode="numeric"
            value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(false);
            }}
            placeholder="e.g. 225199"
            aria-label="Deco quote or order number"
            className={`flex-1 bg-transparent text-base outline-none ${textPrimary} placeholder:opacity-40`}
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={loading}
            onClick={() => run(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Download{eurOn ? ' (EUR)' : ''}
          </button>
          {eurOn && (
            <button
              type="button"
              disabled={loading}
              onClick={() => run(true)}
              title="Download the original Deco PDF without EUR conversion"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} text-xs font-medium ${textSecondary} hover:bg-white/10 transition-colors disabled:opacity-50`}
            >
              <FileText className="w-3.5 h-3.5" />
              GBP original
            </button>
          )}
        </div>

        {err && (
          <p className="text-xs text-rose-500 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{err}</span>
          </p>
        )}
        {lastDownloaded && !err && (
          <p className="text-xs text-emerald-500 font-medium">{lastDownloaded}</p>
        )}
      </div>

      <div className={`text-xs ${textMuted} leading-relaxed`}>
        Pulls the same branded PDF Deco generates for the quote. When EUR mode is on, every £ / GBP
        figure is overwritten in place with its € equivalent and a conversion note is added to the
        footer. The GBP original is always available via the link above. Change the rate or toggle EUR
        in <span className="font-semibold">Invoice settings</span>.
      </div>

      {showInvoiceSettings && (
        <InvoiceSettingsModal
          isDark={isDark}
          onClose={() => setShowInvoiceSettings(false)}
          onSaved={setInvoiceConfig}
          currentUserEmail={currentUserEmail}
        />
      )}
    </div>
  );
};

export default QuoteConverter;
