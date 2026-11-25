import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RackDraw',
  description: 'Free, browser-based network diagrams for client documentation. Your files never leave your computer.',
};

/*
 * The web version's content policy (the desktop app sends a stricter one itself): the page loads and talks only to
 * where it is hosted, so nothing in an opened file can send diagrams anywhere or pull code in. Not in development,
 * where Next.js needs eval for hot reloading.
 */
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {process.env.NODE_ENV === 'production' && (
        <head>
          <meta httpEquiv="Content-Security-Policy" content={WEB_CSP} />
        </head>
      )}
      <body className="antialiased">{children}</body>
    </html>
  );
}
