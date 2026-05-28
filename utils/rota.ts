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
    /** Random token used for the staff-only iCal subscribe URL. */
    ical_token?: string | null;
    /** 1 = January, 4 = April etc. Defaults to 1 (calendar year). */
    leave_year_start_month?: number | null;
    leave_year_start_day?: number | null;
    /** Opt-out of email pings from the rota system. */
    notify_email?: boolean;
    /** Auto-populates the Role field on new shifts. */
    default_role?: string | null;
    /** Optional override colour for this employee's shifts. */
    default_color?: string | null;
}

export interface RotaShift {
    id: number;
    /**
     * NULL = open shift (no assignee yet). Staff can claim by setting this.
     * Backed by `alter column ... drop not null` in stash_rota_v2.sql.
     */
    user_id: string | null;
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
    /** When the shift went from draft → published (last time). */
    published_at?: string | null;
    published_by?: string | null;
    /** Set when an open shift is claimed by a staff member. */
    claimed_by?: string | null;
    claimed_at?: string | null;
    /** Optional override colour (hex or tailwind classes). */
    shift_color?: string | null;
    /** Number of identical slots this row represents (open shifts use > 1). */
    requires_count?: number;
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

export interface RotaShiftAck {
    shift_id: number;
    user_id: string;
    acknowledged_at: string;
}

export interface RotaToilEntry {
    id: number;
    user_id: string;
    hours: number;          // positive = earned, negative = used
    reason: string;
    earned_on: string;      // YYYY-MM-DD
    expires_on: string | null;
    shift_id: number | null;
    created_by: string | null;
    created_at: string;
}

export interface RotaBlockedDate {
    id: number;
    start_date: string;
    end_date: string;
    type: 'no_holiday' | 'reduced_capacity';
    reason: string;
    notes: string;
    created_by: string | null;
    created_at: string;
}

export interface RotaAuditEntry {
    id: number;
    entity: 'shift' | 'time_off' | 'swap' | 'open_shift' | 'employee';
    entity_id: string;
    action:
        | 'create' | 'update' | 'delete'
        | 'publish' | 'unpublish'
        | 'claim' | 'release'
        | 'swap_request' | 'swap_accept' | 'swap_decline'
        | 'acknowledge';
    diff: Record<string, { from?: any; to?: any }>;
    actor_id: string | null;
    actor_name: string | null;
    note: string;
    at: string;
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

/**
 * Build an ISO start/end pair from a date + two times.  If `end` time is
 * earlier than (or equal to) `start`, the end is rolled to the next day so
 * we get true overnight shift support (e.g. 22:00 → 02:00 = 4h next day).
 */
export function buildShiftRange(dateIso: string, startTime: string, endTime: string): { start: string; end: string } {
    const start = combineDateTime(dateIso, startTime);
    let end = combineDateTime(dateIso, endTime);
    if (new Date(end).getTime() <= new Date(start).getTime()) {
        const nextDay = new Date(dateIso);
        nextDay.setDate(nextDay.getDate() + 1);
        end = combineDateTime(isoDate(nextDay), endTime);
    }
    return { start, end };
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
    /**
     * Defaults to the configured leave year that wraps "today" for this
     * employee.  Callers can still pass explicit dates for reporting.
     */
    yearStart: Date = leaveYearRangeFor(employee).start,
    yearEnd: Date = leaveYearRangeFor(employee).end,
): AllowanceSummary {
    const userRequests = requests.filter(r => r.user_id === employee.user_id && r.type === 'holiday');
    const inYear = userRequests.filter(r => {
        const start = new Date(r.start_date);
        return start >= yearStart && start < yearEnd;
    });
    const booked = inYear.filter(r => r.status === 'approved').reduce((sum, r) => sum + Number(r.days_count || 0), 0);
    const pending = inYear.filter(r => r.status === 'pending').reduce((sum, r) => sum + Number(r.days_count || 0), 0);
    const prorated = proratedAllowance(employee, { start: yearStart, end: yearEnd });
    const carriedOver = Number(employee.carried_over_days || 0);
    const remaining = prorated + carriedOver - booked - pending;
    return { annualAllowance: prorated, carriedOver, booked, pending, remaining };
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

/** Open (unassigned) shifts within a range — Bundle B. */
export function openShiftsInRange(shifts: RotaShift[], week: WeekRange): RotaShift[] {
    return shifts.filter(s => {
        if (s.user_id !== null) return false;
        const start = new Date(s.start_at);
        return start >= week.start && start < week.end;
    });
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

// ─── Conflict detection (Bundle A) ─────────────────────────────────────────
/**
 * Conflicts that should warn the manager when saving a shift.  Each one is
 * surface-able as a red banner in the editor.
 */
export type ConflictSeverity = 'error' | 'warning';

export interface ShiftConflict {
    code:
        | 'overlap'
        | 'time_off'
        | 'closure'
        | 'over_weekly_hours'
        | 'min_rest'
        | 'blocked_date'
        | 'zero_length';
    severity: ConflictSeverity;
    message: string;
    /** Optional id of the offending other shift / time-off row. */
    relatedId?: number | string;
}

/** UK Working Time Regulations: 11 hours between shifts. */
export const MIN_REST_HOURS = 11;

export interface ShiftConflictContext {
    userId: string | null;
    startIso: string;
    endIso: string;
    /** When editing, exclude that shift's own id so it doesn't conflict with itself. */
    excludeShiftId?: number;
    weeklyHoursLimit?: number;
    /** All shifts already scheduled (any user). */
    existingShifts: RotaShift[];
    /** Approved + pending time-off rows. */
    timeOff: RotaTimeOff[];
    /** Manual company closures (warn only). */
    closures: RotaClosure[];
    /** Blocked-date windows. Holiday embargoes only warn for new time-off
     *  requests — they don't block shift scheduling. */
    blockedDates?: RotaBlockedDate[];
}

export function detectShiftConflicts(ctx: ShiftConflictContext): ShiftConflict[] {
    const out: ShiftConflict[] = [];
    const startMs = new Date(ctx.startIso).getTime();
    const endMs = new Date(ctx.endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        out.push({ code: 'zero_length', severity: 'error', message: 'Shift end must be after start.' });
        return out;
    }
    const targetDay = isoToDate(ctx.startIso);

    // Overlap with another shift owned by the same user.
    if (ctx.userId) {
        const overlapping = ctx.existingShifts.filter(s => {
            if (s.id === ctx.excludeShiftId) return false;
            if (s.user_id !== ctx.userId) return false;
            const sMs = new Date(s.start_at).getTime();
            const eMs = new Date(s.end_at).getTime();
            return sMs < endMs && eMs > startMs;
        });
        if (overlapping.length > 0) {
            const o = overlapping[0];
            out.push({
                code: 'overlap',
                severity: 'error',
                message: `Overlaps with ${isoToTime(o.start_at)}–${isoToTime(o.end_at)} on the same day.`,
                relatedId: o.id,
            });
        }

        // Approved time-off blocks the shift; pending warns.
        const off = ctx.timeOff.find(r =>
            r.user_id === ctx.userId &&
            r.status !== 'declined' && r.status !== 'cancelled' &&
            targetDay >= r.start_date && targetDay <= r.end_date,
        );
        if (off) {
            out.push({
                code: 'time_off',
                severity: off.status === 'approved' ? 'error' : 'warning',
                message: off.status === 'approved'
                    ? `${off.type} approved on ${targetDay} — cannot schedule.`
                    : `${off.type} request pending on ${targetDay}.`,
                relatedId: off.id,
            });
        }

        // Min-rest check vs the user's nearest neighbouring shifts.
        const rests = ctx.existingShifts
            .filter(s => s.id !== ctx.excludeShiftId && s.user_id === ctx.userId)
            .map(s => {
                const sMs = new Date(s.start_at).getTime();
                const eMs = new Date(s.end_at).getTime();
                if (eMs <= startMs) return (startMs - eMs) / 3_600_000;       // previous shift gap
                if (sMs >= endMs) return (sMs - endMs) / 3_600_000;           // next shift gap
                return Infinity;
            })
            .filter(h => h < MIN_REST_HOURS && h > 0);
        if (rests.length > 0) {
            out.push({
                code: 'min_rest',
                severity: 'warning',
                message: `Less than ${MIN_REST_HOURS}h rest from another shift (${rests[0].toFixed(1)}h).`,
            });
        }
    }

    // Company closure on this date — warn, don't block.
    const closure = ctx.closures.find(c => c.closure_date === targetDay);
    if (closure) {
        out.push({
            code: 'closure',
            severity: 'warning',
            message: `Company closure: ${closure.label}.`,
        });
    }

    // Over weekly hours: include the prospective shift + every other shift
    // for this user in the same calendar week.
    if (ctx.userId && ctx.weeklyHoursLimit && ctx.weeklyHoursLimit > 0) {
        const week = makeWeekRange(new Date(ctx.startIso));
        const otherHours = ctx.existingShifts
            .filter(s => s.id !== ctx.excludeShiftId && s.user_id === ctx.userId)
            .filter(s => {
                const sd = new Date(s.start_at);
                return sd >= week.start && sd < week.end;
            })
            .reduce((sum, s) => sum + shiftLengthHours(s.start_at, s.end_at), 0);
        const thisHours = shiftLengthHours(ctx.startIso, ctx.endIso);
        const total = otherHours + thisHours;
        if (total > ctx.weeklyHoursLimit) {
            out.push({
                code: 'over_weekly_hours',
                severity: 'warning',
                message: `Total ${total.toFixed(1)}h exceeds weekly contract of ${ctx.weeklyHoursLimit}h.`,
            });
        }
    }

    return out;
}

/** A time-off request submitted into a blocked-date window. */
export function detectTimeOffBlocks(
    startDate: string,
    endDate: string,
    blockedDates: RotaBlockedDate[],
): ShiftConflict[] {
    const out: ShiftConflict[] = [];
    for (const b of blockedDates) {
        if (b.end_date < startDate || b.start_date > endDate) continue;
        out.push({
            code: 'blocked_date',
            severity: b.type === 'no_holiday' ? 'error' : 'warning',
            message: b.type === 'no_holiday'
                ? `Holiday is not allowed during this window: ${b.reason}`
                : `Reduced capacity flagged: ${b.reason}`,
            relatedId: b.id,
        });
    }
    return out;
}

/** Other employees with overlapping approved/pending leave on these dates. */
export function clashingTimeOff(
    startDate: string,
    endDate: string,
    userId: string,
    requests: RotaTimeOff[],
): RotaTimeOff[] {
    return requests.filter(r => {
        if (r.user_id === userId) return false;
        if (r.status !== 'approved' && r.status !== 'pending') return false;
        return !(r.end_date < startDate || r.start_date > endDate);
    });
}

// ─── Leave-year math (Bundle D) ────────────────────────────────────────────
/**
 * Build the [start, end) leave-year window that contains `at` for this
 * employee.  Defaults to calendar year when the columns aren't set.
 */
export function leaveYearRangeFor(
    employee: Pick<RotaEmployee, 'leave_year_start_month' | 'leave_year_start_day'>,
    at: Date = new Date(),
): { start: Date; end: Date } {
    const month = Math.min(Math.max(Number(employee.leave_year_start_month || 1), 1), 12);
    const day = Math.min(Math.max(Number(employee.leave_year_start_day || 1), 1), 28);
    const candidate = new Date(at.getFullYear(), month - 1, day);
    const start = at >= candidate
        ? candidate
        : new Date(at.getFullYear() - 1, month - 1, day);
    const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
    return { start, end };
}

/**
 * Pro-rate the annual holiday allowance for a partial-year joiner / leaver.
 * Defaults to fully accrued when no start_date is supplied or when the
 * employee began before the leave-year start.
 */
export function proratedAllowance(
    employee: RotaEmployee,
    leaveYear: { start: Date; end: Date } = leaveYearRangeFor(employee),
): number {
    const annual = Number(employee.holiday_allowance_days || 0);
    if (!employee.start_date) return annual;
    const start = new Date(employee.start_date);
    if (Number.isNaN(start.getTime())) return annual;
    const effectiveStart = start > leaveYear.start ? start : leaveYear.start;
    const totalMs = leaveYear.end.getTime() - leaveYear.start.getTime();
    const remainingMs = leaveYear.end.getTime() - effectiveStart.getTime();
    if (totalMs <= 0 || remainingMs <= 0) return 0;
    const ratio = Math.min(1, remainingMs / totalMs);
    // Round to nearest half-day so the allowance stays human-friendly.
    return Math.round(annual * ratio * 2) / 2;
}

// ─── TOIL balance ──────────────────────────────────────────────────────────
export function toilBalance(entries: RotaToilEntry[], userId: string, at: Date = new Date()): number {
    return entries
        .filter(e => e.user_id === userId)
        .filter(e => {
            if (!e.expires_on) return true;
            return new Date(e.expires_on) >= at;
        })
        .reduce((sum, e) => sum + Number(e.hours || 0), 0);
}

// ─── Audit-log diff helper ─────────────────────────────────────────────────
export function diffShiftPayloads(
    before: Partial<RotaShift> | null | undefined,
    after: Partial<RotaShift> | null | undefined,
): Record<string, { from?: any; to?: any }> {
    const out: Record<string, { from?: any; to?: any }> = {};
    const keys: (keyof RotaShift)[] = [
        'user_id', 'start_at', 'end_at', 'role', 'location', 'notes',
        'published', 'template_key', 'shift_color', 'requires_count',
    ];
    for (const k of keys) {
        const a = before ? (before as any)[k] : undefined;
        const b = after ? (after as any)[k] : undefined;
        if ((a ?? null) !== (b ?? null)) out[k as string] = { from: a, to: b };
    }
    return out;
}

// ─── View helpers (Bundle A) ───────────────────────────────────────────────
export type PlannerView = 'day' | 'week' | 'month';

export function makeDayRange(anchor: Date): WeekRange {
    const start = new Date(anchor); start.setHours(0, 0, 0, 0);
    const end = addDays(start, 1);
    return { start, end, days: [start], isoStart: start.toISOString(), isoEnd: end.toISOString() };
}

export function makeMonthRange(anchor: Date): WeekRange {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const days: Date[] = [];
    const cursor = new Date(start);
    while (cursor < end) {
        days.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return { start, end, days, isoStart: start.toISOString(), isoEnd: end.toISOString() };
}

export function rangeForView(view: PlannerView, anchor: Date): WeekRange {
    if (view === 'day') return makeDayRange(anchor);
    if (view === 'month') return makeMonthRange(anchor);
    return makeWeekRange(anchor);
}

// ─── Acknowledgement helpers (Bundle C) ───────────────────────────────────
export function ackedByUser(acks: RotaShiftAck[], shiftId: number, userId: string): boolean {
    return acks.some(a => a.shift_id === shiftId && a.user_id === userId);
}

/**
 * For a published shift owned by a user, has the user clicked "Got it"?
 * Open shifts return false.
 */
export function isShiftAcknowledged(shift: RotaShift, acks: RotaShiftAck[]): boolean {
    if (!shift.user_id) return false;
    if (!shift.published) return false;
    return ackedByUser(acks, shift.id, shift.user_id);
}

// ─── Storage keys ──────────────────────────────────────────────────────────
export const ROTA_LAST_SURFACE_KEY = 'stash_rota_last_surface';

export type RotaSurfacePreference = 'main' | 'rota_only';
