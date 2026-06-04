import type { InvoiceConfig } from '../utils/invoiceSettings';
import { defaultInvoiceConfig, normalizeInvoiceConfig } from '../utils/invoiceSettings';

function triggerPdfDownload(base64: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchInvoiceSettings(): Promise<InvoiceConfig> {
  try {
    const res = await fetch('/api/invoice-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-config' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) return normalizeInvoiceConfig(data.config);
  } catch {
    /* use defaults */
  }
  return defaultInvoiceConfig();
}

export async function saveInvoiceSettings(
  config: InvoiceConfig,
  updatedBy?: string,
): Promise<InvoiceConfig> {
  const res = await fetch('/api/invoice-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save-config', config, updatedBy }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Save failed (${res.status})`);
  }
  return normalizeInvoiceConfig(data.config);
}

/** Download Deco invoice; converts to EUR in-place when enabled in invoice settings. */
export async function downloadDecoInvoicePdf(
  orderId: string,
  options?: { forceGbp?: boolean },
): Promise<void> {
  const id = String(orderId).trim();
  if (!id) throw new Error('Order number required');
  const res = await fetch('/api/deco', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'invoice-pdf',
      orderId: id,
      forceGbp: options?.forceGbp === true,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || typeof data.base64 !== 'string') {
    throw new Error(data?.error || data?.details || `Download failed (${res.status})`);
  }
  const safe = id.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const suffix = data.currency === 'eur' ? '-EUR' : '';
  triggerPdfDownload(data.base64, `Deco-Invoice${suffix}-${safe}.pdf`);
}
