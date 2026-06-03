import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CLAUDE_REDIRECT, issueDynamicClient } from '../../../lib/mcp-oauth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { client_id, client_secret } = issueDynamicClient();
    const now = Math.floor(Date.now() / 1000);
    return res.status(201).json({
      client_id,
      client_secret,
      client_id_issued_at: now,
      client_secret_expires_at: 0,
      redirect_uris: [CLAUDE_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
