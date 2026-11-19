/** Turns an uploaded SVG/PNG/JPG into a data URL plus its natural size, shrinking large photos. */

const MAX_SIDE = 2000;
const MAX_BYTES = 1.5 * 1024 * 1024;

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
