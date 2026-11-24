'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';

// The editor relies on browser-only APIs (localStorage, canvas measuring), so it never renders on the server.
const Editor = dynamic(() => import('@/components/Editor'), {
  ssr: false,
  loading: () => <div className="flex h-screen items-center justify-center text-sm text-gray-500">Loading RackDraw…</div>,
});

export default function Home() {
  useEffect(() => {
    // Offline support for the web version. Skipped in dev (stale hot reload) and in the desktop app (app:// pages
    // already come from disk, and a cached copy could outlive an upgrade).
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator && location.protocol !== 'app:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return <Editor />;
}
