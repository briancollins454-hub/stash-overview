#!/usr/bin/env node
/**
 * Download brand trio from Shopify CDN, crop the middle row, write a small
 * same-origin fallback at public/statement-brand-trio.png.
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

function isInk(r, g, b, a) {
  return a >= 20 && !(r <= 12 && g <= 12 && b <= 12);
}

function boundsForSource(width) {
  if (width <= 600) return { x0: 59, x1: 411, y0: 95, y1: 155 };
  return { x0: 118, x1: 822, y0: 100, y1: 200 };
}

async function loadSource() {
  const local = path.join(root, 'public/statement-brand-trio-source.png');
  if (fs.existsSync(local)) {
    return { buf: fs.readFileSync(local), from: 'statement-brand-trio-source.png' };
  }
  const res = await fetch(SHOPIFY_URL);
  if (!res.ok) throw new Error(`Shopify fetch failed: ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), from: 'Shopify CDN' };
}

const { buf, from } = await loadSource();
const input = PNG.sync.read(buf);
const { x0, x1, y0, y1 } = boundsForSource(input.width);
const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
const output = new PNG({ width: cw, height: ch });

for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((y0 + y) * input.width + (x0 + x)) * 4;
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

fs.writeFileSync(out, PNG.sync.write(output));
console.log(`OK ${cw}×${ch} from ${from} → ${out} (${fs.statSync(out).size} bytes)`);
