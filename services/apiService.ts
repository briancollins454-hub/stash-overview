import { DecoJob, ShopifyOrder, DecoItem } from '../types';
import { normalizeDecoCancelStatusString } from './decoJobFilters';
import { ApiSettings } from '../components/SettingsModal';
import { MOCK_DECO_JOBS, MOCK_SHOPIFY_ORDERS } from '../constants';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)); 

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
    if (typeof status === 'string' && isNaN(parseInt(status, 10)) && status.trim() !== '') {
        const t = status.trim();
        const canonCancel = normalizeDecoCancelStatusString(t);
        if (canonCancel) return canonCancel;
        return t;
    }
    const statusNum = typeof status === 'string' ? parseInt(status, 10) : status;
    const statusMap: Record<number, string> = {
        1: 'Awaiting Processing', 2: 'Completed', 3: 'Shipped', 4: 'Cancelled', 7: 'On Hold',
        8: 'Not Ordered', 9: 'Awaiting Stock', 10: 'Awaiting Artwork',
        11: 'Awaiting Review', 12: 'In Production', 13: 'Ready for Shipping'
    };
    return statusMap[statusNum] || 'Unknown';
};

/* ---------- Decoration / stitch extraction ---------- */
const DECO_TYPE_MAP: Record<string, string> = {
    embroidery: 'EMB', embroider: 'EMB', emb: 'EMB', stitched: 'EMB', wemb: 'EMB',
    dtf: 'DTF', 'direct to film': 'DTF',
    flex: 'FLEX',
    transfer: 'TRANSFER', 'heat transfer': 'TRANSFER', 'heat press': 'TRANSFER', 'heat applied': 'TRANSFER', trf: 'TRANSFER',
    uv: 'UV', 'uv print': 'UV',
    screen: 'SCREEN', 'screen print': 'SCREEN', screenprint: 'SCREEN',
    freeform: 'FREEFORM', 'free form': 'FREEFORM',
    vinyl: 'VINYL',
    sublimation: 'SUBLIMATION', sublim: 'SUBLIMATION', 'dye sub': 'SUBLIMATION',
    dtg: 'DTG', 'direct to garment': 'DTG',
    print: 'PRINT', printed: 'PRINT',
    laser: 'LASER', engraving: 'LASER', engrave: 'LASER',
    rhinestone: 'RHS', 'rhine stone': 'RHS', rhs: 'RHS',
    patch: 'PATCH', patches: 'PATCH',
    applique: 'APPLIQUE', appliqué: 'APPLIQUE',
    none: 'NONE', 'no decoration': 'NONE',
};
function normaliseDecoType(raw: string | undefined | null): string | undefined {
    if (!raw) return undefined;
    const lower = raw.toLowerCase().trim();
    for (const [key, val] of Object.entries(DECO_TYPE_MAP)) {
        if (lower.includes(key)) return val;
    }
    // Only use raw as-is if it looks like a short process name (not a concatenated string)
    if (raw.length <= 20 && !raw.includes(' ')) return raw.toUpperCase();
    return undefined;
}

/** Consistent badge order when a line has multiple processes (e.g. WEMB + DTF). */
const DECO_TYPE_SORT_ORDER = [
  'EMB', 'DTF', 'DTG', 'UV', 'FLEX', 'SCREEN', 'TRANSFER', 'PRINT', 'SUBLIMATION', 'VINYL',
  'FREEFORM', 'LASER', 'RHS', 'PATCH', 'APPLIQUE', 'DECO', 'NONE',
];

function sortDecoTypes(types: string[]): string[] {
  return [...types].sort((a, b) => {
    const ia = DECO_TYPE_SORT_ORDER.indexOf(a);
    const ib = DECO_TYPE_SORT_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function extractProcessData(proc: any, typeSet: Set<string>, stitchCountRef: { n: number }) {
    const method = proc.process || proc.decoration_method || proc.process_type || proc.type || proc.method || proc.name || '';
    if (method) {
        const nt = normaliseDecoType(method);
        if (nt) typeSet.add(nt);
    }

    const textItems = proc.text_items || proc.texts || [];
    if (Array.isArray(textItems)) {
        for (const ti of textItems) {
            const sc = parseInt(ti.stitch_count || ti.stitchCount || ti.stitch_total || 0);
            if (sc > 0) stitchCountRef.n += sc;
        }
    }
    const procSc = parseInt(proc.stitch_count || proc.stitchCount || proc.total_stitches || 0);
    if (procSc > 0) stitchCountRef.n += procSc;

    const digSc = parseInt(proc.get_digitization_stitch_count || proc.digitization_stitch_count || 0);
    if (digSc > 0 && stitchCountRef.n === 0) stitchCountRef.n = digSc;

    const designs = proc.design_items || proc.designs || proc.artworks || [];
    if (Array.isArray(designs)) {
        for (const d of designs) {
            const dsc = parseInt(d.stitch_count || d.stitchCount || d.get_digitization_stitch_count || 0);
            if (dsc > 0) stitchCountRef.n += dsc;
        }
    }
}

export function extractDecorationInfo(line: any, job?: any): {
  decorationType?: string;
  decorationTypes?: string[];
  stitchCount?: number;
} {
    const typeSet = new Set<string>();
    const stitchCountRef = { n: 0 };

    const flatProcesses = line.processes || line.decorations_data || line.decoration_processes || [];
    if (Array.isArray(flatProcesses)) {
        for (const proc of flatProcesses) extractProcessData(proc, typeSet, stitchCountRef);
    }

    const views = line.views || line.artwork_views || [];
    if (Array.isArray(views)) {
        for (const view of views) {
            const areas = view.areas || view.decoration_areas || [];
            if (Array.isArray(areas)) {
                for (const area of areas) {
                    const procs = area.processes || area.decoration_processes || [];
                    if (Array.isArray(procs)) {
                        for (const proc of procs) extractProcessData(proc, typeSet, stitchCountRef);
                    }
                }
            }
        }
    }

    if (job) {
        const artJobs = job.artwork_jobs || job.jobs || job.artwork?.jobs || [];
        if (Array.isArray(artJobs)) {
            for (const aj of artJobs) {
                const pn = aj.process_name || aj.decoration_method || '';
                const nt = pn ? normaliseDecoType(pn) : undefined;
                if (nt) typeSet.add(nt);
                const dsc = parseInt(aj.get_digitization_stitch_count || aj.digitization_stitch_count || aj.stitch_count || 0);
                if (dsc > 0 && stitchCountRef.n === 0) stitchCountRef.n = dsc;
            }
        }
    }

    const dd = typeof line.decoration_details === 'string' ? line.decoration_details
        : typeof line.decorations === 'string' ? line.decorations
        : line.decoration_method || line.process_type || line.product_type || '';
    const fromLine = normaliseDecoType(dd);
    if (fromLine) typeSet.add(fromLine);

    if (stitchCountRef.n === 0) {
        const lineSc = parseInt(line.stitch_count || line.stitchCount || line.total_stitches || line.digitization_stitch_count || 0);
        if (lineSc > 0) stitchCountRef.n = lineSc;
    }

    if (typeSet.size === 0) {
        const nameStr = [line.product_name, line.product_supplier_name, line.supplier_name, job?.job_name].filter(Boolean).join(' ');
        const fromName = normaliseDecoType(nameStr);
        if (fromName) typeSet.add(fromName);
    }

    if (typeSet.size === 0 && parseFloat(line.decoration_unit_price) > 0) {
        typeSet.add('DECO');
    }

    const sortedTypes = sortDecoTypes(Array.from(typeSet));
    const decorationTypes = sortedTypes.length > 0 ? sortedTypes : undefined;
    const decorationType = sortedTypes[0];
    const stitchCount = stitchCountRef.n > 0 ? stitchCountRef.n : undefined;

    return { decorationType, decorationTypes, stitchCount };
}

const parseDecoItems = (job: any): DecoItem[] => {
    if (!job || !job.order_lines || !Array.isArray(job.order_lines)) return [];
    const optionNameMap: {[key: number]: string} = {};
    const optionSkuMap: {[key: number]: string} = {};
    job.order_lines.forEach((line: any) => {
        if (line?.fields) {
            line.fields.forEach((field: any) => {
                if (field.options) {
                    field.options.forEach((opt: any) => {
                        if (opt.option_id) {
                            optionNameMap[opt.option_id] = opt.code || opt.name || '';
                            if (opt.sku) optionSkuMap[opt.option_id] = opt.sku;
                        }
                    });
                }
            });
        }
    });
    const items: DecoItem[] = [];
    job.order_lines.forEach((line: any) => {
        if (!line) return;
        // item_type: 0=standard, 25=freeform, 26=general job — allow all product-like types
        if (![0, 25, 26].includes(line.item_type)) return;
        let colorName = line.product_color?.name || '';
        const potentialEan = line.barcode || line.ean || line.gtin || line.upc || line.product?.barcode || '';
        const decoInfo = extractDecorationInfo(line, job);
        if (line.workflow_items?.length > 0) {
            line.workflow_items.forEach((wf: any) => {
                let variantName = wf.option_id && optionNameMap[wf.option_id] ? standardizeSize(optionNameMap[wf.option_id]) : '';
                let uniqueName = `${line.product_name || 'Item'}${colorName ? ` - ${colorName}` : ''}${variantName ? ` - ${variantName}` : ''}`;
                const procS = wf.procurement_status || 0;
                const prodS = wf.production_status || 0;
                const shipS = wf.shipping_status || 0;
                const qF = wf.qty_to_fulfill || 0;
                const qP = wf.qty_produced != null ? Number(wf.qty_produced) : 0;
                const qtyProducedSafe = Number.isFinite(qP) ? Math.max(0, qP) : 0;
                const fullyProduced = prodS >= 80 || (qF > 0 && qtyProducedSafe >= qF);
                const stage: 'notReady' | 'awaiting' | 'produced' | 'shipped' =
                    shipS >= 80 ? 'shipped'
                    : fullyProduced ? 'produced'
                    : procS >= 60 ? 'awaiting'
                    : 'notReady';
                items.push({
                    productCode: line.product_code || '',
                    vendorSku: wf.vendor_sku || (wf.option_id && optionSkuMap[wf.option_id]) || line.sku || '',
                    name: uniqueName,
                    ean: wf.barcode || wf.ean || potentialEan,
                    quantity: qF,
                    isReceived: wf.procurement_status >= 60,
                    isProduced: fullyProduced,
                    isShipped: wf.shipping_status >= 80,
                    procurementStatus: procS,
                    productionStatus: prodS,
                    shippingStatus: shipS,
                    productionStage: stage,
                    status: wf.shipping_status >= 80 ? 'Shipped' : (fullyProduced ? 'Produced' : (wf.procurement_status >= 60 ? 'Awaiting Production' : 'Awaiting Stock')),
                    unitPrice: parseFloat(line.unit_price) || undefined,
                    totalPrice: parseFloat(line.total_price) || undefined,
                    decorationDetails: line.decoration_details || line.decorations || undefined,
                    decorationType: decoInfo.decorationType,
                    decorationTypes: decoInfo.decorationTypes,
                    qtyProduced: qtyProducedSafe > 0 ? qtyProducedSafe : undefined,
                    stitchCount: decoInfo.stitchCount,
                    assignedTo: (() => {
                        const raw = wf.assigned_to || wf.assigned_user || line.assigned_to;
                        if (raw && typeof raw === 'object') return raw.name || raw.full_name || raw.display_name || raw.username || String(raw.id || '');
                        return raw || undefined;
                    })(),
                    estimatedCompletion: wf.estimated_completion || wf.date_estimated || undefined,
                    supplierId: line.vendor_id?.toString() || line.supplier_id?.toString() || undefined,
                    supplierName: line.vendor_name || line.supplier_name || line.supplier || undefined,
                });
            });
        } else {
            const rawProd = typeof line.production_status === 'number' ? line.production_status : 0;
            const hasShippedDate = !!line.shipped_date;
            // Deco line-level production_status observed in API probes:
            //   0/null = not yet assigned to production (notReady)
            //   1      = awaiting production (files ready, not processed)
            //   2      = in-progress (treat as produced for legacy compatibility)
            //   3      = produced (processed_date is set)
            // Shipping is signalled by line.shipped_date being set.
            const stage: 'notReady' | 'awaiting' | 'produced' | 'shipped' =
                hasShippedDate ? 'shipped'
                : rawProd >= 2 ? 'produced'
                : rawProd === 1 ? 'awaiting'
                : 'notReady';
            const isProducedDerived = rawProd >= 2;
            const isShippedDerived = hasShippedDate;
            const lineQtyProduced = line.qty_produced != null ? Number(line.qty_produced) : 0;
            const lineQty = parseInt(line.qty) || 0;
            const lineQtyProducedSafe = Number.isFinite(lineQtyProduced) ? Math.max(0, lineQtyProduced) : 0;
            items.push({
                productCode: line.product_code || '',
                vendorSku: line.sku || '',
                name: line.product_name || 'Item',
                ean: potentialEan,
                quantity: lineQty,
                status: isShippedDerived
                    ? 'Shipped'
                    : (isProducedDerived ? 'Produced' : (rawProd === 1 ? 'Awaiting Production' : 'Ordered')),
                isReceived: true,
                isProduced: isProducedDerived,
                isShipped: isShippedDerived,
                procurementStatus: 60,
                productionStatus: isProducedDerived ? 80 : (rawProd === 1 ? 20 : 0),
                shippingStatus: isShippedDerived ? 80 : 0,
                productionStage: stage,
                unitPrice: parseFloat(line.unit_price) || undefined,
                totalPrice: parseFloat(line.total_price) || undefined,
                decorationDetails: line.decoration_details || line.decorations || undefined,
                decorationType: decoInfo.decorationType,
                decorationTypes: decoInfo.decorationTypes,
                qtyProduced: lineQtyProducedSafe > 0 ? lineQtyProducedSafe : undefined,
                stitchCount: decoInfo.stitchCount,
                assignedTo: (() => {
                    const raw = line.assigned_to;
                    if (raw && typeof raw === 'object') return raw.name || raw.full_name || raw.display_name || raw.username || String(raw.id || '');
                    return raw || undefined;
                })(),
                supplierId: line.vendor_id?.toString() || line.supplier_id?.toString() || undefined,
                supplierName: line.vendor_name || line.supplier_name || line.supplier || undefined,
            });
        }
    });
    return items;
};

const buildDecoJob = (job: any, items: DecoItem[]): DecoJob => {
    const custName = job.billing_details?.company || `${job.billing_details?.firstname || ''} ${job.billing_details?.lastname || ''}`.trim() || "Unknown";
    // Defensive stringification: Deco very occasionally returns a
    // row with a missing/null order_id (API glitch, partial write).
    // Previously `.toString()` would throw and kill the whole batch.
    // Fall back to order_number, then a synthetic 'unknown-<n>' so
    // one bad row can't take the rest down.
    const orderId = job.order_id ?? job.order_number;
    const idString = orderId != null ? String(orderId) : `unknown-${Math.random().toString(36).slice(2, 8)}`;
    return {
        id: idString, jobNumber: (job.order_number || job.order_id || idString).toString(),
        poNumber: job.customer_po_number || '', jobName: job.job_name || 'Deco Job',
        customerName: custName, status: mapDecoStatus(job.order_status_name || job.order_status),
        dateOrdered: job.date_ordered, productionDueDate: job.date_scheduled,
        dateDue: job.date_due, dateShipped: job.date_shipped || job.date_completed,
        itemsProduced: items.filter(i => i.isProduced).length, totalItems: items.length,
        notes: Array.isArray(job.notes) ? job.notes.map((n: any) => n.content || '').join(' | ') : '',
        productCode: items[0]?.productCode || '', items,
        orderTotal: parseFloat(job.total) || parseFloat(job.order_total) || undefined,
        orderSubtotal: parseFloat(job.subtotal) || parseFloat(job.order_subtotal) || undefined,
        orderTax: parseFloat(job.tax) || parseFloat(job.order_tax) || undefined,
        paymentStatus: job.payment_status_name || job.payment_status?.toString() || undefined,
        paymentMethod: job.payment_method || job.payment_type || undefined,
        discount: parseFloat(job.discount) || parseFloat(job.discount_amount) || undefined,
        couponCode: job.coupon_code || job.promo_code || undefined,
        outstandingBalance: parseFloat(job.outstanding_balance) || 0,
        billableAmount: parseFloat(job.billable_amount) || 0,
        creditUsed: parseFloat(job.credit_used) || 0,
        accountTerms: job.account_terms || undefined,
        dateInvoiced: job.date_invoiced || undefined,
        isQuote: job.is_quote === true || job.is_quote === 1 || job.order_type === 2 || job.order_type === '2' || false,
        payments: Array.isArray(job.payments) ? job.payments.map((p: any) => ({
            id: p.id || p.payment_id,
            datePaid: p.date_paid,
            method: p.payment_method || 'Unknown',
            amount: parseFloat(p.paid_amount) || 0,
            refundedAmount: parseFloat(p.refunded_amount) || 0,
        })) : [],
        refunds: Array.isArray(job.refunds) ? job.refunds.map((r: any) => ({
            id: r.id,
            amount: parseFloat(r.amount || r.refund_amount) || 0,
            date: r.date || r.date_refunded || '',
        })) : [],
        salesPerson: (() => {
            // Try assigned_to first
            const at = job.assigned_to;
            if (at && typeof at === 'object' && (at.firstname || at.lastname))
                return `${at.firstname || ''} ${at.lastname || ''}`.trim();
            if (at && typeof at === 'string') return at;
            // Try sales_staff_account / sales_staff
            const ss = job.sales_staff_account || job.sales_staff || job.staff_account;
            if (ss && typeof ss === 'object' && (ss.firstname || ss.lastname))
                return `${ss.firstname || ''} ${ss.lastname || ''}`.trim();
            if (ss && typeof ss === 'string') return ss;
            // Try processed_by from first order line
            const pb = job.order_lines?.[0]?.processed_by || job.order_lines?.[0]?.workflow_items?.[0]?.processed_by;
            if (pb && typeof pb === 'object' && (pb.firstname || pb.lastname))
                return `${pb.firstname || ''} ${pb.lastname || ''}`.trim();
            // Fallback to created_by
            const cb = job.created_by;
            if (cb && typeof cb === 'object' && (cb.firstname || cb.lastname))
                return `${cb.firstname || ''} ${cb.lastname || ''}`.trim();
            return undefined;
        })(),
    };
};

const fetchServerRoute = async (route: string, body: any, retries = 2): Promise<Response> => {
    try {
        const response = await fetch(route, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const msg = errData.error || errData.message || errData.details || `Proxy failed with status ${response.status}`;
            
            // If it's a 504 (Gateway Timeout), 500 (Server Error) or 429 (Too Many Requests), we should retry
            if ((response.status === 504 || response.status === 500 || response.status === 429) && retries > 0) {
                console.warn(`Server ${response.status} - Retrying... (${retries} left)`);
                await delay(2000);
                return fetchServerRoute(route, body, retries - 1);
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
            return fetchServerRoute(route, body, retries - 1);
        }

        // Only log as error if it's NOT a 404 (which is often just a missing resource)
        if (e.status !== 404) {
            console.error("Server Route Error:", e.message);
        }
        
        if (e.message.includes('Failed to fetch')) {
            throw new Error(`The backend server is currently unreachable. This often happens during a restart or due to network instability. Please wait 10 seconds and try again.`);
        }
        throw new Error(`Connection Error: ${e.message}. Please check your connection and try again.`);
    }
};

const robustShopifyGraphQL = async (settings: ApiSettings, dateFilter: string, isDelta: boolean = false, onProgress?: (msg: string) => void): Promise<ShopifyOrder[]> => {
    let allRawOrders: any[] = [];
    let hasNextPage = true; 
    let endCursor: string | null = null; 
    let pageCount = 0;
    
    const filterField = isDelta ? 'updated_at' : 'created_at';
    const query = `query getOrders($cursor: String, $query: String) { orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) { edges { node { id name email createdAt updatedAt closedAt displayFinancialStatus displayFulfillmentStatus tags note billingAddress { firstName lastName } shippingAddress { firstName lastName address1 address2 city provinceCode zip country phone } totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } shippingLines(first: 5) { edges { node { title } } } lineItems(first: 50) { edges { node { id name quantity unfulfilledQuantity sku vendor fulfillmentStatus image { url } customAttributes { key value } variant { id barcode image { url } } originalUnitPriceSet { shopMoney { amount } } } } } } } pageInfo { hasNextPage endCursor } } }`;
    
    while (hasNextPage && pageCount < 100) { 
        const pct = Math.min(99, Math.round((pageCount / Math.max(pageCount + 1, 10)) * 100));
        if (onProgress) onProgress(`Shopify: ${allRawOrders.length} orders (${pct}%) — Page ${pageCount + 1}...`);
        const variables = { cursor: endCursor, query: `${filterField}:>=${dateFilter} status:any` };
        const res = await fetchServerRoute('/api/shopify', { query, variables });
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
            return { id: i.id, name: i.name || 'Unknown', quantity: i.quantity || 0, fulfilledQuantity: i.quantity - (i.unfulfilledQuantity || 0), sku: i.sku || '', ean: i.variant?.barcode || '-', variantId: i.variant?.id || '', vendor: i.vendor || '', itemStatus: i.fulfillmentStatus ? i.fulfillmentStatus.toLowerCase() : 'unfulfilled', imageUrl: i.image?.url || i.variant?.image?.url || '', price: i.originalUnitPriceSet?.shopMoney?.amount || undefined, properties: (i.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })) };
        }).filter(Boolean);
        let fStatus = o.displayFulfillmentStatus ? o.displayFulfillmentStatus.toLowerCase() : 'unfulfilled';
        if (fStatus === 'partially_fulfilled') fStatus = 'partial';
        const custName = o.billingAddress ? `${o.billingAddress.firstName || ''} ${o.billingAddress.lastName || ''}`.trim() : 'Guest';
        const sa = o.shippingAddress;
        const shippingAddress = sa ? { name: `${sa.firstName || ''} ${sa.lastName || ''}`.trim(), address1: sa.address1 || '', address2: sa.address2 || '', city: sa.city || '', province: sa.provinceCode || '', zip: sa.zip || '', country: sa.country || '', phone: sa.phone || '' } : undefined;
        return { id: o.id, orderNumber: o.name.replace('#', ''), customerName: custName, email: o.email || '', date: o.createdAt, updatedAt: o.updatedAt, closedAt: o.closedAt, totalPrice: o.totalPriceSet?.shopMoney?.amount || '0.00', paymentStatus: o.displayFinancialStatus?.toLowerCase() || 'pending', fulfillmentStatus: fStatus, timelineComments: [o.note || ''].filter(Boolean), items: mappedItems, tags: o.tags || [], shippingAddress, shippingMethod: o.shippingLines?.edges?.[0]?.node?.title || undefined, shippingCost: o.totalShippingPriceSet?.shopMoney?.amount || undefined, subtotalPrice: o.subtotalPriceSet?.shopMoney?.amount || undefined, taxPrice: o.totalTaxSet?.shopMoney?.amount || undefined };
    });
};

export const fetchShopifyOrders = async (settings: ApiSettings, sinceDate?: string, onProgress?: (msg: string) => void, isDeepSync: boolean = false, cachedOrderCount: number = 0): Promise<ShopifyOrder[]> => {
    if (!settings.useLiveData) return MOCK_SHOPIFY_ORDERS.map(o => ({ ...o, items: o.items.map((it, idx) => ({ ...it, id: `${o.id}-i-${idx}` })) }));
    try {
        if (sinceDate) return await robustShopifyGraphQL(settings, sinceDate, true, onProgress);
        
        // If no cache, use a smaller lookback for "Recent" sync to speed up initial load
        const lookback = isDeepSync ? (settings.syncLookbackDays || 365) : 120;
        const minDate = new Date(); minDate.setDate(minDate.getDate() - lookback); minDate.setHours(0,0,0,0);

        // Smart deep sync: if we have cached data, use updated_at filter to only fetch changes
        if (isDeepSync && cachedOrderCount > 50) {
            return await robustShopifyGraphQL(settings, minDate.toISOString(), true, onProgress);
        }

        return await robustShopifyGraphQL(settings, minDate.toISOString(), false, onProgress);
    } catch (e: any) {
        throw e;
    }
};

/** Fetch ALL unfulfilled orders from Shopify regardless of date — ensures no active order is missed */
export const fetchAllUnfulfilledOrders = async (settings: ApiSettings, onProgress?: (msg: string) => void): Promise<ShopifyOrder[]> => {
    if (!settings.useLiveData) return [];
    try {
        // Shopify GraphQL: pull both fully-unshipped AND partially-fulfilled orders.
        // `unshipped` alone misses partials (e.g. half-stock / half-MTO orders waiting
        // on a restock) — those need to stay visible until the remaining items ship.
        let allRawOrders: any[] = [];
        let hasNextPage = true;
        let endCursor: string | null = null;
        let pageCount = 0;
        const query = `query getOrders($cursor: String, $query: String) { orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) { edges { node { id name email createdAt updatedAt closedAt displayFinancialStatus displayFulfillmentStatus tags note billingAddress { firstName lastName } shippingAddress { firstName lastName address1 address2 city provinceCode zip country phone } totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } shippingLines(first: 5) { edges { node { title } } } lineItems(first: 50) { edges { node { id name quantity unfulfilledQuantity sku vendor fulfillmentStatus image { url } customAttributes { key value } variant { id barcode image { url } } originalUnitPriceSet { shopMoney { amount } } } } } } } pageInfo { hasNextPage endCursor } } }`;
        while (hasNextPage && pageCount < 100) {
            if (onProgress) onProgress(`Unfulfilled: ${allRawOrders.length} orders — Page ${pageCount + 1}...`);
            const variables = { cursor: endCursor, query: `(fulfillment_status:unshipped OR fulfillment_status:partial) status:open` };
            const res = await fetchServerRoute('/api/shopify', { query, variables });
            if (res.status === 401) throw new Error('Shopify Token Invalid.');
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
        return allRawOrders.map((o: any) => {
            const edges = o.lineItems?.edges || [];
            const mappedItems = edges.map((edge: any) => {
                const i = edge?.node;
                if (!i || i.quantity <= 0) return null;
                return { id: i.id, name: i.name || 'Unknown', quantity: i.quantity || 0, fulfilledQuantity: i.quantity - (i.unfulfilledQuantity || 0), sku: i.sku || '', ean: i.variant?.barcode || '-', variantId: i.variant?.id || '', vendor: i.vendor || '', itemStatus: i.fulfillmentStatus ? i.fulfillmentStatus.toLowerCase() : 'unfulfilled', imageUrl: i.image?.url || i.variant?.image?.url || '', price: i.originalUnitPriceSet?.shopMoney?.amount || undefined, properties: (i.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })) };
            }).filter(Boolean);
            let fStatus = o.displayFulfillmentStatus ? o.displayFulfillmentStatus.toLowerCase() : 'unfulfilled';
            if (fStatus === 'partially_fulfilled') fStatus = 'partial';
            const custName = o.billingAddress ? `${o.billingAddress.firstName || ''} ${o.billingAddress.lastName || ''}`.trim() : 'Guest';
            const sa = o.shippingAddress;
            const shippingAddress = sa ? { name: `${sa.firstName || ''} ${sa.lastName || ''}`.trim(), address1: sa.address1 || '', address2: sa.address2 || '', city: sa.city || '', province: sa.provinceCode || '', zip: sa.zip || '', country: sa.country || '', phone: sa.phone || '' } : undefined;
            return { id: o.id, orderNumber: o.name.replace('#', ''), customerName: custName, email: o.email || '', date: o.createdAt, updatedAt: o.updatedAt, closedAt: o.closedAt, totalPrice: o.totalPriceSet?.shopMoney?.amount || '0.00', paymentStatus: o.displayFinancialStatus?.toLowerCase() || 'pending', fulfillmentStatus: fStatus, timelineComments: [o.note || ''].filter(Boolean), items: mappedItems, tags: o.tags || [], shippingAddress, shippingMethod: o.shippingLines?.edges?.[0]?.node?.title || undefined, shippingCost: o.totalShippingPriceSet?.shopMoney?.amount || undefined, subtotalPrice: o.subtotalPriceSet?.shopMoney?.amount || undefined, taxPrice: o.totalTaxSet?.shopMoney?.amount || undefined };
        });
    } catch (e: any) {
        console.warn('Failed to fetch unfulfilled orders:', e.message);
        return [];
    }
};

const robustDecoFetch = async (settings: ApiSettings, endpoint: string, params: Record<string, string>) => {
    const response = await fetchServerRoute('/api/deco', { endpoint, params });
    
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
    const BATCH_SIZE = 100; // Deco API caps responses at 100 when using include flags
    const MAX_JOBS = isDeepSync ? 1500 : 800;
    
    while (hasMore && offset < MAX_JOBS) { 
        if (onProgress) onProgress(`Deco: Batch ${Math.floor(offset/BATCH_SIZE) + 1}...`);
        const params = { 'limit': BATCH_SIZE.toString(), 'offset': offset.toString(), 'field': '1', 'condition': '4', 'date1': dateStr, 'include_workflow_data': '1', 'include_user_assignments': '1', 'include_custom_fields': '1', 'include_sales_data': '1', 'include_product_data': '1', 'include_decoration_data': '1', 'include_artwork_data': '1', 'skip_login_token': '1' };
        const data = await robustDecoFetch(settings, 'api/json/manage_orders/find', params);
        const list = data.orders || []; 
        allDeco = [...allDeco, ...list];
        if (list.length < BATCH_SIZE || allDeco.length >= (data.total || 0)) hasMore = false;
        else { offset += list.length; await delay(100); }
    }
    const parsed = allDeco.map((job: any) => {
        const items = parseDecoItems(job);
        return buildDecoJob(job, items);
    });
    // Debug: count how many jobs got decoration types
    const withTypes = parsed.filter(j => j.items.some(i => i.decorationType));
    console.log(`[DECO] Parsed ${parsed.length} jobs. ${withTypes.length} have decoration types.`,
        withTypes.length > 0 ? 'Sample types: ' + withTypes.slice(0, 5).map(j => `${j.jobNumber}=${j.items.map(i=>i.decorationType).filter(Boolean).join(',')}`).join(' | ') : '');
    return parsed;
};

// Lightweight financial-only fetch — loads ALL Deco orders from a given year onward
// Only extracts financial fields (no item parsing) for speed
export const fetchDecoFinancials = async (
    settings: ApiSettings,
    sinceYear: number = 2020,
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal,
): Promise<DecoJob[]> => {
    if (!settings.useLiveData) return [];
    const dateStr = `${sinceYear}-01-01`;
    const BATCH = 100; // API hard-caps at 100 per request
    let allJobs: DecoJob[] = [];
    let offset = 0;
    let apiTotal = 0;

    while (true) {
        if (signal?.aborted) break;
        const params: Record<string, string> = {
            field: '1', condition: '4', date1: dateStr,
            limit: BATCH.toString(), offset: offset.toString(),
            skip_login_token: '1',
            include_workflow_data: '1',
            include_user_assignments: '1',
            include_custom_fields: '1',
            include_sales_data: '1',
        };
        const data = await robustDecoFetch(settings, 'api/json/manage_orders/find', params);
        const orders = data.orders || [];
        if (!apiTotal) apiTotal = data.total || 0;
        if (!orders.length) break;

        for (const job of orders) {
            const custName = job.billing_details?.company ||
                `${job.billing_details?.firstname || ''} ${job.billing_details?.lastname || ''}`.trim() || 'Unknown';
            allJobs.push({
                id: String(job.order_id), jobNumber: String(job.order_number || job.order_id),
                poNumber: job.customer_po_number || '', jobName: job.job_name || '',
                customerName: custName,
                status: mapDecoStatus(job.order_status_name || job.order_status),
                dateOrdered: job.date_ordered,
                productionDueDate: job.date_scheduled || '',
                dateDue: job.date_due,
                dateShipped: job.date_shipped || job.date_completed,
                itemsProduced: 0, totalItems: 0,
                notes: '', productCode: '', items: [],
                // Prefer grand total (inc. tax) so it matches outstandingBalance. Deco's
                // `item_amount` is pre-tax subtotal and would wrongly display lower than
                // the outstanding balance on VAT-bearing orders.
                orderTotal: parseFloat(job.total) || parseFloat(job.order_total) || parseFloat(job.item_amount) || undefined,
                orderSubtotal: parseFloat(job.item_amount) || undefined,
                orderTax: parseFloat(job.tax_amount) || parseFloat(job.tax) || undefined,
                paymentStatus: job.payment_status?.toString(),
                paymentMethod: job.payment_details?.payment_type_name || job.payment_method || undefined,
                discount: parseFloat(job.discount_amount) || undefined,
                couponCode: job.coupon_code || undefined,
                outstandingBalance: parseFloat(job.outstanding_balance) || 0,
                billableAmount: parseFloat(job.billable_amount) || 0,
                creditUsed: parseFloat(job.credit_used) || 0,
                accountTerms: job.account_terms || undefined,
                dateInvoiced: job.date_invoiced || undefined,
                isQuote: job.is_quote === true || job.is_quote === 1 || job.order_type === 2 || job.order_type === '2' || false,
                payments: Array.isArray(job.payments) ? job.payments.map((p: any) => ({
                    id: p.id || p.payment_id,
                    datePaid: p.date_paid,
                    method: p.payment_method || 'Unknown',
                    amount: parseFloat(p.paid_amount) || 0,
                    refundedAmount: parseFloat(p.refunded_amount) || 0,
                })) : [],
                refunds: Array.isArray(job.refunds) ? job.refunds.map((r: any) => ({
                    id: r.id,
                    amount: parseFloat(r.amount || r.refund_amount) || 0,
                    date: r.date || r.date_refunded || '',
                })) : [],
                salesPerson: (() => {
                    const at = job.assigned_to;
                    if (at && typeof at === 'object' && (at.firstname || at.lastname))
                        return `${at.firstname || ''} ${at.lastname || ''}`.trim();
                    if (at && typeof at === 'string') return at;
                    const ss = job.sales_staff_account || job.sales_staff || job.staff_account;
                    if (ss && typeof ss === 'object' && (ss.firstname || ss.lastname))
                        return `${ss.firstname || ''} ${ss.lastname || ''}`.trim();
                    if (ss && typeof ss === 'string') return ss;
                    const cb = job.created_by;
                    if (cb && typeof cb === 'object' && (cb.firstname || cb.lastname))
                        return `${cb.firstname || ''} ${cb.lastname || ''}`.trim();
                    return undefined;
                })(),
            });
        }

        offset += orders.length;
        onProgress?.(offset, apiTotal);

        if (orders.length < BATCH || offset >= apiTotal) break;
        await delay(50); // throttle
    }

    return allJobs;
};

export const fetchSingleDecoJob = async (settings: ApiSettings, jobId: string): Promise<DecoJob | null> => {
    if (!settings.useLiveData) return MOCK_DECO_JOBS.find(j => j.jobNumber === jobId) || null;
    
    // Use single action which tries direct lookup strategies first, then falls back to date scan
    try {
        const res = await fetchServerRoute('/api/deco', { action: 'single', jobIds: [jobId.trim()] });
        const json = await res.json();
        const result = (json.results || []).find((r: any) => r.order);
        if (result) {
            const items = parseDecoItems(result.order);
            return buildDecoJob(result.order, items);
        }
    } catch (e) { }
    return null;
};

// Search Deco jobs by customer name (billing name contains)
export const searchDecoByName = async (settings: ApiSettings, name: string): Promise<DecoJob[]> => {
    if (!settings.useLiveData || !name.trim()) return [];
    // DecoNetwork manage_orders/find: field 5 = billing name, condition 2 = contains
    try {
        const params = { 'field': '5', 'condition': '2', 'string': name.trim(), 'criteria': name.trim(), 'limit': '10', 'include_workflow_data': '1', 'skip_login_token': '1' };
        const data = await robustDecoFetch(settings, 'api/json/manage_orders/find', params);
        const list = data.orders || [];
        return list.map((job: any) => {
            const items = parseDecoItems(job);
            return buildDecoJob(job, items);
        });
    } catch (e) { return []; }
};

// Bulk fetch multiple Deco jobs by ID in a single server call
export const fetchBulkDecoJobs = async (
    settings: ApiSettings,
    jobIds: string[],
    onProgress?: (current: number, total: number) => void,
): Promise<DecoJob[]> => {
    if (!settings.useLiveData || jobIds.length === 0) return [];

    // The /api/deco bulk action caps at 60 IDs per request to keep each
    // call well inside Vercel's 60s budget. Chunk here so callers don't
    // have to know about the cap and we stay reliable on big boards.
    const CHUNK = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < jobIds.length; i += CHUNK) {
        chunks.push(jobIds.slice(i, i + CHUNK));
    }

    const fetchOneChunk = async (chunk: string[]): Promise<DecoJob[]> => {
        const mergeByJobNumber = (list: DecoJob[]) => {
            const m = new Map<string, DecoJob>();
            for (const j of list) {
                if (j.jobNumber) m.set(j.jobNumber, j);
            }
            return Array.from(m.values());
        };

        try {
            const res = await fetchServerRoute('/api/deco', { action: 'bulk', jobIds: chunk });
            const json = await res.json();
            const results = json.results || [];
            const satisfied = new Set<string>();
            const jobs: DecoJob[] = [];
            for (const r of results) {
                const jid = String(r.jobId ?? '').trim();
                if (r.order && jid) {
                    satisfied.add(jid);
                    const items = parseDecoItems(r.order);
                    jobs.push(buildDecoJob(r.order, items));
                }
            }
            const missing = chunk.map(id => String(id).trim()).filter(id => id && !satisfied.has(id));
            if (missing.length > 0) {
                console.warn(`[fetchBulkDecoJobs] bulk missed ${missing.length}/${chunk.length} id(s) — direct fetch`);
                const PER_ID_CONCURRENCY = 4;
                for (let i = 0; i < missing.length; i += PER_ID_CONCURRENCY) {
                    const slice = missing.slice(i, i + PER_ID_CONCURRENCY);
                    const settled = await Promise.allSettled(slice.map(id => fetchSingleDecoJob(settings, id)));
                    settled.forEach(r => {
                        if (r.status === 'fulfilled' && r.value) jobs.push(r.value);
                    });
                }
            }
            return mergeByJobNumber(jobs);
        } catch (e: any) {
            console.warn(`[fetchBulkDecoJobs] chunk of ${chunk.length} failed (${e.message}); falling back to per-ID with concurrency`);
            // Per-ID fallback runs WITH concurrency rather than a sequential
            // for-loop. The old code was looping `for (const id of jobIds)` and
            // awaiting each fetchSingleDecoJob — for 150 ids that's a 5+
            // minute serial nightmare. Concurrency 4 gets us through ~50 ids
            // in roughly 15s without burying the Deco API.
            const PER_ID_CONCURRENCY = 4;
            const out: DecoJob[] = [];
            for (let i = 0; i < chunk.length; i += PER_ID_CONCURRENCY) {
                const slice = chunk.slice(i, i + PER_ID_CONCURRENCY);
                const settled = await Promise.allSettled(slice.map(id => fetchSingleDecoJob(settings, id)));
                settled.forEach(r => { if (r.status === 'fulfilled' && r.value) out.push(r.value); });
            }
            const m = new Map<string, DecoJob>();
            for (const j of out) {
                if (j.jobNumber) m.set(j.jobNumber, j);
            }
            return Array.from(m.values());
        }
    };

    const all: DecoJob[] = [];
    let done = 0;
    for (const chunk of chunks) {
        const part = await fetchOneChunk(chunk);
        all.push(...part);
        done += chunk.length;
        if (onProgress) onProgress(done, jobIds.length);
    }
    return all;
};

export const fetchSingleShopifyOrder = async (settings: ApiSettings, orderId: string): Promise<ShopifyOrder | null> => {
    if (!settings.useLiveData) return MOCK_SHOPIFY_ORDERS.find(o => o.id === orderId) || null;
    
    const query = `query getOrder($id: ID!) { order(id: $id) { id name email createdAt updatedAt closedAt displayFinancialStatus displayFulfillmentStatus tags note billingAddress { firstName lastName } shippingAddress { firstName lastName address1 address2 city provinceCode zip country phone } totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } } shippingLines(first: 5) { edges { node { title } } } lineItems(first: 50) { edges { node { id name quantity unfulfilledQuantity sku vendor fulfillmentStatus image { url } customAttributes { key value } variant { id barcode image { url } } originalUnitPriceSet { shopMoney { amount } } } } } } }`;
    
    try {
        const res = await fetchServerRoute('/api/shopify', { query, variables: { id: orderId } });
        const json = await res.json();
        const o = json.data?.order;
        if (!o) return null;

        const edges = o.lineItems?.edges || [];
        const mappedItems = edges.map((edge: any) => {
            const i = edge?.node; 
            if (!i || i.quantity <= 0) return null;
            return { id: i.id, name: i.name || 'Unknown', quantity: i.quantity || 0, fulfilledQuantity: i.quantity - (i.unfulfilledQuantity || 0), sku: i.sku || '', ean: i.variant?.barcode || '-', variantId: i.variant?.id || '', vendor: i.vendor || '', itemStatus: i.fulfillmentStatus ? i.fulfillmentStatus.toLowerCase() : 'unfulfilled', imageUrl: i.image?.url || i.variant?.image?.url || '', price: i.originalUnitPriceSet?.shopMoney?.amount || undefined, properties: (i.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })) };
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
    try {
        const res = await fetchServerRoute('/api/shopify', { action: 'rest', restPath: `/admin/api/2025-01/orders/${numericId}/events.json` });
        const json = await res.json();
        return { comments: (json.events || []).map((e: any) => e.body || e.message || '').filter((s: string) => s.trim().length > 0) };
    } catch (e) { return { comments: [] }; }
};

/**
 * Fetch product EANs from Deco product catalog.
 * Looks up products by product code and extracts barcode/EAN/GTIN fields.
 * Returns a Map of lowercase productCode → EAN string.
 */
export const fetchDecoProductEans = async (settings: ApiSettings, productCodes: string[]): Promise<Map<string, string>> => {
    const eanMap = new Map<string, string>();
    if (!productCodes.length) return eanMap;

    // Deduplicate and batch
    const uniqueCodes = [...new Set(productCodes.map(c => c.trim()).filter(Boolean))];
    const BATCH = 10;

    for (let i = 0; i < uniqueCodes.length; i += BATCH) {
        const batch = uniqueCodes.slice(i, i + BATCH);
        const promises = batch.map(async (code) => {
            try {
                const data = await robustDecoFetch(settings, 'api/json/manage_products/find', {
                    field: '3', // product code field
                    condition: '1', // exact match
                    string: code,
                    limit: '5',
                });
                const products = data.products || data.items || [];
                for (const p of (Array.isArray(products) ? products : [])) {
                    const ean = p.barcode || p.ean || p.gtin || p.upc || '';
                    const pc = (p.product_code || p.code || code || '').trim().toLowerCase();
                    if (ean && ean.trim().length >= 8 && pc) {
                        eanMap.set(pc, ean.trim());
                    }
                    // Also check variants/options for EANs
                    const variants = p.variants || p.options || p.skus || [];
                    for (const v of (Array.isArray(variants) ? variants : [])) {
                        const vEan = v.barcode || v.ean || v.gtin || v.upc || '';
                        const vSku = (v.vendor_sku || v.sku || v.code || '').trim().toLowerCase();
                        if (vEan && vEan.trim().length >= 8) {
                            if (vSku) eanMap.set(vSku, vEan.trim());
                            if (pc && !eanMap.has(pc)) eanMap.set(pc, vEan.trim());
                        }
                    }
                }
            } catch (e) {
                // Product lookup failed — skip silently
            }
        });
        await Promise.all(promises);
    }
    return eanMap;
};

export const updateShopifyVariantBarcode = async (settings: ApiSettings, variantId: string, barcode: string): Promise<{ success: boolean; error?: string }> => {
    if (!variantId || !variantId.startsWith('gid://')) return { success: false, error: 'Invalid variant ID' };
    if (!barcode || barcode.trim().length === 0) return { success: false, error: 'Empty barcode' };

    const mutation = `mutation productVariantUpdate($input: ProductVariantInput!) { productVariantUpdate(input: $input) { productVariant { id barcode } userErrors { field message } } }`;
    const variables = { input: { id: variantId, barcode: barcode.trim() } };

    try {
        const res = await fetchServerRoute('/api/shopify', { query: mutation, variables });
        const json = await res.json();
        const errors = json.data?.productVariantUpdate?.userErrors;
        if (errors?.length > 0) return { success: false, error: errors.map((e: any) => e.message).join(', ') };
        if (json.errors) return { success: false, error: json.errors[0]?.message || 'GraphQL error' };
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
};

/* ---------- Stitch enrichment: fetch detail per job ---------- */
export interface StitchCacheEntry {
    job_number: string;
    items: Array<{ lineIndex: number; decorationType?: string; decorationTypes?: string[]; stitchCount?: number }>;
    enriched_at: string;
}

export const enrichDecoStitchBatch = async (
    settings: ApiSettings,
    jobIds: string[],
    onProgress?: (done: number, total: number) => void,
): Promise<StitchCacheEntry[]> => {
    if (!settings.useLiveData || jobIds.length === 0) return [];
    const results: StitchCacheEntry[] = [];
    const BATCH = 5;

    for (let i = 0; i < jobIds.length; i += BATCH) {
        const batch = jobIds.slice(i, i + BATCH);
        try {
            const res = await fetchServerRoute('/api/deco', { action: 'enrich_stitch', jobIds: batch });
            const json = await res.json();
            for (const r of (json.results || [])) {
                if (!r.order) {
                    results.push({ job_number: r.jobId, items: [], enriched_at: new Date().toISOString() });
                    continue;
                }
                const job = r.order;
                const items: StitchCacheEntry['items'] = [];
                (job.order_lines || []).forEach((line: any, idx: number) => {
                    const info = extractDecorationInfo(line, job);
                    if (info.stitchCount || info.decorationType || (info.decorationTypes && info.decorationTypes.length > 0)) {
                        items.push({
                            lineIndex: idx,
                            decorationType: info.decorationType,
                            decorationTypes: info.decorationTypes,
                            stitchCount: info.stitchCount,
                        });
                    }
                });
                results.push({ job_number: r.jobId, items, enriched_at: new Date().toISOString() });
            }
        } catch (e) {
            // Mark failed jobs as enriched (empty) so we don't retry endlessly
            batch.forEach(id => results.push({ job_number: id, items: [], enriched_at: new Date().toISOString() }));
        }
        if (onProgress) onProgress(Math.min(i + BATCH, jobIds.length), jobIds.length);
        if (i + BATCH < jobIds.length) await delay(200);
    }
    return results;
};