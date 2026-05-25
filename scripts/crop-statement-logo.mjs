#!/usr/bin/env node
/**
 * Build statement-brand-trio.png from Shopify brand_trio_image.png.
 * Vertical stack like legacy statements: Marx Corporate, Stash Shop, Stash Inc.
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

/** Regions on 1000×1000 Shopify canvas (from pixel analysis). */
const REGIONS_1000 = [
  { id: 'marx', x0: 118, x1: 298, y0: 102, y1: 180 },
  { id: 'stashShop', x0: 118, x1: 400, y0: 200, y1: 272 },
  { id: 'stashInc', x0: 430, x1: 823, y0: 292, y1: 334 },
];

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

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

function extractRegion(input, bounds, pad = 4) {
  const { x0, x1, y0, y1 } = bounds;
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

  minX = Math.max(x0, minX - pad);
  minY = Math.max(y0, minY - pad);
  maxX = Math.min(x1, maxX + pad);
  maxY = Math.min(y1, maxY + pad);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const slice = new PNG({ width: cw, height: ch });

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((minY + y) * input.width + (minX + x)) * 4;
      const di = (y * cw + x) * 4;
      const r = input.data[si];
      const g = input.data[si + 1];
      const b = input.data[si + 2];
      const a = input.data[si + 3];
      if (isContent(r, g, b, a)) {
        slice.data[di] = r;
        slice.data[di + 1] = g;
        slice.data[di + 2] = b;
        slice.data[di + 3] = 255;
      } else {
        slice.data[di] = 255;
        slice.data[di + 1] = 255;
        slice.data[di + 2] = 255;
        slice.data[di + 3] = 255;
      }
    }
  }

  return slice;
}

function scaleToWidth(png, targetW) {
  const targetH = Math.max(1, Math.round((png.height * targetW) / png.width));
  const scaled = new PNG({ width: targetW, height: targetH });
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(png.width - 1, Math.floor((x * png.width) / targetW));
      const sy = Math.min(png.height - 1, Math.floor((y * png.height) / targetH));
      const si = (sy * png.width + sx) * 4;
      const di = (y * targetW + x) * 4;
      scaled.data[di] = png.data[si];
      scaled.data[di + 1] = png.data[si + 1];
      scaled.data[di + 2] = png.data[si + 2];
      scaled.data[di + 3] = png.data[si + 3];
    }
  }
  return scaled;
}

function stackVertical(layers, gap = 10, padX = 12, padY = 8) {
  const maxW = Math.max(...layers.map(l => l.width));
  const totalH =
    padY * 2 + layers.reduce((sum, l, i) => sum + l.height + (i ? gap : 0), 0);
  const output = new PNG({ width: maxW + padX * 2, height: totalH });

  for (let i = 0; i < output.data.length; i += 4) {
    output.data[i] = 255;
    output.data[i + 1] = 255;
    output.data[i + 2] = 255;
    output.data[i + 3] = 255;
  }

  let y = padY;
  for (const layer of layers) {
    const xOff = padX + Math.floor((maxW - layer.width) / 2);
    for (let ly = 0; ly < layer.height; ly++) {
      for (let lx = 0; lx < layer.width; lx++) {
        const si = (ly * layer.width + lx) * 4;
        const di = ((y + ly) * output.width + (xOff + lx)) * 4;
        output.data[di] = layer.data[si];
        output.data[di + 1] = layer.data[si + 1];
        output.data[di + 2] = layer.data[si + 2];
        output.data[di + 3] = layer.data[si + 3];
      }
    }
    y += layer.height + gap;
  }

  return output;
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

const slices = REGIONS_1000.map(region => {
  const bounds = scaleBounds(input.width, input.height, region);
  return extractRegion(input, bounds);
});

const targetW = 420;
const scaled = slices.map(s => scaleToWidth(s, targetW));
const stacked = stackVertical(scaled, 12, 16, 10);

fs.writeFileSync(out, PNG.sync.write(stacked));
console.log(
  `OK ${stacked.width}×${stacked.height} (vertical: Marx Corporate + Stash Shop + Stash Inc) → ${out} (${fs.statSync(out).size} bytes)`,
);
