import React, { useEffect, useState } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import type { InvoiceConfig } from '../utils/invoiceSettings';
import { defaultInvoiceConfig } from '../utils/invoiceSettings';
import { fetchInvoiceSettings, saveInvoiceSettings } from '../services/decoInvoiceDownload';

interface Props {
  isDark: boolean;
  onClose: () => void;
  onSaved?: (config: InvoiceConfig) => void;
  currentUserEmail?: string;
}

const InvoiceSettingsModal: React.FC<Props> = ({ isDark, onClose, onSaved, currentUserEmail }) => {
  const [config, setConfig] = useState<InvoiceConfig>(defaultInvoiceConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchInvoiceSettings();
        if (!cancelled) setConfig(c);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const card = isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900';
  const input = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-300 text-gray-900';

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveInvoiceSettings(config, currentUserEmail);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-2xl border shadow-xl ${card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-inherit">
          <h2 className="text-lg font-bold">Invoice downloads</h2>
          <button type="button" onClick={onClose} className="opacity-60 hover:opacity-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm opacity-70">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 accent-indigo-500"
                  checked={config.eurInvoicesEnabled}
                  onChange={(e) => setConfig((c) => ({ ...c, eurInvoicesEnabled: e.target.checked }))}
                />
                <span>
                  <span className="font-semibold block">Enable EUR invoice PDF</span>
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Shows “Download EUR” on Finance and Unpaid Orders. Off by default.
                  </span>
                </span>
              </label>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  GBP → EUR rate (multiply GBP amounts)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.01"
                  value={config.gbpToEurRate}
                  onChange={(e) => setConfig((c) => ({
                    ...c,
                    gbpToEurRate: parseFloat(e.target.value) || c.gbpToEurRate,
                  }))}
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ${input}`}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  Rate note (optional, on PDF footer)
                </label>
                <input
                  type="text"
                  value={config.rateNote}
                  onChange={(e) => setConfig((c) => ({ ...c, rateNote: e.target.value }))}
                  placeholder="e.g. ECB daily rate 3 Jun 2026"
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${input}`}
                />
              </div>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                “Download Deco PDF” is always available — original branded invoice from DecoNetwork (GBP).
              </p>
            </>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-inherit">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg opacity-70 hover:opacity-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceSettingsModal;
