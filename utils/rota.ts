// ─── Rota — types, date helpers, payload builders ─────────────────────────
// Everything that doesn't touch the network lives here so the planner UI
// stays focussed on rendering. Used by both manager + staff surfaces.

export interface RotaEmployee {
    user_id: string;
    display_name: string;
    job_title: string;
    team: string;
    location: string;
    start_date: string | null;
    weekly_hours: number;
    holiday_allowance_days: number;
    carried_over_days: number;
    manager_user_id: string | null;
    is_active: boolean;
    email: string | null;
    notes: string;
    rotacloud_id: string | null;
    updated_at: string;
}

export interface RotaShift {
    id: number;
    user_id: string;
    start_at: string;
    end_at: string;
    role: string;
    location: string;
    notes: string;
    published: boolean;
    template_key: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export type TimeOffType = 'holiday' | 'sick' | 'unpaid' | 'other';
export type TimeOffStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
export type TimeOffHalfDay = 'am' | 'pm' | null;

export interface RotaTimeOff {
    id: number;
    user_id: string;
    type: TimeOffType;
    start_date: string;
    end_date: string;
    half_day: TimeOffHalfDay;
    reason: string;
    status: TimeOffStatus;
    decided_by: string | null;
    decided_at: string | null;
    decided_note: string;
    requested_at: string;
    days_count: number;
    updated_at: string;
}

export interface RotaClosure {
    closure_date: string;
    label: string;
    paid: boolean;
    notes: string;
    created_by: string | null;
    created_at: string;
}

export interface RotaSwapRequest {
    id: number;
    requester_id: string;
    counterparty_id: string | null;
    shift_id: number | null;
    offered_shift_id: number | null;
    reason: string;
    status: 'pending' | 'accepted' | 'declined' | 'cancelled';
    decided_by: string | null;
    decided_at: string | null;
    created_at: string;
    updated_at: string;
}

// ─── Date helpers ──────────────────────────────────────────────────────────
const WEEK_STARTS_ON_MONDAY = true;

/** Snap a Date back to the Monday (or Sunday) that starts its calendar week. */
export function startOfWeek(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const offset = WEEK_STARTS_ON_MONDAY ? (day === 0 ? -6 : 1 - day) : -day;
    d.setDate(d.getDate() + offset);
    return d;
}

export function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

export function isoDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** "Mon 13 May" — short display label for a column header. */
export function shortDateLabel(date: Date): string {
    return date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
}

/** "08:00" → minutes since midnight (NaN on bad input). */
export function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
    return h * 60 + m;
}

/** minutes since midnight → "HH:MM" (wraps days inside the same string). */
export function minutesToTime(minutes: number): string {
    const m = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Combine "YYYY-MM-DD" + "HH:MM" into a UTC-ish ISO string. */
export function combineDateTime(dateIso: string, time: string): string {
    const [y, m, d] = dateIso.split('-').map(Number);
    const [h, mins] = time.split(':').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1, h || 0, mins || 0, 0, 0);
    return dt.toISOString();
}

/** Inverse of combineDateTime — pull "HH:MM" out of an ISO timestamp. */
export function isoToTime(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Inverse of combineDateTime — pull "YYYY-MM-DD" out of an ISO timestamp. */
export function isoToDate(iso: string): string {
    const d = new Date(iso);
    return isoDate(d);
}

/** Decimal hours between two ISO timestamps (rounded to 0.25h). */
export function shiftLengthHours(startIso: string, endIso: string): number {
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
    return Math.round(((e - s) / (1000 * 60 * 60)) * 4) / 4;
}

/** Inclusive working-day count between two YYYY-MM-DD dates. */
export function workingDaysBetween(startDateIso: string, endDateIso: string): number {
    const start = new Date(startDateIso);
    const end = new Date(endDateIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    if (end < start) return 0;
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) count += 1;
        cursor.setDate(cursor.getDate() + 1);
    }
    return count;
}

/** Days deducted from holiday allowance — half-day requests count as 0.5. */
export function daysCountFor(start: string, end: string, halfDay: TimeOffHalfDay): number {
    if (halfDay && start === end) return 0.5;
    return workingDaysBetween(start, end);
}

// ─── Time-off allowance bookkeeping ────────────────────────────────────────
export interface AllowanceSummary {
    annualAllowance: number;
    carriedOver: number;
    booked: number;       // approved holiday in current year, days
    pending: number;      // pending holiday in current year, days
    remaining: number;
}

export function summariseAllowance(
    employee: RotaEmployee,
    requests: RotaTimeOff[],
    yearStart: Date = new Date(new Date().getFullYear(), 0, 1),
    yearEnd: Date = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59),
): AllowanceSummary {
    const userRequests = requests.filter(r => r.user_id === employee.user_id && r.type === 'holiday');
    const inYear = userRequests.filter(r => {
        const start = new Date(r.start_date);
        return start >= yearStart && start <= yearEnd;
    });
    const booked = inYear.filter(r => r.status === 'approved').reduce((sum, r) => sum + Number(r.days_count || 0), 0);
    const pending = inYear.filter(r => r.status === 'pending').reduce((sum, r) => sum + Number(r.days_count || 0), 0);
    const annualAllowance = Number(employee.holiday_allowance_days || 0);
    const carriedOver = Number(employee.carried_over_days || 0);
    const remaining = annualAllowance + carriedOver - booked - pending;
    return { annualAllowance, carriedOver, booked, pending, remaining };
}

// ─── Date-range helpers used by the planner grid ──────────────────────────
export interface WeekRange {
    start: Date;
    end: Date;
    days: Date[];          // 7 dates, Monday → Sunday
    isoStart: string;
    isoEnd: string;
}

export function makeWeekRange(anchor: Date): WeekRange {
    const start = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const end = addDays(start, 7);
    return {
        start,
        end,
        days,
        isoStart: start.toISOString(),
        isoEnd: end.toISOString(),
    };
}

/** Shifts that fall on the given calendar day for the given user. */
export function shiftsForDay(shifts: RotaShift[], userId: string, day: Date): RotaShift[] {
    const target = isoDate(day);
    return shifts.filter(s => s.user_id === userId && isoToDate(s.start_at) === target);
}

/** Sum of shift hours for a user inside a week range. */
export function weeklyHoursFor(shifts: RotaShift[], userId: string, week: WeekRange): number {
    return shifts
        .filter(s => s.user_id === userId)
        .filter(s => {
            const start = new Date(s.start_at);
            return start >= week.start && start < week.end;
        })
        .reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0);
}

/** Time-off requests that overlap a calendar day for the given user. */
export function timeOffForDay(requests: RotaTimeOff[], userId: string, day: Date): RotaTimeOff[] {
    const target = isoDate(day);
    return requests.filter(r => {
        if (r.user_id !== userId) return false;
        if (r.status === 'declined' || r.status === 'cancelled') return false;
        return target >= r.start_date && target <= r.end_date;
    });
}

/** Closures on a given calendar day (usually 0 or 1 row). */
export function closuresForDay(closures: RotaClosure[], day: Date): RotaClosure[] {
    const target = isoDate(day);
    return closures.filter(c => c.closure_date === target);
}

// ─── Common shift presets (saved as template_key for analytics) ───────────
export interface ShiftPreset {
    key: string;
    label: string;
    start: string;
    end: string;
    color: string;
}

export const DEFAULT_SHIFT_PRESETS: ShiftPreset[] = [
    { key: 'day_full', label: 'Full day 09–17', start: '09:00', end: '17:00', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    { key: 'day_early', label: 'Early 08–16', start: '08:00', end: '16:00', color: 'bg-sky-100 text-sky-800 border-sky-300' },
    { key: 'day_late', label: 'Late 10–18', start: '10:00', end: '18:00', color: 'bg-violet-100 text-violet-800 border-violet-300' },
    { key: 'half_am', label: 'Morning 09–13', start: '09:00', end: '13:00', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    { key: 'half_pm', label: 'Afternoon 13–17', start: '13:00', end: '17:00', color: 'bg-orange-100 text-orange-800 border-orange-300' },
];

// ─── Storage keys ──────────────────────────────────────────────────────────
export const ROTA_LAST_SURFACE_KEY = 'stash_rota_last_surface';

export type RotaSurfacePreference = 'main' | 'rota_only';
