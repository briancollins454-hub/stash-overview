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

// ─── Local Storage (cache only) ────────────────────────────────────────────
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

// ─── Cloud Sync (Firebase) ─────────────────────────────────────────────────

function noteToFirebase(n: OrderNote): Record<string, any> {
  return {
    note_id: n.id,
    order_id: n.orderId,
    order_number: n.orderNumber,
    text: n.text,
    author: n.author,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    priority: n.priority || '',
    pinned: n.pinned || false,
    mentions: n.mentions ? n.mentions.join(',') : '',
  };
}

function firebaseToNote(r: any): OrderNote {
  return {
    id: r.note_id || r.id,
    orderId: r.order_id || '',
    orderNumber: r.order_number || '',
    text: r.text || '',
    author: r.author || '',
    createdAt: typeof r.created_at === 'number' ? r.created_at : new Date(r.created_at).getTime(),
    updatedAt: typeof r.updated_at === 'number' ? r.updated_at : new Date(r.updated_at).getTime(),
    priority: r.priority || undefined,
    pinned: r.pinned || false,
    mentions: r.mentions ? (typeof r.mentions === 'string' ? (r.mentions ? r.mentions.split(',') : undefined) : r.mentions) : undefined,
  };
}

export async function syncNoteToCloud(note: OrderNote): Promise<void> {
  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', note: noteToFirebase(note) }),
    });
  } catch (e) {
    console.error('Failed to sync note to cloud:', e);
  }
}

// Keep old function name for backward compat
export async function syncNotesToCloud(_settings: ApiSettings, notes: OrderNote[]): Promise<void> {
  await Promise.allSettled(notes.map(n => syncNoteToCloud(n)));
}

export async function fetchNotesFromCloud(orderId: string): Promise<OrderNote[]> {
  try {
    const resp = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', order_id: orderId }),
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(firebaseToNote);
  } catch {
    return [];
  }
}

export async function deleteNoteFromCloud(noteId: string): Promise<void> {
  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', note_id: noteId }),
    });
  } catch (e) {
    console.error('Failed to delete note from cloud:', e);
  }
}

/** Get all unique authors who have posted in this order's chat */
export async function fetchChatParticipants(orderId: string): Promise<string[]> {
  try {
    const resp = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'participants', order_id: orderId }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
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
