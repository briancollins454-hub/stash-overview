import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/verifyAuth';

/**
 * /api/slack-backfill
 *
 * Pulls the last N days of history from all tracked channels (print-updates,
 * embroidery-updates, delivery-updates) and upserts them into Supabase. Safe
 * to call repeatedly — upserts on the natural key `channel_id:ts`, so
 * duplicates are collapsed.
 *
 * Typical usage:
 *   - The Shop Floor page calls this automatically on first load if the
 *     Supabase table is empty (bootstrap).
 *   - An admin can also trigger it from the "Sync 3d" button on that page.
 *
 * Query params:
 *   - days (default 3, max 14) — how far back to pull.
 *   - channel — optional: "print" | "embroidery" | "delivery". Omit for all.
 */

const SLACK_API = 'https://slack.com/api';

type ChannelDisplay = 'print-updates' | 'embroidery-updates' | 'delivery-updates';

// Single source of truth for which Slack channels we mirror. Add another
// entry here to onboard a new channel — the rest of this file adapts
// automatically. Keep in lock-step with the same list in api/slack-events.ts
// and the frontend in components/SlackFeeds.tsx.
const TRACKED_CHANNELS: { display: ChannelDisplay; defaultName: string; envId: string | undefined }[] = [
  {
    display: 'print-updates',
    defaultName: process.env.SLACK_CHANNEL_PRINT_NAME || 'print-updates',
    envId: process.env.SLACK_CHANNEL_PRINT_ID,
  },
  {
    display: 'embroidery-updates',
    defaultName: process.env.SLACK_CHANNEL_EMB_NAME || 'embroidery-updates',
    envId: process.env.SLACK_CHANNEL_EMB_ID,
  },
  {
    display: 'delivery-updates',
    defaultName: process.env.SLACK_CHANNEL_DELIVERY_NAME || 'delivery-updates',
    envId: process.env.SLACK_CHANNEL_DELIVERY_ID,
  },
];

// Short-code (used by the ?channel= query param) → internal display key.
const CHANNEL_SHORTCODES: Record<string, ChannelDisplay> = {
  print: 'print-updates',
  embroidery: 'embroidery-updates',
  delivery: 'delivery-updates',
};

interface ChannelRef { id: string; name: string; display: ChannelDisplay }

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

  const out: ChannelRef[] = [];
  for (const c of raw) {
    // env-var id override wins over name matching so a channel rename in
    // Slack doesn't silently break the mirror.
    const byEnv = TRACKED_CHANNELS.find(tc => tc.envId && c.id === tc.envId);
    if (byEnv) { out.push({ id: c.id, name: c.name, display: byEnv.display }); continue; }

    const byName = TRACKED_CHANNELS.find(tc => !tc.envId && c.name === tc.defaultName);
    if (byName) { out.push({ id: c.id, name: c.name, display: byName.display }); }
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

  // CORS so the Shop Floor page can call this from the browser.
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');

  if (await requireAuth(req, res, { route: 'slack-backfill' })) return;

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
      const names = TRACKED_CHANNELS.map(tc => tc.defaultName).join(' / ');
      res.status(404).json({ error: `No tracked channels found. Is the bot invited to ${names}?` });
      return;
    }

    const resolveUser = await makeUserResolver(botToken);
    const summary: Record<string, number> = {};

    // ?channel=print|embroidery|delivery limits to a single channel; any
    // unknown shortcode is treated as "all" so callers can't accidentally
    // process nothing by mistyping.
    const filterDisplay: ChannelDisplay | null = CHANNEL_SHORTCODES[only] || null;

    for (const channel of channels) {
      if (filterDisplay && channel.display !== filterDisplay) continue;

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
