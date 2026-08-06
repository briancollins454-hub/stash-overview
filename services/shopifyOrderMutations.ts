import { ApiSettings } from '../components/SettingsModal';
import { fetchServerRoute } from './apiService';

/**
 * Shopify order write operations (tags + notes) via the /api/shopify proxy.
 *
 * Used by:
 *  - Batch Print Sheets: tag printed orders "Printed - DD/MM" so staff can
 *    see at a glance which sheets have already been run off (no duplicates).
 *  - Bulk Notes tool: append a note (typically the Deco job name + number)
 *    to many orders at once instead of editing each order individually.
 *    Because the dashboard links orders to Deco jobs by scanning the order
 *    note for a job number, appending "…47963…" also auto-links the order.
 */

export interface OrderMutationTarget {
  id: string; // Shopify GID (gid://shopify/Order/…)
  orderNumber: string;
}

export interface OrderMutationResult {
  id: string;
  orderNumber: string;
  ok: boolean;
  /** True when nothing needed doing (tag/note already present). Counted as ok. */
  skipped?: boolean;
  error?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** "Printed - DD/MM" for today (matches the manual tag format staff already use). */
export const formatPrintedTag = (date: Date = new Date()): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `Printed - ${dd}/${mm}`;
};

/** First "Printed…" tag on an order, or null. */
export const findPrintedTag = (tags: string[] | undefined | null): string | null => {
  for (const t of tags || []) {
    if (/^printed\b/i.test((t || '').trim())) return t;
  }
  return null;
};

const shopifyGraphQL = async (query: string, variables: Record<string, unknown>): Promise<any> => {
  const res = await fetchServerRoute('/api/shopify', { query, variables });
  return res.json();
};

const firstUserError = (payload: any): string | null => {
  const errs = payload?.userErrors;
  if (Array.isArray(errs) && errs.length > 0) return errs[0].message || 'Shopify rejected the change';
  return null;
};

/** Run `fn` over targets with modest concurrency, reporting progress after each batch. */
async function runBatched<T extends OrderMutationTarget>(
  targets: T[],
  fn: (t: T) => Promise<OrderMutationResult>,
  onProgress?: (done: number, total: number) => void,
  concurrency = 4,
): Promise<OrderMutationResult[]> {
  const out: OrderMutationResult[] = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const slice = targets.slice(i, i + concurrency);
    const settled = await Promise.allSettled(slice.map(t => fn(t)));
    settled.forEach((r, idx) => {
      if (r.status === 'fulfilled') out.push(r.value);
      else out.push({ id: slice[idx].id, orderNumber: slice[idx].orderNumber, ok: false, error: r.reason?.message || 'Request failed' });
    });
    onProgress?.(Math.min(i + concurrency, targets.length), targets.length);
    if (i + concurrency < targets.length) await delay(250); // stay well inside the GraphQL cost budget
  }
  return out;
}

/** Add tags to orders (Shopify tagsAdd — existing tags are preserved, exact duplicates ignored). */
export const addTagsToOrders = async (
  settings: ApiSettings,
  targets: OrderMutationTarget[],
  tags: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<OrderMutationResult[]> => {
  const unique = Array.from(new Map(targets.filter(t => t?.id).map(t => [t.id, t])).values());
  if (unique.length === 0 || tags.length === 0) return [];
  if (!settings.useLiveData) {
    return unique.map(t => ({ id: t.id, orderNumber: t.orderNumber, ok: false, error: 'Live data is disabled (demo mode)' }));
  }
  const mutation = `mutation addOrderTags($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
  return runBatched(unique, async (t) => {
    const json = await shopifyGraphQL(mutation, { id: t.id, tags });
    if (json.errors?.length) return { id: t.id, orderNumber: t.orderNumber, ok: false, error: json.errors[0]?.message };
    const err = firstUserError(json.data?.tagsAdd);
    if (err) return { id: t.id, orderNumber: t.orderNumber, ok: false, error: err };
    return { id: t.id, orderNumber: t.orderNumber, ok: true };
  }, onProgress);
};

export interface OrderNoteState {
  id: string;
  note: string;
  tags: string[];
}

/** Current note + tags for a set of order GIDs (chunked `nodes` lookup). */
export const fetchOrdersNoteState = async (
  settings: ApiSettings,
  ids: string[],
): Promise<Map<string, OrderNoteState>> => {
  const map = new Map<string, OrderNoteState>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!settings.useLiveData || unique.length === 0) return map;
  const query = `query orderNotes($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id note tags } } }`;
  const CHUNK = 50;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const json = await shopifyGraphQL(query, { ids: chunk });
    if (json.errors?.length) throw new Error(json.errors[0]?.message || 'Failed to load current notes');
    for (const node of json.data?.nodes || []) {
      if (node?.id) map.set(node.id, { id: node.id, note: node.note || '', tags: node.tags || [] });
    }
  }
  return map;
};

/**
 * Resolve display order numbers (e.g. "224981") to Shopify order GIDs for
 * orders that aren't in the local cache (old/archived orders from a CSV).
 */
export const resolveOrderIdsByNumber = async (
  settings: ApiSettings,
  orderNumbers: string[],
): Promise<Map<string, OrderMutationTarget & { customerName?: string }>> => {
  const out = new Map<string, OrderMutationTarget & { customerName?: string }>();
  const unique = Array.from(new Set(orderNumbers.map(n => String(n || '').trim()).filter(Boolean)));
  if (!settings.useLiveData || unique.length === 0) return out;
  const query = `query findOrder($query: String!) { orders(first: 5, query: $query) { edges { node { id name billingAddress { firstName lastName } } } } }`;
  const CONCURRENCY = 3;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const slice = unique.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(async num => {
      const json = await shopifyGraphQL(query, { query: `name:${num}` });
      const nodes = (json.data?.orders?.edges || []).map((e: any) => e.node);
      const hit = nodes.find((n: any) => String(n.name || '').replace('#', '') === num);
      return hit ? { num, hit } : null;
    }));
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        const { num, hit } = r.value;
        const custName = hit.billingAddress ? `${hit.billingAddress.firstName || ''} ${hit.billingAddress.lastName || ''}`.trim() : undefined;
        out.set(num, { id: hit.id, orderNumber: num, customerName: custName || undefined });
      }
    });
    if (i + CONCURRENCY < unique.length) await delay(300);
  }
  return out;
};

export interface OrderNoteUpdate extends OrderMutationTarget {
  note: string;
}

/** Set the order note (Shopify orderUpdate). Caller decides append vs replace by composing `note`. */
export const updateOrderNotes = async (
  settings: ApiSettings,
  updates: OrderNoteUpdate[],
  onProgress?: (done: number, total: number) => void,
): Promise<OrderMutationResult[]> => {
  const unique = Array.from(new Map(updates.filter(u => u?.id).map(u => [u.id, u])).values());
  if (unique.length === 0) return [];
  if (!settings.useLiveData) {
    return unique.map(u => ({ id: u.id, orderNumber: u.orderNumber, ok: false, error: 'Live data is disabled (demo mode)' }));
  }
  const mutation = `mutation setOrderNote($input: OrderInput!) { orderUpdate(input: $input) { order { id note } userErrors { field message } } }`;
  return runBatched(unique, async (u) => {
    const json = await shopifyGraphQL(mutation, { input: { id: u.id, note: u.note } });
    if (json.errors?.length) return { id: u.id, orderNumber: u.orderNumber, ok: false, error: json.errors[0]?.message };
    const err = firstUserError(json.data?.orderUpdate);
    if (err) return { id: u.id, orderNumber: u.orderNumber, ok: false, error: err };
    return { id: u.id, orderNumber: u.orderNumber, ok: true };
  }, onProgress);
};

/**
 * Parse pasted text (plain list, WhatsApp message, or a Shopify CSV export)
 * into order numbers. When the text contains #-prefixed numbers (Shopify's
 * "Name" column), ONLY those are used — avoids picking up quantities, prices
 * and postcodes from other CSV columns. Otherwise falls back to bare numeric
 * tokens (3–8 digits).
 */
export const parseOrderNumbersFromText = (text: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (n: string) => {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  };
  const hashMatches = Array.from(text.matchAll(/#\s?(\d{3,8})/g));
  if (hashMatches.length > 0) {
    hashMatches.forEach(m => push(m[1]));
    return out;
  }
  text.split(/[\s,;]+/).forEach(tok => {
    const t = tok.trim();
    if (/^\d{3,8}$/.test(t)) push(t);
  });
  return out;
};

/** Compose the final note for append/replace, or null when nothing needs writing. */
export const composeOrderNote = (
  existingNote: string,
  addition: string,
  mode: 'append' | 'replace',
): string | null => {
  const add = addition.trim();
  if (!add) return null;
  const existing = (existingNote || '').trim();
  if (mode === 'replace') {
    return existing === add ? null : add;
  }
  if (existing.includes(add)) return null; // idempotent — already there
  return existing ? `${existing}\n${add}` : add;
};
