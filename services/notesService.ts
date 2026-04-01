import { ApiSettings } from '../components/SettingsModal';

export interface OrderNote {
  id: string;
  orderId: string;
  orderNumber: string;
  text: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  priority?: string;
  pinned?: boolean;
  mentions?: string[];
}

const STORAGE_KEY = 'stash_order_notes';

// ─── Local Storage ─────────────────────────────────────────────────────────
export function loadNotes(): Record<string, OrderNote[]> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveAllNotes(all: Record<string, OrderNote[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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
  saveAllNotes(all);
}

export function deleteNote(orderId: string, noteId: string) {
  const all = loadNotes();
  if (all[orderId]) {
    all[orderId] = all[orderId].filter(n => n.id !== noteId);
    if (all[orderId].length === 0) delete all[orderId];
  }
  saveAllNotes(all);
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

// ─── Cloud Sync (Supabase) ─────────────────────────────────────────────────

function noteToRow(n: OrderNote) {
  return {
    id: n.id,
    order_id: n.orderId,
    order_number: n.orderNumber,
    text: n.text,
    author: n.author,
    created_at: new Date(n.createdAt).toISOString(),
    updated_at: new Date(n.updatedAt).toISOString(),
    priority: n.priority || null,
    pinned: n.pinned || false,
    mentions: n.mentions ? JSON.stringify(n.mentions) : null,
  };
}

function rowToNote(r: any): OrderNote {
  return {
    id: r.id,
    orderId: r.order_id,
    orderNumber: r.order_number,
    text: r.text,
    author: r.author,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    priority: r.priority || undefined,
    pinned: r.pinned || false,
    mentions: r.mentions ? (typeof r.mentions === 'string' ? JSON.parse(r.mentions) : r.mentions) : undefined,
  };
}

export async function syncNotesToCloud(settings: ApiSettings, notes: OrderNote[]): Promise<void> {
  try {
    await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'order_notes',
        method: 'POST',
        body: notes.map(noteToRow),
        prefer: 'resolution=merge-duplicates, return=minimal',
      }),
    });
  } catch (e) {
    console.error('Failed to sync notes to cloud:', e);
  }
}

export async function fetchNotesFromCloud(orderId: string): Promise<OrderNote[]> {
  try {
    const resp = await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `order_notes?order_id=eq.${encodeURIComponent(orderId)}&order=created_at.desc`,
        method: 'GET',
      }),
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(rowToNote);
  } catch {
    return [];
  }
}

export async function deleteNoteFromCloud(noteId: string): Promise<void> {
  try {
    await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `order_notes?id=eq.${encodeURIComponent(noteId)}`,
        method: 'DELETE',
      }),
    });
  } catch (e) {
    console.error('Failed to delete note from cloud:', e);
  }
}

/** Merge cloud + local notes, cloud wins on conflict */
export function mergeNotes(local: OrderNote[], cloud: OrderNote[]): OrderNote[] {
  const map = new Map<string, OrderNote>();
  for (const n of local) map.set(n.id, n);
  for (const n of cloud) {
    const existing = map.get(n.id);
    if (!existing || n.updatedAt >= existing.updatedAt) {
      map.set(n.id, n);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Mention Users Cache ───────────────────────────────────────────────────

export interface MentionUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  displayName: string;
}

let cachedUsers: MentionUser[] | null = null;

export async function fetchMentionUsers(): Promise<MentionUser[]> {
  if (cachedUsers) return cachedUsers;
  try {
    const resp = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_basic' }),
    });
    if (!resp.ok) return [];
    const users = await resp.json();
    cachedUsers = users;
    return users;
  } catch {
    return [];
  }
}

export function clearMentionUsersCache() {
  cachedUsers = null;
}

// ─── Notifications ─────────────────────────────────────────────────────────

export async function fetchUnreadMentions(username: string): Promise<OrderNote[]> {
  try {
    const resp = await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `order_notes?mentions=cs.["${username}"]&order=created_at.desc&limit=50`,
        method: 'GET',
      }),
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(rowToNote);
  } catch {
    return [];
  }
}
