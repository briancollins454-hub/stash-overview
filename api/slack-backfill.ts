import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * /api/slack-backfill
 *
 * Pulls the last N days of history from the two tracked channels (print-updates
 * and embroidery-updates) and upserts them into Supabase. Safe to call
 * repeatedly — it upserts on the natural key `channel_id:ts`, so duplicates
 * are collapsed.
 *
 * Typical usage:
 *   - The Production page calls this automatically on first load if the
 *     Supabase table is empty for either channel (bootstrap).
 *   - An admin can also trigger it from a "Sync History" button.
 *
 * Query params:
 *   - days (default 3, max 14) — how far back to pull.
 *   - channel — optional, one of "print" | "embroidery". Omit for both.
 */

const SLACK_API = 'https://slack.com/api';
const DEFAULT_PRINT_NAME = process.env.SLACK_CHANNEL_PRINT_NAME || 'print-updates';
const DEFAULT_EMB_NAME = process.env.SLACK_CHANNEL_EMB_NAME || 'embroidery-updates';

interface ChannelRef { id: string; name: string; display: 'print-updates' | 'embroidery-updates' }

async function resolveTrackedChannels(token: string): Promise<ChannelRef[]> {
  // Public and private channels are fetched separately so missing `groups:read`
  // scope doesn't take the whole call down when the channels are public.
  const raw: { id: string; name: string }[] = [];

  const pubResp = await fetch(`${SLACK_API}/conversations.list?types=public_channel&limit=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const pub: any = await pubResp.json();
  if (!pub.ok) throw new Error(`conversations.list (public) failed: ${pub.error}`);
  for (const c of (pub.channels || [])) raw.push({ id: c.id, name: c.name });

  try {
    const privResp = await fetch(`${SLACK_API}/conversations.list?types=private_channel&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const priv: any = await privResp.json();
    if (priv.ok) {
      for (const c of (priv.channels || [])) raw.push({ id: c.id, name: c.name });
    }
  } catch { /* groups:read not granted — safe to skip */ }

  const envPrint = process.env.SLACK_CHANNEL_PRINT_ID;
  const envEmb = process.env.SLACK_CHANNEL_EMB_ID;

  const out: ChannelRef[] = [];
  for (const c of raw) {
    if (envPrint && c.id === envPrint) out.push({ id: c.id, name: c.name, display: 'print-updates' });
    else if (envEmb && c.id === envEmb) out.push({ id: c.id, name: c.name, display: 'embroidery-updates' });
    else if (!envPrint && c.name === DEFAULT_PRINT_NAME) out.push({ id: c.id, name: c.name, display: 'print-updates' });
    else if (!envEmb && c.name === DEFAULT_EMB_NAME) out.push({ id: c.id, name: c.name, display: 'embroidery-updates' });
  }
  return out;
}

// Per-invocation user cache. Backfill often touches the same handful of users
// many times; skipping the repeat round-trips halves the runtime.
async function makeUserResolver(token: string): Promise<(uid: string) => Promise<{ name: string; avatar: string }>> {
  const cache = new Map<string, { name: string; avatar: string }>();
  return async (uid: string) => {
    if (!uid) return { name: '', avatar: '' };
    const hit = cache.get(uid);
    if (hit) return hit;
    try {
      const resp = await fetch(`${SLACK_API}/users.info?user=${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: any = await resp.json();
      if (data.ok) {
        const p = data.user?.profile || {};
        const info = {
          name: p.display_name || p.real_name || data.user?.name || uid,
          avatar: p.image_48 || p.image_72 || '',
        };
        cache.set(uid, info);
        return info;
      }
    } catch { /* fall through to fallback */ }
    const fallback = { name: uid, avatar: '' };
    cache.set(uid, fallback);
    return fallback;
  };
}

async function fetchHistory(token: string, channelId: string, oldestEpoch: number): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  // conversations.history is paginated at 200 per call. For 3 days of
  // reasonable chatter we rarely need more than 1-2 pages.
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({
      channel: channelId,
      oldest: String(oldestEpoch),
      limit: '200',
      inclusive: 'true',
    });
    if (cursor) params.set('cursor', cursor);
    const resp = await fetch(`${SLACK_API}/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await resp.json();
    if (!data.ok) throw new Error(`conversations.history failed for ${channelId}: ${data.error}`);
    all.push(...(data.messages || []));
    if (!data.has_more || !data.response_metadata?.next_cursor) break;
    cursor = data.response_metadata.next_cursor;
  }
  return all;
}

async function supabaseUpsert(rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials not configured');

  // Insert in chunks of 500 to keep URL/body size well under any limits.
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const resp = await fetch(`${supabaseUrl}/rest/v1/stash_slack_messages?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Supabase upsert failed (${resp.status}): ${body.slice(0, 300)}`);
    }
    written += chunk.length;
  }
  return written;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // .trim() guards against trailing whitespace or newlines that sometimes
  // come along when pasting tokens into the Vercel env var UI — without this
  // the token looks fine in the dashboard but Slack returns invalid_auth.
  const botToken = (process.env.SLACK_BOT_TOKEN || '').trim();
  if (!botToken) {
    res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });
    return;
  }

  // Clamp days to a sane window — default 3 matches the product requirement.
  const daysRaw = parseInt(String(req.query.days || '3'), 10);
  const days = Math.max(1, Math.min(Number.isFinite(daysRaw) ? daysRaw : 3, 14));
  const oldest = Math.floor(Date.now() / 1000) - days * 86400;

  const only = String(req.query.channel || '').toLowerCase();

  try {
    const channels = await resolveTrackedChannels(botToken);
    if (channels.length === 0) {
      res.status(404).json({ error: 'No tracked channels found. Is the bot invited to print-updates / embroidery-updates?' });
      return;
    }

    const resolveUser = await makeUserResolver(botToken);
    const summary: Record<string, number> = {};

    for (const channel of channels) {
      if (only === 'print' && channel.display !== 'print-updates') continue;
      if (only === 'embroidery' && channel.display !== 'embroidery-updates') continue;

      const messages = await fetchHistory(botToken, channel.id, oldest);

      const rows: any[] = [];
      for (const m of messages) {
        const ts = m.ts;
        if (!ts) continue;
        // Skip the bot's own "X has joined the channel" type events — noisy.
        if (m.subtype === 'channel_join' || m.subtype === 'channel_leave') continue;

        let userName = '';
        let userAvatar = '';
        if (m.user) {
          const info = await resolveUser(m.user);
          userName = info.name;
          userAvatar = info.avatar;
        } else if (m.username) {
          userName = m.username;
          userAvatar = m.icons?.image_48 || m.icons?.image_72 || '';
        }

        rows.push({
          id: `${channel.id}:${ts}`,
          channel_id: channel.id,
          channel_name: channel.display,
          user_id: m.user || m.bot_id || null,
          user_name: userName || null,
          user_avatar: userAvatar || null,
          text: typeof m.text === 'string' ? m.text : '',
          ts,
          ts_epoch: parseFloat(ts),
          subtype: m.subtype || null,
          edited: Boolean(m.edited),
          thread_ts: m.thread_ts || null,
          permalink: null,
        });
      }

      const written = await supabaseUpsert(rows);
      summary[channel.display] = written;
    }

    res.status(200).json({ ok: true, days, summary });
  } catch (err: any) {
    console.error('[slack-backfill] error', err?.message || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
}
