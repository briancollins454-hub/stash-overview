import { ApiSettings } from '../components/SettingsModal';

/**
 * Fulfills a Shopify order via the Admin REST API through the proxy.
 * Optionally includes tracking information.
 */
export async function fulfillShopifyOrder(
  settings: ApiSettings,
  orderId: string,
  trackingNumber?: string,
  trackingCompany?: string
): Promise<{ success: boolean; error?: string }> {
  const domain = settings.shopifyDomain;
  const token = settings.shopifyAccessToken;

  if (!domain || !token) {
    return { success: false, error: 'Shopify credentials not configured' };
  }

  const numericId = orderId.includes('/') ? orderId.split('/').pop() : orderId;

  try {
    // Step 1: Get fulfillment orders for this order
    const foUrl = `https://${domain}/admin/api/2024-01/orders/${numericId}/fulfillment_orders.json`;
    const foResponse = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: foUrl,
        method: 'GET',
        headers: { 'X-Shopify-Access-Token': token },
      }),
    });

    if (!foResponse.ok) {
      const err = await foResponse.text();
      return { success: false, error: `Failed to get fulfillment orders: ${err}` };
    }

    const foData = await foResponse.json();
    const fulfillmentOrders = foData.fulfillment_orders || [];

    const openFOs = fulfillmentOrders.filter(
      (fo: any) => fo.status === 'open' || fo.status === 'in_progress'
    );

    if (openFOs.length === 0) {
      return { success: false, error: 'No open fulfillment orders found' };
    }

    // Step 2: Create fulfillment
    const lineItemsByFulfillmentOrder = openFOs.map((fo: any) => ({
      fulfillment_order_id: fo.id,
      fulfillment_order_line_items: fo.line_items.map((li: any) => ({
        id: li.id,
        quantity: li.fulfillable_quantity,
      })),
    }));

    const fulfillmentPayload: any = {
      fulfillment: {
        line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
        notify_customer: true,
      },
    };

    if (trackingNumber) {
      fulfillmentPayload.fulfillment.tracking_info = {
        number: trackingNumber,
        company: trackingCompany || '',
      };
    }

    const fulfillUrl = `https://${domain}/admin/api/2024-01/fulfillments.json`;
    const fulfillResponse = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: fulfillUrl,
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fulfillmentPayload),
      }),
    });

    if (!fulfillResponse.ok) {
      const err = await fulfillResponse.text();
      return { success: false, error: `Fulfillment failed: ${err}` };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
