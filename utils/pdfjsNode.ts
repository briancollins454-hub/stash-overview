/**
 * pdfjs-dist expects browser globals (DOMMatrix, etc.) at module load time.
 * Import @napi-rs/canvas first on Node/Vercel so text extraction works server-side.
 */
let pdfjsModule: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;

async function ensurePdfJsNodeGlobals(): Promise<void> {
  if (typeof globalThis.DOMMatrix !== 'undefined') return;
  try {
    await import('@napi-rs/canvas');
  } catch {
    // Last resort for environments where native canvas is unavailable.
    (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      is2D = true;
      isIdentity = true;
      transformPoint(p: { x: number; y: number }) { return p; }
    };
    (globalThis as Record<string, unknown>).Path2D = class Path2D {};
    (globalThis as Record<string, unknown>).ImageData = class ImageData {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
    };
  }
}

export async function loadPdfJs() {
  if (!pdfjsModule) {
    await ensurePdfJsNodeGlobals();
    pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModule;
}
