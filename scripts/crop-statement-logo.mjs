#!/usr/bin/env node
/**
 * Fetch Shopify brand_trio_image, trim to logo rows (skip large top mark),
 * write public/statement-brand-trio.png + constants/statementLogoEmbed.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'public/statement-brand-trio.png');

const SHOPIFY_URL =
  'https://cdn.shopify.com/s/files/1/1075/6304/files/brand_trio_image.png?v=1779267381';

const REGION = { x0: 110, x1: 890, y0: 98, y1: 338 };

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isInk(r, g, b, a) {
  return a >= 20 && lum(r, g, b) > 24;
}

const res = await fetch(SHOPIFY_URL);
if (!res.ok) throw new Error(`fetch ${res.status}`);
const input = PNG.sync.read(Buffer.from(await res.arrayBuffer()));

let minX = REGION.x1;
let maxX = REGION.x0;
let minY = REGION.y1;
let maxY = REGION.y0;

for (let y = REGION.y0; y <= REGION.y1; y++) {
  for (let x = REGION.x0; x <= REGION.x1; x++) {
    const i = (y * input.width + x) * 4;
    if (isInk(input.data[i], input.data[i + 1], input.data[i + 2], input.data[i + 3])) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const pad = 4;
minX = Math.max(REGION.x0, minX - pad);
minY = Math.max(REGION.y0, minY - pad);
maxX = Math.min(REGION.x1, maxX + pad);
maxY = Math.min(REGION.y1, maxY + pad);

const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const output = new PNG({ width: cw, height: ch });

for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((minY + y) * input.width + (minX + x)) * 4;
    const di = (y * cw + x) * 4;
    const r = input.data[si];
    const g = input.data[si + 1];
    const b = input.data[si + 2];
    const a = input.data[si + 3];
    if (isInk(r, g, b, a)) {
      output.data[di] = r;
      output.data[di + 1] = g;
      output.data[di + 2] = b;
      output.data[di + 3] = 255;
    } else {
      output.data[di] = 255;
      output.data[di + 1] = 255;
      output.data[di + 2] = 255;
      output.data[di + 3] = 255;
    }
  }
}

const pngBuf = PNG.sync.write(output);
fs.writeFileSync(out, pngBuf);
console.log(`OK ${cw}×${ch} → ${out} (update STATEMENT_LOGO_SIZE in statementBranding.ts if changed)`);
