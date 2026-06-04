export interface InvoiceConfig {
  /** When true, Deco invoice PDFs are amended to EUR on download (same layout, not a second invoice). */
  eurInvoicesEnabled: boolean;
  /** Multiply GBP amounts by this to get EUR (e.g. 1.17). */
  gbpToEurRate: number;
  /** Shown on EUR PDF footer, e.g. "ECB reference 03 Jun 2026". */
  rateNote: string;
}

export function defaultInvoiceConfig(): InvoiceConfig {
  return {
    eurInvoicesEnabled: false,
    gbpToEurRate: 1.17,
    rateNote: '',
  };
}

export function normalizeInvoiceConfig(raw: unknown): InvoiceConfig {
  const base = defaultInvoiceConfig();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<InvoiceConfig>;
  const rate = Number(r.gbpToEurRate);
  return {
    eurInvoicesEnabled: Boolean(r.eurInvoicesEnabled),
    gbpToEurRate: Number.isFinite(rate) && rate > 0 ? rate : base.gbpToEurRate,
    rateNote: typeof r.rateNote === 'string' ? r.rateNote.trim() : base.rateNote,
  };
}
