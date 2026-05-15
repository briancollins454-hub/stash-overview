import { isSupabaseReady, supabaseFetch } from './supabase';

export const PRIORITY_NOTES_KEY = 'stash_priority_line_notes';
const TABLE = 'stash_priority_notes';
const PAGE = 1000;

export interface PriorityLineNote {
  text: string;
  excludeFromPdf: boolean;
  updatedAt: string;
}

interface CloudRow {
  job_number: string;
  note_text: string | null;
  exclude_from_pdf: boolean | null;
  updated_at: string | null;
}

export function cloudRowsToNotesByJob(rows: unknown): Record<string, PriorityLineNote> {
  const out: Record<string, PriorityLineNote> = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows as CloudRow[]) {
    const key = String(row.job_number || '').trim();
    if (!key) continue;
    out[key] = {
      text: row.note_text || '',
      excludeFromPdf: !!row.exclude_from_pdf,
      updatedAt: row.updated_at || new Date().toISOString(),
    };
  }
  return out;
}

export function rowToNote(row: CloudRow): { jobNumber: string; note: PriorityLineNote } | null {
  const jobNumber = String(row.job_number || '').trim();
  if (!jobNumber) return null;
  return {
    jobNumber,
    note: {
      text: row.note_text || '',
      excludeFromPdf: !!row.exclude_from_pdf,
      updatedAt: row.updated_at || new Date().toISOString(),
    },
  };
}

/** Newer `updatedAt` wins — avoids empty cloud wiping unsynced local notes. */
export function mergePriorityNotesByUpdatedAt(
  local: Record<string, PriorityLineNote>,
  cloud: Record<string, PriorityLineNote>,
): Record<string, PriorityLineNote> {
  const keys = new Set([...Object.keys(local), ...Object.keys(cloud)]);
  const out: Record<string, PriorityLineNote> = {};
  for (const k of keys) {
    const a = local[k];
    const b = cloud[k];
    if (!a) {
      if (b) out[k] = { ...b };
      continue;
    }
    if (!b) {
      out[k] = { ...a };
      continue;
    }
    const ta = Date.parse(a.updatedAt || '') || 0;
    const tb = Date.parse(b.updatedAt || '') || 0;
    out[k] = ta >= tb ? { ...a } : { ...b };
  }
  return out;
}

export async function fetchAllPriorityNotesFromCloud(): Promise<Record<string, PriorityLineNote>> {
  if (!isSupabaseReady()) return {};
  const rows: CloudRow[] = [];
  let offset = 0;
  for (;;) {
    const res = await supabaseFetch(
      `${TABLE}?select=job_number,note_text,exclude_from_pdf,updated_at&order=updated_at.desc&limit=${PAGE}&offset=${offset}`,
      'GET',
    );
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return cloudRowsToNotesByJob(rows);
}

export type PushPriorityNotesResult =
  | { ok: true }
  | { ok: false; message: string; missingTable: boolean };

export async function pushPriorityNotesToCloud(
  notes: Record<string, PriorityLineNote>,
): Promise<PushPriorityNotesResult> {
  if (!isSupabaseReady()) {
    return { ok: false, message: 'Supabase not configured', missingTable: false };
  }

  try {
    const entries = Object.entries(notes);
    const upserts = entries
      .filter(([, v]) => (v.text || '').trim().length > 0 || v.excludeFromPdf)
      .map(([jobNumber, v]) => ({
        job_number: jobNumber,
        note_text: (v.text || '').trim() || null,
        exclude_from_pdf: !!v.excludeFromPdf,
        updated_at: v.updatedAt || new Date().toISOString(),
      }));

    if (upserts.length > 0) {
      await supabaseFetch(TABLE, 'POST', upserts, 'resolution=merge-duplicates');
    }

    const toDelete = entries
      .filter(([, v]) => (v.text || '').trim().length === 0 && !v.excludeFromPdf)
      .map(([jobNumber]) => jobNumber);
    if (toDelete.length > 0) {
      const inList = toDelete.map(j => `"${String(j).replace(/"/g, '""')}"`).join(',');
      await supabaseFetch(`${TABLE}?job_number=in.(${inList})`, 'DELETE');
    }

    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const missingTable = /stash_priority_notes|relation|does not exist|42P01|PGRST205/i.test(msg);
    return { ok: false, message: msg, missingTable };
  }
}
