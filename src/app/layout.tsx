import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NetCraft',
  description: 'Free, browser-based network diagrams for client documentation. Your files never leave your computer.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
