
import { ApiSettings } from '../components/SettingsModal';
import { ShopifyOrder, PhysicalStockItem, ReturnStockItem, ReferenceProduct, DecoJob } from '../types';

/**
 * SyncService handles the persistence of user-defined data (mappings/links),
 * cached Shopify order data, and physical inventory to Supabase via server-side routes.
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

const fetchWithProxy = async (path: string, method: string, body?: any, prefer?: string): Promise<Response> => {
    try {
        const preferValues = ['return=minimal'];
        if (prefer) preferValues.push(prefer);

        const response = await fetch('/api/supabase-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path,
                method,
                body,
                prefer: preferValues.join(', ')
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

const fetchAllFromCloud = async <T>(table: string, select = '*', offset = 0, limit = 500, retries = 2): Promise<T[] | null> => {
    try {
        const path = `${table}?select=${select}&limit=${limit}&offset=${offset}`;
        const res = await fetchWithProxy(path, 'GET');
        
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        
        // Recursive pagination if we hit the limit
        if (data.length === limit && offset + limit < 100000) {
            const nextBatch = await fetchAllFromCloud<T>(table, select, offset + limit, limit, retries);
            return [...data, ...(nextBatch || [])];
        }
        
        return data;
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn(`Cloud table "${table}" not found.`);
            return null;
        }
        // Retry on network/timeout errors
        if (retries > 0) {
            console.warn(`Cloud fetch ${table} failed, retrying (${retries} left)...`);
            await new Promise(r => setTimeout(r, 1500));
            return fetchAllFromCloud<T>(table, select, offset, limit, retries - 1);
        }
        console.error(`Cloud fetch ${table} failed after retries:`, e.message || e);
        return [];
    }
};

export const fetchCloudData = async (settings: ApiSettings, opts?: { includeOrders?: boolean }): Promise<{
    mappings: Record<string, string>;
    links: Record<string, string>;
    productMappings: Record<string, string>;
    orders: ShopifyOrder[];
    decoJobs: DecoJob[];
    physicalStock: PhysicalStockItem[];
    returnStock: ReturnStockItem[];
    referenceProducts: ReferenceProduct[];
    missingTables: string[];
} | null> => {
    try {
        const missingTables: string[] = [];
        const includeOrders = opts?.includeOrders ?? false;
        
        // Parallel fetch for speed with full pagination support
        const [mappings, links, productMappings, physicalStock, returnStock, referenceProducts, rawOrders, rawDecoJobs] = await Promise.all([
            fetchAllFromCloud<CloudMapping>('stash_mappings'),
            fetchAllFromCloud<CloudJobLink>('stash_job_links'),
            fetchAllFromCloud<any>('stash_product_patterns'),
            fetchAllFromCloud<PhysicalStockItem>('stash_stock'),
            fetchAllFromCloud<ReturnStockItem>('stash_returns'),
            fetchAllFromCloud<ReferenceProduct>('stash_reference_products'),
            includeOrders ? fetchAllFromCloud<any>('stash_orders', 'order_data') : Promise.resolve([]),
            fetchAllFromCloud<any>('stash_deco_jobs', 'job_data')
        ]);

        if (mappings === null) missingTables.push('stash_mappings');
        if (links === null) missingTables.push('stash_job_links');
        if (productMappings === null) missingTables.push('stash_product_patterns');
        if (physicalStock === null) missingTables.push('stash_stock');
        if (returnStock === null) missingTables.push('stash_returns');
        if (referenceProducts === null) missingTables.push('stash_reference_products');
        if (rawOrders === null) missingTables.push('stash_orders');
        if (rawDecoJobs === null) missingTables.push('stash_deco_jobs');

        const cloudOrders = (rawOrders || []).map(row => row.order_data as ShopifyOrder);
        const cloudDecoJobs = (rawDecoJobs || []).map(row => row.job_data as DecoJob);

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
            decoJobs: cloudDecoJobs,
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
    if (orders.length === 0) return;

    try {
        // Dedup by order ID to prevent Postgres error 21000 in batch operations
        const uniqueOrders = Array.from(new Map(orders.map(o => [o.id, o])).values());
        
        const batchSize = 20;
        
        for (let i = 0; i < uniqueOrders.length; i += batchSize) {
            const batch = uniqueOrders.slice(i, i + batchSize);
            const payload = batch.map(o => ({
                order_id: o.id,
                order_number: o.orderNumber,
                order_data: o,
                updated_at: new Date().toISOString()
            }));

            const res = await fetchWithProxy('stash_orders', 'POST', payload, 'resolution=merge-duplicates');

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

export const saveCloudDecoJobs = async (settings: ApiSettings, jobs: DecoJob[]) => {
    if (jobs.length === 0) return;
    try {
        const uniqueJobs = Array.from(new Map(jobs.map(j => [j.jobNumber, j])).values());
        const batchSize = 20;
        for (let i = 0; i < uniqueJobs.length; i += batchSize) {
            const batch = uniqueJobs.slice(i, i + batchSize);
            const payload = batch.map(j => ({
                job_number: j.jobNumber,
                job_data: j,
                updated_at: new Date().toISOString()
            }));
            const res = await fetchWithProxy('stash_deco_jobs', 'POST', payload, 'resolution=merge-duplicates');
            if (!res.ok) {
                const error = await res.text();
                console.error(`Deco Job Batch Save Error: ${error}`);
            }
        }
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn('Cloud Deco Job Save Failed: Table "stash_deco_jobs" not found. Create it in Supabase.');
        } else {
            console.error('Cloud Deco Job Save Failed:', e.message || e);
        }
    }
};

export const savePhysicalStockItem = async (settings: ApiSettings, item: PhysicalStockItem) => {
    try {
        await fetchWithProxy('stash_stock', 'POST', item, 'resolution=merge-duplicates');
    } catch (e) {
        console.error('savePhysicalStockItem failed:', e);
        throw e;
    }
};

export const deletePhysicalStockItem = async (settings: ApiSettings, id: string) => {
    try {
        await fetchWithProxy(`stash_stock?id=eq.${id}`, 'DELETE');
    } catch (e) {
        console.error('deletePhysicalStockItem failed:', e);
        throw e;
    }
};

export const saveReturnStockItem = async (settings: ApiSettings, item: ReturnStockItem) => {
    try {
        await fetchWithProxy('stash_returns', 'POST', item, 'resolution=merge-duplicates');
    } catch (e) {
        console.error('saveReturnStockItem failed:', e);
        throw e;
    }
};

export const deleteReturnStockItem = async (settings: ApiSettings, id: string) => {
    try {
        await fetchWithProxy(`stash_returns?id=eq.${id}`, 'DELETE');
    } catch (e) {
        console.error('deleteReturnStockItem failed:', e);
        throw e;
    }
};

export const saveReferenceProducts = async (settings: ApiSettings, products: ReferenceProduct[]) => {
    if (products.length === 0) return;
    try {
        // Fix: Deduplicate by EAN (Primary Key) to prevent Postgres error 21000
        const uniqueProducts = Array.from(
            new Map(products.map(p => [p.ean.trim(), p])).values()
        );

        const batchSize = 100;
        for (let i = 0; i < uniqueProducts.length; i += batchSize) {
            const batch = uniqueProducts.slice(i, i + batchSize);
            const res = await fetchWithProxy('stash_reference_products', 'POST', batch, 'resolution=merge-duplicates');
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
    try {
        await fetchWithProxy('stash_job_links', 'POST', { order_id, job_id, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates');
    } catch (e) {
        console.error('Cloud Job Link Save Failed:', e);
    }
};

export const saveCloudJobLinkBatch = async (settings: ApiSettings, links: Record<string, string>) => {
    const entries = Object.entries(links);
    if (entries.length === 0) return;
    try {
        const batchSize = 100;
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize).map(([order_id, job_id]) => ({
                order_id, job_id, updated_at: new Date().toISOString()
            }));
            const res = await fetchWithProxy('stash_job_links', 'POST', batch, 'resolution=merge-duplicates');
            if (!res.ok) console.error('Job Link Batch Save Error:', await res.text());
        }
    } catch (e: any) {
        console.error('Cloud Job Link Batch Save Failed:', e.message || e);
    }
};

export const saveCloudProductMappingBatch = async (settings: ApiSettings, mappings: Record<string, string>) => {
    const entries = Object.entries(mappings);
    if (entries.length === 0) return;
    try {
        const batchSize = 100;
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize).map(([shopify_pattern, deco_pattern]) => ({
                shopify_pattern, deco_pattern, updated_at: new Date().toISOString()
            }));
            const res = await fetchWithProxy('stash_product_patterns', 'POST', batch, 'resolution=merge-duplicates');
            if (!res.ok) console.error('Product Mapping Batch Save Error:', await res.text());
        }
    } catch (e: any) {
        console.error('Cloud Product Mapping Batch Save Failed:', e.message || e);
    }
};

export const saveCloudMappingBatch = async (settings: ApiSettings, mappings: { item_id: string, deco_id: string }[]) => {
    if (mappings.length === 0) return;
    try {
        // Dedup by item ID to prevent Postgres error 21000
        const uniqueMappings = Array.from(new Map(mappings.map(m => [m.item_id, m])).values());
        
        const batchSize = 100;
        
        for (let i = 0; i < uniqueMappings.length; i += batchSize) {
            const batch = uniqueMappings.slice(i, i + batchSize);
            const payload = batch.map(m => ({
                item_id: m.item_id,
                deco_id: m.deco_id,
                updated_at: new Date().toISOString()
            }));

            const res = await fetchWithProxy('stash_mappings', 'POST', payload, 'resolution=merge-duplicates');

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
    try {
        await fetchWithProxy('stash_product_patterns', 'POST', { shopify_pattern, deco_pattern, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates');
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn(`Cloud Product Pattern Save Failed: Table "stash_product_patterns" not found.`);
        } else {
            console.error("Cloud Product Pattern Save Failed:", e.message || e);
        }
    }
};

/**
 * Fetch API settings from Supabase cloud (stash_settings table).
 * Now uses the server-side route — no credentials needed.
 */
export const fetchCloudSettings = async (): Promise<Partial<ApiSettings> | null> => {
    try {
        const res = await fetchWithProxy('stash_settings?select=settings_data&id=eq.main&limit=1', 'GET');
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
    try {
        // Strip sensitive credentials before saving to cloud
        const safeSettings = { ...settings };
        delete (safeSettings as any).shopifyAccessToken;
        delete (safeSettings as any).decoPassword;
        delete (safeSettings as any).supabaseAnonKey;
        delete (safeSettings as any).shipStationApiSecret;

        await fetchWithProxy('stash_settings', 'POST', {
            id: 'main',
            settings_data: safeSettings,
            updated_at: new Date().toISOString()
        }, 'resolution=merge-duplicates');
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn('Cloud Settings Save: Table "stash_settings" not found.');
        } else {
            console.error('Cloud Settings Save Failed:', e.message || e);
        }
    }
};
