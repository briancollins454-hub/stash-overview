export const config = { runtime: 'edge' };

// ─── TTS: OpenAI (primary) + ElevenLabs (premium fallback) ───────
// OpenAI TTS-1 for low-latency, natural voice. ElevenLabs if key exists for premium quality.

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

  const authDecision = await requireAuthEdge(req, 'tts', corsHeaders);
  if (authDecision.reject) return authDecision.reject;

  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!elevenLabsKey && !openaiKey) {
    return new Response(JSON.stringify({ error: 'No TTS API key configured' }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { text, voice: reqVoice, speed: reqSpeed } = await req.json();
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanText = text.slice(0, 2000).trim();

    // ── Try ElevenLabs first (premium quality) ──
    if (elevenLabsKey) {
      try {
        const voice = reqVoice || process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
        const elResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': elevenLabsKey,
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.35,
              similarity_boost: 0.85,
              style: 0.55,
              use_speaker_boost: true,
            },
            optimize_streaming_latency: 3,
          }),
        });

        if (elResp.ok && elResp.body) {
          return new Response(elResp.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-cache',
            },
          });
        }
      } catch {
        // Fall through to OpenAI
      }
    }

    // ── OpenAI TTS (reliable fallback, still natural) ──
    if (openaiKey) {
      const ttsVoice = reqVoice || process.env.TTS_VOICE || 'nova';
      const ttsSpeed = Math.min(Math.max(reqSpeed || 1.05, 0.25), 4.0);

      const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: cleanText,
          voice: ttsVoice,
          speed: ttsSpeed,
          response_format: 'mp3',
        }),
      });

      if (resp.ok && resp.body) {
        return new Response(resp.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-cache',
          },
        });
      }

      const err = await resp.text();
      return new Response(JSON.stringify({ error: 'TTS generation failed', detail: err }), {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'No TTS provider available' }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
