// ─── Notification Service ──────────────────────────────────────────────────
// Stores notifications in Supabase so @mentioned users see them on ANY device.

export interface AppNotification {
  id: string;
  recipient_username: string;
  sender_name: string;
  order_id: string;
  order_number: string;
  note_id: string;
  message_preview: string;
  is_read: boolean;
  created_at: string;
}

// ─── Create notifications for each mentioned user ──────────────────────────
export async function createMentionNotifications(params: {
  mentions: string[];
  senderName: string;
  orderId: string;
  orderNumber: string;
  noteId: string;
  messageText: string;
}): Promise<void> {
  const { mentions, senderName, orderId, orderNumber, noteId, messageText } = params;
  if (mentions.length === 0) return;

  const preview = messageText.length > 120 ? messageText.slice(0, 120) + '…' : messageText;
  const now = new Date().toISOString();

  const rows = mentions.map(username => ({
    id: `notif-${Date.now()}-${username}-${Math.random().toString(36).slice(2, 6)}`,
    recipient_username: username,
    sender_name: senderName,
    order_id: orderId,
    order_number: orderNumber,
    note_id: noteId,
    message_preview: preview,
    is_read: false,
    created_at: now,
  }));

  try {
    await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'stash_notifications',
        method: 'POST',
        body: rows,
        prefer: 'return=minimal',
      }),
    });
  } catch (e) {
    console.error('Failed to create mention notifications:', e);
  }
}

// ─── Fetch unread notifications for a user ─────────────────────────────────
export async function fetchUnreadNotifications(username: string): Promise<AppNotification[]> {
  try {
    const resp = await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `stash_notifications?recipient_username=eq.${encodeURIComponent(username)}&is_read=eq.false&order=created_at.desc&limit=50`,
        method: 'GET',
      }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ─── Mark a single notification as read ────────────────────────────────────
export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `stash_notifications?id=eq.${encodeURIComponent(notifId)}`,
        method: 'PATCH',
        body: { is_read: true },
      }),
    });
  } catch (e) {
    console.error('Failed to mark notification read:', e);
  }
}

// ─── Mark all notifications as read for a user ─────────────────────────────
export async function markAllNotificationsRead(username: string): Promise<void> {
  try {
    await fetch('/api/supabase-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `stash_notifications?recipient_username=eq.${encodeURIComponent(username)}&is_read=eq.false`,
        method: 'PATCH',
        body: { is_read: true },
      }),
    });
  } catch (e) {
    console.error('Failed to mark all notifications read:', e);
  }
}
