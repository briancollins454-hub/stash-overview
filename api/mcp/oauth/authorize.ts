import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  CLAUDE_REDIRECT,
  isAllowedRedirectUri,
  signPayload,
} from '../../mcp-lib/oauth.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function consentPage(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  error?: string;
}): string {
  const hidden = `
    <input type="hidden" name="response_type" value="code" />
    <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
    <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}" />
    <input type="hidden" name="code_challenge_method" value="S256" />
    <input type="hidden" name="scope" value="${escapeHtml(params.scope)}" />
  `;
  const err = params.error
    ? `<p style="color:#b91c1c;margin:0 0 1rem">${escapeHtml(params.error)}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect Claude to Stash</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f1f5f9; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; padding: 2rem; border-radius: 12px; max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; color: #0f172a; }
    p { color: #64748b; font-size: .9rem; line-height: 1.5; }
    label { display: block; font-size: .8rem; font-weight: 600; color: #334155; margin-bottom: .35rem; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: .65rem .75rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 1rem; }
    button { margin-top: 1rem; width: 100%; padding: .75rem; background: #4f46e5; color: #fff; border: 0; border-radius: 8px; font-weight: 600; font-size: 1rem; cursor: pointer; }
    button:hover { background: #4338ca; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Claude to Stash</h1>
    <p>Claude is requesting access to Stash production data (Shopify, Supabase, Deco). Enter your Stash MCP connect password to approve.</p>
    ${err}
    <form method="POST">
      ${hidden}
      <label for="password">MCP connect password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Allow access</button>
    </form>
  </div>
</body>
</html>`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const clientId = String(req.query.client_id || '');
    const redirectUri = String(req.query.redirect_uri || '');
    const state = String(req.query.state || '');
    const codeChallenge = String(req.query.code_challenge || '');
    const scope = String(req.query.scope || 'mcp');
    if (!clientId || !redirectUri || !codeChallenge) {
      return res.status(400).send('Missing OAuth parameters');
    }
    if (!isAllowedRedirectUri(redirectUri)) {
      return res.status(400).send('Invalid redirect_uri');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(consentPage({ clientId, redirectUri, state, codeChallenge, scope }));
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, string>;
    const clientId = String(body.client_id || '');
    const redirectUri = String(body.redirect_uri || '');
    const state = String(body.state || '');
    const codeChallenge = String(body.code_challenge || '');
    const scope = String(body.scope || 'mcp');
    const password = String(body.password || '');

    if (!isAllowedRedirectUri(redirectUri)) {
      return res.status(400).send('Invalid redirect_uri');
    }

    const expected = process.env.MCP_CONNECT_PASSWORD?.trim();
    if (!expected) {
      return res.status(503).send('MCP_CONNECT_PASSWORD is not configured on the server');
    }
    if (password !== expected) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(401).send(
        consentPage({
          clientId,
          redirectUri,
          state,
          codeChallenge,
          scope,
          error: 'Incorrect password. Try again.',
        }),
      );
    }

    const code = signPayload(
      {
        type: 'auth_code',
        clientId,
        redirectUri,
        codeChallenge,
        scope,
        sub: 'stash-mcp-user',
      },
      600,
    );
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    res.setHeader('Location', url.toString());
    return res.status(302).end();
  }

  return res.status(405).send('Method not allowed');
}
