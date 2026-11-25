/** Turns an uploaded SVG/PNG/JPG into a data URL plus its natural size, shrinking large photos. */

const MAX_SIDE = 2000;
const MAX_BYTES = 1.5 * 1024 * 1024;

/** Pictures with more pixels than this are refused before decoding (a small file can claim a gigantic picture). */
const MAX_PIXELS = 100_000_000;

/**
 * Width and height from a PNG, JPEG, GIF, WebP or BMP header, without decoding the picture; null when unknown.
 */
export function imageDims(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { width: u32be(16), height: u32be(20) };
  if (b.length >= 10 && ascii(0, 3) === 'GIF') return { width: u16le(6), height: u16le(8) };
  if (b.length >= 26 && ascii(0, 2) === 'BM') {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: Math.abs(v.getInt32(18, true)), height: Math.abs(v.getInt32(22, true)) };
  }
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8L') { const n = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) }; }
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segments to the frame header (SOF0…SOF15, not DHT/JPG/DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

function readAs(file: File, kind: 'dataURL' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    if (kind === 'text') r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be read.'));
    img.src = src;
  });
}

/** SVGs without width/height report no natural size; fall back to their viewBox. */
function svgSize(text: string): { width: number; height: number } | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') return null;
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const w = parseFloat(svg.getAttribute('width') ?? '');
  const h = parseFloat(svg.getAttribute('height') ?? '');
  if (w > 0 && h > 0 && !String(svg.getAttribute('width')).endsWith('%')) return { width: w, height: h };
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  return null;
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    const text = await readAs(file, 'text');
    // SVGs shown through <img> can't run scripts anyway; refuse them so they never end up in shared files.
    if (/<script[\s>]|\son[a-z]+\s*=/i.test(text)) throw new Error('This SVG contains scripts and was not imported.');
    const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    const size = svgSize(text) ?? (await loadImage(dataUrl));
    return { dataUrl, width: Math.round(size.width), height: Math.round(size.height) };
  }

  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('Use an SVG, PNG, JPG or WebP image.');
  const dims = imageDims(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
  if (dims && dims.width * dims.height > MAX_PIXELS) {
    throw new Error(`This picture is ${dims.width} × ${dims.height} pixels, too large to import. Make it smaller (under 10,000 × 10,000) and try again.`);
  }
  const original = await readAs(file, 'dataURL');
  const img = await loadImage(original);
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (big <= MAX_SIDE && file.size <= MAX_BYTES) return { dataUrl: original, width: img.naturalWidth, height: img.naturalHeight };

  // Re-encode large photos so a library of them stays small.
  const k = Math.min(1, MAX_SIDE / big);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/webp', 0.9), width: canvas.width, height: canvas.height };
}
