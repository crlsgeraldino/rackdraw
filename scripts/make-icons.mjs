// Renders public/icon.svg into the PNG icons the PWA manifest and favicon need.
// Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = (p) => fileURLToPath(new URL(p, import.meta.url));

const svg = await readFile(out('../public/icon.svg'));
for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(out(`../public/icon-${size}.png`));
}
// Maskable variant: same artwork inside the 80% safe zone on a full-bleed background.
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2563eb' } })
  .composite([{ input: await sharp(svg).resize(410, 410).png().toBuffer(), gravity: 'center' }])
  .png()
  .toFile(out('../public/icon-maskable-512.png'));
await sharp(svg).resize(180, 180).png().toFile(out('../src/app/apple-icon.png'));
await sharp(svg).resize(32, 32).png().toFile(out('../src/app/icon.png'));
// Desktop app / installer icon (electron-builder converts it to .ico).
await mkdir(out('../build'), { recursive: true });
await sharp(svg).resize(512, 512).png().toFile(out('../build/icon.png'));
console.log('icons written');
