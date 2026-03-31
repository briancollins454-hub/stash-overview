import { ApiSettings } from '../components/SettingsModal';

export interface ShippingLabel {
  id: string;
  orderId: string;
  orderNumber: string;
  carrier: 'royal_mail' | 'dpd' | 'dhl' | 'hermes' | 'yodel' | 'other';
  service: string;
  trackingNumber: string;
  trackingUrl?: string;
  weight?: number;
  cost?: number;
  status: 'created' | 'printed' | 'dispatched';
  recipientName: string;
  recipientAddress: string;
  createdAt: number;
  printedAt?: number;
  dispatchedAt?: number;
}

const STORAGE_KEY = 'stash_shipping_labels';

export const CARRIER_LABELS: Record<ShippingLabel['carrier'], string> = {
  royal_mail: 'Royal Mail',
  dpd: 'DPD',
  dhl: 'DHL',
  hermes: 'Evri (Hermes)',
  yodel: 'Yodel',
  other: 'Other',
};

export const CARRIER_TRACKING_URLS: Record<string, (t: string) => string> = {
  royal_mail: (t) => `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(t)}`,
  dpd: (t) => `https://tracking.dpd.de/status/en_GB/parcel/${encodeURIComponent(t)}`,
  dhl: (t) => `https://www.dhl.com/gb-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(t)}`,
  hermes: (t) => `https://www.evri.com/track/parcel/${encodeURIComponent(t)}`,
  yodel: (t) => `https://www.yodel.co.uk/tracking/${encodeURIComponent(t)}`,
};

export function loadShippingLabels(): ShippingLabel[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function saveShippingLabels(labels: ShippingLabel[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}

export function addShippingLabel(label: Omit<ShippingLabel, 'id' | 'createdAt' | 'status'>): ShippingLabel[] {
  const labels = loadShippingLabels();
  labels.unshift({
    ...label,
    id: `ship-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'created',
    createdAt: Date.now(),
    trackingUrl: label.trackingUrl || CARRIER_TRACKING_URLS[label.carrier]?.(label.trackingNumber),
  });
  saveShippingLabels(labels);
  return labels;
}

export function updateShippingLabel(id: string, updates: Partial<ShippingLabel>): ShippingLabel[] {
  const labels = loadShippingLabels();
  const idx = labels.findIndex(l => l.id === id);
  if (idx >= 0) {
    labels[idx] = { ...labels[idx], ...updates };
    saveShippingLabels(labels);
  }
  return labels;
}

export function deleteShippingLabel(id: string): ShippingLabel[] {
  const labels = loadShippingLabels().filter(l => l.id !== id);
  saveShippingLabels(labels);
  return labels;
}

export function getLabelsForOrder(orderId: string): ShippingLabel[] {
  return loadShippingLabels().filter(l => l.orderId === orderId);
}
