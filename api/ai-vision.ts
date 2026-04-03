export const config = { runtime: 'edge' };

// ─── Vision: Send camera frames to GPT-4o for real visual understanding ───
// Accepts a base64 JPEG snapshot + text query, returns streaming response
// The AI can genuinely SEE the user — their face, expression, surroundings, clothing, etc.

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
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { system, messages, image } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build messages — if image is provided, attach it to the last user message as vision content
    const oaiMessages: any[] = [];
    if (system) {
      oaiMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      oaiMessages.push(msg);
    }

    // Attach the camera frame to the last user message
    if (image && oaiMessages.length > 0) {
      const lastIdx = oaiMessages.length - 1;
      const lastMsg = oaiMessages[lastIdx];
      if (lastMsg.role === 'user') {
        // Convert text content to multimodal content array
        const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        oaiMessages[lastIdx] = {
          role: 'user',
          content: [
            { type: 'text', text: textContent },
            {
              type: 'image_url',
              image_url: {
                url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
                detail: 'low', // low detail = fast + cheap, enough for face/person recognition
              },
            },
          ],
        };
      }
    }

    // Use gpt-4o for vision (gpt-4.1 doesn't support vision)
    const model = image ? 'gpt-4o' : (process.env.OPENAI_MODEL || 'gpt-4.1');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.75,
        top_p: 0.95,
        frequency_penalty: 0.15,
        presence_penalty: 0.1,
        messages: oaiMessages,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = resp.body!.getReader();
        let buf = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const json = line.slice(6).trim();
              if (!json || json === '[DONE]') continue;
              try {
                const d = JSON.parse(json);
                const token = d.choices?.[0]?.delta?.content;
                if (token) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: token })}\n\n`));
                }
              } catch {}
            }
          }
        } catch {}
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
