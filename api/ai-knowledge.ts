import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── RAG: Store & Search Embeddings via Supabase pgvector ─────────
// Stores conversation summaries, order snapshots, and production notes
// for semantic search retrieval

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(501).json({ error: 'Supabase not configured' });
  }

  try {
    const { action, text, category, metadata, limit } = req.body || {};

    if (action === 'store') {
      // Generate embedding via Claude/Voyage or use simple hash-based approach
      // For now, store text with metadata for full-text search (pgvector upgrade later)
      const embedding = await generateEmbedding(text, claudeKey);
      
      const storeRes = await fetch(`${supabaseUrl}/rest/v1/ai_knowledge_base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          content: text,
          category: category || 'general',
          metadata: metadata || {},
          embedding: embedding,
          created_at: new Date().toISOString()
        })
      });

      if (!storeRes.ok) {
        // Table might not exist yet — return gracefully
        return res.status(200).json({ stored: false, reason: 'table_not_ready' });
      }
      return res.status(200).json({ stored: true });
    }

    if (action === 'search') {
      if (!text) return res.status(400).json({ error: 'text required for search' });

      const queryEmbedding = await generateEmbedding(text, claudeKey);
      
      // Try vector search first, fall back to text search
      let results: any[] = [];
      
      if (queryEmbedding) {
        // pgvector cosine similarity search
        const searchRes = await fetch(`${supabaseUrl}/rest/v1/rpc/search_knowledge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({
            query_embedding: queryEmbedding,
            match_count: limit || 5,
            filter_category: category || null
          })
        });

        if (searchRes.ok) {
          results = await searchRes.json();
        }
      }

      // Fallback: full-text search
      if (results.length === 0) {
        const words = text.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3);
        if (words.length > 0) {
          const tsvQuery = words.join(' & ');
          const ftsRes = await fetch(
            `${supabaseUrl}/rest/v1/ai_knowledge_base?content=fts.${encodeURIComponent(tsvQuery)}&limit=${limit || 5}&order=created_at.desc${category && category !== 'all' ? `&category=eq.${category}` : ''}`, {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          });
          if (ftsRes.ok) {
            results = await ftsRes.json();
          }
        }
      }

      return res.status(200).json({ results });
    }

    if (action === 'store_feedback') {
      const { message_id, rating, user_name } = req.body;
      const fbRes = await fetch(`${supabaseUrl}/rest/v1/ai_feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          message_id: message_id || `msg_${Date.now()}`,
          rating,
          user_name: user_name || 'unknown',
          created_at: new Date().toISOString()
        })
      });
      return res.status(200).json({ stored: fbRes.ok });
    }

    if (action === 'store_activity') {
      const { user_name, event_type, details } = req.body;
      const actRes = await fetch(`${supabaseUrl}/rest/v1/ai_activity_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          user_name: user_name || 'unknown',
          event_type,
          details: details || {},
          created_at: new Date().toISOString()
        })
      });
      return res.status(200).json({ stored: actRes.ok });
    }

    if (action === 'get_activity_summary') {
      const { user_name, period } = req.body;
      const since = new Date();
      if (period === 'today') since.setHours(0, 0, 0, 0);
      else if (period === 'this_week') since.setDate(since.getDate() - 7);
      else since.setDate(since.getDate() - 1);

      let url = `${supabaseUrl}/rest/v1/ai_activity_log?created_at=gte.${since.toISOString()}&order=created_at.desc&limit=50`;
      if (user_name) url += `&user_name=eq.${encodeURIComponent(user_name)}`;

      const actRes = await fetch(url, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      const activities = actRes.ok ? await actRes.json() : [];
      return res.status(200).json({ activities });
    }

    if (action === 'store_conversation_summary') {
      const { user_name, summary, session_id } = req.body;
      // Store as knowledge base entry + separate conversation log
      const promises = [
        fetch(`${supabaseUrl}/rest/v1/ai_knowledge_base`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            content: `Conversation with ${user_name}: ${summary}`,
            category: 'conversations',
            metadata: { user_name, session_id },
            created_at: new Date().toISOString()
          })
        }),
        fetch(`${supabaseUrl}/rest/v1/ai_conversation_log`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            user_name: user_name || 'unknown',
            summary,
            session_id: session_id || `session_${Date.now()}`,
            message_count: req.body.message_count || 0,
            created_at: new Date().toISOString()
          })
        })
      ];
      await Promise.allSettled(promises);
      return res.status(200).json({ stored: true });
    }

    if (action === 'get_last_conversation') {
      const { user_name } = req.body;
      if (!user_name) return res.status(200).json({ conversation: null });

      const convRes = await fetch(
        `${supabaseUrl}/rest/v1/ai_conversation_log?user_name=eq.${encodeURIComponent(user_name)}&order=created_at.desc&limit=1`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      const convos = convRes.ok ? await convRes.json() : [];
      return res.status(200).json({ conversation: convos[0] || null });
    }

    return res.status(400).json({ error: 'Invalid action. Use: store, search, store_feedback, store_activity, get_activity_summary, store_conversation_summary, get_last_conversation' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
}

// Generate embedding using Voyage AI (Anthropic's partner) or fallback
async function generateEmbedding(text: string, claudeKey?: string | null): Promise<number[] | null> {
  if (!text) return null;
  
  // Try Voyage AI if available
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (voyageKey) {
    try {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${voyageKey}`
        },
        body: JSON.stringify({
          model: 'voyage-3-lite',
          input: [text.slice(0, 2000)],
          input_type: 'document'
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.data?.[0]?.embedding || null;
      }
    } catch {}
  }

  // Fallback: no embedding (use full-text search instead)
  return null;
}
