export const config = { runtime: 'edge' };

// ─── AI Learning Engine ──────────────────────────────────────────
// Runs after sessions close and periodically during long sessions.
// Takes conversation history + observation buffer, uses GPT to extract:
//   1. New facts about the user (preferences, habits, context)
//   2. Pattern reinforcements (routines, behaviors)
//   3. Notable observations worth remembering
// Writes results to Supabase via /api/ai-memory.

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { user_name, conversation, observations, existing_knowledge, existing_patterns, session_id } = await req.json();

    if (!user_name) {
      return new Response(JSON.stringify({ error: 'user_name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build the learning prompt
    const convoText = conversation && conversation.length > 0
      ? conversation.slice(-30).map((m: any) => `${m.role}: ${(m.text || '').slice(0, 150)}`).join('\n')
      : 'No conversation this session.';

    const obsText = observations && observations.length > 0
      ? observations.slice(-20).map((o: any) => {
          const people = o.people?.map((p: any) => `${p.name}: ${p.expression}, ${p.posture}, ${p.gesture}, doing: ${p.activity}`).join('; ') || o.description || '';
          const objs = o.objects?.map((obj: any) => obj.item).join(', ') || '';
          return `[${o.timestamp || '?'}] ${people}${objs ? ` | Objects: ${objs}` : ''}${o.significant_change && o.significant_change !== 'none' ? ` | Change: ${o.significant_change}` : ''}`;
        }).join('\n')
      : 'No visual observations this session.';

    const knownFacts = existing_knowledge && existing_knowledge.length > 0
      ? existing_knowledge.map((k: any) => `- [${k.category}] ${k.fact} (confidence: ${k.confidence})`).join('\n')
      : 'Nothing known yet.';

    const knownPatterns = existing_patterns && existing_patterns.length > 0
      ? existing_patterns.map((p: any) => `- [${p.pattern_type}] ${p.pattern} (confidence: ${p.confidence}, seen ${p.evidence_count}x)`).join('\n')
      : 'No patterns learned yet.';

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 800,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: `You are a learning engine for an AI assistant named Stash. Your job is to analyze a conversation and visual observations, then extract new facts, patterns, and notable moments that the AI should remember permanently.

The user's name is: ${user_name}

WHAT YOU ALREADY KNOW ABOUT THEM:
${knownFacts}

PATTERNS ALREADY LEARNED:
${knownPatterns}

RULES:
- Only extract GENUINELY useful information. Not every message is worth remembering.
- DON'T re-extract facts you already know (listed above). Only NEW information.
- DON'T extract trivial facts like "user asked about orders" — that's obvious.
- DO extract: personal details shared (family, interests, preferences), work habits, emotional patterns, specific preferences about how they want to be treated, recurring topics they care about.
- DO notice: arrival/departure times, stress triggers, mood patterns, relationship dynamics with other people mentioned, objects they regularly have.
- Patterns need at least some basis — don't invent patterns from single observations.
- Keep facts concise and specific.
- Assign reasonable confidence (0.3 for weak inference, 0.5 for mentioned once, 0.7 for clearly stated, 0.9 for repeatedly confirmed).

Return ONLY valid JSON:
{
  "new_facts": [
    {"category": "preference|fact|relationship|work_style|personal|physical", "fact": "concise statement", "source": "conversation|observation|inference", "confidence": 0.5}
  ],
  "pattern_updates": [
    {"pattern_type": "routine|behavior|preference|habit|reaction|social", "pattern": "concise description", "confidence": 0.5}
  ],
  "notable_observations": [
    {"type": "gesture|expression|arrival|departure|interaction|environment", "detail": "what happened and why it matters", "mood": "detected mood"}
  ],
  "relationship_note": "Brief note on how the relationship/rapport felt this session, or null"
}

If nothing worth learning, return empty arrays. Don't force insights.`,
          },
          {
            role: 'user',
            content: `CONVERSATION THIS SESSION:\n${convoText}\n\nVISUAL OBSERVATIONS THIS SESSION:\n${obsText}\n\nExtract what's worth remembering permanently.`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    let learnings;
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      learnings = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to parse learning output', raw: content }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Now store everything via the memory API
    const baseUrl = new URL(req.url).origin;
    const memoryUrl = `${baseUrl}/api/ai-memory`;
    const results = { facts_stored: 0, patterns_stored: 0, observations_stored: 0 };

    // Store new facts
    if (learnings.new_facts?.length > 0) {
      const factPromises = learnings.new_facts.map((f: any) =>
        fetch(memoryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'store_knowledge',
            entity: user_name,
            category: f.category || 'fact',
            fact: f.fact,
            source: f.source || 'inference',
            confidence: f.confidence || 0.5,
          }),
        }).then(() => { results.facts_stored++; }).catch(() => {}),
      );
      await Promise.allSettled(factPromises);
    }

    // Store/reinforce patterns
    if (learnings.pattern_updates?.length > 0) {
      const patternPromises = learnings.pattern_updates.map((p: any) =>
        fetch(memoryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'store_pattern',
            user_name,
            pattern_type: p.pattern_type || 'behavior',
            pattern: p.pattern,
            confidence: p.confidence || 0.5,
          }),
        }).then(() => { results.patterns_stored++; }).catch(() => {}),
      );
      await Promise.allSettled(patternPromises);
    }

    // Store notable observations
    if (learnings.notable_observations?.length > 0) {
      const obsPromises = learnings.notable_observations.map((o: any) =>
        fetch(memoryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'store_observation',
            user_name,
            observation_type: o.type || 'general',
            detail: o.detail,
            mood_at_time: o.mood || null,
            session_id: session_id || null,
          }),
        }).then(() => { results.observations_stored++; }).catch(() => {}),
      );
      await Promise.allSettled(obsPromises);
    }

    return new Response(JSON.stringify({
      learned: true,
      ...results,
      relationship_note: learnings.relationship_note || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
