// ─── Stash — Rota Supabase service ─────────────────────────────────────────
// Thin wrapper around supabaseFetch for the five stash_rota_* tables.
// All write helpers return the updated row(s) so optimistic UI can confirm.
// Email notifications (manager-on-request, staff-on-decision) live in
// /api/rota.ts and are triggered through dispatchRotaEmail() below.

import { isSupabaseReady, supabaseFetch } from './supabase';
import { auth } from '../firebase';
import type {
    RotaAuditEntry,
    RotaBlockedDate,
    RotaClosure,
    RotaEmployee,
    RotaShift,
    RotaShiftAck,
    RotaSwapRequest,
    RotaTimeOff,
    RotaToilEntry,
} from '../utils/rota';

const T_EMP = 'stash_rota_employees';
const T_SHIFTS = 'stash_rota_shifts';
const T_TIMEOFF = 'stash_rota_time_off';
const T_CLOSURES = 'stash_rota_closures';
const T_SWAPS = 'stash_rota_swap_requests';
const T_ACKS = 'stash_rota_shift_acks';
const T_TOIL = 'stash_rota_toil';
const T_BLOCKED = 'stash_rota_blocked_dates';
const T_AUDIT = 'stash_rota_audit';

async function readJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!text) return [] as unknown as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        return [] as unknown as T;
    }
}

const CUSTOM_AUTH_KEY = 'stash_custom_auth';

async function getRotaAuthPayload(): Promise<{ token?: string; firebaseIdToken?: string }> {
    const out: { token?: string; firebaseIdToken?: string } = {};
    try {
        const stored = localStorage.getItem(CUSTOM_AUTH_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed?.token) out.token = String(parsed.token);
        }
    } catch {
        // ignore
    }
    try {
        const user = auth.currentUser;
        if (user) out.firebaseIdToken = await user.getIdToken();
    } catch {
        // ignore
    }
    return out;
}

async function rotaWrite(path: string, method: string, body?: any, prefer?: string): Promise<Response> {
    const authPayload = await getRotaAuthPayload();
    const resp = await fetch('/api/rota-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            path,
            method,
            body,
            prefer,
            ...authPayload,
        }),
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        let msg = `Rota API ${resp.status}`;
        try {
            const parsed = JSON.parse(txt);
            msg = parsed?.error || msg;
        } catch {
            if (txt) msg = txt;
        }
        const err = new Error(msg) as any;
        err.status = resp.status;
        throw err;
    }
    return resp;
}

// ─── Employees ─────────────────────────────────────────────────────────────
export async function fetchEmployees(): Promise<RotaEmployee[]> {
    if (!isSupabaseReady()) return [];
    const res = await supabaseFetch(`${T_EMP}?select=*&order=display_name.asc`, 'GET');
    return readJson<RotaEmployee[]>(res);
}

export async function upsertEmployee(emp: Partial<RotaEmployee> & { user_id: string }): Promise<RotaEmployee | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(T_EMP, 'POST', [emp], 'resolution=merge-duplicates,return=representation');
    const rows = await readJson<RotaEmployee[]>(res);
    return rows[0] || null;
}

export async function deactivateEmployee(userId: string): Promise<void> {
    if (!isSupabaseReady()) return;
    await rotaWrite(`${T_EMP}?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH', { is_active: false });
}

// ─── Shifts ────────────────────────────────────────────────────────────────
export async function fetchShiftsInRange(startIso: string, endIso: string): Promise<RotaShift[]> {
    if (!isSupabaseReady()) return [];
    const path = `${T_SHIFTS}?select=*&start_at=gte.${encodeURIComponent(startIso)}&start_at=lt.${encodeURIComponent(endIso)}&order=start_at.asc`;
    const res = await supabaseFetch(path, 'GET');
    return readJson<RotaShift[]>(res);
}

export async function fetchShiftsForUser(userId: string, startIso: string, endIso: string): Promise<RotaShift[]> {
    if (!isSupabaseReady()) return [];
    const path = `${T_SHIFTS}?select=*&user_id=eq.${encodeURIComponent(userId)}&start_at=gte.${encodeURIComponent(startIso)}&start_at=lt.${encodeURIComponent(endIso)}&order=start_at.asc`;
    const res = await supabaseFetch(path, 'GET');
    return readJson<RotaShift[]>(res);
}

export type ShiftInput = Omit<RotaShift, 'id' | 'created_at' | 'updated_at'> & { id?: number };

export async function saveShift(shift: ShiftInput): Promise<RotaShift | null> {
    if (!isSupabaseReady()) return null;
    if (shift.id) {
        const { id, ...rest } = shift;
        const res = await rotaWrite(`${T_SHIFTS}?id=eq.${id}`, 'PATCH', rest, 'return=representation');
        const rows = await readJson<RotaShift[]>(res);
        return rows[0] || null;
    }
    const res = await rotaWrite(T_SHIFTS, 'POST', [shift], 'return=representation');
    const rows = await readJson<RotaShift[]>(res);
    return rows[0] || null;
}

export async function bulkInsertShifts(shifts: ShiftInput[]): Promise<RotaShift[]> {
    if (!isSupabaseReady() || shifts.length === 0) return [];
    const res = await rotaWrite(T_SHIFTS, 'POST', shifts, 'return=representation');
    return readJson<RotaShift[]>(res);
}

export async function deleteShift(id: number): Promise<void> {
    if (!isSupabaseReady()) return;
    await rotaWrite(`${T_SHIFTS}?id=eq.${id}`, 'DELETE');
}

// ─── Time-off ──────────────────────────────────────────────────────────────
export async function fetchTimeOff(opts: { userId?: string; status?: string } = {}): Promise<RotaTimeOff[]> {
    if (!isSupabaseReady()) return [];
    const parts = ['select=*', 'order=start_date.desc'];
    if (opts.userId) parts.push(`user_id=eq.${encodeURIComponent(opts.userId)}`);
    if (opts.status) parts.push(`status=eq.${encodeURIComponent(opts.status)}`);
    const res = await supabaseFetch(`${T_TIMEOFF}?${parts.join('&')}`, 'GET');
    return readJson<RotaTimeOff[]>(res);
}

export type TimeOffInput = Omit<RotaTimeOff, 'id' | 'requested_at' | 'updated_at'> & { id?: number };

export async function submitTimeOff(req: TimeOffInput): Promise<RotaTimeOff | null> {
    if (!isSupabaseReady()) return null;
    if (req.id) {
        const { id, ...rest } = req;
        const res = await rotaWrite(`${T_TIMEOFF}?id=eq.${id}`, 'PATCH', rest, 'return=representation');
        const rows = await readJson<RotaTimeOff[]>(res);
        return rows[0] || null;
    }
    const res = await rotaWrite(T_TIMEOFF, 'POST', [req], 'return=representation');
    const rows = await readJson<RotaTimeOff[]>(res);
    return rows[0] || null;
}

export async function decideTimeOff(id: number, status: 'approved' | 'declined' | 'cancelled', decidedBy: string, note: string = ''): Promise<RotaTimeOff | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(`${T_TIMEOFF}?id=eq.${id}`, 'PATCH', {
        status,
        decided_by: decidedBy,
        decided_at: new Date().toISOString(),
        decided_note: note,
    }, 'return=representation');
    const rows = await readJson<RotaTimeOff[]>(res);
    return rows[0] || null;
}

// ─── Closures ─────────────────────────────────────────────────────────────
export async function fetchClosures(): Promise<RotaClosure[]> {
    if (!isSupabaseReady()) return [];
    const res = await supabaseFetch(`${T_CLOSURES}?select=*&order=closure_date.asc`, 'GET');
    return readJson<RotaClosure[]>(res);
}

export async function upsertClosure(closure: Partial<RotaClosure> & { closure_date: string }): Promise<RotaClosure | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(T_CLOSURES, 'POST', [closure], 'resolution=merge-duplicates,return=representation');
    const rows = await readJson<RotaClosure[]>(res);
    return rows[0] || null;
}

export async function deleteClosure(closureDate: string): Promise<void> {
    if (!isSupabaseReady()) return;
    await rotaWrite(`${T_CLOSURES}?closure_date=eq.${encodeURIComponent(closureDate)}`, 'DELETE');
}

// ─── Swap requests ────────────────────────────────────────────────────────
export async function fetchSwapRequests(opts: { userId?: string; status?: string } = {}): Promise<RotaSwapRequest[]> {
    if (!isSupabaseReady()) return [];
    const parts = ['select=*', 'order=created_at.desc'];
    if (opts.userId) parts.push(`or=(requester_id.eq.${encodeURIComponent(opts.userId)},counterparty_id.eq.${encodeURIComponent(opts.userId)})`);
    if (opts.status) parts.push(`status=eq.${encodeURIComponent(opts.status)}`);
    const res = await supabaseFetch(`${T_SWAPS}?${parts.join('&')}`, 'GET');
    return readJson<RotaSwapRequest[]>(res);
}

export type SwapInput = Omit<RotaSwapRequest, 'id' | 'created_at' | 'updated_at'>;

export async function createSwapRequest(payload: SwapInput): Promise<RotaSwapRequest | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(T_SWAPS, 'POST', [payload], 'return=representation');
    const rows = await readJson<RotaSwapRequest[]>(res);
    return rows[0] || null;
}

export async function decideSwapRequest(
    id: number,
    status: 'accepted' | 'declined' | 'cancelled',
    decidedBy: string,
): Promise<RotaSwapRequest | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(`${T_SWAPS}?id=eq.${id}`, 'PATCH', {
        status,
        decided_by: decidedBy,
        decided_at: new Date().toISOString(),
    }, 'return=representation');
    const rows = await readJson<RotaSwapRequest[]>(res);
    return rows[0] || null;
}

// ─── Publish / draft (Bundle A) ───────────────────────────────────────────
/**
 * Flip every shift in [startIso, endIso) that is currently a draft into
 * published.  Returns the rows that were updated so the planner can
 * optimistically refresh.
 */
export async function publishShiftsInRange(
    startIso: string,
    endIso: string,
    publishedBy: string,
): Promise<RotaShift[]> {
    if (!isSupabaseReady()) return [];
    const path = `${T_SHIFTS}?published=eq.false&start_at=gte.${encodeURIComponent(startIso)}&start_at=lt.${encodeURIComponent(endIso)}`;
    const res = await rotaWrite(path, 'PATCH', {
        published: true,
        published_at: new Date().toISOString(),
        published_by: publishedBy,
    }, 'return=representation');
    return readJson<RotaShift[]>(res);
}

export async function unpublishShift(id: number): Promise<RotaShift | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(`${T_SHIFTS}?id=eq.${id}`, 'PATCH', {
        published: false,
        published_at: null,
        published_by: null,
    }, 'return=representation');
    const rows = await readJson<RotaShift[]>(res);
    return rows[0] || null;
}

// ─── Open shifts (Bundle B) ────────────────────────────────────────────────
/**
 * Staff-initiated claim of an unassigned shift.  Sets user_id + claimed_by
 * atomically; PostgREST will reject the patch if a concurrent claim has
 * already filled the slot (user_id is no longer null).
 */
export async function claimOpenShift(shiftId: number, userId: string): Promise<RotaShift | null> {
    if (!isSupabaseReady()) return null;
    const path = `${T_SHIFTS}?id=eq.${shiftId}&user_id=is.null`;
    const res = await rotaWrite(path, 'PATCH', {
        user_id: userId,
        claimed_by: userId,
        claimed_at: new Date().toISOString(),
    }, 'return=representation');
    const rows = await readJson<RotaShift[]>(res);
    return rows[0] || null;
}

export async function releaseToOpen(shiftId: number): Promise<RotaShift | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(`${T_SHIFTS}?id=eq.${shiftId}`, 'PATCH', {
        user_id: null,
        claimed_by: null,
        claimed_at: null,
    }, 'return=representation');
    const rows = await readJson<RotaShift[]>(res);
    return rows[0] || null;
}

// ─── Acknowledgements (Bundle C) ──────────────────────────────────────────
export async function fetchAcksForShifts(shiftIds: number[]): Promise<RotaShiftAck[]> {
    if (!isSupabaseReady() || shiftIds.length === 0) return [];
    const list = shiftIds.join(',');
    const res = await supabaseFetch(`${T_ACKS}?select=*&shift_id=in.(${list})`, 'GET');
    return readJson<RotaShiftAck[]>(res);
}

export async function fetchAcksForUser(userId: string): Promise<RotaShiftAck[]> {
    if (!isSupabaseReady()) return [];
    const res = await supabaseFetch(`${T_ACKS}?select=*&user_id=eq.${encodeURIComponent(userId)}`, 'GET');
    return readJson<RotaShiftAck[]>(res);
}

export async function acknowledgeShift(shiftId: number, userId: string): Promise<RotaShiftAck | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(T_ACKS, 'POST', [{
        shift_id: shiftId,
        user_id: userId,
        acknowledged_at: new Date().toISOString(),
    }], 'resolution=merge-duplicates,return=representation');
    const rows = await readJson<RotaShiftAck[]>(res);
    return rows[0] || null;
}

// ─── Blocked dates (Bundle D) ─────────────────────────────────────────────
export async function fetchBlockedDates(): Promise<RotaBlockedDate[]> {
    if (!isSupabaseReady()) return [];
    const res = await supabaseFetch(`${T_BLOCKED}?select=*&order=start_date.asc`, 'GET');
    return readJson<RotaBlockedDate[]>(res);
}

export type BlockedDateInput = Omit<RotaBlockedDate, 'id' | 'created_at'>;

export async function saveBlockedDate(input: BlockedDateInput & { id?: number }): Promise<RotaBlockedDate | null> {
    if (!isSupabaseReady()) return null;
    if (input.id) {
        const { id, ...rest } = input;
        const res = await rotaWrite(`${T_BLOCKED}?id=eq.${id}`, 'PATCH', rest, 'return=representation');
        const rows = await readJson<RotaBlockedDate[]>(res);
        return rows[0] || null;
    }
    const res = await rotaWrite(T_BLOCKED, 'POST', [input], 'return=representation');
    const rows = await readJson<RotaBlockedDate[]>(res);
    return rows[0] || null;
}

export async function deleteBlockedDate(id: number): Promise<void> {
    if (!isSupabaseReady()) return;
    await rotaWrite(`${T_BLOCKED}?id=eq.${id}`, 'DELETE');
}

// ─── TOIL ledger (Bundle D) ────────────────────────────────────────────────
export async function fetchToilEntries(opts: { userId?: string } = {}): Promise<RotaToilEntry[]> {
    if (!isSupabaseReady()) return [];
    const parts = ['select=*', 'order=earned_on.desc'];
    if (opts.userId) parts.push(`user_id=eq.${encodeURIComponent(opts.userId)}`);
    const res = await supabaseFetch(`${T_TOIL}?${parts.join('&')}`, 'GET');
    return readJson<RotaToilEntry[]>(res);
}

export type ToilInput = Omit<RotaToilEntry, 'id' | 'created_at'>;

export async function addToilEntry(input: ToilInput): Promise<RotaToilEntry | null> {
    if (!isSupabaseReady()) return null;
    const res = await rotaWrite(T_TOIL, 'POST', [input], 'return=representation');
    const rows = await readJson<RotaToilEntry[]>(res);
    return rows[0] || null;
}

export async function deleteToilEntry(id: number): Promise<void> {
    if (!isSupabaseReady()) return;
    await rotaWrite(`${T_TOIL}?id=eq.${id}`, 'DELETE');
}

// ─── Audit log (Bundle D) ──────────────────────────────────────────────────
export type AuditInput = Omit<RotaAuditEntry, 'id' | 'at'>;

/**
 * Best-effort audit append. Never throws — audit logging must not break the
 * primary action.
 */
export async function appendAudit(entry: AuditInput): Promise<void> {
    if (!isSupabaseReady()) return;
    try {
        await rotaWrite(T_AUDIT, 'POST', [{
            ...entry,
            at: new Date().toISOString(),
        }]);
    } catch {
        /* swallow */
    }
}

export async function fetchAudit(opts: {
    entity?: string;
    entityId?: string;
    sinceIso?: string;
    limit?: number;
} = {}): Promise<RotaAuditEntry[]> {
    if (!isSupabaseReady()) return [];
    const parts = ['select=*', 'order=at.desc'];
    if (opts.entity) parts.push(`entity=eq.${encodeURIComponent(opts.entity)}`);
    if (opts.entityId) parts.push(`entity_id=eq.${encodeURIComponent(opts.entityId)}`);
    if (opts.sinceIso) parts.push(`at=gte.${encodeURIComponent(opts.sinceIso)}`);
    parts.push(`limit=${Math.min(Math.max(opts.limit || 100, 1), 500)}`);
    const res = await supabaseFetch(`${T_AUDIT}?${parts.join('&')}`, 'GET');
    return readJson<RotaAuditEntry[]>(res);
}

// ─── Email notifications ──────────────────────────────────────────────────
// Best-effort. If Resend isn't configured the API will return 500 but the
// caller doesn't propagate that — staff/manager UX shouldn't break just
// because email failed.
export interface RotaEmailPayload {
    kind: 'time_off_requested' | 'time_off_decided' | 'shifts_published' | 'shift_swap_requested';
    request?: RotaTimeOff;
    employee?: Pick<RotaEmployee, 'display_name' | 'email'>;
    employees?: Pick<RotaEmployee, 'display_name' | 'email'>[];
    managerEmail?: string;
    decidedByDisplayName?: string;
    publishWindow?: { start: string; end: string };
    publishedShifts?: RotaShift[];
    swap?: RotaSwapRequest;
}

export async function dispatchRotaEmail(payload: RotaEmailPayload): Promise<void> {
    try {
        await fetch('/api/rota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'notify', ...payload }),
        });
    } catch {
        // Swallow — email is best-effort; primary action already succeeded.
    }
}
