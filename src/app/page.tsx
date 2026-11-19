'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';

// The editor relies on browser-only APIs (localStorage, canvas measuring), so it never renders on the server.
const Editor = dynamic(() => import('@/components/Editor'), {
  ssr: false,
  loading: () => <div className="flex h-screen items-center justify-center text-sm text-gray-500">Loading NetCraft…</div>,
});

export default function Home() {
  useEffect(() => {
    // Offline support for the installed app. Skipped in dev so hot reload isn't served stale files.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return <Editor />;
}
