
import { ApiSettings } from '../components/SettingsModal';
import { ShopifyOrder, PhysicalStockItem, ReturnStockItem, ReferenceProduct, DecoJob } from '../types';
import { supabaseFetch } from './supabase';
import { trackSave } from './syncAuditService';

/**
 * SyncService handles the persistence of user-defined data (mappings/links),
 * cached Shopify order data, and physical inventory to Supabase directly.
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

        return await supabaseFetch(path, method, body, preferValues.join(', '));
    } catch (e: any) {
        // Only log as error if it's NOT a 404 (which is often just a missing table)
        if (e.status !== 404) {
            console.error("Supabase Error:", e.message);
        }
        throw e;
    }
};

const fetchAllFromCloud = async <T>(table: string, select = '*', offset = 0, limit = 1000, retries = 2): Promise<T[] | null> => {
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
    const uniqueOrders = Array.from(new Map(orders.map(o => [o.id, o])).values());
    return trackSave('stash_orders', uniqueOrders.length, async () => {
        try {
            // Clean fulfilled/restocked orders from cloud — they should not be synced
            try {
                await fetchWithProxy(`stash_orders?order_data->>fulfillmentStatus=in.(fulfilled,restocked)`, 'DELETE');
            } catch (cleanupErr) {
                console.warn('Cloud order cleanup failed (non-fatal):', cleanupErr);
            }

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
    });
};

export const saveCloudDecoJobs = async (settings: ApiSettings, jobs: DecoJob[]) => {
    if (jobs.length === 0) return;
    const uniqueJobs = Array.from(new Map(jobs.map(j => [j.jobNumber, j])).values());
    return trackSave('stash_deco_jobs', uniqueJobs.length, async () => {
        try {
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
                    throw new Error(`Deco Job Batch Save Error: ${error}`);
                }
            }
        } catch (e: any) {
            if (e.status === 404 || e.message.includes('404')) {
                console.warn('Cloud Deco Job Save Failed: Table "stash_deco_jobs" not found. Create it in Supabase.');
            } else {
                console.error('Cloud Deco Job Save Failed:', e.message || e);
            }
            throw e;
        }
    });
};

export const savePhysicalStockItem = async (settings: ApiSettings, item: PhysicalStockItem) => {
    return trackSave('stash_stock', 1, async () => {
        try {
            await fetchWithProxy('stash_stock', 'POST', item, 'resolution=merge-duplicates');
        } catch (e) {
            console.error('savePhysicalStockItem failed:', e);
            throw e;
        }
    });
};

export const deletePhysicalStockItem = async (settings: ApiSettings, id: string) => {
    return trackSave('stash_stock', 1, async () => {
        try {
            await fetchWithProxy(`stash_stock?id=eq.${id}`, 'DELETE');
        } catch (e) {
            console.error('deletePhysicalStockItem failed:', e);
            throw e;
        }
    }, 'delete');
};

export const saveReturnStockItem = async (settings: ApiSettings, item: ReturnStockItem) => {
    return trackSave('stash_returns', 1, async () => {
        try {
            await fetchWithProxy('stash_returns', 'POST', item, 'resolution=merge-duplicates');
        } catch (e) {
            console.error('saveReturnStockItem failed:', e);
            throw e;
        }
    });
};

export const deleteReturnStockItem = async (settings: ApiSettings, id: string) => {
    return trackSave('stash_returns', 1, async () => {
        try {
            await fetchWithProxy(`stash_returns?id=eq.${id}`, 'DELETE');
        } catch (e) {
            console.error('deleteReturnStockItem failed:', e);
            throw e;
        }
    }, 'delete');
};

export const saveReferenceProducts = async (settings: ApiSettings, products: ReferenceProduct[]) => {
    if (products.length === 0) return;
    // Fix: Deduplicate by EAN (Primary Key) to prevent Postgres error 21000
    const uniqueProducts = Array.from(
        new Map(products.map(p => [p.ean.trim(), p])).values()
    );
    return trackSave('stash_reference_products', uniqueProducts.length, async () => {
        try {
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
    });
};

export const saveCloudJobLink = async (settings: ApiSettings, order_id: string, job_id: string) => {
    try {
        await trackSave('stash_job_links', 1, async () => {
            await fetchWithProxy('stash_job_links', 'POST', { order_id, job_id, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates');
        });
    } catch (e) {
        console.error('Cloud Job Link Save Failed:', e);
    }
};

/**
 * Strict single-row writes that RETURN success/failure so callers (and the
 * pending-sync queue) can react to real errors instead of silently swallowing
 * them. Each of these accepts an explicit updated_at so the caller decides
 * timestamp ordering.
 */
export const saveCloudMappingStrict = async (item_id: string, deco_id: string, updated_at: string): Promise<boolean> => {
    try {
        return await trackSave('stash_mappings', 1, async () => {
            const res = await fetchWithProxy('stash_mappings', 'POST', [{ item_id, deco_id, updated_at }], 'resolution=merge-duplicates');
            if (!res.ok) throw new Error(`mapping upsert ${res.status}`);
            return true;
        });
    } catch (e: any) {
        console.error('[pending-sync] mapping upsert failed:', e.message || e);
        return false;
    }
};

export const saveCloudJobLinkStrict = async (order_id: string, job_id: string, updated_at: string): Promise<boolean> => {
    try {
        return await trackSave('stash_job_links', 1, async () => {
            const res = await fetchWithProxy('stash_job_links', 'POST', [{ order_id, job_id, updated_at }], 'resolution=merge-duplicates');
            if (!res.ok) throw new Error(`job link upsert ${res.status}`);
            return true;
        });
    } catch (e: any) {
        console.error('[pending-sync] job link upsert failed:', e.message || e);
        return false;
    }
};

export const saveCloudProductPatternStrict = async (shopify_pattern: string, deco_pattern: string, updated_at: string): Promise<boolean> => {
    try {
        return await trackSave('stash_product_patterns', 1, async () => {
            const res = await fetchWithProxy('stash_product_patterns', 'POST', [{ shopify_pattern, deco_pattern, updated_at }], 'resolution=merge-duplicates');
            if (!res.ok) throw new Error(`pattern upsert ${res.status}`);
            return true;
        });
    } catch (e: any) {
        console.error('[pending-sync] pattern upsert failed:', e.message || e);
        return false;
    }
};

export const deleteCloudMapping = async (item_id: string): Promise<boolean> => {
    try {
        return await trackSave('stash_mappings', 1, async () => {
            const encoded = encodeURIComponent(item_id);
            const res = await fetchWithProxy(`stash_mappings?item_id=eq.${encoded}`, 'DELETE');
            if (!res.ok) throw new Error(`mapping delete ${res.status}`);
            return true;
        }, 'delete');
    } catch (e: any) {
        console.error('[pending-sync] mapping delete failed:', e.message || e);
        return false;
    }
};

export const deleteCloudJobLink = async (order_id: string): Promise<boolean> => {
    try {
        return await trackSave('stash_job_links', 1, async () => {
            const encoded = encodeURIComponent(order_id);
            const res = await fetchWithProxy(`stash_job_links?order_id=eq.${encoded}`, 'DELETE');
            if (!res.ok) throw new Error(`job link delete ${res.status}`);
            return true;
        }, 'delete');
    } catch (e: any) {
        console.error('[pending-sync] job link delete failed:', e.message || e);
        return false;
    }
};

export const deleteCloudProductPattern = async (shopify_pattern: string): Promise<boolean> => {
    try {
        return await trackSave('stash_product_patterns', 1, async () => {
            const encoded = encodeURIComponent(shopify_pattern);
            const res = await fetchWithProxy(`stash_product_patterns?shopify_pattern=eq.${encoded}`, 'DELETE');
            if (!res.ok) throw new Error(`pattern delete ${res.status}`);
            return true;
        }, 'delete');
    } catch (e: any) {
        console.error('[pending-sync] pattern delete failed:', e.message || e);
        return false;
    }
};

/**
 * Fetch the latest updated_at for a single mapping row. Used by the
 * pending-sync queue to skip pushes that would stomp on newer cloud state.
 */
export const getCloudMappingUpdatedAt = async (item_id: string): Promise<string | null> => {
    try {
        const encoded = encodeURIComponent(item_id);
        const res = await fetchWithProxy(`stash_mappings?select=updated_at&item_id=eq.${encoded}`, 'GET');
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].updated_at) return String(rows[0].updated_at);
        return null;
    } catch {
        return null;
    }
};

export const getCloudJobLinkUpdatedAt = async (order_id: string): Promise<string | null> => {
    try {
        const encoded = encodeURIComponent(order_id);
        const res = await fetchWithProxy(`stash_job_links?select=updated_at&order_id=eq.${encoded}`, 'GET');
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].updated_at) return String(rows[0].updated_at);
        return null;
    } catch {
        return null;
    }
};

export const getCloudPatternUpdatedAt = async (shopify_pattern: string): Promise<string | null> => {
    try {
        const encoded = encodeURIComponent(shopify_pattern);
        const res = await fetchWithProxy(`stash_product_patterns?select=updated_at&shopify_pattern=eq.${encoded}`, 'GET');
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].updated_at) return String(rows[0].updated_at);
        return null;
    } catch {
        return null;
    }
};

export const saveCloudJobLinkBatch = async (settings: ApiSettings, links: Record<string, string>) => {
    const entries = Object.entries(links);
    if (entries.length === 0) return;
    try {
        await trackSave('stash_job_links', entries.length, async () => {
            const batchSize = 100;
            for (let i = 0; i < entries.length; i += batchSize) {
                const batch = entries.slice(i, i + batchSize).map(([order_id, job_id]) => ({
                    order_id, job_id, updated_at: new Date().toISOString()
                }));
                const res = await fetchWithProxy('stash_job_links', 'POST', batch, 'resolution=merge-duplicates');
                if (!res.ok) {
                    const err = await res.text();
                    throw new Error(`Job Link Batch Save Error: ${err}`);
                }
            }
        });
    } catch (e: any) {
        console.error('Cloud Job Link Batch Save Failed:', e.message || e);
    }
};

export const saveCloudProductMappingBatch = async (settings: ApiSettings, mappings: Record<string, string>) => {
    const entries = Object.entries(mappings);
    if (entries.length === 0) return;
    try {
        await trackSave('stash_product_patterns', entries.length, async () => {
            const batchSize = 100;
            for (let i = 0; i < entries.length; i += batchSize) {
                const batch = entries.slice(i, i + batchSize).map(([shopify_pattern, deco_pattern]) => ({
                    shopify_pattern, deco_pattern, updated_at: new Date().toISOString()
                }));
                const res = await fetchWithProxy('stash_product_patterns', 'POST', batch, 'resolution=merge-duplicates');
                if (!res.ok) {
                    const err = await res.text();
                    throw new Error(`Product Mapping Batch Save Error: ${err}`);
                }
            }
        });
    } catch (e: any) {
        console.error('Cloud Product Mapping Batch Save Failed:', e.message || e);
    }
};

export const saveCloudMappingBatch = async (settings: ApiSettings, mappings: { item_id: string, deco_id: string }[]) => {
    if (mappings.length === 0) return;
    // Dedup by item ID to prevent Postgres error 21000
    const uniqueMappings = Array.from(new Map(mappings.map(m => [m.item_id, m])).values());
    try {
        await trackSave('stash_mappings', uniqueMappings.length, async () => {
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
                    throw new Error(`Mapping Batch Save Error: ${err}`);
                }
            }
        });
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
        await trackSave('stash_product_patterns', 1, async () => {
            await fetchWithProxy('stash_product_patterns', 'POST', { shopify_pattern, deco_pattern, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates');
        });
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
        await trackSave('stash_settings', 1, async () => {
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
        });
    } catch (e: any) {
        if (e.status === 404 || e.message.includes('404')) {
            console.warn('Cloud Settings Save: Table "stash_settings" not found.');
        } else {
            console.error('Cloud Settings Save Failed:', e.message || e);
        }
    }
};

/* ---------- Deco Stitch Cache (Supabase) ---------- */
export interface CloudStitchCache {
    job_number: string;
    decoration_data: {
        items: Array<{ lineIndex: number; decorationType?: string; stitchCount?: number }>;
    };
    enriched_at: string;
}

export const fetchStitchCache = async (): Promise<Map<string, CloudStitchCache>> => {
    const map = new Map<string, CloudStitchCache>();
    try {
        const rows = await fetchAllFromCloud<CloudStitchCache>('stash_deco_stitch_cache');
        if (rows) {
            rows.forEach(r => map.set(r.job_number, r));
        }
    } catch (e) {
        console.warn('Stitch cache fetch failed:', e);
    }
    return map;
};

export const saveStitchCache = async (entries: Array<{ job_number: string; items: Array<{ lineIndex: number; decorationType?: string; stitchCount?: number }>; enriched_at: string }>) => {
    if (entries.length === 0) return;
    try {
        await trackSave('stash_deco_stitch_cache', entries.length, async () => {
            const batchSize = 20;
            for (let i = 0; i < entries.length; i += batchSize) {
                const batch = entries.slice(i, i + batchSize);
                const payload = batch.map(e => ({
                    job_number: e.job_number,
                    decoration_data: { items: e.items },
                    enriched_at: e.enriched_at,
                    updated_at: new Date().toISOString(),
                }));
                const res = await fetchWithProxy('stash_deco_stitch_cache', 'POST', payload, 'resolution=merge-duplicates');
                if (!res.ok) {
                    const err = await res.text();
                    throw new Error(`stitch cache batch failed: ${err}`);
                }
            }
        });
    } catch (e) {
        console.warn('Stitch cache save failed:', e);
    }
};
