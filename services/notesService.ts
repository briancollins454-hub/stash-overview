import { ApiSettings } from '../components/SettingsModal';

export interface OrderNote {
  id: string;
  orderId: string;
  orderNumber: string;
  text: string;
  author: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'stash_order_notes';

export function loadNotes(): Record<string, OrderNote[]> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

export function saveNote(note: OrderNote) {
  const all = loadNotes();
  if (!all[note.orderId]) all[note.orderId] = [];
  const existing = all[note.orderId].findIndex(n => n.id === note.id);
  if (existing >= 0) {
    all[note.orderId][existing] = note;
  } else {
    all[note.orderId].push(note);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteNote(orderId: string, noteId: string) {
  const all = loadNotes();
  if (all[orderId]) {
    all[orderId] = all[orderId].filter(n => n.id !== noteId);
    if (all[orderId].length === 0) delete all[orderId];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function getNotesForOrder(orderId: string): OrderNote[] {
  const all = loadNotes();
  return (all[orderId] || []).sort((a, b) => b.createdAt - a.createdAt);
}

export function getNoteCounts(): Record<string, number> {
  const all = loadNotes();
  const counts: Record<string, number> = {};
  for (const [orderId, notes] of Object.entries(all)) {
    counts[orderId] = notes.length;
  }
  return counts;
}

/**
 * Syncs notes to Supabase via server-side route.
 * Uses the `order_notes` table.
 */
export async function syncNotesToCloud(settings: ApiSettings, notes: OrderNote[]): Promise<void> {
  try {
    await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'order_notes',
        method: 'POST',
        body: notes.map(n => ({
          id: n.id,
          order_id: n.orderId,
          order_number: n.orderNumber,
          text: n.text,
          author: n.author,
          created_at: new Date(n.createdAt).toISOString(),
          updated_at: new Date(n.updatedAt).toISOString(),
        })),
        prefer: 'resolution=merge-duplicates, return=minimal',
      }),
    });
  } catch (e) {
    console.error('Failed to sync notes to cloud:', e);
  }
}
