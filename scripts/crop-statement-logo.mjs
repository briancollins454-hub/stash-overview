#!/usr/bin/env node
/**
 * Download Shopify brand_trio_image.png and crop the three-logo row for statements.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'public/statement-brand-trio.png');
const sourceOut = path.join(root, 'public/statement-brand-trio-source.png');

const SHOPIFY_URL =
  'https://cdn.shopify.com/s/files/1/1075/6304/files/brand_trio_image.png?v=1779267381';

/** Three-logo row on the 1000×1000 Shopify file (not the large mark at the top). */
const CROP_1000 = { x0: 118, x1: 818, y0: 205, y1: 265 };

function isInk(r, g, b, a) {
  return a >= 20 && !(r <= 12 && g <= 12 && b <= 12);
}

function scaleBounds(width, height, bounds) {
  const sx = width / 1000;
  const sy = height / 1000;
  return {
    x0: Math.round(bounds.x0 * sx),
    x1: Math.round(bounds.x1 * sx),
    y0: Math.round(bounds.y0 * sy),
    y1: Math.round(bounds.y1 * sy),
  };
}

async function loadSource() {
  const res = await fetch(SHOPIFY_URL);
  if (!res.ok) throw new Error(`Shopify fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(sourceOut, buf);
  return buf;
}

const buf = fs.existsSync(sourceOut)
  ? fs.readFileSync(sourceOut)
  : await loadSource();

const input = PNG.sync.read(buf);
const { x0, x1, y0, y1 } = scaleBounds(input.width, input.height, CROP_1000);
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
console.log(
  `OK ${cw}×${ch} (crop y ${y0}-${y1}) → ${out} (${fs.statSync(out).size} bytes)`,
);
