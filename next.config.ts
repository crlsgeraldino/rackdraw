import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';

// The app's version (package.json), for Help → About and the What's new window.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Static export: the whole app is plain HTML/JS/CSS that runs in the browser.
// Host the `out/` folder anywhere (IIS, Nginx, GitHub Pages, a file share) — there is no server.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
