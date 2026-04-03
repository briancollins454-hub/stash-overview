export const config = { runtime: 'edge' };

// ─── Multi-Agent AI Endpoint with Tool Use ────────────────────────
// Supports: orchestrator routing, tool calls, streaming, agent specialization

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'lookup_order',
    description: 'Look up a specific order by order number. Returns full order details including customer, status, items, completion, value, and timeline.',
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string', description: 'The order number to look up (e.g. "12345")' }
      },
      required: ['order_number']
    }
  },
  {
    name: 'search_orders',
    description: 'Search orders by customer name, club name, product, or status. Returns matching orders with key details.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term — customer name, club, product, or status keyword' },
        filter: { type: 'string', enum: ['overdue', 'ready', 'in_production', 'all'], description: 'Optional filter for order status' },
        limit: { type: 'number', description: 'Max results to return (default 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_analytics',
    description: 'Get business analytics and trends. Can compute averages, comparisons, forecasts, and breakdowns.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['overdue_trend', 'completion_rate', 'throughput', 'bottlenecks', 'customer_breakdown', 'daily_summary', 'risk_forecast'], description: 'The metric or analysis to compute' },
        period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'last_7_days', 'last_30_days'], description: 'Time period for the analysis' }
      },
      required: ['metric']
    }
  },
  {
    name: 'execute_action',
    description: 'Execute a dashboard action like syncing data, navigating to a tab, or triggering a refresh.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['sync', 'deep_sync', 'navigate'], description: 'The action to execute' },
        target: { type: 'string', description: 'For navigate: the tab name (dashboard, stock, deco, kanban, alerts, production, finance, sales)' }
      },
      required: ['action']
    }
  },
  {
    name: 'search_knowledge_base',
    description: 'Search the knowledge base (RAG) for historical data, past conversations, production notes, and business context that isn\'t in the live dashboard.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        category: { type: 'string', enum: ['orders', 'customers', 'production', 'conversations', 'all'], description: 'Category to search within' }
      },
      required: ['query']
    }
  },
  {
    name: 'draft_communication',
    description: 'Draft an email or message about an order or situation. Returns formatted text ready to send.',
    input_schema: {
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

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { system, messages, tools_context } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Use Sonnet for complex queries, Haiku for simple ones
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

    // First call: may return tool_use blocks
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system: system || '',
        messages,
        tools: TOOLS,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Stream response — emit text tokens and tool_use events
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = resp.body!.getReader();
        let buf = '';
        let toolUseBlocks: any[] = [];
        let currentToolId = '';
        let currentToolName = '';
        let currentToolInput = '';
        let stopReason = '';

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

                // Text content
                if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: d.delta.text })}\n\n`));
                }

                // Tool use start
                if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
                  currentToolId = d.content_block.id;
                  currentToolName = d.content_block.name;
                  currentToolInput = '';
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_start: currentToolName })}\n\n`));
                }

                // Tool use input delta
                if (d.type === 'content_block_delta' && d.delta?.type === 'input_json_delta') {
                  currentToolInput += d.delta.partial_json || '';
                }

                // Tool use block complete
                if (d.type === 'content_block_stop' && currentToolName) {
                  let parsedInput = {};
                  try { parsedInput = JSON.parse(currentToolInput); } catch {}
                  
                  const toolBlock = {
                    id: currentToolId,
                    name: currentToolName,
                    input: parsedInput
                  };
                  toolUseBlocks.push(toolBlock);
                  
                  // Emit tool_call event so client can resolve it
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_call: toolBlock })}\n\n`));
                  currentToolName = '';
                  currentToolInput = '';
                  currentToolId = '';
                }

                // Track stop reason
                if (d.type === 'message_delta' && d.delta?.stop_reason) {
                  stopReason = d.delta.stop_reason;
                }
              } catch {}
            }
          }
        } catch {}

        // If stop reason is tool_use, signal client to resolve tools and continue
        if (stopReason === 'tool_use') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ needs_tool_results: true, tools: toolUseBlocks })}\n\n`));
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
