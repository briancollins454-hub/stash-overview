export const config = { runtime: 'edge' };

// ─── Multi-Agent AI Endpoint with Tool Use (OpenAI GPT-4.1) ──────
// Supports: orchestrator routing, tool calls, streaming, agent specialization

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description: 'Look up a specific order by order number. Returns full order details including customer, status, items, completion, value, and timeline.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: 'The order number to look up (e.g. "12345")' }
        },
        required: ['order_number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_orders',
      description: 'Search orders by customer name, club name, product, or status. Returns matching orders with key details.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term — customer name, club, product, or status keyword' },
          filter: { type: 'string', enum: ['overdue', 'ready', 'in_production', 'all'], description: 'Optional filter for order status' },
          limit: { type: 'number', description: 'Max results to return (default 10)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_analytics',
      description: 'Get business analytics and trends. Can compute averages, comparisons, forecasts, and breakdowns.',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['overdue_trend', 'completion_rate', 'throughput', 'bottlenecks', 'customer_breakdown', 'daily_summary', 'risk_forecast'], description: 'The metric or analysis to compute' },
          period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'last_7_days', 'last_30_days'], description: 'Time period for the analysis' }
        },
        required: ['metric']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_action',
      description: 'Execute a dashboard action like syncing data, navigating to a tab, or triggering a refresh.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['sync', 'deep_sync', 'navigate'], description: 'The action to execute' },
          target: { type: 'string', description: 'For navigate: the tab name (dashboard, stock, deco, kanban, alerts, production, finance, sales)' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description: 'Search the knowledge base (RAG) for historical data, past conversations, production notes, and business context that isn\'t in the live dashboard.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          category: { type: 'string', enum: ['orders', 'customers', 'production', 'conversations', 'all'], description: 'Category to search within' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'draft_communication',
      description: 'Draft an email or message about an order or situation. Returns formatted text ready to send.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['delay_notice', 'completion_update', 'general'], description: 'Type of communication' },
          order_number: { type: 'string', description: 'Related order number if applicable' },
          recipient: { type: 'string', description: 'Who the message is for' },
          context: { type: 'string', description: 'Additional context or instructions' }
        },
        required: ['type']
      }
    }
  }
];

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
    const { system, messages, tools_context, image } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Use GPT-4o when vision is needed (supports both vision AND tools)
    // Fall back to gpt-4.1 for text-only (faster, cheaper)
    const hasImage = !!image;
    const model = hasImage ? 'gpt-4o' : (process.env.OPENAI_MODEL || 'gpt-4.1');

    const oaiMessages: any[] = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...messages,
    ];

    // Attach camera snapshot to the last user message as vision content
    if (hasImage && oaiMessages.length > 0) {
      for (let i = oaiMessages.length - 1; i >= 0; i--) {
        if (oaiMessages[i].role === 'user') {
          const textContent = typeof oaiMessages[i].content === 'string' ? oaiMessages[i].content : '';
          oaiMessages[i] = {
            role: 'user',
            content: [
              { type: 'text', text: textContent },
              {
                type: 'image_url',
                image_url: {
                  url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
                  detail: 'low',
                },
              },
            ],
          };
          break;
        }
      }
    }

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
        tools: TOOLS,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Stream response — translate OpenAI SSE to our custom { t, tool_call, tool_start } format
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = resp.body!.getReader();
        let buf = '';
        // Track tool calls being assembled (OpenAI streams them in deltas by index)
        const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();
        let finishReason = '';

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
                const choice = d.choices?.[0];
                if (!choice) continue;

                // Text content
                if (choice.delta?.content) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: choice.delta.content })}\n\n`));
                }

                // Tool calls (streamed as deltas)
                if (choice.delta?.tool_calls) {
                  for (const tc of choice.delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsInProgress.has(idx)) {
                      toolCallsInProgress.set(idx, { id: tc.id || '', name: '', arguments: '' });
                    }
                    const entry = toolCallsInProgress.get(idx)!;
                    if (tc.id) entry.id = tc.id;
                    if (tc.function?.name) {
                      entry.name = tc.function.name;
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_start: entry.name })}\n\n`));
                    }
                    if (tc.function?.arguments) {
                      entry.arguments += tc.function.arguments;
                    }
                  }
                }

                // Track finish reason
                if (choice.finish_reason) {
                  finishReason = choice.finish_reason;
                }
              } catch {}
            }
          }
        } catch {}

        // If finish reason is tool_calls, emit them for the client to resolve
        if (finishReason === 'tool_calls' && toolCallsInProgress.size > 0) {
          const toolBlocks: any[] = [];
          for (const [, entry] of toolCallsInProgress) {
            let parsedInput = {};
            try { parsedInput = JSON.parse(entry.arguments); } catch {}
            const toolBlock = { id: entry.id, name: entry.name, input: parsedInput };
            toolBlocks.push(toolBlock);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_call: toolBlock })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ needs_tool_results: true, tools: toolBlocks })}\n\n`));
        }

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
