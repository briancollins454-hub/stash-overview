import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  issueAccessToken,
  parseFormBody,
  verifyOAuthClient,
  verifyPkceS256,
  verifySignedPayload,
} from '../../mcp-lib/oauth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const raw =
    typeof req.body === 'string' ? req.body
      : Buffer.isBuffer(req.body) ? req.body.toString('utf8')
        : undefined;
  const form = parseFormBody(req.body, raw);
  const grantType = form.get('grant_type');

  try {
    if (grantType === 'authorization_code') {
      const code = form.get('code') || '';
      const clientId = form.get('client_id') || '';
      const clientSecret = form.get('client_secret') || undefined;
      const codeVerifier = form.get('code_verifier') || '';
      if (!verifyOAuthClient(clientId, clientSecret)) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      const payload = verifySignedPayload<{
        type?: string;
        clientId?: string;
        codeChallenge?: string;
        redirectUri?: string;
        scope?: string;
        sub?: string;
      }>(code);
      if (!payload || payload.type !== 'auth_code') {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (payload.clientId !== clientId) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (!payload.codeChallenge || !verifyPkceS256(codeVerifier, payload.codeChallenge)) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      const scope = payload.scope || 'mcp';
      return res.status(200).json(issueAccessToken(payload.sub || 'stash-mcp-user', scope));
    }

    if (grantType === 'refresh_token') {
      const refresh = form.get('refresh_token') || '';
      const clientId = form.get('client_id') || '';
      const clientSecret = form.get('client_secret') || undefined;
      if (!verifyOAuthClient(clientId, clientSecret)) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      const payload = verifySignedPayload<{
        type?: string;
        sub?: string;
        scope?: string;
      }>(refresh);
      if (!payload || payload.type !== 'refresh') {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      return res.status(200).json(
        issueAccessToken(payload.sub || 'stash-mcp-user', payload.scope || 'mcp'),
      );
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
