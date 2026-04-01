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

// ── ShipStation Order Lookup ──

export interface ShipStationOrder {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  shipTo: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
  carrierCode?: string;
  serviceCode?: string;
  weight?: { value: number; units: string };
  dimensions?: { length: number; width: number; height: number; units: string };
}

export interface ShipStationLabelResult {
  shipmentId: number;
  trackingNumber: string;
  labelData: string; // base64 PDF
  shipmentCost: number;
}

/** Look up a ShipStation order by Shopify order number */
export const fetchShipStationOrder = async (
  settings: ApiSettings,
  orderNumber: string
): Promise<ShipStationOrder | null> => {
  const auth = settings.shipStationApiKey && settings.shipStationApiSecret
    ? btoa(`${settings.shipStationApiKey}:${settings.shipStationApiSecret}`)
    : undefined;

  const url = `https://ssapi.shipstation.com/orders?orderNumber=${encodeURIComponent(orderNumber)}&pageSize=50`;

  const response = await fetch('/api/shipstation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, auth }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const orders: ShipStationOrder[] = data.orders || [];
  // Find awaiting_shipment first, fallback to any match
  return orders.find(o => o.orderStatus === 'awaiting_shipment') || orders[0] || null;
};

/** Create a label for a ShipStation order (creates shipment + marks shipped) */
export const createShipStationLabel = async (
  settings: ApiSettings,
  ssOrderId: number,
  carrierCode: string,
  serviceCode: string,
  weight: { value: number; units: string },
  dimensions?: { length: number; width: number; height: number; units: string }
): Promise<ShipStationLabelResult> => {
  const auth = settings.shipStationApiKey && settings.shipStationApiSecret
    ? btoa(`${settings.shipStationApiKey}:${settings.shipStationApiSecret}`)
    : undefined;

  const url = 'https://ssapi.shipstation.com/orders/createlabel';

  const body: any = {
    orderId: ssOrderId,
    carrierCode,
    serviceCode,
    confirmation: 'none',
    shipDate: new Date().toISOString().split('T')[0],
    weight,
    testLabel: false,
  };

  if (dimensions) {
    body.dimensions = dimensions;
  }

  const response = await fetch('/api/shipstation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, auth, method: 'POST', body }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.ExceptionMessage || err.Message || err.error || `Label creation failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    shipmentId: data.shipmentId,
    trackingNumber: data.trackingNumber,
    labelData: data.labelData,
    shipmentCost: data.shipmentCost,
  };
};

/** Fetch available carriers for the ShipStation account */
export const fetchShipStationCarriers = async (
  settings: ApiSettings
): Promise<Array<{ code: string; name: string; services: Array<{ code: string; name: string }> }>> => {
  const auth = settings.shipStationApiKey && settings.shipStationApiSecret
    ? btoa(`${settings.shipStationApiKey}:${settings.shipStationApiSecret}`)
    : undefined;

  const response = await fetch('/api/shipstation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://ssapi.shipstation.com/carriers', auth }),
  });

  if (!response.ok) return [];

  const carriers = await response.json();
  // Fetch services for each carrier in parallel
  const carriersWithServices = await Promise.all(
    carriers.map(async (c: any) => {
      const svcRes = await fetch('/api/shipstation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://ssapi.shipstation.com/carriers/listservices?carrierCode=${c.code}`, auth }),
      });
      const services = svcRes.ok ? await svcRes.json() : [];
      return {
        code: c.code,
        name: c.name,
        services: services.map((s: any) => ({ code: s.code, name: s.name })),
      };
    })
  );

  return carriersWithServices;
};

/** Validate an address via ShipStation API */
export const validateShipStationAddress = async (
  settings: ApiSettings,
  address: { name: string; street1: string; street2?: string; city: string; state?: string; postalCode: string; country: string; phone?: string }
): Promise<{ valid: boolean; messages: string[] }> => {
  const auth = settings.shipStationApiKey && settings.shipStationApiSecret
    ? btoa(`${settings.shipStationApiKey}:${settings.shipStationApiSecret}`)
    : undefined;

  try {
    const response = await fetch('/api/shipstation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://ssapi.shipstation.com/addresses/validate',
        auth,
        method: 'POST',
        body: address,
      }),
    });

    if (!response.ok) {
      return { valid: false, messages: ['Address validation unavailable'] };
    }

    const data = await response.json();
    // ShipStation returns an array; first item has the result
    if (Array.isArray(data) && data.length > 0) {
      const result = data[0];
      const messages: string[] = [];
      if (result.Address_Not_Found) messages.push('Address not found');
      if (result.valid === false || result.match === false) messages.push('Address could not be verified');
      return { valid: messages.length === 0, messages };
    }

    return { valid: true, messages: [] };
  } catch {
    return { valid: false, messages: ['Address validation failed'] };
  }
};
