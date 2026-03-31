import { DecoJob, ShopifyOrder, DecoItem } from '../types';
import { ApiSettings } from '../components/SettingsModal';
import { MOCK_DECO_JOBS, MOCK_SHOPIFY_ORDERS } from '../constants';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestTime = 0;
const PROXY_THROTTLE_MS = 200; 

// In-memory cache for single job fetches to speed up repeated lookups
const decoJobCache = new Map<string, { job: DecoJob | null, timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const standardizeSize = (size: string): string => {
    if (!size) return '';
    const s = size.toLowerCase().replace(/[^a-z0-9]/g, '');
    const map: {[key:string]: string} = {
      's': 'S', 'small': 'S', 'm': 'M', 'medium': 'M', 'l': 'L', 'large': 'L',
      'xl': 'XL', 'xlarge': 'XL', '2xl': '2XL', 'xxl': '2XL', '3xl': '3XL', 'xxxl': '3XL',
      '4xl': '4XL', 'xs': 'XS', 'xsmall': 'XS', 'one': 'ONE', 'onesize': 'ONE'
    };
    return map[s] || size.toUpperCase();
};

export const isEligibleForMapping = (itemName: string, productType?: string): boolean => {
    const name = itemName.toLowerCase();
    const type = (productType || '').toLowerCase();
    if (type.includes('service')) return false;
    const exclusions = ['add name', 'add initials', 'personalisation', 'personalization', 'customisation', 'customization', 'printing service', 'embroidery service'];
    return !exclusions.some(exc => name.includes(exc));
};

const mapDecoStatus = (status: string | number): string => {
    if (!status) return 'Unknown';
    if (typeof status === 'string' && isNaN(parseInt(status)) && status.trim() !== '') {
        return status.trim();
    }
    const statusNum = typeof status === 'string' ? parseInt(status) : status;
    const statusMap: Record<number, string> = {
        1: 'Awaiting Processing', 2: 'Completed', 3: 'Shipped', 4: 'Cancelled', 7: 'On Hold',
        8: 'Not Ordered', 9: 'Awaiting Stock', 10: 'Awaiting Artwork',
        11: 'Awaiting Review', 12: 'In Production', 13: 'Ready for Shipping'
    };
    return statusMap[statusNum] || 'Unknown';
};

const parseDecoItems = (job: any): DecoItem[] => {
    if (!job || !job.order_lines || !Array.isArray(job.order_lines)) return [];
    const optionNameMap: {[key: number]: string} = {};
    job.order_lines.forEach((line: any) => {
        if (line?.fields) {
            line.fields.forEach((field: any) => {
                if (field.options) {
                    field.options.forEach((opt: any) => { if (opt.option_id) optionNameMap[opt.option_id] = opt.code || opt.name || ''; });
                }
            });
        }
    });
    const items: DecoItem[] = [];
    job.order_lines.forEach((line: any) => {
        if (!line || (line.item_type !== 0 && line.item_type !== 25)) return;
        let colorName = line.product_color?.name || '';
        const potentialEan = line.barcode || line.ean || line.gtin || line.upc || line.product?.barcode || '';
        if (line.workflow_items?.length > 0) {
            line.workflow_items.forEach((wf: any) => {
                let variantName = wf.option_id && optionNameMap[wf.option_id] ? standardizeSize(optionNameMap[wf.option_id]) : '';
                let uniqueName = `${line.product_name || 'Item'}${colorName ? ` - ${colorName}` : ''}${variantName ? ` - ${variantName}` : ''}`;
                items.push({
                    productCode: line.product_code || '',
                    vendorSku: wf.vendor_sku || line.sku || '',
                    name: uniqueName,
                    ean: wf.barcode || wf.ean || potentialEan,
                    quantity: wf.qty_to_fulfill || 0,
                    isReceived: wf.procurement_status >= 60,
                    isProduced: wf.production_status >= 80,
                    isShipped: wf.shipping_status >= 80,
                    procurementStatus: wf.procurement_status || 0,
                    productionStatus: wf.production_status || 0,
                    shippingStatus: wf.shipping_status || 0,
                    status: wf.shipping_status >= 80 ? 'Shipped' : (wf.production_status >= 80 ? 'Produced' : (wf.procurement_status >= 60 ? 'Awaiting Production' : 'Awaiting Stock'))
                });
            });
        } else {
            items.push({
                productCode: line.product_code || '',
                vendorSku: line.sku || '',
                name: line.product_name || 'Item',
                ean: potentialEan,
                quantity: parseInt(line.qty) || 0,
                status: line.production_status === 3 ? 'Shipped' : (line.production_status === 2 ? 'Produced' : 'Ordered'),
                isReceived: true,
                isProduced: (line.production_status || 0) >= 2,
                isShipped: (line.production_status || 0) >= 3,
                procurementStatus: 60,
                productionStatus: line.production_status >= 2 ? 80 : 20,
                shippingStatus: line.production_status === 3 ? 80 : 0
            });
        }
    });
    return items;
};

const fetchWithProxyFallback = async (targetUrl: string, options: RequestInit, retries = 2): Promise<Response> => {
    const now = Date.now();
    const wait = PROXY_THROTTLE_MS - (now - lastRequestTime);
    if (wait > 0) await delay(wait);
    lastRequestTime = Date.now();

    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: targetUrl,
                method: options.method || 'GET',
                headers: options.headers,
                body: options.body
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const msg = errData.message || errData.details || `Proxy failed with status ${response.status}`;
            
            // If it's a 504 (Gateway Timeout) or 429 (Too Many Requests), we should retry
            if ((response.status === 504 || response.status === 429) && retries > 0) {
                console.warn(`Proxy ${response.status} - Retrying... (${retries} left)`);
                await delay(2000);
                return fetchWithProxyFallback(targetUrl, options, retries - 1);
            }
            
            // Create a custom error object that includes the status
            const error = new Error(msg) as any;
            error.status = response.status;
            throw error;
        }

        return response;
    } catch (e: any) {
        // If it's a network error (Failed to fetch), retry up to 2 times
        if (e.message.includes('Failed to fetch') && retries > 0) {
            console.warn(`Network Error (Failed to fetch) - Retrying... (${retries} left)`);
            await delay(1500);
            return fetchWithProxyFallback(targetUrl, options, retries - 1);
        }

        // Only log as error if it's NOT a 404 (which is often just a missing resource)
        if (e.status !== 404) {
            console.error("Backend Proxy Error:", e.message);
        }
        
        if (e.message.includes('Failed to fetch')) {
            throw new Error(`The backend server is currently unreachable. This often happens during a restart or due to network instability. Please wait 10 seconds and try again.`);
        }
        throw new Error(`Connection Error: ${e.message}. Please check your connection and try again.`);
    }
};

const robustShopifyGraphQL = async (settings: ApiSettings, dateFilter: string, isDelta: boolean = false, onProgress?: (msg: string) => void): Promise<ShopifyOrder[]> => {
    if (!settings.shopifyDomain || !settings.shopifyAccessToken) throw new Error("Shopify Credentials Missing");
    const cleanDomain = settings.shopifyDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const endpoint = `https://${cleanDomain}/admin/api/2025-01/graphql.json`;
    const headers = { 'X-Shopify-Access-Token': settings.shopifyAccessToken.trim(), 'Content-Type': 'application/json', 'Accept': 'application/json' };
    
    let allRawOrders: any[] = [];
    let hasNextPage = true; 
    let endCursor: string | null = null; 
    let pageCount = 0;
    
    const filterField = isDelta ? 'updated_at' : 'created_at';
    const query = `query getOrders($cursor: String, $query: String) { orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) { edges { node { id name email createdAt updatedAt closedAt displayFinancialStatus displayFulfillmentStatus tags note billingAddress { firstName lastName } shippingAddress { firstName lastName address1 address2 city provinceCode zip country phone } totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } shippingLines(first: 5) { edges { node { title } } } lineItems(first: 50) { edges { node { id name quantity unfulfilledQuantity sku vendor fulfillmentStatus image { url } customAttributes { key value } variant { barcode image { url } } originalUnitPriceSet { shopMoney { amount } } } } } } } pageInfo { hasNextPage endCursor } } }`;
    
    while (hasNextPage && pageCount < 100) { 
        const pct = Math.min(99, Math.round((pageCount / Math.max(pageCount + 1, 10)) * 100));
        if (onProgress) onProgress(`Shopify: ${allRawOrders.length} orders (${pct}%) — Page ${pageCount + 1}...`);
        const variables = { cursor: endCursor, query: `${filterField}:>=${dateFilter} status:any` };
        const res = await fetchWithProxyFallback(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
        if (res.status === 401) throw new Error("Shopify Token Invalid.");
        const json = await res.json();
        if (json.errors) throw new Error(`Shopify API: ${json.errors[0]?.message}`);
        const data = json.data?.orders;
        if (!data) break;
        const nodes = data.edges ? data.edges.map((e: any) => e.node) : [];
        allRawOrders = [...allRawOrders, ...nodes];
        hasNextPage = data.pageInfo?.hasNextPage || false;
        endCursor = data.pageInfo?.endCursor || null;
        pageCount++;
    }
    if (onProgress) onProgress(`Shopify: ${allRawOrders.length} orders (100%) — Complete`);

    return allRawOrders.map((o: any) => {
        const edges = o.lineItems?.edges || [];
        const mappedItems = edges.map((edge: any) => {
            const i = edge?.node; 
            if (!i || i.quantity <= 0) return null;
            return { id: i.id, name: i.name || 'Unknown', quantity: i.quantity || 0, fulfilledQuantity: i.quantity - (i.unfulfilledQuantity || 0), sku: i.sku || '', ean: i.variant?.barcode || '-', vendor: i.vendor || '', itemStatus: i.fulfillmentStatus ? i.fulfillmentStatus.toLowerCase() : 'unfulfilled', imageUrl: i.image?.url || i.variant?.image?.url || '', price: i.originalUnitPriceSet?.shopMoney?.amount || undefined, properties: (i.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })) };
        }).filter(Boolean);
        let fStatus = o.displayFulfillmentStatus ? o.displayFulfillmentStatus.toLowerCase() : 'unfulfilled';
        if (fStatus === 'partially_fulfilled') fStatus = 'partial';
        const custName = o.billingAddress ? `${o.billingAddress.firstName || ''} ${o.billingAddress.lastName || ''}`.trim() : 'Guest';
        const sa = o.shippingAddress;
        const shippingAddress = sa ? { name: `${sa.firstName || ''} ${sa.lastName || ''}`.trim(), address1: sa.address1 || '', address2: sa.address2 || '', city: sa.city || '', province: sa.provinceCode || '', zip: sa.zip || '', country: sa.country || '', phone: sa.phone || '' } : undefined;
        return { id: o.id, orderNumber: o.name.replace('#', ''), customerName: custName, email: o.email || '', date: o.createdAt, updatedAt: o.updatedAt, closedAt: o.closedAt, totalPrice: o.totalPriceSet?.shopMoney?.amount || '0.00', paymentStatus: o.displayFinancialStatus?.toLowerCase() || 'pending', fulfillmentStatus: fStatus, timelineComments: [o.note || ''].filter(Boolean), items: mappedItems, tags: o.tags || [], shippingAddress, shippingMethod: o.shippingLines?.edges?.[0]?.node?.title || undefined, shippingCost: o.totalShippingPriceSet?.shopMoney?.amount || undefined, subtotalPrice: o.subtotalPriceSet?.shopMoney?.amount || undefined, taxPrice: o.totalTaxSet?.shopMoney?.amount || undefined };
    });
};

export const fetchShopifyOrders = async (settings: ApiSettings, sinceDate?: string, onProgress?: (msg: string) => void, isDeepSync: boolean = false): Promise<ShopifyOrder[]> => {
    if (!settings.useLiveData) return MOCK_SHOPIFY_ORDERS.map(o => ({ ...o, items: o.items.map((it, idx) => ({ ...it, id: `${o.id}-i-${idx}` })) }));
    try {
        if (sinceDate) return await robustShopifyGraphQL(settings, sinceDate, true, onProgress);
        
        // If no cache, use a smaller lookback for "Recent" sync to speed up initial load
        const lookback = isDeepSync ? (settings.syncLookbackDays || 365) : 120;
        const minDate = new Date(); minDate.setDate(minDate.getDate() - lookback); minDate.setHours(0,0,0,0);
        return await robustShopifyGraphQL(settings, minDate.toISOString(), false, onProgress);
    } catch (e: any) {
        throw e;
    }
};

const robustDecoFetch = async (settings: ApiSettings, endpoint: string, params: Record<string, string>) => {
    if (!settings.decoDomain || !settings.decoUsername || !settings.decoPassword) throw new Error("Deco Credentials Missing");
    const domain = settings.decoDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const baseUrl = `https://${domain}/${endpoint}`;
    const queryParams = new URLSearchParams();
    queryParams.append('username', settings.decoUsername.trim());
    queryParams.append('password', settings.decoPassword.trim());
    Object.keys(params).forEach(key => queryParams.append(key, params[key]));
    const finalUrl = `${baseUrl}?${queryParams.toString()}`;
    const response = await fetchWithProxyFallback(finalUrl, { method: 'GET' });
    
    let data;
    const text = await response.text();
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`Deco API returned invalid response: ${text.substring(0, 100)}...`);
    }

    const status = data.response_status;
    if (!status && Array.isArray(data.orders)) return data;
    
    if (status) {
        const code = parseInt(status.code);
        if (code === 10002) throw new Error("Deco Auth Failed: Check Username/Password.");
        if (code === 10005) throw new Error("Deco API: Access Denied. Ensure API is enabled in DecoNetwork settings.");
        if (code !== 10001) throw new Error(status.description || `Deco Error (Code ${code})`);
    }
    
    return data;
};

export const fetchDecoJobs = async (settings: ApiSettings, onProgress?: (msg: string) => void, isDeepSync: boolean = false): Promise<DecoJob[]> => {
    if (!settings.useLiveData) return [];
    const lookback = isDeepSync ? 180 : 120; 
    const minDate = new Date(); minDate.setDate(minDate.getDate() - lookback);
    const dateStr = minDate.toISOString().split('T')[0] + ' 00:00:00';
    let allDeco: any[] = []; let offset = 0; let hasMore = true;
    const BATCH_SIZE = 100;
    const MAX_JOBS = isDeepSync ? 1500 : 600; // Increased to cover more history
    
    while (hasMore && offset < MAX_JOBS) { 
        if (onProgress) onProgress(`Deco: Batch ${Math.floor(offset/BATCH_SIZE) + 1}...`);
        const params = { 'limit': BATCH_SIZE.toString(), 'offset': offset.toString(), 'field': '1', 'condition': '4', 'date1': dateStr, 'include_workflow_data': '1', 'skip_login_token': '1' };
        const data = await robustDecoFetch(settings, 'api/json/manage_orders/find', params);
        const list = data.orders || []; 
        allDeco = [...allDeco, ...list];
        if (list.length < BATCH_SIZE || allDeco.length >= (data.total || 0)) hasMore = false;
        else { offset += list.length; await delay(400); }
    }
    return allDeco.map((job: any) => {
        const items = parseDecoItems(job);
        const custName = job.billing_details?.company || `${job.billing_details?.firstname || ''} ${job.billing_details?.lastname || ''}`.trim() || "Unknown";
        return { id: job.order_id.toString(), jobNumber: job.order_id.toString(), poNumber: job.customer_po_number || '', jobName: job.job_name || 'Deco Job', customerName: custName, status: mapDecoStatus(job.order_status_name || job.order_status), dateOrdered: job.date_ordered, productionDueDate: job.date_scheduled, dateDue: job.date_due, dateShipped: job.date_shipped || job.date_completed, itemsProduced: items.filter(i => i.isProduced).length, totalItems: items.length, notes: Array.isArray(job.notes) ? job.notes.map((n: any) => n.content || '').join(' | ') : '', productCode: items[0]?.productCode || '', items };
    });
};

export const fetchSingleDecoJob = async (settings: ApiSettings, jobId: string): Promise<DecoJob | null> => {
    if (!settings.useLiveData) return MOCK_DECO_JOBS.find(j => j.jobNumber === jobId) || null;
    
    // Aggressive Search: Try Field 1 (Order ID), Field 2 (PO), Field 7 (External Reference), Field 3 (Line ID)
    const fields = ['1', '2', '7', '3'];
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        try {
            const params = { 'field': f, 'condition': '1', 'string': jobId.trim(), 'criteria': jobId.trim(), 'limit': '1', 'include_workflow_data': '1', 'skip_login_token': '1' };
            const data = await robustDecoFetch(settings, 'api/json/manage_orders/find', params);
            const job = data.orders?.[0];
            if (job) {
                const items = parseDecoItems(job);
                const custName = job.billing_details?.company || `${job.billing_details?.firstname || ''} ${job.billing_details?.lastname || ''}`.trim() || "Unknown";
                return { id: job.order_id.toString(), jobNumber: job.order_id.toString(), poNumber: job.customer_po_number || '', jobName: job.job_name || 'Deco Job', customerName: custName, status: mapDecoStatus(job.order_status_name || job.order_status), dateOrdered: job.date_ordered, productionDueDate: job.date_scheduled, dateDue: job.date_due, dateShipped: job.date_shipped || job.date_completed, itemsProduced: items.filter(i => i.isProduced).length, totalItems: items.length, notes: Array.isArray(job.notes) ? job.notes.map((n: any) => n.content).join(' | ') : '', productCode: items[0]?.productCode || '', items };
            }
        } catch (e) { }
        if (i < fields.length - 1) await delay(200); // Small delay between field attempts if not found
    }
    return null;
};

export const fetchSingleShopifyOrder = async (settings: ApiSettings, orderId: string): Promise<ShopifyOrder | null> => {
    if (!settings.useLiveData) return MOCK_SHOPIFY_ORDERS.find(o => o.id === orderId) || null;
    if (!settings.shopifyDomain || !settings.shopifyAccessToken) throw new Error("Shopify Credentials Missing");
    
    const cleanDomain = settings.shopifyDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const endpoint = `https://${cleanDomain}/admin/api/2025-01/graphql.json`;
    const headers = { 'X-Shopify-Access-Token': settings.shopifyAccessToken.trim(), 'Content-Type': 'application/json', 'Accept': 'application/json' };
    
    const query = `query getOrder($id: ID!) { order(id: $id) { id name email createdAt updatedAt closedAt displayFinancialStatus displayFulfillmentStatus tags note billingAddress { firstName lastName } shippingAddress { firstName lastName address1 address2 city provinceCode zip country phone } totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } shippingLines(first: 5) { edges { node { title } } } lineItems(first: 50) { edges { node { id name quantity unfulfilledQuantity sku vendor fulfillmentStatus image { url } customAttributes { key value } variant { barcode image { url } } originalUnitPriceSet { shopMoney { amount } } } } } } }`;
    
    try {
        const res = await fetchWithProxyFallback(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, variables: { id: orderId } }) });
        const json = await res.json();
        const o = json.data?.order;
        if (!o) return null;

        const edges = o.lineItems?.edges || [];
        const mappedItems = edges.map((edge: any) => {
            const i = edge?.node; 
            if (!i || i.quantity <= 0) return null;
            return { id: i.id, name: i.name || 'Unknown', quantity: i.quantity || 0, fulfilledQuantity: i.quantity - (i.unfulfilledQuantity || 0), sku: i.sku || '', ean: i.variant?.barcode || '-', vendor: i.vendor || '', itemStatus: i.fulfillmentStatus ? i.fulfillmentStatus.toLowerCase() : 'unfulfilled', imageUrl: i.image?.url || i.variant?.image?.url || '', price: i.originalUnitPriceSet?.shopMoney?.amount || undefined, properties: (i.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })) };
        }).filter(Boolean);

        let fStatus = o.displayFulfillmentStatus ? o.displayFulfillmentStatus.toLowerCase() : 'unfulfilled';
        if (fStatus === 'partially_fulfilled') fStatus = 'partial';
        const custName = o.billingAddress ? `${o.billingAddress.firstName || ''} ${o.billingAddress.lastName || ''}`.trim() : 'Guest';
        const sa = o.shippingAddress;
        const shippingAddress = sa ? { name: `${sa.firstName || ''} ${sa.lastName || ''}`.trim(), address1: sa.address1 || '', address2: sa.address2 || '', city: sa.city || '', province: sa.provinceCode || '', zip: sa.zip || '', country: sa.country || '', phone: sa.phone || '' } : undefined;
        
        return { id: o.id, orderNumber: o.name.replace('#', ''), customerName: custName, email: o.email || '', date: o.createdAt, updatedAt: o.updatedAt, closedAt: o.closedAt, totalPrice: o.totalPriceSet?.shopMoney?.amount || '0.00', paymentStatus: o.displayFinancialStatus?.toLowerCase() || 'pending', fulfillmentStatus: fStatus, timelineComments: [o.note || ''].filter(Boolean), items: mappedItems, tags: o.tags || [], shippingAddress, shippingMethod: o.shippingLines?.edges?.[0]?.node?.title || undefined, shippingCost: o.totalShippingPriceSet?.shopMoney?.amount || undefined, subtotalPrice: o.subtotalPriceSet?.shopMoney?.amount || undefined, taxPrice: o.totalTaxSet?.shopMoney?.amount || undefined };
    } catch (e) {
        console.error("Error fetching single Shopify order:", e);
        return null;
    }
};

export const fetchOrderTimeline = async (settings: ApiSettings, orderId: string): Promise<{ comments: string[] }> => {
    if (!settings.useLiveData) return { comments: [] };
    const numericId = orderId.replace(/\D/g, ''); 
    if (!numericId) return { comments: [] };
    const domain = settings.shopifyDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${domain}/admin/api/2025-01/orders/${numericId}/events.json`;
    try {
        const res = await fetchWithProxyFallback(url, { headers: { 'X-Shopify-Access-Token': settings.shopifyAccessToken.trim() } });
        const json = await res.json();
        return { comments: (json.events || []).map((e: any) => e.body || e.message || '').filter((s: string) => s.trim().length > 0) };
    } catch (e) { return { comments: [] }; }
};