// ─── Stash — Rota Supabase service ─────────────────────────────────────────
// Thin wrapper around supabaseFetch for the five stash_rota_* tables.
// All write helpers return the updated row(s) so optimistic UI can confirm.
// Email notifications (manager-on-request, staff-on-decision) live in
// /api/rota.ts and are triggered through dispatchRotaEmail() below.

import { isSupabaseReady, supabaseFetch } from './supabase';
import type {
    RotaClosure,
    RotaEmployee,
    RotaShift,
    RotaSwapRequest,
    RotaTimeOff,
} from '../utils/rota';

const T_EMP = 'stash_rota_employees';
const T_SHIFTS = 'stash_rota_shifts';
const T_TIMEOFF = 'stash_rota_time_off';
const T_CLOSURES = 'stash_rota_closures';
const T_SWAPS = 'stash_rota_swap_requests';

async function readJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!text) return [] as unknown as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        return [] as unknown as T;
    }
}

// ─── Employees ─────────────────────────────────────────────────────────────
export async function fetchEmployees(): Promise<RotaEmployee[]> {
    if (!isSupabaseReady()) return [];
    const res = await supabaseFetch(`${T_EMP}?select=*&order=display_name.asc`, 'GET');
    return readJson<RotaEmployee[]>(res);
}

export async function upsertEmployee(emp: Partial<RotaEmployee> & { user_id: string }): Promise<RotaEmployee | null> {
    if (!isSupabaseReady()) return null;
    const res = await supabaseFetch(T_EMP, 'POST', [emp], 'resolution=merge-duplicates,return=representation');
    const rows = await readJson<RotaEmployee[]>(res);
    return rows[0] || null;
}

export async function deactivateEmployee(userId: string): Promise<void> {
    if (!isSupabaseReady()) return;
    await supabaseFetch(`${T_EMP}?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH', { is_active: false });
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
        const res = await supabaseFetch(`${T_SHIFTS}?id=eq.${id}`, 'PATCH', rest, 'return=representation');
        const rows = await readJson<RotaShift[]>(res);
        return rows[0] || null;
    }
    const res = await supabaseFetch(T_SHIFTS, 'POST', [shift], 'return=representation');
    const rows = await readJson<RotaShift[]>(res);
    return rows[0] || null;
}

export async function bulkInsertShifts(shifts: ShiftInput[]): Promise<RotaShift[]> {
    if (!isSupabaseReady() || shifts.length === 0) return [];
    const res = await supabaseFetch(T_SHIFTS, 'POST', shifts, 'return=representation');
    return readJson<RotaShift[]>(res);
}

export async function deleteShift(id: number): Promise<void> {
    if (!isSupabaseReady()) return;
    await supabaseFetch(`${T_SHIFTS}?id=eq.${id}`, 'DELETE');
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
        const res = await supabaseFetch(`${T_TIMEOFF}?id=eq.${id}`, 'PATCH', rest, 'return=representation');
        const rows = await readJson<RotaTimeOff[]>(res);
        return rows[0] || null;
    }
    const res = await supabaseFetch(T_TIMEOFF, 'POST', [req], 'return=representation');
    const rows = await readJson<RotaTimeOff[]>(res);
    return rows[0] || null;
}

export async function decideTimeOff(id: number, status: 'approved' | 'declined' | 'cancelled', decidedBy: string, note: string = ''): Promise<RotaTimeOff | null> {
    if (!isSupabaseReady()) return null;
    const res = await supabaseFetch(`${T_TIMEOFF}?id=eq.${id}`, 'PATCH', {
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
    const res = await supabaseFetch(T_CLOSURES, 'POST', [closure], 'resolution=merge-duplicates,return=representation');
    const rows = await readJson<RotaClosure[]>(res);
    return rows[0] || null;
}

export async function deleteClosure(closureDate: string): Promise<void> {
    if (!isSupabaseReady()) return;
    await supabaseFetch(`${T_CLOSURES}?closure_date=eq.${encodeURIComponent(closureDate)}`, 'DELETE');
}

// ─── Swap requests (feature-flagged; surface arrives in v2) ────────────────
export async function fetchSwapRequests(): Promise<RotaSwapRequest[]> {
    if (!isSupabaseReady()) return [];
    const res = await supabaseFetch(`${T_SWAPS}?select=*&order=created_at.desc`, 'GET');
    return readJson<RotaSwapRequest[]>(res);
}

// ─── Email notifications ──────────────────────────────────────────────────
// Best-effort. If Resend isn't configured the API will return 500 but the
// caller doesn't propagate that — staff/manager UX shouldn't break just
// because email failed.
export interface RotaEmailPayload {
    kind: 'time_off_requested' | 'time_off_decided';
    request: RotaTimeOff;
    employee?: Pick<RotaEmployee, 'display_name' | 'email'>;
    managerEmail?: string;
    decidedByDisplayName?: string;
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
