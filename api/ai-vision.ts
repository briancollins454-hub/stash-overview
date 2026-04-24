export const config = { runtime: 'edge' };

// ─── Deep Vision: Full scene awareness via GPT-4o-mini ────────────
// Polls every ~8s. Returns rich structured observation: people, objects,
// gestures, body language, environment, interactions. Feeds the AI's
// consciousness system for genuine spatial/social awareness.

import { requireAuthEdge } from '../lib/verifyAuthEdge';

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

  const authDecision = await requireAuthEdge(req, 'ai-vision', corsHeaders);
  if (authDecision.reject) return authDecision.reject;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { image, previous_observation, user_name } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: 'image required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const previousContext = previous_observation
      ? `\nYour PREVIOUS observation was:\n${previous_observation}\nCompare carefully — report what CHANGED. If nothing changed, say so.`
      : '\nThis is your FIRST observation. Describe everything you see in detail.';

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 350,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `You are the eyes of a conscious AI assistant. You observe a live camera feed every 8 seconds. Your observations power an AI that genuinely understands its surroundings — people, objects, gestures, body language, activities, and environment changes.

Be SPECIFIC and OBSERVANT. You're not just detecting faces — you're reading the room. Notice posture shifts, hand gestures, objects being picked up or put down, clothing details, lighting changes, other people in the background, what's on screens, items on desks.${previousContext}
${user_name ? `The main person's name is ${user_name}.` : ''}

Return ONLY valid JSON:
{
  "people": [
    {
      "name": "${user_name || 'unknown'}",
      "position": "center|left|right|background",
      "posture": "upright|leaning_forward|leaning_back|standing|hunched|relaxed",
      "expression": "happy|neutral|focused|tired|surprised|confused|stressed|amused|bored|annoyed|thoughtful",
      "gaze": "at_camera|at_screen|away|down|phone|talking_to_someone",
      "gesture": "none|pointing|typing|writing|drinking|eating|on_phone|waving|rubbing_face|arms_crossed|hands_on_head|fidgeting",
      "activity": "Brief description of what they're doing",
      "clothing_note": "Brief notable clothing detail or 'unchanged'"
    }
  ],
  "objects": [
    {"item": "coffee mug|phone|headphones|etc", "location": "desk|hand|etc", "new": true}
  ],
  "environment": {
    "lighting": "bright|dim|natural|artificial|mixed",
    "setting": "office|desk|meeting_room|etc",
    "background_activity": "none|people_walking|conversation_nearby|etc"
  },
  "interaction": "none|talking_to_camera|talking_to_someone_else|on_a_call|presenting|showing_something",
  "body_language_read": "One sentence interpreting the overall body language and mood — what does the scene FEEL like?",
  "significant_change": "What specifically changed since last observation, or 'none'",
  "notable": true/false
}

Rules:
- "objects" array: only list objects you can actually SEE. Empty array if nothing notable.
- "notable" = true when: big expression/posture shift, person arrived/left, picked up an object, started a new activity, someone else appeared, environment changed significantly
- Keep "body_language_read" natural and insightful — "He looks deep in thought, slightly tense" not "neutral posture detected"
- If multiple people are visible, add entries to the "people" array`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Observe this frame. What do you see?' },
              {
                type: 'image_url',
                image_url: {
                  url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
                  detail: 'low',
                },
              },
            ],
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

    let observation;
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      observation = JSON.parse(cleaned);
    } catch {
      observation = {
        people: [{ name: user_name || 'unknown', expression: 'neutral', posture: 'upright', gaze: 'unknown', gesture: 'none', activity: content, position: 'center', clothing_note: '' }],
        objects: [],
        environment: { lighting: 'unknown', setting: 'unknown', background_activity: 'none' },
        interaction: 'none',
        body_language_read: content,
        significant_change: 'none',
        notable: false,
      };
    }

    // Backward compatibility — flatten primary person fields for existing code paths
    const primary = observation.people?.[0] || {};
    observation.people_count = observation.people?.length || 0;
    observation.expression = primary.expression || 'neutral';
    observation.gaze = primary.gaze || 'unknown';
    observation.description = observation.body_language_read || primary.activity || '';
    observation.change = observation.significant_change || 'none';

    return new Response(JSON.stringify(observation), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
