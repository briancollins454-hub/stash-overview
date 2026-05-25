#!/usr/bin/env node
/**
 * Build statement-brand-trio.png from Shopify brand_trio_image.png.
 * Matches legacy PDF header: Marx Corporate + Stash Shop + Stash Inc (white bg).
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
  process.env.BRAND_TRIO_SHOPIFY_URL ||
  'https://cdn.shopify.com/s/files/1/1075/6304/files/brand_trio_image.png?v=1779267381';

/** Marx trio row + Stash / Stash Inc (skip the oversized top-left mark). */
const CROP_1000 = { x0: 118, x1: 880, y0: 100, y1: 335 };

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Visible pixel on the black Shopify canvas (green Marx marks + Stash marks). */
function isContent(r, g, b, a) {
  if (a < 15) return false;
  return lum(r, g, b) > 28;
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

const buf = await loadSource();
const input = PNG.sync.read(buf);
const { x0, x1, y0, y1 } = scaleBounds(input.width, input.height, CROP_1000);

// Tight bbox of visible content inside crop region
let minX = x1;
let maxX = x0;
let minY = y1;
let maxY = y0;
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const i = (y * input.width + x) * 4;
    const r = input.data[i];
    const g = input.data[i + 1];
    const b = input.data[i + 2];
    const a = input.data[i + 3];
    if (isContent(r, g, b, a)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const pad = 4;
minX = Math.max(x0, minX - pad);
minY = Math.max(y0, minY - pad);
maxX = Math.min(x1, maxX + pad);
maxY = Math.min(y1, maxY + pad);

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

    if (isContent(r, g, b, a)) {
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
  `OK ${cw}×${ch} (content y ${minY}–${maxY}, x ${minX}–${maxX}) → ${out} (${fs.statSync(out).size} bytes)`,
);
