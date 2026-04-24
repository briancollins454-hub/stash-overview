export const config = { runtime: 'edge' };

// ─── RAG: Store & Search Knowledge via Supabase ─────────────────

import { requireAuthEdge } from './_lib/verifyAuthEdge';

export default async function handler(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ['https://stashoverview.co.uk', 'https://www.stashoverview.co.uk', 'http://localhost:3000'];
  const corsHeaders: Record<string, string> = {};
  if (allowed.includes(origin) || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }
  corsHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Firebase-Id-Token';

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);

  const authDecision = await requireAuthEdge(req, 'ai-knowledge', corsHeaders);
  if (authDecision.reject) return authDecision.reject;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return json({ error: 'Supabase not configured' }, 501, corsHeaders);
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  try {
    const body = await req.json();
    const { action, text, category, metadata, limit } = body;

    if (action === 'store') {
      const storeRes = await fetch(`${supabaseUrl}/rest/v1/ai_knowledge_base`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          content: text,
          category: category || 'general',
          metadata: metadata || {},
          created_at: new Date().toISOString(),
        }),
      });
      if (!storeRes.ok) return json({ stored: false, reason: 'table_not_ready' }, 200, corsHeaders);
      return json({ stored: true }, 200, corsHeaders);
    }

    if (action === 'search') {
      if (!text) return json({ error: 'text required for search' }, 400, corsHeaders);
      const words = text.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3);
      let results: any[] = [];
      if (words.length > 0) {
        const tsvQuery = words.join(' & ');
        const catFilter = category && category !== 'all' ? `&category=eq.${category}` : '';
        const ftsRes = await fetch(
          `${supabaseUrl}/rest/v1/ai_knowledge_base?content=fts.${encodeURIComponent(tsvQuery)}&limit=${limit || 5}&order=created_at.desc${catFilter}`,
          { headers: sbHeaders },
        );
        if (ftsRes.ok) results = await ftsRes.json();
      }
      return json({ results }, 200, corsHeaders);
    }

    if (action === 'store_feedback') {
      const { message_id, rating, user_name } = body;
      const fbRes = await fetch(`${supabaseUrl}/rest/v1/ai_feedback`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          message_id: message_id || `msg_${Date.now()}`,
          rating,
          user_name: user_name || 'unknown',
          created_at: new Date().toISOString(),
        }),
      });
      return json({ stored: fbRes.ok }, 200, corsHeaders);
    }

    if (action === 'store_activity') {
      const { user_name, event_type, details } = body;
      const actRes = await fetch(`${supabaseUrl}/rest/v1/ai_activity_log`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          user_name: user_name || 'unknown',
          event_type,
          details: details || {},
          created_at: new Date().toISOString(),
        }),
      });
      return json({ stored: actRes.ok }, 200, corsHeaders);
    }

    if (action === 'get_activity_summary') {
      const { user_name, period } = body;
      const since = new Date();
      if (period === 'today') since.setHours(0, 0, 0, 0);
      else if (period === 'this_week') since.setDate(since.getDate() - 7);
      else since.setDate(since.getDate() - 1);

      let url = `${supabaseUrl}/rest/v1/ai_activity_log?created_at=gte.${since.toISOString()}&order=created_at.desc&limit=50`;
      if (user_name) url += `&user_name=eq.${encodeURIComponent(user_name)}`;

      const actRes = await fetch(url, { headers: sbHeaders });
      const activities = actRes.ok ? await actRes.json() : [];
      return json({ activities }, 200, corsHeaders);
    }

    if (action === 'store_conversation_summary') {
      const { user_name, summary, session_id, message_count } = body;
      await Promise.allSettled([
        fetch(`${supabaseUrl}/rest/v1/ai_knowledge_base`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            content: `Conversation with ${user_name}: ${summary}`,
            category: 'conversations',
            metadata: { user_name, session_id },
            created_at: new Date().toISOString(),
          }),
        }),
        fetch(`${supabaseUrl}/rest/v1/ai_conversation_log`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            user_name: user_name || 'unknown',
            summary,
            session_id: session_id || `session_${Date.now()}`,
            message_count: message_count || 0,
            created_at: new Date().toISOString(),
          }),
        }),
      ]);
      return json({ stored: true }, 200, corsHeaders);
    }

    if (action === 'get_last_conversation') {
      const { user_name } = body;
      if (!user_name) return json({ conversation: null }, 200, corsHeaders);
      const convRes = await fetch(
        `${supabaseUrl}/rest/v1/ai_conversation_log?user_name=eq.${encodeURIComponent(user_name)}&order=created_at.desc&limit=1`,
        { headers: sbHeaders },
      );
      const convos = convRes.ok ? await convRes.json() : [];
      return json({ conversation: convos[0] || null }, 200, corsHeaders);
    }

    return json({ error: 'Invalid action' }, 400, corsHeaders);
  } catch (e: any) {
    return json({ error: e.message || 'Internal error' }, 500, corsHeaders);
  }
}

function json(data: any, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
