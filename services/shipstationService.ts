import type { ApiSettings } from '../components/SettingsModal';

export interface ShipStationShipment {
  shipmentId: number;
  orderId: number;
  orderNumber: string;
  customerEmail: string;
  shipDate: string;
  trackingNumber: string;
  carrierCode: string;
  serviceCode: string;
  shipmentCost: number;
  voidDate: string | null;
  voided: boolean;
}

export interface ShipStationTracking {
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  shipDate: string;
  cost: number;
}

const CARRIER_NAMES: Record<string, string> = {
  royal_mail: 'Royal Mail',
  royalmail: 'Royal Mail',
  dpd: 'DPD',
  dhl_express: 'DHL',
  dhl_express_uk: 'DHL',
  dhl: 'DHL',
  hermes_uk: 'Evri',
  evri: 'Evri',
  yodel: 'Yodel',
  fedex: 'FedEx',
  ups: 'UPS',
  stamps_com: 'USPS',
  other: 'Other',
};

const CARRIER_TRACKING_URLS: Record<string, string> = {
  'Royal Mail': 'https://www.royalmail.com/track-your-item#/tracking-results/',
  'DPD': 'https://tracking.dpd.de/parcelstatus?locale=en_GB&query=',
  'DHL': 'https://www.dhl.com/gb-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=',
  'Evri': 'https://www.evri.com/track/parcel/',
  'Yodel': 'https://www.yodel.co.uk/tracking/',
  'FedEx': 'https://www.fedex.com/fedextrack/?trknbr=',
  'UPS': 'https://www.ups.com/track?tracknum=',
};

export const getCarrierName = (code: string): string => {
  return CARRIER_NAMES[code?.toLowerCase()] || code || 'Unknown';
};

export const getTrackingUrl = (carrier: string, trackingNumber: string): string | null => {
  const url = CARRIER_TRACKING_URLS[carrier];
  if (!url || !trackingNumber) return null;
  return `${url}${encodeURIComponent(trackingNumber)}`;
};

export const fetchShipStationShipments = async (settings: ApiSettings): Promise<ShipStationTracking[]> => {
  // Build auth from client settings if available (server will use env vars as primary)
  const auth = settings.shipStationApiKey && settings.shipStationApiSecret
    ? btoa(`${settings.shipStationApiKey}:${settings.shipStationApiSecret}`)
    : undefined;
  
  // Fetch recent shipments (last N days matching sync lookback)
  const lookbackDays = settings.syncLookbackDays || 90;
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString().split('T')[0];

  let allShipments: ShipStationShipment[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 10) { // Safety limit
    const url = `https://ssapi.shipstation.com/shipments?shipDateStart=${sinceStr}&pageSize=500&page=${page}&sortBy=ShipDate&sortDir=DESC`;
    
    const response = await fetch('/api/shipstation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, auth }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `ShipStation API error: ${response.status}`);
    }

    const data = await response.json();
    const shipments: ShipStationShipment[] = data.shipments || [];
    allShipments = [...allShipments, ...shipments];

    if (shipments.length < 500 || allShipments.length >= (data.total || 0)) {
      hasMore = false;
    } else {
      page++;
    }
  }

  // Map to tracking records, keyed by order number, deduplicated
  const trackingMap = new Map<string, ShipStationTracking>();
  
  for (const s of allShipments) {
    if (s.voided || !s.trackingNumber || !s.orderNumber) continue;
    
    const carrier = getCarrierName(s.carrierCode);
    
    // Keep the most recent shipment per order number
    const existing = trackingMap.get(s.orderNumber);
    if (!existing || new Date(s.shipDate) > new Date(existing.shipDate)) {
      trackingMap.set(s.orderNumber, {
        orderNumber: s.orderNumber,
        trackingNumber: s.trackingNumber,
        carrier,
        shipDate: s.shipDate,
        cost: s.shipmentCost || 0,
      });
    }
  }

  return Array.from(trackingMap.values());
};
