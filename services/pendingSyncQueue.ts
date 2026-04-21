/**
 * Pending Sync Queue
 * ------------------
 * Durable, per-device queue of mutations that need to reach Supabase. Every
 * user-initiated write (mapping upsert, job link, learned pattern, or their
 * deletes) is enqueued BEFORE the cloud call. If the cloud call succeeds the
 * op is removed; if it fails it stays queued and is retried on:
 *   (a) next app load,
 *   (b) realtime websocket reconnect,
 *   (c) an explicit flushPending() call.
 *
 * This replaces the previous pattern where the app blindly re-pushed the
 * entire local IndexedDB cache on every startup — a design that caused stale
 * tabs to overwrite fresh cloud data and silently erase other users' work.
 *
 * Only ops that were actually made on THIS device enter the queue, so we
 * never clobber mutations made elsewhere.
 */

import { getItem as getLocalItem, setItem as setLocalItem } from './localStore';
import {
    saveCloudMappingStrict,
    saveCloudJobLinkStrict,
    saveCloudProductPatternStrict,
    deleteCloudMapping,
    deleteCloudJobLink,
    deleteCloudProductPattern,
    getCloudMappingUpdatedAt,
    getCloudJobLinkUpdatedAt,
    getCloudPatternUpdatedAt,
} from './syncService';

const STORAGE_KEY = 'stash_pending_sync';
const MAX_ATTEMPTS = 8; // after this many failures, log loudly and drop

export type PendingMappingUpsert = {
    id: string; // internal queue id
    kind: 'mapping';
    op: 'upsert';
    item_id: string;
    deco_id: string;
    updated_at: string; // ISO
    attempts: number;
};
export type PendingMappingDelete = {
    id: string;
    kind: 'mapping';
    op: 'delete';
    item_id: string;
    updated_at: string;
    attempts: number;
};
export type PendingJobLinkUpsert = {
    id: string;
    kind: 'joblink';
    op: 'upsert';
    order_id: string;
    job_id: string;
    updated_at: string;
    attempts: number;
};
export type PendingJobLinkDelete = {
    id: string;
    kind: 'joblink';
    op: 'delete';
    order_id: string;
    updated_at: string;
    attempts: number;
};
export type PendingPatternUpsert = {
    id: string;
    kind: 'pattern';
    op: 'upsert';
    shopify_pattern: string;
    deco_pattern: string;
    updated_at: string;
    attempts: number;
};
export type PendingPatternDelete = {
    id: string;
    kind: 'pattern';
    op: 'delete';
    shopify_pattern: string;
    updated_at: string;
    attempts: number;
};

export type PendingOp =
    | PendingMappingUpsert
    | PendingMappingDelete
    | PendingJobLinkUpsert
    | PendingJobLinkDelete
    | PendingPatternUpsert
    | PendingPatternDelete;

// Simple mutex to prevent two concurrent flushes from racing the same op
let flushInFlight: Promise<FlushResult> | null = null;

const genId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const readQueue = async (): Promise<PendingOp[]> => {
    const q = await getLocalItem<PendingOp[]>(STORAGE_KEY);
    return Array.isArray(q) ? q : [];
};

const writeQueue = async (q: PendingOp[]): Promise<void> => {
    await setLocalItem(STORAGE_KEY, q);
};

/**
 * Collapse superseding ops on the SAME target so the queue can't balloon.
 * Example: if mapping X was upserted 3 times while offline, only the last
 * version needs to be sent. A delete on X also supersedes any prior upsert.
 */
const collapse = (q: PendingOp[]): PendingOp[] => {
    const seen = new Map<string, PendingOp>();
    const keyOf = (op: PendingOp): string => {
        switch (op.kind) {
            case 'mapping': return `mapping:${op.item_id}`;
            case 'joblink': return `joblink:${op.order_id}`;
            case 'pattern': return `pattern:${op.shopify_pattern}`;
        }
    };
    for (const op of q) {
        const k = keyOf(op);
        const existing = seen.get(k);
        if (!existing) { seen.set(k, op); continue; }
        // Keep whichever has the later updated_at, preserving the HIGHER attempt count
        const keepNew = new Date(op.updated_at).getTime() >= new Date(existing.updated_at).getTime();
        const winner = keepNew ? op : existing;
        winner.attempts = Math.max(op.attempts, existing.attempts);
        seen.set(k, winner);
    }
    return Array.from(seen.values());
};

const pushOp = async (op: PendingOp): Promise<void> => {
    const q = await readQueue();
    q.push(op);
    await writeQueue(collapse(q));
};

export const enqueueMappingUpsert = (item_id: string, deco_id: string, updated_at = new Date().toISOString()) =>
    pushOp({ id: genId(), kind: 'mapping', op: 'upsert', item_id, deco_id, updated_at, attempts: 0 });

export const enqueueMappingDelete = (item_id: string, updated_at = new Date().toISOString()) =>
    pushOp({ id: genId(), kind: 'mapping', op: 'delete', item_id, updated_at, attempts: 0 });

export const enqueueJobLinkUpsert = (order_id: string, job_id: string, updated_at = new Date().toISOString()) =>
    pushOp({ id: genId(), kind: 'joblink', op: 'upsert', order_id, job_id, updated_at, attempts: 0 });

export const enqueueJobLinkDelete = (order_id: string, updated_at = new Date().toISOString()) =>
    pushOp({ id: genId(), kind: 'joblink', op: 'delete', order_id, updated_at, attempts: 0 });

export const enqueuePatternUpsert = (shopify_pattern: string, deco_pattern: string, updated_at = new Date().toISOString()) =>
    pushOp({ id: genId(), kind: 'pattern', op: 'upsert', shopify_pattern, deco_pattern, updated_at, attempts: 0 });

export const enqueuePatternDelete = (shopify_pattern: string, updated_at = new Date().toISOString()) =>
    pushOp({ id: genId(), kind: 'pattern', op: 'delete', shopify_pattern, updated_at, attempts: 0 });

export const getPendingCount = async (): Promise<number> => (await readQueue()).length;

export const clearPendingQueue = async (): Promise<void> => writeQueue([]);

/**
 * Snapshot the queue as three overlay dicts (mappings, jobLinks, patterns).
 * Used when merging freshly-fetched cloud state into local: cloud is the
 * source of truth EXCEPT where we still have a queued-but-not-yet-confirmed
 * write. That local write must win until it is either successfully flushed or
 * explicitly dropped — otherwise the UI would momentarily "un-map" the item
 * the user just mapped.
 */
export interface PendingOverlay {
    mappings: Record<string, string>;
    mappingDeletes: Set<string>;
    jobLinks: Record<string, string>;
    jobLinkDeletes: Set<string>;
    patterns: Record<string, string>;
    patternDeletes: Set<string>;
}
export const getPendingOverlay = async (): Promise<PendingOverlay> => {
    const q = await readQueue();
    const overlay: PendingOverlay = {
        mappings: {}, mappingDeletes: new Set(),
        jobLinks: {}, jobLinkDeletes: new Set(),
        patterns: {}, patternDeletes: new Set(),
    };
    for (const op of q) {
        if (op.kind === 'mapping' && op.op === 'upsert') overlay.mappings[op.item_id] = op.deco_id;
        else if (op.kind === 'mapping' && op.op === 'delete') overlay.mappingDeletes.add(op.item_id);
        else if (op.kind === 'joblink' && op.op === 'upsert') overlay.jobLinks[op.order_id] = op.job_id;
        else if (op.kind === 'joblink' && op.op === 'delete') overlay.jobLinkDeletes.add(op.order_id);
        else if (op.kind === 'pattern' && op.op === 'upsert') overlay.patterns[op.shopify_pattern] = op.deco_pattern;
        else if (op.kind === 'pattern' && op.op === 'delete') overlay.patternDeletes.add(op.shopify_pattern);
    }
    return overlay;
};

export interface FlushResult {
    total: number;
    sent: number;
    failed: number;
    skipped: number; // skipped because cloud is newer
    remaining: number;
}

/**
 * Attempt to ship every queued op to Supabase. Successful ops are removed;
 * failures stay queued (with attempts++) for the next retry cycle.
 *
 * Conflict handling: before an upsert we fetch the row's current updated_at
 * from cloud. If cloud is newer than our queued op, we SKIP — i.e. we don't
 * stomp on fresher data made by someone else. This is the core defence
 * against stale tabs overwriting newer work.
 */
export const flushPending = async (): Promise<FlushResult> => {
    if (flushInFlight) return flushInFlight;

    const work = (async (): Promise<FlushResult> => {
        const queue = await readQueue();
        if (queue.length === 0) return { total: 0, sent: 0, failed: 0, skipped: 0, remaining: 0 };

        const remaining: PendingOp[] = [];
        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const op of queue) {
            let success = false;
            let skip = false;

            try {
                // Look up the current cloud `updated_at` for this row once, so
                // both upserts AND deletes can refuse to stomp newer state.
                let cloudTs: string | null = null;
                if (op.kind === 'mapping') cloudTs = await getCloudMappingUpdatedAt(op.item_id);
                else if (op.kind === 'joblink') cloudTs = await getCloudJobLinkUpdatedAt(op.order_id);
                else if (op.kind === 'pattern') cloudTs = await getCloudPatternUpdatedAt(op.shopify_pattern);

                const cloudIsNewer = !!cloudTs && new Date(cloudTs).getTime() > new Date(op.updated_at).getTime();

                if (op.op === 'upsert') {
                    if (cloudIsNewer) {
                        skip = true;
                    } else {
                        if (op.kind === 'mapping') success = await saveCloudMappingStrict(op.item_id, op.deco_id, op.updated_at);
                        else if (op.kind === 'joblink') success = await saveCloudJobLinkStrict(op.order_id, op.job_id, op.updated_at);
                        else if (op.kind === 'pattern') success = await saveCloudProductPatternStrict(op.shopify_pattern, op.deco_pattern, op.updated_at);
                    }
                } else if (op.op === 'delete') {
                    // Same conflict rule as upserts: if the cloud row was
                    // touched AFTER we queued this delete, another user/tab
                    // re-created or re-mapped it. Skip rather than silently
                    // wiping their newer work. The next realtime pull will
                    // converge us to the cloud state.
                    if (cloudIsNewer) {
                        skip = true;
                    } else if (cloudTs === null) {
                        // Row is already gone from the cloud — treat as success.
                        success = true;
                    } else {
                        if (op.kind === 'mapping') success = await deleteCloudMapping(op.item_id);
                        else if (op.kind === 'joblink') success = await deleteCloudJobLink(op.order_id);
                        else if (op.kind === 'pattern') success = await deleteCloudProductPattern(op.shopify_pattern);
                    }
                }
            } catch (e) {
                console.error('[pending-sync] flush op errored:', op, e);
                success = false;
            }

            if (skip) {
                skipped++;
                // Skip means cloud has newer data — drop the queued op; next realtime
                // pull will converge local to the newer value.
                continue;
            }
            if (success) {
                sent++;
                continue;
            }
            op.attempts++;
            failed++;
            if (op.attempts >= MAX_ATTEMPTS) {
                console.warn(`[pending-sync] dropping op after ${MAX_ATTEMPTS} failed attempts:`, op);
                continue;
            }
            remaining.push(op);
        }

        await writeQueue(remaining);
        return { total: queue.length, sent, failed, skipped, remaining: remaining.length };
    })();

    flushInFlight = work;
    try {
        return await work;
    } finally {
        flushInFlight = null;
    }
};
