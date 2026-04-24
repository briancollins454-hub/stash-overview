import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');
  res.setHeader('Cache-Control', 'public, max-age=300'); // cache 5 min

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Return non-sensitive shared system config (ANON_KEY is public by design in Supabase)
  res.json({
    shopifyDomain: process.env.SHOPIFY_DOMAIN || '',
    decoDomain: process.env.DECO_DOMAIN || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    firebaseApiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBCRGZHAAsD2y4Ns0KoJqIHQOGzJUJH5Y4',
  });
}
