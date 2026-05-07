import type { VercelRequest, VercelResponse } from '@vercel/node';

type ScanJob = {
  jobNumber: string;
  customerName?: string;
  status?: string;
  dateDue?: string;
  productionDueDate?: string;
  dateOrdered?: string;
  orderTotal?: number;
  outstandingBalance?: number;
  salesPerson?: string;
  notes?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (
    origin === 'https://stashoverview.co.uk'
    || origin === 'https://www.stashoverview.co.uk'
    || origin === 'http://localhost:3000'
    || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const { taskDate, jobs, limit } = (req.body || {}) as {
      taskDate?: string;
      jobs?: ScanJob[];
      limit?: number;
    };
    const rows = Array.isArray(jobs) ? jobs.slice(0, 250) : [];
    const max = Number.isFinite(limit) ? Math.max(3, Math.min(25, Number(limit))) : 12;
    if (!taskDate || rows.length === 0) return res.status(400).json({ error: 'taskDate and jobs required' });

    const prompt = [
      `Task date: ${taskDate}`,
      'You are operations AI for a production business.',
      `Return up to ${max} actionable chase tasks from these jobs.`,
      'Use common sense and prioritise what should be chased now.',
      'Prefer jobs that are overdue, due soon, aging, blocked/on hold, or carry balance risk.',
      'Do NOT output generic advice. Output concrete tasks tied to a jobNumber.',
      'JSON only.',
      JSON.stringify(rows),
    ].join('\n\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return JSON object: { "tasks": [{ "jobNumber": "string", "title": "string", "reason": "string", "score": number }] }. Keep reason short and specific.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(resp.status).json({ error: txt });
    }
    const json = await resp.json();
    const rawText = json?.choices?.[0]?.message?.content || '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(rawText); } catch { parsed = {}; }
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    const cleaned = tasks
      .filter((t: any) => t && t.jobNumber && t.title)
      .slice(0, max)
      .map((t: any) => ({
        sourceRef: `job:${String(t.jobNumber)}`,
        jobNumber: String(t.jobNumber),
        title: String(t.title),
        reason: String(t.reason || '').trim(),
        score: Number.isFinite(Number(t.score)) ? Number(t.score) : 0,
      }));
    return res.status(200).json({ tasks: cleaned });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'AI daily scan failed' });
  }
}

