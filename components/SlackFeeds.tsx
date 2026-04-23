import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Palette, Truck, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';

/* ================================================================
   SLACK FEEDS — live shop-floor channel mirror
   ================================================================
   Three side-by-side panels (print / embroidery / delivery updates)
   that mirror the matching Slack channels in near-real-time.

   Data flow:
     Slack → /api/slack-events (webhook) → Supabase stash_slack_messages
                                                 ↑
     Slack history → /api/slack-backfill ────────┘
                                                 ↓
                     this component polls Supabase every 15s

   Lives on its own page (tab id "shop-floor") so floor staff can park
   it on a second screen without the Production page's other widgets.
   Anyone logged in can view; writes only ever happen server-side.
   ================================================================ */

interface SlackMessage {
  id: string;
  channel_id: string;
  channel_name: ChannelKey | string;
  user_id: string | null;
  user_name: string | null;
  user_avatar: string | null;
  text: string;
  ts: string;
  ts_epoch: number;
  subtype: string | null;
  edited: boolean;
  thread_ts: string | null;
}

type ChannelKey = 'print-updates' | 'embroidery-updates' | 'delivery-updates';
type AccentKey = 'indigo' | 'pink' | 'emerald';

const POLL_INTERVAL_MS = 15_000;
const BACKFILL_DAYS = 3;
const MAX_MESSAGES_PER_FEED = 200;

// ─── Feed catalogue ─────────────────────────────────────────────────────────
// Single source of truth for which channels we render. Add an entry here to
// expose another channel — the layout adapts automatically. Keep the `channel`
// values aligned with `TRACKED_CHANNELS` in api/slack-events.ts + slack-backfill.ts.
interface FeedSpec {
  channel: ChannelKey;
  title: string;
  accent: AccentKey;
  icon: React.ReactNode;
}

const FEEDS: FeedSpec[] = [
  { channel: 'print-updates',      title: 'Print Updates',      accent: 'indigo',  icon: <Printer className="w-4 h-4 text-indigo-300" /> },
  { channel: 'embroidery-updates', title: 'Embroidery Updates', accent: 'pink',    icon: <Palette className="w-4 h-4 text-pink-300" /> },
  { channel: 'delivery-updates',   title: 'Delivery Updates',   accent: 'emerald', icon: <Truck   className="w-4 h-4 text-emerald-300" /> },
];

const ACCENT_STYLES: Record<AccentKey, { headerBg: string; headerText: string; dot: string }> = {
  indigo:  { headerBg: 'bg-indigo-900/40 border-indigo-700/60',   headerText: 'text-indigo-200',  dot: 'bg-indigo-400'  },
  pink:    { headerBg: 'bg-pink-900/40 border-pink-700/60',       headerText: 'text-pink-200',    dot: 'bg-pink-400'    },
  emerald: { headerBg: 'bg-emerald-900/40 border-emerald-700/60', headerText: 'text-emerald-200', dot: 'bg-emerald-400' },
};

/* ----------------------------------------------------------------
   Slack text → HTML
   Slack sends <@USER>, <#CHAN|name>, <https://url|label>, and *bold* /
   _italic_ / `code` / ```block```. We render a conservative subset so
   staff see readable messages without XSS risk.
   ---------------------------------------------------------------- */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function renderSlackText(text: string): string {
  if (!text) return '';
  let out = escapeHtml(text);

  out = out.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g, (_m, url, label) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:underline">${label}</a>`);
  out = out.replace(/&lt;(https?:\/\/[^|&]+)&gt;/g, (_m, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:underline">${url}</a>`);
  out = out.replace(/&lt;@([UW][A-Z0-9]+)&gt;/g, (_m) => `<span class="text-sky-400 font-medium">@mention</span>`);
  out = out.replace(/&lt;#[CG][A-Z0-9]+\|([^&]+)&gt;/g, (_m, name) =>
    `<span class="text-sky-400 font-medium">#${name}</span>`);

  out = out.replace(/```([\s\S]+?)```/g, (_m, code) =>
    `<pre class="bg-slate-900/80 border border-slate-700 rounded p-2 text-xs font-mono text-slate-200 overflow-x-auto my-1">${code}</pre>`);
  out = out.replace(/`([^`]+?)`/g, (_m, code) =>
    `<code class="bg-slate-900/60 border border-slate-700 rounded px-1 text-xs font-mono text-slate-200">${code}</code>`);
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*/g, (_m, pre, inner) => `${pre}<strong class="font-semibold text-slate-100">${inner}</strong>`);
  out = out.replace(/(^|[^_])_([^_\n]+?)_/g, (_m, pre, inner) => `${pre}<em class="italic">${inner}</em>`);

  out = out.replace(/\n/g, '<br/>');
  return out;
}

function formatRelative(tsEpoch: number): string {
  if (!Number.isFinite(tsEpoch) || tsEpoch <= 0) return '';
  const delta = Date.now() / 1000 - tsEpoch;
  if (delta < 30) return 'just now';
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
  const d = new Date(tsEpoch * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatAbsolute(tsEpoch: number): string {
  if (!Number.isFinite(tsEpoch) || tsEpoch <= 0) return '';
  const d = new Date(tsEpoch * 1000);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ----------------------------------------------------------------
   Supabase queries
   ---------------------------------------------------------------- */
async function fetchMessages(channel: ChannelKey): Promise<SlackMessage[]> {
  const oldest = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;
  const params = new URLSearchParams({
    select: '*',
    channel_name: `eq.${channel}`,
    ts_epoch: `gte.${oldest}`,
    order: 'ts_epoch.desc',
    limit: String(MAX_MESSAGES_PER_FEED),
  });
  const res = await supabaseFetch(`stash_slack_messages?${params}`, 'GET');
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function triggerBackfill(): Promise<void> {
  // Fire-and-forget; we re-query Supabase after a short delay. Endpoint is
  // idempotent (upsert on channel_id:ts) so calling it twice is harmless.
  await fetch(`/api/slack-backfill?days=${BACKFILL_DAYS}`, { method: 'GET' });
}

/* ----------------------------------------------------------------
   Feed column
   ---------------------------------------------------------------- */
interface FeedColumnProps {
  title: string;
  channel: ChannelKey;
  accent: AccentKey;
  icon: React.ReactNode;
  messages: SlackMessage[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

function FeedColumn({ title, channel, accent, icon, messages, isLoading, error, lastUpdated }: FeedColumnProps) {
  const style = ACCENT_STYLES[accent];

  // Non-user messages (bot_message, channel_join, etc.) are mostly noise.
  // Hide the really chatty ones but keep bot_message (covers integrations
  // like Shopify / our own notifier posting into the channel).
  const visible = useMemo(() => messages.filter(m => {
    if (!m.subtype) return true;
    return m.subtype === 'bot_message' || m.subtype === 'thread_broadcast' || m.subtype === 'me_message';
  }), [messages]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-slate-800/60 border border-slate-700 rounded-lg overflow-hidden min-h-[400px] h-[calc(100vh-220px)] max-h-[900px]">
      <div className={`px-4 py-2.5 border-b ${style.headerBg} flex items-center justify-between flex-shrink-0`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dot} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dot}`}></span>
          </span>
          {icon}
          <span className={`text-sm font-semibold ${style.headerText} truncate`}>{title}</span>
          <span className="text-xs text-slate-400 truncate hidden sm:inline">#{channel}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
          {isLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
          <span>{lastUpdated ? formatRelative(lastUpdated / 1000) : '—'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700/60 rounded p-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">Couldn't load messages</div>
              <div className="text-xs text-red-200/80 mt-0.5">{error}</div>
            </div>
          </div>
        )}
        {!error && visible.length === 0 && !isLoading && (
          <div className="text-center text-sm text-slate-500 py-8">
            No messages in the last {BACKFILL_DAYS} days.
            <div className="text-xs mt-1">Waiting for activity…</div>
            <div className="text-[11px] mt-2 text-slate-600">
              Make sure the bot is invited to <span className="font-mono">#{channel}</span>.
            </div>
          </div>
        )}
        {visible.map(m => (
          <article key={m.id} className="flex gap-2.5 group">
            <div className="flex-shrink-0">
              {m.user_avatar ? (
                <img src={m.user_avatar} alt={m.user_name || 'user'} className="w-8 h-8 rounded" />
              ) : (
                <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                  {(m.user_name || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-slate-100 truncate">
                  {m.user_name || 'Unknown'}
                </span>
                <span className="text-xs text-slate-500 flex-shrink-0" title={formatAbsolute(m.ts_epoch)}>
                  {formatRelative(m.ts_epoch)}
                </span>
                {m.edited && <span className="text-[10px] text-slate-500">(edited)</span>}
              </div>
              <div
                className="text-sm text-slate-200 mt-0.5 break-words leading-snug"
                dangerouslySetInnerHTML={{ __html: renderSlackText(m.text) }}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Main component
   ---------------------------------------------------------------- */
export default function SlackFeeds() {
  // Messages are stored per-channel in a record so adding/removing a feed
  // is purely a FEEDS config change — no extra useState required.
  const [messagesByChannel, setMessagesByChannel] = useState<Record<ChannelKey, SlackMessage[]>>(() => {
    const init: Partial<Record<ChannelKey, SlackMessage[]>> = {};
    for (const f of FEEDS) init[f.channel] = [];
    return init as Record<ChannelKey, SlackMessage[]>;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [hasBackfilled, setHasBackfilled] = useState(false);
  const backfillInFlight = useRef(false);

  const loadAll = useCallback(async (): Promise<number> => {
    const entries = await Promise.all(
      FEEDS.map(async f => [f.channel, await fetchMessages(f.channel)] as const)
    );
    const next: Partial<Record<ChannelKey, SlackMessage[]>> = {};
    let total = 0;
    for (const [channel, msgs] of entries) {
      next[channel] = msgs;
      total += msgs.length;
    }
    setMessagesByChannel(next as Record<ChannelKey, SlackMessage[]>);
    setLastUpdated(Date.now());
    return total;
  }, []);

  const refresh = useCallback(async () => {
    if (!isSupabaseReady()) {
      setError('Supabase not configured — enter Supabase URL & anon key in Settings.');
      setIsLoading(false);
      return;
    }
    setError(null);
    try {
      const total = await loadAll();

      // Auto-backfill once if *all* feeds are empty on first load. We don't
      // retry per-feed because an empty single channel is a legitimate state
      // (nobody's posted there for 3 days) — only total emptiness suggests
      // the mirror hasn't been bootstrapped.
      if (!hasBackfilled && total === 0 && !backfillInFlight.current) {
        backfillInFlight.current = true;
        setHasBackfilled(true);
        try {
          await triggerBackfill();
          await new Promise(r => setTimeout(r, 1500));
          await loadAll();
        } finally {
          backfillInFlight.current = false;
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load Slack messages');
    } finally {
      setIsLoading(false);
    }
  }, [hasBackfilled, loadAll]);

  const runBackfill = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await triggerBackfill();
      await new Promise(r => setTimeout(r, 1500));
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'Backfill failed');
    } finally {
      setIsLoading(false);
    }
  }, [loadAll]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="space-y-2" aria-label="Slack shop-floor feeds">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Live from Slack
        </h2>
        <button
          onClick={runBackfill}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-slate-800 transition-colors"
          title={`Re-sync the last ${BACKFILL_DAYS} days from Slack`}
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Sync {BACKFILL_DAYS}d
        </button>
      </div>
      {/* 1 col on phones, 2 cols on tablets, 3 cols on desktop so each feed
          stays readable at every width without horizontal scroll. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {FEEDS.map(f => (
          <FeedColumn
            key={f.channel}
            title={f.title}
            channel={f.channel}
            accent={f.accent}
            icon={f.icon}
            messages={messagesByChannel[f.channel] || []}
            isLoading={isLoading}
            error={error}
            lastUpdated={lastUpdated}
          />
        ))}
      </div>
    </section>
  );
}
