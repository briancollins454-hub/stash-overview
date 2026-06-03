// Self-contained for Vercel — do not import from outside api/
import crypto from 'crypto';

const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const PROD_ORIGIN = 'https://www.stashoverview.co.uk';

export function mcpIssuerOrigin(): string {
  const fromEnv = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (fromEnv && !fromEnv.includes('localhost')) return fromEnv;
  return PROD_ORIGIN;
}

export function protectedResourceMetadataUrl(): string {
  return `${mcpIssuerOrigin()}/.well-known/oauth-protected-resource`;
}

function signingSecret(): string {
  const s = process.env.MCP_OAUTH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!s) throw new Error('MCP_OAUTH_SECRET or CRON_SECRET must be set for MCP OAuth');
  return s;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64url');
}

function fromB64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64url(JSON.stringify({ ...payload, exp }));
  const sig = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(fromB64url(body)) as T & { exp?: number };
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clientSecretForId(clientId: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(`client:${clientId}`).digest('base64url');
}

export function verifyOAuthClient(clientId: string, clientSecret?: string): boolean {
  const staticId = process.env.MCP_OAUTH_CLIENT_ID?.trim();
  const staticSecret = process.env.MCP_OAUTH_CLIENT_SECRET?.trim();
  if (staticId && clientId === staticId) {
    if (!staticSecret) return true;
    return clientSecret === staticSecret;
  }
  const expected = clientSecretForId(clientId);
  return !!clientSecret && clientSecret === expected;
}

export function issueDynamicClient() {
  const client_id = crypto.randomUUID();
  const client_secret = clientSecretForId(client_id);
  return { client_id, client_secret };
}

export function isAllowedRedirectUri(uri: string): boolean {
  return uri === CLAUDE_REDIRECT;
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return hash === codeChallenge;
}

export function parseFormBody(body: unknown, rawBody?: string | Buffer): URLSearchParams {
  if (typeof rawBody === 'string' && rawBody.length > 0) return new URLSearchParams(rawBody);
  if (Buffer.isBuffer(rawBody) && rawBody.length > 0) return new URLSearchParams(rawBody.toString('utf8'));
  if (typeof body === 'string' && body.length > 0) return new URLSearchParams(body);
  if (body && typeof body === 'object') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body as Record<string, string>)) {
      if (v != null) params.set(k, String(v));
    }
    return params;
  }
  return new URLSearchParams();
}

export function protectedResourceMetadata() {
  const origin = mcpIssuerOrigin();
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['mcp', 'offline_access'],
    bearer_methods_supported: ['header'],
  };
}

export function authorizationServerMetadata() {
  const origin = mcpIssuerOrigin();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['mcp', 'offline_access'],
  };
}

export function unauthorizedMcpHeaders(): Record<string, string> {
  return {
    'WWW-Authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl()}", scope="mcp"`,
  };
}

export function issueAccessToken(sub: string, scope: string) {
  const access_token = signPayload({ type: 'access', sub, scope }, 3600);
  const refresh_token = signPayload({ type: 'refresh', sub, scope }, 60 * 60 * 24 * 90);
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token,
    scope,
  };
}

export function verifyAccessToken(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  const payload = verifySignedPayload<{ type?: string }>(token);
  return payload?.type === 'access';
}

export { CLAUDE_REDIRECT };
