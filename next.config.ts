import type { NextConfig } from 'next';

// Static export: the whole app is plain HTML/JS/CSS that runs in the browser.
// Host the `out/` folder anywhere (IIS, Nginx, GitHub Pages, a file share) — there is no server.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
