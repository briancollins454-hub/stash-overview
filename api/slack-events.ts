import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

/**
 * /api/slack-events
 *
 * Receives Slack Events API webhooks for the two production channels we mirror
 * (print-updates, embroidery-updates). Two request shapes matter:
 *
 *   1. `url_verification` — the one-off handshake when you paste this URL into
 *      the Slack app's Event Subscriptions page. We reply with the challenge.
 *
 *   2. `event_callback` with `event.type === 'message'` — a real user message
 *      (or subtype like bot_message / message_changed). We persist it into
 *      Supabase so the frontend can render a live feed.
 *
 * Security:
 *   - Slack signs every request with HMAC-SHA256 using SLACK_SIGNING_SECRET.
 *   - We verify the signature *and* the 5-minute timestamp window before
 *     trusting any payload.
 *   - Slack expects a 200 within ~3s. Heavy work (user lookup) happens after
 *     we've acked, but Vercel serverless runs synchronously — we keep the
 *     handler tight and do all work inside the timeout.
 *
 * Env vars required on Vercel:
 *   - SLACK_SIGNING_SECRET       — from Slack app "Basic Information"
 *   - SLACK_BOT_TOKEN            — xoxb-… from "OAuth & Permissions"
 *   - SUPABASE_URL               — already set
 *   - SUPABASE_SERVICE_KEY       — service key (preferred) or anon (fallback)
 *   - SLACK_CHANNEL_PRINT_ID     — optional; auto-resolved from CHANNEL_PRINT_NAME if missing
 *   - SLACK_CHANNEL_PRINT_NAME   — defaults to "print-updates"
 *   - SLACK_CHANNEL_EMB_ID       — optional; auto-resolved from CHANNEL_EMB_NAME if missing
 *   - SLACK_CHANNEL_EMB_NAME     — defaults to "embroidery-updates"
 */

const SLACK_API = 'https://slack.com/api';
const DEFAULT_PRINT_NAME = process.env.SLACK_CHANNEL_PRINT_NAME || 'print-updates';
const DEFAULT_EMB_NAME = process.env.SLACK_CHANNEL_EMB_NAME || 'embroidery-updates';

// ─── Slack channel resolution (cached across warm invocations) ──────────────
// We fetch conversations.list once and remember which channel id maps to which
// friendly name. Cold-start cost ~300ms, warm cost zero.
interface ChannelMap { id: string; name: string }
let cachedChannels: ChannelMap[] | null = null;
let cachedChannelsAt = 0;

async function resolveChannels(token: string): Promise<ChannelMap[]> {
  const now = Date.now();
  if (cachedChannels && now - cachedChannelsAt < 10 * 60_000) return cachedChannels;
  const resp = await fetch(`${SLACK_API}/conversations.list?types=public_channel,private_channel&limit=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await resp.json();
  if (!data.ok) throw new Error(`slack conversations.list failed: ${data.error}`);
  cachedChannels = (data.channels || []).map((c: any) => ({ id: c.id, name: c.name }));
  cachedChannelsAt = now;
  return cachedChannels!;
}

function channelDisplayName(id: string, channels: ChannelMap[] | null): string {
  if (!channels) return id;
  const hit = channels.find(c => c.id === id);
  return hit ? hit.name : id;
}

// ─── Slack user resolution (cached) ─────────────────────────────────────────
interface UserInfo { id: string; name: string; avatar: string }
const userCache = new Map<string, UserInfo>();
let userCacheAt = 0;

async function resolveUser(token: string, userId: string): Promise<UserInfo> {
  // 30-minute TTL so display-name changes eventually propagate.
  const now = Date.now();
  if (now - userCacheAt > 30 * 60_000) { userCache.clear(); userCacheAt = now; }
  const cached = userCache.get(userId);
  if (cached) return cached;

  const resp = await fetch(`${SLACK_API}/users.info?user=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await resp.json();
  if (!data.ok) {
    // Don't blow up — fall back to the raw id so the message still posts.
    const fallback: UserInfo = { id: userId, name: userId, avatar: '' };
    userCache.set(userId, fallback);
    return fallback;
  }
  const profile = data.user?.profile || {};
  const info: UserInfo = {
    id: userId,
    name: profile.display_name || profile.real_name || data.user?.name || userId,
    avatar: profile.image_48 || profile.image_72 || '',
  };
  userCache.set(userId, info);
  return info;
}

// ─── Signature verification ─────────────────────────────────────────────────
// Slack signs requests with HMAC-SHA256 over `v0:{timestamp}:{rawBody}` using
// the app signing secret. We reject anything older than 5 minutes to prevent
// replay attacks.
function verifySlackSignature(rawBody: string, timestamp: string, signature: string, signingSecret: string): boolean {
  if (!timestamp || !signature) return false;
  const tsNum = parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > 300) return false; // 5-minute replay window

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex');
  const expected = `v0=${hmac}`;

  // Length mismatch means timingSafeEqual would throw — treat as failure.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Supabase writes ────────────────────────────────────────────────────────
async function supabaseUpsert(rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials not configured');

  const resp = await fetch(`${supabaseUrl}/rest/v1/stash_slack_messages?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Supabase upsert failed (${resp.status}): ${body.slice(0, 300)}`);
  }
}

async function supabaseDelete(id: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials not configured');

  await fetch(`${supabaseUrl}/rest/v1/stash_slack_messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// Named channels we actually care about — everything else is ignored so the
// bot being invited into another channel by mistake doesn't flood Supabase.
function isTrackedChannel(channelId: string, channels: ChannelMap[]): { tracked: boolean; name: string } {
  const hit = channels.find(c => c.id === channelId);
  if (!hit) return { tracked: false, name: channelId };
  const envPrint = process.env.SLACK_CHANNEL_PRINT_ID;
  const envEmb = process.env.SLACK_CHANNEL_EMB_ID;
  if (envPrint && channelId === envPrint) return { tracked: true, name: DEFAULT_PRINT_NAME };
  if (envEmb && channelId === envEmb) return { tracked: true, name: DEFAULT_EMB_NAME };
  if (hit.name === DEFAULT_PRINT_NAME) return { tracked: true, name: DEFAULT_PRINT_NAME };
  if (hit.name === DEFAULT_EMB_NAME) return { tracked: true, name: DEFAULT_EMB_NAME };
  return { tracked: false, name: hit.name };
}

// Read the raw request body as a string — needed for signature verification
// (JSON.stringify would produce a different byte sequence than Slack signed).
// This only works because we disable the Vercel bodyParser below.
async function readRawBody(req: VercelRequest): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Trim env vars — pasting into Vercel's UI frequently leaves a trailing
  // newline / space, which Slack then rejects as invalid_auth even though
  // the token itself is valid. A defensive .trim() removes that whole class
  // of bug.
  const signingSecret = (process.env.SLACK_SIGNING_SECRET || '').trim();
  const botToken = (process.env.SLACK_BOT_TOKEN || '').trim();
  if (!signingSecret || !botToken) {
    console.error('[slack-events] missing SLACK_SIGNING_SECRET or SLACK_BOT_TOKEN');
    res.status(500).json({ error: 'Slack not configured' });
    return;
  }

  const rawBody = await readRawBody(req);
  const timestamp = String(req.headers['x-slack-request-timestamp'] || '');
  const signature = String(req.headers['x-slack-signature'] || '');

  // Parse once; we'll need `type` early for the URL-verification handshake.
  let payload: any;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // URL verification happens *before* Slack has seen a successful 200, so we
  // still require the signature header to be valid (Slack sends one).
  if (payload?.type === 'url_verification') {
    if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
      res.status(401).json({ error: 'Invalid Slack signature' });
      return;
    }
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
    console.error('[slack-events] signature mismatch');
    res.status(401).json({ error: 'Invalid Slack signature' });
    return;
  }

  if (payload?.type !== 'event_callback' || !payload.event) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const event = payload.event;
  const channelId: string = event.channel || '';
  if (!channelId) { res.status(200).json({ ok: true }); return; }

  let channels: ChannelMap[] = [];
  try { channels = await resolveChannels(botToken); }
  catch (e: any) { console.warn('[slack-events] conversations.list failed', e?.message); }

  const tracked = isTrackedChannel(channelId, channels);
  if (!tracked.tracked) {
    // Unknown channel — ack so Slack doesn't retry.
    res.status(200).json({ ok: true, ignored: 'untracked_channel' });
    return;
  }

  try {
    // message_deleted / message_changed carry a nested event.
    if (event.type === 'message' && event.subtype === 'message_deleted' && event.deleted_ts) {
      const id = `${channelId}:${event.deleted_ts}`;
      await supabaseDelete(id);
      res.status(200).json({ ok: true, deleted: id });
      return;
    }

    // For edits the new text lives on event.message.
    const msg = event.type === 'message' && event.subtype === 'message_changed' && event.message
      ? { ...event.message, ts: event.message.ts || event.ts, edited: true }
      : event;

    const ts: string = msg.ts || '';
    const text: string = typeof msg.text === 'string' ? msg.text : '';
    if (!ts) { res.status(200).json({ ok: true, ignored: 'no_ts' }); return; }

    const userId: string | undefined = msg.user || msg.bot_id;
    let userName = '';
    let userAvatar = '';
    if (msg.user) {
      try {
        const info = await resolveUser(botToken, msg.user);
        userName = info.name;
        userAvatar = info.avatar;
      } catch { /* non-fatal */ }
    } else if (msg.username) {
      userName = msg.username;
      userAvatar = msg.icons?.image_48 || msg.icons?.image_72 || '';
    }

    const row = {
      id: `${channelId}:${ts}`,
      channel_id: channelId,
      channel_name: tracked.name,
      user_id: userId || null,
      user_name: userName || null,
      user_avatar: userAvatar || null,
      text,
      ts,
      ts_epoch: parseFloat(ts),
      subtype: msg.subtype || null,
      edited: Boolean(msg.edited) || Boolean(event.subtype === 'message_changed'),
      thread_ts: msg.thread_ts || null,
      permalink: null,
    };

    await supabaseUpsert([row]);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[slack-events] handler error', err?.message || err);
    // Still 200 so Slack doesn't retry forever on a bad message — we logged.
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
}

// Disable Vercel's automatic JSON parser — we need the exact raw bytes for
// HMAC verification. We parse the body ourselves after reading the stream.
export const config = {
  api: {
    bodyParser: false,
  },
};
