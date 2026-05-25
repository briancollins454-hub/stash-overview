#!/usr/bin/env node
/**
 * Build statement-brand-trio.png from the Marx Corporate logo asset (white bg).
 * Place source at assets/brand_trio_image__2_*.png or pass a path argument.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'public/statement-brand-trio.png');

const src =
  process.argv[2] ||
  [
    path.join(
      process.env.HOME,
      '.cursor/projects/Users-briansinclair-stash-overview/assets/brand_trio_image__2_-d5186e6a-3ba5-4b6f-a844-02dc35e7a0dc.png',
    ),
    path.join(root, 'public/statement-brand-trio-source.png'),
  ].find(p => fs.existsSync(p));

if (!src) {
  console.error('No source PNG found');
  process.exit(1);
}

function isInk(r, g, b, a) {
  return a >= 20 && !(r <= 12 && g <= 12 && b <= 12);
}

const input = PNG.sync.read(fs.readFileSync(src));
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

const pad = 4;
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
console.log(`OK ${cw}×${ch} from ${path.basename(src)} → ${out}`);
