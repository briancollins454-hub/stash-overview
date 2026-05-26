#!/usr/bin/env node
/**
 * Fetch Shopify brand_trio_image and trim transparent padding.
 * Writes public/statement-brand-trio.png (white bg) for the statement PDF header.
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

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Visible artwork: ignore transparent and near-white pixels. */
function isInk(r, g, b, a) {
  if (a < 20) return false;
  return lum(r, g, b) < 240;
}

const res = await fetch(SHOPIFY_URL);
if (!res.ok) throw new Error(`fetch ${res.status}`);
const input = PNG.sync.read(Buffer.from(await res.arrayBuffer()));

let minX = input.width;
let maxX = 0;
let minY = input.height;
let maxY = 0;

for (let y = 0; y < input.height; y++) {
  for (let x = 0; x < input.width; x++) {
    const i = (y * input.width + x) * 4;
    if (isInk(input.data[i], input.data[i + 1], input.data[i + 2], input.data[i + 3])) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const pad = 8;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(input.width - 1, maxX + pad);
maxY = Math.min(input.height - 1, maxY + pad);

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
    if (a < 20) {
      // transparent → flatten to white
      output.data[di] = 255;
      output.data[di + 1] = 255;
      output.data[di + 2] = 255;
      output.data[di + 3] = 255;
    } else {
      output.data[di] = r;
      output.data[di + 1] = g;
      output.data[di + 2] = b;
      output.data[di + 3] = 255;
    }
  }
}

fs.writeFileSync(out, PNG.sync.write(output));
console.log(
  `OK ${cw}×${ch} → ${out} (update STATEMENT_LOGO_SIZE in constants/statementBranding.ts)`,
);
