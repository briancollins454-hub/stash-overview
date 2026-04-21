import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fetch, { RequestInit as FetchRequestInit } from "node-fetch";
import crypto from "crypto";

// --- Structured Logger ---
const log = {
  info: (msg: string, meta?: Record<string, any>) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta ? JSON.stringify(meta) : ''),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: Record<string, any>) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, meta ? JSON.stringify(meta) : ''),
};

const sanitizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    // Redact password param from query string
    if (parsed.searchParams.has('password')) {
      parsed.searchParams.set('password', '***REDACTED***');
    }
    // Redact any Authorization-like params
    for (const key of ['access_token', 'apikey', 'token', 'secret']) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '***REDACTED***');
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(/password=[^&]+/gi, 'password=***REDACTED***');
  }
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // --- Webhook Ingestion ---
  // Stores recent webhook events in memory for the frontend to poll.
  // Declared up here because the webhook POST handler is mounted BEFORE
  // the global express.json() parser (Shopify HMAC is computed against
  // the raw request bytes, so we cannot let json() consume the body first).
  const webhookEvents: { id: string; topic: string; payload: any; receivedAt: string }[] = [];
  const MAX_WEBHOOK_EVENTS = 200;

  // Shopify sends webhooks as POST with HMAC verification.
  // IMPORTANT: this route uses express.raw() to preserve the exact bytes
  // Shopify signed. Running express.json() first would re-stringify the
  // body with different whitespace / key ordering and the HMAC would
  // never match.
  app.post(
    "/api/webhooks/shopify",
    express.raw({ type: 'application/json', limit: '2mb' }),
    (req, res) => {
      const topic = req.headers['x-shopify-topic'] as string || 'unknown';
      const shopDomain = req.headers['x-shopify-shop-domain'] as string || '';
      const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');

      // Fail closed: if no secret is configured we refuse to accept
      // webhooks at all, rather than silently rubber-stamping every
      // request that hits this endpoint. Operators must set
      // SHOPIFY_WEBHOOK_SECRET to enable ingestion.
      const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        log.warn('Webhook rejected: SHOPIFY_WEBHOOK_SECRET is not configured', { topic, shop: shopDomain });
        return res.status(503).send('Webhook receiver not configured');
      }

      const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string | undefined;
      const computedHmac = crypto.createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('base64');

      // Constant-time compare.
      let signaturesMatch = false;
      if (hmacHeader) {
        try {
          const a = Buffer.from(hmacHeader, 'base64');
          const b = Buffer.from(computedHmac, 'base64');
          signaturesMatch = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
        } catch {
          signaturesMatch = false;
        }
      }

      if (!signaturesMatch) {
        log.warn('Webhook HMAC verification failed', { topic, shop: shopDomain });
        return res.status(401).send('Unauthorized');
      }

      // Parse the raw body now that we've verified it. If parsing fails
      // we still 200 (Shopify will retry otherwise, and the signature was
      // valid — so it's our bug if we can't parse), but log loudly.
      let payload: any = null;
      try {
        payload = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf8')) : {};
      } catch (e) {
        log.error('Webhook body JSON parse failed after HMAC passed', { topic, shop: shopDomain, err: (e as Error).message });
        payload = { _rawParseFailed: true };
      }

      const event = {
        id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        topic,
        payload,
        receivedAt: new Date().toISOString(),
      };

      webhookEvents.unshift(event);
      if (webhookEvents.length > MAX_WEBHOOK_EVENTS) webhookEvents.length = MAX_WEBHOOK_EVENTS;

      log.info('Webhook received', { topic, shop: shopDomain, eventId: event.id });
      res.status(200).json({ received: true });
    }
  );

  // Global JSON parser for every OTHER route. Mounted AFTER the webhook
  // route above so the raw-body parser wins for Shopify webhooks.
  app.use(express.json({ limit: '2mb' }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Frontend polls this endpoint for recent webhook events
  app.get("/api/webhooks/events", (req, res) => {
    const since = req.query.since as string;
    let events = webhookEvents;
    if (since) {
      const sinceTime = new Date(since).getTime();
      events = webhookEvents.filter(e => new Date(e.receivedAt).getTime() > sinceTime);
    }
    res.json({ events: events.slice(0, 50) });
  });

  // Customer order tracking — public endpoint, no auth required
  app.get("/api/track/:orderNumber", (req, res) => {
    // This is a stub. In production, query Supabase for the order status.
    // For now, the frontend handles tracking via React Router.
    res.json({ message: "Use the frontend tracking page at /?track=ORDER_NUMBER" });
  });

  // Shopify OAuth URL generation
  app.get("/api/auth/shopify/url", (req, res) => {
    const shop = req.query.shop as string;
    if (!shop) return res.status(400).json({ error: "Shop domain is required" });

    const clientId = process.env.SHOPIFY_API_KEY;
    const redirectUri = `${process.env.APP_URL}/auth/callback`;
    const scopes = "read_orders,read_products,read_inventory,read_fulfillments,read_assigned_fulfillment_orders";

    if (!clientId) {
      return res.status(500).json({ error: "SHOPIFY_API_KEY is not configured in environment variables" });
    }

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`;
    res.json({ url: authUrl });
  });

  // Shopify OAuth Callback
  app.get("/auth/callback", async (req, res) => {
    const { code, shop } = req.query;
    const clientId = process.env.SHOPIFY_API_KEY;
    const clientSecret = process.env.SHOPIFY_API_SECRET;

    if (!code || !shop) {
      return res.status(400).send("Missing code or shop parameter");
    }

    // Validate shop is a legitimate Shopify domain
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(String(shop))) {
      return res.status(400).send("Invalid shop domain");
    }

    try {
      const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const data = await response.json();
      const accessToken = data.access_token;

      if (!accessToken) {
        return res.status(400).send("Failed to obtain access token: " + JSON.stringify(data));
      }

      // Return a script that sends the token back to the main window and closes the popup
      // Use JSON serialization to prevent XSS via token/shop injection
      const safeData = JSON.stringify({ type: 'SHOPIFY_AUTH_SUCCESS', accessToken, shop: String(shop) });
      res.send(`
        <html>
          <head>
            <title>Shopify Auth Success</title>
            <style>
              body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f4; }
              .card { background: white; padding: 2rem; border-radius: 8px; shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #2c3e50; margin-top: 0; }
              p { color: #7f8c8d; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Authentication Successful</h1>
              <p>You can close this window now.</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage(${safeData.replace(/</g, '\u003c')}, window.location.origin);
                setTimeout(() => window.close(), 1000);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      log.error('OAuth Callback Error', { error: error.message });
      res.status(500).send("Authentication failed: " + error.message);
    }
  });

  // Deco API proxy — injects credentials server-side so they never leave the server
  app.post("/api/deco", async (req, res) => {
    const { endpoint, params } = req.body;
    const decoDomain = process.env.DECO_DOMAIN;
    const decoUsername = process.env.DECO_USERNAME;
    const decoPassword = process.env.DECO_PASSWORD;

    if (!decoDomain || !decoUsername || !decoPassword) {
      return res.status(500).json({ error: "Deco credentials not configured on server" });
    }

    const domain = decoDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const queryParams = new URLSearchParams();
    queryParams.append('username', decoUsername);
    queryParams.append('password', decoPassword);
    if (params) {
      Object.entries(params).forEach(([key, value]) => queryParams.append(key, String(value)));
    }

    const targetUrl = `https://${domain}/${endpoint}?${queryParams.toString()}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(targetUrl, { method: 'GET', signal: controller.signal as any });
      clearTimeout(timeoutId);
      const data = await response.text();
      log.info('Deco API call', { endpoint, paramCount: Object.keys(params || {}).length });
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } catch (error: any) {
      log.error('Deco API Error', { endpoint, error: error.message });
      res.status(500).json({ error: "Deco API call failed", details: error.message });
    }
  });

  // Domain allowlist for proxy (SSRF protection)
  const ALLOWED_PROXY_DOMAINS = [
    '.myshopify.com',
    '.shopify.com',
    '.secure-decoration.com',
    '.supabase.co',
  ];

  const isAllowedProxyTarget = (targetUrl: string): boolean => {
    try {
      const parsed = new URL(targetUrl);
      return ALLOWED_PROXY_DOMAINS.some(domain => parsed.hostname.endsWith(domain));
    } catch {
      return false;
    }
  };

  // API Proxy Route - Handle both POST and GET if needed
  app.all("/api/proxy", async (req, res) => {
    const { url, method, headers, body } = req.method === 'POST' ? req.body : req.query;
    
    const targetUrl = url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "URL is required" });
    }

    if (!isAllowedProxyTarget(targetUrl)) {
      log.warn('Blocked proxy request to disallowed domain', { url: sanitizeUrl(targetUrl) });
      return res.status(403).json({ error: "Target domain is not allowed" });
    }

    log.info(`Proxying ${req.method}`, { url: sanitizeUrl(targetUrl) });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const fetchOptions: FetchRequestInit = {
        method: (method as string) || req.method || 'GET',
        headers: (headers as any) || {},
        signal: controller.signal as any
      };

      if (body && !['GET', 'HEAD'].includes(fetchOptions.method?.toUpperCase() || '')) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type");
      const data = await response.text();

      // Forward status and content type
      res.status(response.status);
      if (contentType) res.setHeader("Content-Type", contentType);
      res.send(data);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        log.error('Proxy Timeout', { url: sanitizeUrl(targetUrl) });
        return res.status(504).json({ error: "Proxy timeout", details: "The target server took too long to respond." });
      }
      log.error('Proxy Error', { error: error.message, url: sanitizeUrl(targetUrl) });
      res.status(500).json({ error: "Proxy failed", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    // Express 5 wildcard
    app.get("*all", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    log.info(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
