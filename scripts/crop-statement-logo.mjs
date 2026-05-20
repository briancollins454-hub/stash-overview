#!/usr/bin/env node
/** One-off crop: tight bounds around brand trio (no square padding). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const sources = [
  path.join(root, 'public/statement-brand-trio-source.png'),
  path.join(
    process.env.HOME,
    '.cursor/projects/Users-briansinclair-stash-overview/assets/brand_trio_image__1_-f47375a3-fe6a-483e-bded-408dbf5e87c9.png',
  ),
  path.join(root, 'public/statement-brand-trio.png'),
].filter(p => fs.existsSync(p));

const src = sources[0];
const out = path.join(root, 'public/statement-brand-trio.png');

function isContent(r, g, b, a) {
  return a >= 20 && !(r <= 12 && g <= 12 && b <= 12);
}

const input = PNG.sync.read(fs.readFileSync(src));
const { width, height, data } = input;
let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (isContent(data[i], data[i + 1], data[i + 2], data[i + 3])) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
}

const pad = 2;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(width - 1, maxX + pad);
maxY = Math.min(height - 1, maxY + pad);
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;

const output = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((minY + y) * width + (minX + x)) * 4;
    const di = (y * cw + x) * 4;
    const r = data[si];
    const g = data[si + 1];
    const b = data[si + 2];
    const a = data[si + 3];
    if (isContent(r, g, b, a)) {
      output.data[di] = r;
      output.data[di + 1] = g;
      output.data[di + 2] = b;
      output.data[di + 3] = a;
    } else {
      output.data[di] = 255;
      output.data[di + 1] = 255;
      output.data[di + 2] = 255;
      output.data[di + 3] = 255;
    }
  }
}

fs.writeFileSync(out, PNG.sync.write(output));
console.log(`Cropped ${path.basename(src)} → ${cw}×${ch} (${(cw / ch).toFixed(2)}:1) → ${out}`);
