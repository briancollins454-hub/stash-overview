export const config = { runtime: 'edge' };

// ─── AI Memory: Persistent consciousness storage ──────────────────
// CRUD for observations, learned patterns, and entity knowledge.
// Stores what the AI has seen, learned, and knows about people/environment.

type SupabaseHeaders = Record<string, string>;

function getConfig(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ['https://stashoverview.co.uk', 'https://www.stashoverview.co.uk', 'http://localhost:3000'];
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (allowed.includes(origin) || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

  return { corsHeaders, supabaseUrl, supabaseKey };
}

function sbHeaders(key: string, returning = false): SupabaseHeaders {
  const h: SupabaseHeaders = {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (returning) h.Prefer = 'return=representation';
  else h.Prefer = 'return=minimal';
  return h;
}

function json(data: any, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export default async function handler(req: Request) {
  const { corsHeaders, supabaseUrl, supabaseKey } = getConfig(req);

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (!supabaseUrl || !supabaseKey) return json({ error: 'Supabase not configured' }, corsHeaders, 501);

  try {
    const body = await req.json();
    const { action } = body;

    // ── Store a notable observation ──
    if (action === 'store_observation') {
      const { user_name, observation_type, detail, context, mood_at_time, session_id } = body;
      if (!user_name || !detail) return json({ error: 'user_name and detail required' }, corsHeaders, 400);

      const res = await fetch(`${supabaseUrl}/rest/v1/ai_observations`, {
        method: 'POST',
        headers: sbHeaders(supabaseKey),
        body: JSON.stringify({
          user_name,
          observation_type: observation_type || 'general',
          detail,
          context: context || {},
          mood_at_time: mood_at_time || null,
          session_id: session_id || null,
          created_at: new Date().toISOString(),
        }),
      });
      return json({ stored: res.ok }, corsHeaders);
    }

    // ── Get recent observations for a user ──
    if (action === 'get_observations') {
      const { user_name, limit: lim, observation_type } = body;
      if (!user_name) return json({ error: 'user_name required' }, corsHeaders, 400);

      let url = `${supabaseUrl}/rest/v1/ai_observations?user_name=eq.${encodeURIComponent(user_name)}&order=created_at.desc&limit=${lim || 20}`;
      if (observation_type) url += `&observation_type=eq.${encodeURIComponent(observation_type)}`;

      const res = await fetch(url, { headers: sbHeaders(supabaseKey) });
      const data = res.ok ? await res.json() : [];
      return json({ observations: data }, corsHeaders);
    }

    // ── Store or update a learned pattern ──
    if (action === 'store_pattern') {
      const { user_name, pattern_type, pattern, confidence, metadata } = body;
      if (!pattern) return json({ error: 'pattern required' }, corsHeaders, 400);

      // Check if similar pattern exists — update confidence if so
      const checkUrl = `${supabaseUrl}/rest/v1/ai_learned_patterns?user_name=eq.${encodeURIComponent(user_name || '')}&pattern_type=eq.${encodeURIComponent(pattern_type || 'behavior')}&active=eq.true&limit=20`;
      const checkRes = await fetch(checkUrl, { headers: sbHeaders(supabaseKey) });
      const existing = checkRes.ok ? await checkRes.json() : [];

      // Simple similarity — if an existing pattern contains >60% of the same words
      const patternWords = new Set(pattern.toLowerCase().split(/\s+/));
      const match = existing.find((p: any) => {
        const existingWords = new Set(p.pattern.toLowerCase().split(/\s+/));
        const overlap = [...patternWords].filter(w => existingWords.has(w)).length;
        return overlap / Math.max(patternWords.size, existingWords.size) > 0.6;
      });

      if (match) {
        // Reinforce existing pattern
        const newConfidence = Math.min(1.0, (match.confidence || 0.5) + 0.05);
        await fetch(`${supabaseUrl}/rest/v1/ai_learned_patterns?id=eq.${match.id}`, {
          method: 'PATCH',
          headers: sbHeaders(supabaseKey),
          body: JSON.stringify({
            confidence: newConfidence,
            evidence_count: (match.evidence_count || 1) + 1,
            last_seen: new Date().toISOString(),
            pattern: pattern, // Update with latest wording
          }),
        });
        return json({ stored: true, reinforced: true, confidence: newConfidence }, corsHeaders);
      }

      // New pattern
      const res = await fetch(`${supabaseUrl}/rest/v1/ai_learned_patterns`, {
        method: 'POST',
        headers: sbHeaders(supabaseKey),
        body: JSON.stringify({
          user_name: user_name || null,
          pattern_type: pattern_type || 'behavior',
          pattern,
          confidence: confidence || 0.5,
          evidence_count: 1,
          metadata: metadata || {},
          last_seen: new Date().toISOString(),
          first_seen: new Date().toISOString(),
          active: true,
          created_at: new Date().toISOString(),
        }),
      });
      return json({ stored: res.ok, reinforced: false }, corsHeaders);
    }

    // ── Get learned patterns for a user ──
    if (action === 'get_patterns') {
      const { user_name, min_confidence } = body;

      let url = `${supabaseUrl}/rest/v1/ai_learned_patterns?active=eq.true&order=confidence.desc&limit=30`;
      if (user_name) url += `&user_name=eq.${encodeURIComponent(user_name)}`;
      if (min_confidence) url += `&confidence=gte.${min_confidence}`;

      const res = await fetch(url, { headers: sbHeaders(supabaseKey) });
      const data = res.ok ? await res.json() : [];
      return json({ patterns: data }, corsHeaders);
    }

    // ── Store or update entity knowledge (facts about people/things) ──
    if (action === 'store_knowledge') {
      const { entity, category, fact, source, confidence } = body;
      if (!entity || !fact) return json({ error: 'entity and fact required' }, corsHeaders, 400);

      // Check for existing similar fact — update instead of duplicate
      const checkUrl = `${supabaseUrl}/rest/v1/ai_entity_knowledge?entity=eq.${encodeURIComponent(entity)}&category=eq.${encodeURIComponent(category || 'fact')}&superseded_by=is.null&limit=20`;
      const checkRes = await fetch(checkUrl, { headers: sbHeaders(supabaseKey) });
      const existing = checkRes.ok ? await checkRes.json() : [];

      const factWords = new Set(fact.toLowerCase().split(/\s+/));
      const match = existing.find((k: any) => {
        const kWords = new Set(k.fact.toLowerCase().split(/\s+/));
        const overlap = [...factWords].filter(w => kWords.has(w)).length;
        return overlap / Math.max(factWords.size, kWords.size) > 0.5;
      });

      if (match) {
        // Update existing fact
        await fetch(`${supabaseUrl}/rest/v1/ai_entity_knowledge?id=eq.${match.id}`, {
          method: 'PATCH',
          headers: sbHeaders(supabaseKey),
          body: JSON.stringify({
            fact,
            confidence: Math.min(1.0, (match.confidence || 0.7) + 0.05),
            times_confirmed: (match.times_confirmed || 1) + 1,
            last_confirmed: new Date().toISOString(),
          }),
        });
        return json({ stored: true, updated: true }, corsHeaders);
      }

      // New fact
      const res = await fetch(`${supabaseUrl}/rest/v1/ai_entity_knowledge`, {
        method: 'POST',
        headers: sbHeaders(supabaseKey),
        body: JSON.stringify({
          entity,
          category: category || 'fact',
          fact,
          source: source || 'observation',
          confidence: confidence || 0.7,
          times_confirmed: 1,
          last_confirmed: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }),
      });
      return json({ stored: res.ok, updated: false }, corsHeaders);
    }

    // ── Get all knowledge about a person ──
    if (action === 'get_knowledge') {
      const { entity, category } = body;
      if (!entity) return json({ error: 'entity required' }, corsHeaders, 400);

      let url = `${supabaseUrl}/rest/v1/ai_entity_knowledge?entity=eq.${encodeURIComponent(entity)}&superseded_by=is.null&order=confidence.desc&limit=50`;
      if (category) url += `&category=eq.${encodeURIComponent(category)}`;

      const res = await fetch(url, { headers: sbHeaders(supabaseKey) });
      const data = res.ok ? await res.json() : [];
      return json({ knowledge: data }, corsHeaders);
    }

    // ── Build consciousness context for a user ──
    // Returns everything the AI "knows" about this person — for system prompt injection
    if (action === 'get_consciousness') {
      const { user_name } = body;
      if (!user_name) return json({ error: 'user_name required' }, corsHeaders, 400);

      // Parallel fetch: knowledge + patterns + recent observations
      const [knowledgeRes, patternsRes, observationsRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/ai_entity_knowledge?entity=eq.${encodeURIComponent(user_name)}&superseded_by=is.null&order=confidence.desc&limit=30`, { headers: sbHeaders(supabaseKey) }),
        fetch(`${supabaseUrl}/rest/v1/ai_learned_patterns?user_name=eq.${encodeURIComponent(user_name)}&active=eq.true&confidence=gte.0.4&order=confidence.desc&limit=15`, { headers: sbHeaders(supabaseKey) }),
        fetch(`${supabaseUrl}/rest/v1/ai_observations?user_name=eq.${encodeURIComponent(user_name)}&order=created_at.desc&limit=10`, { headers: sbHeaders(supabaseKey) }),
      ]);

      const knowledge = knowledgeRes.ok ? await knowledgeRes.json() : [];
      const patterns = patternsRes.ok ? await patternsRes.json() : [];
      const recentObservations = observationsRes.ok ? await observationsRes.json() : [];

      // Build natural language consciousness block
      const lines: string[] = [];

      if (knowledge.length > 0) {
        const grouped: Record<string, string[]> = {};
        for (const k of knowledge) {
          const cat = k.category || 'other';
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(k.fact);
        }
        for (const [cat, facts] of Object.entries(grouped)) {
          lines.push(`${cat}: ${facts.join('. ')}`);
        }
      }

      if (patterns.length > 0) {
        lines.push(`Patterns you've noticed: ${patterns.map((p: any) => p.pattern).join('. ')}`);
      }

      if (recentObservations.length > 0) {
        const recent = recentObservations.slice(0, 3).map((o: any) => o.detail).join('. ');
        lines.push(`Recent memories: ${recent}`);
      }

      return json({
        consciousness: lines.length > 0 ? lines.join('\n') : null,
        knowledge,
        patterns,
        recentObservations,
      }, corsHeaders);
    }

    return json({ error: 'Invalid action. Use: store_observation, get_observations, store_pattern, get_patterns, store_knowledge, get_knowledge, get_consciousness' }, corsHeaders, 400);
  } catch (e: any) {
    return json({ error: e.message || 'Internal error' }, corsHeaders, 500);
  }
}
