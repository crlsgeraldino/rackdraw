/**
 * PDF floor plans (architects' and building owners' drawings): one page of a PDF, drawn sharply, behind a RackDraw
 * page at its printed size, so the scale printed on the drawing (1/8" = 1', 1:100…) can be used as the page scale.
 * pdf.js is loaded only when a PDF is inserted.
 */
import type { PageScale } from './types';

/** Longest side of the rendered picture (px): sharp when zoomed in, still a manageable size. */
const MAX_SIDE = 4800;
/** Largest canvas area browsers reliably allow. */
const MAX_AREA = 16_000_000;

export interface RenderedPdf {
  dataUrl: string;
  /** Rendered picture size (px). */
  width: number;
  height: number;
  /** The page's printed size, in diagram px (96 per inch). */
  paperWidth: number;
  paperHeight: number;
  pages: number;
}

/** Number of pages, and a function that renders one of them (1-based). */
export async function openPdf(file: File): Promise<{ pages: number; render: (page: number) => Promise<RenderedPdf> }> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    // The worker is fetched and started from a blob labelled as JavaScript: servers (and file:// setups) that send
    // .mjs files as text/plain would otherwise stop the module worker from loading.
    const src = await (await fetch(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url))).text();
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise.catch((e: unknown) => {
    throw new Error(/password/i.test(String(e)) ? 'This PDF is password-protected. Remove the password and try again.' : `This PDF could not be read (${(e as Error)?.message ?? e}).`);
  });
  const render = async (n: number): Promise<RenderedPdf> => {
    const page = await doc.getPage(Math.min(Math.max(1, n), doc.numPages));
    const base = page.getViewport({ scale: 1 }); // points: 72 per inch
    // A damaged page size (zero, or absurdly large) would make the picture size infinite.
    if (!(base.width >= 1 && base.height >= 1 && base.width < 1e6 && base.height < 1e6)) throw new Error(`Page ${n} of this PDF has no usable page size; it may be damaged.`);
    const k = Math.min(MAX_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_AREA / (base.width * base.height)));
    const vp = page.getViewport({ scale: k });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    return {
      dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
      paperWidth: (base.width / 72) * 96, paperHeight: (base.height / 72) * 96, pages: doc.numPages,
    };
  };
  return { pages: doc.numPages, render };
}

/**
 * A drawing scale as printed on plans: architectural (1/8" = 1'-0", 1" = 10'), or a ratio (1:100, 1/100). Null when
 * it can't be read. The result assumes the drawing is shown at its printed size (96 px per paper inch).
 */
export function parsePrintedScale(text: string): PageScale | null {
  const t = text.trim().toLowerCase().replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").replace(/\s+/g, ' ');
  if (!t) return null;
  // 1:100 or 1/100 (metric ratio, no units)
  const ratio = t.match(/^1\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (ratio) return { perPx: (0.0254 / 96) * Number(ratio[1]), unit: 'm' };
  // <paper inches> = <real feet>: 1/8" = 1'-0", 3/16" = 1', 1" = 10', 0.25 in = 1 ft
  const m = t.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*(?:"|in\.?|inch(?:es)?)?\s*=\s*(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)?\s*(?:-?\s*0\s*"?)?$/);
  if (m) {
    const paperIn = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
    const realFt = Number(m[3]);
    if (paperIn > 0 && realFt > 0) return { perPx: realFt / (paperIn * 96), unit: 'ft' };
  }
  return null;
}
