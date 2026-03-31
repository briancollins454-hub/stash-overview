
import { ApiSettings } from '../components/SettingsModal';
import { ShopifyOrder, PhysicalStockItem, ReturnStockItem, ReferenceProduct } from '../types';

/**
 * SyncService handles the persistence of user-defined data (mappings/links),
 * cached Shopify order data, and physical inventory to an external Supabase database.
 */

export interface CloudMapping {
    item_id: string;
    deco_id: string;
    updated_at: string;
}

export interface CloudJobLink {
    order_id: string;
    job_id: string;
    updated_at: string;
}

const getHeaders = (settings: ApiSettings, extraPrefer?: string) => {
    const anonKey = (settings.supabaseAnonKey || '').trim();
    const headers: Record<string, string> = {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
    };

    // PostgREST Prefer headers should be comma-separated
    const preferValues = ['return=minimal'];
    if (extraPrefer) preferValues.push(extraPrefer);
    headers['Prefer'] = preferValues.join(', ');

    return headers;
};

const getBaseUrl = (settings: ApiSettings) => {
    let url = (settings.supabaseUrl || '').trim();
    if (!url) return '';
    
    // Ensure protocol
    if (!url.startsWith('http')) {
        url = `https://${url}`;
    }
    
    // Clean trailing slash and whitespace
    url = url.replace(/\/$/, '');
    
    // Validate it's a working URL structure
    try {
        new URL(url);
        return url;
    } catch (e) {
        console.error("Invalid Supabase URL provided:", url);
        return '';
    }
};

const fetchWithProxy = async (targetUrl: string, options: RequestInit): Promise<Response> => {
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
            const message = errData.message || errData.details || `Proxy failed with status ${response.status}`;
            
            // Create a custom error object that includes the status
            const error = new Error(message) as any;
            error.status = response.status;
            throw error;
        }

        return response;
    } catch (e: any) {
        // Only log as error if it's NOT a 404 (which is often just a missing table)
        if (e.status !== 404) {
            console.error("Backend Proxy Error:", e.message);
        }
        throw e;
    }
};

const fetchAllFromCloud = async <T>(baseUrl: string, table: string, headers: any, select = '*', offset = 0, limit = 5000): Promise<T[] | null> => {
    try {
        const url = `${baseUrl}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;
        const res = await fetchWithProxy(url, { headers, method: 'GET' });
        
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        
        // Recursive pagination if we hit the limit
        if (data.length === limit && offset + limit < 100000) {
            const nextBatch = await fetchAllFromCloud<T>(baseUrl, table, headers, select, offset + limit, limit);
            return [...data, ...(nextBatch || [])];
        }
        
        return data;
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn(`Cloud table "${table}" not found. This is expected if you haven't run the Supabase setup SQL yet.`);
            return null;
        } else {
            console.error(`Network error fetching cloud ${table}:`, e.message || e);
            return [];
        }
    }
};

export const fetchCloudData = async (settings: ApiSettings): Promise<{
    mappings: Record<string, string>;
    links: Record<string, string>;
    productMappings: Record<string, string>;
    orders: ShopifyOrder[];
    physicalStock: PhysicalStockItem[];
    returnStock: ReturnStockItem[];
    referenceProducts: ReferenceProduct[];
    missingTables: string[];
} | null> => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return null;

    try {
        const headers = getHeaders(settings);
        const missingTables: string[] = [];
        
        // Parallel fetch for speed with full pagination support
        const [mappings, links, productMappings, physicalStock, returnStock, referenceProducts, rawOrders] = await Promise.all([
            fetchAllFromCloud<CloudMapping>(baseUrl, 'stash_mappings', headers),
            fetchAllFromCloud<CloudJobLink>(baseUrl, 'stash_job_links', headers),
            fetchAllFromCloud<any>(baseUrl, 'stash_product_patterns', headers),
            fetchAllFromCloud<PhysicalStockItem>(baseUrl, 'stash_stock', headers),
            fetchAllFromCloud<ReturnStockItem>(baseUrl, 'stash_returns', headers),
            fetchAllFromCloud<ReferenceProduct>(baseUrl, 'stash_reference_products', headers),
            fetchAllFromCloud<any>(baseUrl, 'stash_orders', headers, 'order_data')
        ]);

        if (mappings === null) missingTables.push('stash_mappings');
        if (links === null) missingTables.push('stash_job_links');
        if (productMappings === null) missingTables.push('stash_product_patterns');
        if (physicalStock === null) missingTables.push('stash_stock');
        if (returnStock === null) missingTables.push('stash_returns');
        if (referenceProducts === null) missingTables.push('stash_reference_products');
        if (rawOrders === null) missingTables.push('stash_orders');

        const cloudOrders = (rawOrders || []).map(row => row.order_data as ShopifyOrder);

        const mappingRecord: Record<string, string> = {};
        if (Array.isArray(mappings)) {
            mappings.forEach(m => { if (m.item_id) mappingRecord[m.item_id] = m.deco_id; });
        }

        const linkRecord: Record<string, string> = {};
        if (Array.isArray(links)) {
            links.forEach(l => { if (l.order_id) linkRecord[l.order_id] = l.job_id; });
        }

        const productMappingRecord: Record<string, string> = {};
        if (Array.isArray(productMappings)) {
            productMappings.forEach(pm => { if (pm.shopify_pattern) productMappingRecord[pm.shopify_pattern] = pm.deco_pattern; });
        }

        return { 
            mappings: mappingRecord, 
            links: linkRecord, 
            productMappings: productMappingRecord, 
            orders: cloudOrders, 
            physicalStock: physicalStock || [], 
            returnStock: returnStock || [], 
            referenceProducts: referenceProducts || [],
            missingTables
        };
    } catch (e) {
        console.error("Supabase Global Sync Error:", e);
        return null;
    }
};

export const saveCloudOrders = async (settings: ApiSettings, orders: ShopifyOrder[]) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey || orders.length === 0) return;

    try {
        // Dedup by order ID to prevent Postgres error 21000 in batch operations
        const uniqueOrders = Array.from(new Map(orders.map(o => [o.id, o])).values());
        
        const batchSize = 20;
        const headers = getHeaders(settings, 'resolution=merge-duplicates');
        
        for (let i = 0; i < uniqueOrders.length; i += batchSize) {
            const batch = uniqueOrders.slice(i, i + batchSize);
            const payload = batch.map(o => ({
                order_id: o.id,
                order_number: o.orderNumber,
                order_data: o,
                updated_at: new Date().toISOString()
            }));

            const res = await fetchWithProxy(`${baseUrl}/rest/v1/stash_orders`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const error = await res.text();
                throw new Error(`Batch Save Failed: ${res.status} - ${error}`);
            }
        }
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn(`Cloud Order Save Failed: Table "stash_orders" not found. Please run the Supabase setup SQL in the Integration Guide.`);
        } else {
            console.error("Cloud Order Save Failed:", e.message || e);
        }
        throw e;
    }
};

export const savePhysicalStockItem = async (settings: ApiSettings, item: PhysicalStockItem) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;
    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_stock`, {
            method: 'POST',
            headers: getHeaders(settings, 'resolution=merge-duplicates'),
            body: JSON.stringify(item)
        });
    } catch (e) {}
};

export const deletePhysicalStockItem = async (settings: ApiSettings, id: string) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;
    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_stock?id=eq.${id}`, {
            method: 'DELETE',
            headers: getHeaders(settings)
        });
    } catch (e) {}
};

export const saveReturnStockItem = async (settings: ApiSettings, item: ReturnStockItem) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;
    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_returns`, {
            method: 'POST',
            headers: getHeaders(settings, 'resolution=merge-duplicates'),
            body: JSON.stringify(item)
        });
    } catch (e) {}
};

export const deleteReturnStockItem = async (settings: ApiSettings, id: string) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;
    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_returns?id=eq.${id}`, {
            method: 'DELETE',
            headers: getHeaders(settings)
        });
    } catch (e) {}
};

export const saveReferenceProducts = async (settings: ApiSettings, products: ReferenceProduct[]) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey || products.length === 0) return;
    try {
        // Fix: Deduplicate by EAN (Primary Key) to prevent Postgres error 21000
        // (ON CONFLICT DO UPDATE command cannot affect row a second time)
        const uniqueProducts = Array.from(
            new Map(products.map(p => [p.ean.trim(), p])).values()
        );

        // Optimized batching for reference products
        const batchSize = 100;
        const headers = getHeaders(settings, 'resolution=merge-duplicates');
        for (let i = 0; i < uniqueProducts.length; i += batchSize) {
            const batch = uniqueProducts.slice(i, i + batchSize);
            const res = await fetchWithProxy(`${baseUrl}/rest/v1/stash_reference_products`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(batch)
            });
            if (!res.ok) {
                const err = await res.text();
                throw new Error(`Master Data Batch Error: ${err}`);
            }
        }
    } catch (e) {
        console.error("Master Ref Sync Error:", e);
        throw e;
    }
};

export const saveCloudJobLink = async (settings: ApiSettings, order_id: string, job_id: string) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;
    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_job_links`, {
            method: 'POST',
            headers: getHeaders(settings, 'resolution=merge-duplicates'),
            body: JSON.stringify({ order_id, job_id, updated_at: new Date().toISOString() })
        });
    } catch (e) {}
};

export const saveCloudMappingBatch = async (settings: ApiSettings, mappings: { item_id: string, deco_id: string }[]) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey || mappings.length === 0) return;
    try {
        // Dedup by item ID to prevent Postgres error 21000
        const uniqueMappings = Array.from(new Map(mappings.map(m => [m.item_id, m])).values());
        
        const batchSize = 100;
        const headers = getHeaders(settings, 'resolution=merge-duplicates');
        
        for (let i = 0; i < uniqueMappings.length; i += batchSize) {
            const batch = uniqueMappings.slice(i, i + batchSize);
            const payload = batch.map(m => ({
                item_id: m.item_id,
                deco_id: m.deco_id,
                updated_at: new Date().toISOString()
            }));

            const res = await fetchWithProxy(`${baseUrl}/rest/v1/stash_mappings`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.text();
                console.error(`Mapping Batch Save Error: ${err}`);
            }
        }
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn(`Cloud Mapping Save Failed: Table "stash_mappings" not found. Please run the Supabase setup SQL in the Integration Guide.`);
        } else {
            console.error("Cloud Mapping Save Failed:", e.message || e);
        }
    }
};

export const saveProductMapping = async (settings: ApiSettings, shopify_pattern: string, deco_pattern: string) => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;
    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_product_patterns`, {
            method: 'POST',
            headers: getHeaders(settings, 'resolution=merge-duplicates'),
            body: JSON.stringify({ shopify_pattern, deco_pattern, updated_at: new Date().toISOString() })
        });
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn(`Cloud Product Pattern Save Failed: Table "stash_product_patterns" not found. Please run the Supabase setup SQL in the Integration Guide.`);
        } else {
            console.error("Cloud Product Pattern Save Failed:", e.message || e);
        }
    }
};

/**
 * Fetch API settings from Supabase cloud (stash_settings table).
 * Returns the saved settings or null if not found / table missing.
 */
export const fetchCloudSettings = async (supabaseUrl: string, supabaseAnonKey: string): Promise<Partial<ApiSettings> | null> => {
    const anonKey = supabaseAnonKey.trim();
    let url = supabaseUrl.trim();
    if (!url || !anonKey) return null;
    if (!url.startsWith('http')) url = `https://${url}`;
    url = url.replace(/\/$/, '');

    const headers: Record<string, string> = {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    };

    try {
        const res = await fetchWithProxy(`${url}/rest/v1/stash_settings?select=settings_data&id=eq.main&limit=1`, {
            method: 'GET',
            headers
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0 && data[0].settings_data) {
            return data[0].settings_data as Partial<ApiSettings>;
        }
        return null;
    } catch (e: any) {
        console.warn('Cloud settings fetch failed:', e.message || e);
        return null;
    }
};

/**
 * Save API settings to Supabase cloud (stash_settings table).
 * Upserts a single row with id='main'.
 */
export const saveCloudSettings = async (settings: ApiSettings): Promise<void> => {
    const baseUrl = getBaseUrl(settings);
    if (!baseUrl || !settings.supabaseAnonKey) return;

    const headers = getHeaders(settings, 'resolution=merge-duplicates');

    try {
        await fetchWithProxy(`${baseUrl}/rest/v1/stash_settings`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                id: 'main',
                settings_data: settings,
                updated_at: new Date().toISOString()
            })
        });
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn('Cloud Settings Save: Table "stash_settings" not found. Create it in Supabase.');
        } else {
            console.error('Cloud Settings Save Failed:', e.message || e);
        }
    }
};
