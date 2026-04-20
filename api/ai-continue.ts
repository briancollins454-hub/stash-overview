export const config = { runtime: 'edge' };

// ─── Continue conversation after tool results (OpenAI GPT-4.1) ───
// Client resolves tool calls locally, sends results back here for GPT to synthesize

export default async function handler(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ['https://stashoverview.co.uk', 'https://www.stashoverview.co.uk', 'http://localhost:3000'];
  const corsHeaders: Record<string, string> = {};
  if (allowed.includes(origin) || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }
  corsHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type';

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { system, messages } = await req.json();

    const model = process.env.OPENAI_MODEL || 'gpt-4.1';

    const oaiMessages = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...messages,
    ];

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
