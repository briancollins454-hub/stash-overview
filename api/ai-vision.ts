export const config = { runtime: 'edge' };

// ─── Live Vision Watch: Continuous camera awareness via GPT-4o-mini ──────
// Lightweight endpoint called every ~8s to analyze what the AI sees.
// Returns a brief JSON observation — NOT a full conversation response.
// Uses gpt-4o-mini for speed and cost (vision-capable, very fast).

export default async function handler(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ['https://stashoverview.co.uk', 'https://www.stashoverview.co.uk', 'http://localhost:3000'];
  const corsHeaders: Record<string, string> = {};
  if (allowed.includes(origin) || origin.endsWith('.vercel.app')) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }
  corsHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type';

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { image, previous_observation, user_name } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: 'image required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const previousContext = previous_observation
      ? `\nYour previous observation was: "${previous_observation}"\nNote any CHANGES from what you saw before.`
      : '';

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `You are a visual observer for an AI assistant. Analyze the camera frame and return a brief JSON observation. Be specific about what you see — this feeds into a conversational AI that reacts to the person naturally.${previousContext}

Return ONLY valid JSON with these fields:
{
  "people_count": number,
  "expression": "happy|neutral|focused|tired|surprised|confused|stressed|amused|bored",
  "gaze": "at_camera|away|down|phone",
  "description": "Brief natural description of what you see — person, clothing, setting, posture, anything notable",
  "change": "What changed since last observation, or 'none' if nothing notable",
  "notable": true/false — true if something interesting happened worth commenting on (big expression change, left/returned, doing something unusual, looking stressed, laughing, etc)
}${user_name ? `\nThe person's name is ${user_name}.` : ''}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What do you see right now?' },
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

    // Parse the JSON observation (handle markdown-wrapped JSON)
    let observation;
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      observation = JSON.parse(cleaned);
    } catch {
      observation = { description: content, expression: 'neutral', notable: false, change: 'none', people_count: 0, gaze: 'unknown' };
    }

    return new Response(JSON.stringify(observation), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
