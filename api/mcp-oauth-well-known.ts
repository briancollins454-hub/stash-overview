import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../lib/mcp-oauth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const type = (req.query.type as string) || 'resource';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (type === 'server') {
    return res.status(200).json(authorizationServerMetadata());
  }
  return res.status(200).json(protectedResourceMetadata());
}
