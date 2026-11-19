import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'NetCraft — Network Diagrams',
    short_name: 'NetCraft',
    description: 'Free network diagrams for client documentation. Works offline; your files never leave your computer.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    file_handlers: [
      // Lets the installed app open .netcraft.json files (Chromium/Edge).
      { action: '/', accept: { 'application/json': ['.json'] } },
    ],
  } as MetadataRoute.Manifest;
}
