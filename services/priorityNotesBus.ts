import type { PriorityLineNote } from './priorityNotesService';

type LiveRow = {
  job_number?: string;
  note_text?: string | null;
  exclude_from_pdf?: boolean | null;
  updated_at?: string | null;
};

const listeners = new Set<(jobNumber: string, note: PriorityLineNote) => void>();

export function onPriorityNoteLiveUpdate(
  listener: (jobNumber: string, note: PriorityLineNote) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitPriorityNoteFromRealtimeRow(row: LiveRow, deleted = false): void {
  const jobNumber = String(row.job_number || '').trim();
  if (!jobNumber) return;
  const note: PriorityLineNote = deleted
    ? { text: '', excludeFromPdf: false, updatedAt: new Date().toISOString() }
    : {
        text: row.note_text || '',
        excludeFromPdf: !!row.exclude_from_pdf,
        updatedAt: row.updated_at || new Date().toISOString(),
      };
  for (const fn of listeners) {
    try {
      fn(jobNumber, note);
    } catch { /* */ }
  }
}
