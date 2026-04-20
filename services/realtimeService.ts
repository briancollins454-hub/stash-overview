/**
 * Supabase Realtime Service — subscribes to database changes so all devices
 * see updates instantly without manual refresh. Uses the @supabase/supabase-js
 * client purely for its Realtime channel (all REST ops still go through our
 * direct client in supabase.ts).
 */
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// Lightweight row shapes for the tables we care about
interface MappingRow { item_id: string; deco_id: string; }
interface JobLinkRow { order_id: string; job_id: string; }
interface PatternRow { shopify_pattern: string; deco_pattern: string; }

export interface RealtimeCallbacks {
  /** A single mapping row was inserted or updated */
  onMappingChange: (itemId: string, decoId: string) => void;
  /** A single job-link row was inserted or updated */
  onJobLinkChange: (orderId: string, jobId: string) => void;
  /** A single product-pattern row was inserted or updated */
  onPatternChange: (shopifyPattern: string, decoPattern: string) => void;
  /** Orders or deco jobs changed — do a lightweight cloud pull */
  onDataChange: (table: 'stash_orders' | 'stash_deco_jobs') => void;
}

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let isSubscribed = false;

/**
 * Initialise the Supabase Realtime subscription. Safe to call multiple times —
 * tears down the previous channel before creating a new one.
 */
export function startRealtime(
  supabaseUrl: string,
  supabaseAnonKey: string,
  callbacks: RealtimeCallbacks
): void {
  // Tear down previous subscription if any
  stopRealtime();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[Realtime] Missing Supabase credentials — skipping');
    return;
  }

  client = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
    // We only need the realtime features — disable auto-refresh of auth tokens
    auth: { persistSession: false, autoRefreshToken: false },
  });

  channel = client
    .channel('stash-sync')
    // Mappings — instant merge
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stash_mappings' },
      (payload) => {
        const row = (payload.new || {}) as MappingRow;
        if (row.item_id && row.deco_id) {
          callbacks.onMappingChange(row.item_id, row.deco_id);
        }
      }
    )
    // Job links — instant merge
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stash_job_links' },
      (payload) => {
        const row = (payload.new || {}) as JobLinkRow;
        if (row.order_id && row.job_id) {
          callbacks.onJobLinkChange(row.order_id, row.job_id);
        }
      }
    )
    // Product patterns — instant merge
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stash_product_patterns' },
      (payload) => {
        const row = (payload.new || {}) as PatternRow;
        if (row.shopify_pattern && row.deco_pattern) {
          callbacks.onPatternChange(row.shopify_pattern, row.deco_pattern);
        }
      }
    )
    // Orders — debounced data pull (JSONB blobs are too big for individual events)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stash_orders' },
      () => debouncedDataChange(callbacks, 'stash_orders')
    )
    // Deco jobs — debounced data pull
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stash_deco_jobs' },
      () => debouncedDataChange(callbacks, 'stash_deco_jobs')
    )
    .subscribe((status) => {
      isSubscribed = status === 'SUBSCRIBED';
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Connected — live sync active');
      } else if (status === 'CHANNEL_ERROR') {
        console.warn('[Realtime] Channel error — will auto-reconnect');
      } else if (status === 'TIMED_OUT') {
        console.warn('[Realtime] Subscription timed out — will retry');
      }
    });
}

// Debounce bulk data changes — multiple rows in quick succession (e.g. batch
// order saves) should trigger only one cloud pull after things settle.
const pendingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function debouncedDataChange(
  callbacks: RealtimeCallbacks,
  table: 'stash_orders' | 'stash_deco_jobs'
) {
  if (pendingTimers[table]) clearTimeout(pendingTimers[table]);
  pendingTimers[table] = setTimeout(() => {
    delete pendingTimers[table];
    callbacks.onDataChange(table);
  }, 3000); // 3s debounce — batch saves can write 20+ rows rapidly
}

/**
 * Tear down the realtime subscription. Safe to call even if not connected.
 */
export function stopRealtime(): void {
  if (channel && client) {
    client.removeChannel(channel);
  }
  if (client) {
    client.realtime.disconnect();
  }
  channel = null;
  client = null;
  isSubscribed = false;
  // Clear any pending debounce timers
  Object.values(pendingTimers).forEach(clearTimeout);
  Object.keys(pendingTimers).forEach(k => delete pendingTimers[k]);
}

/** Check whether realtime is currently connected */
export function isRealtimeConnected(): boolean {
  return isSubscribed;
}
