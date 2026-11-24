'use client';

import { renderRack, type PageRenderer } from './export';
import { pageAlt, rackAlt } from './altText';
import { writePptx, type PptSlide } from './pptx';
import type { Project } from './types';

/**
 * Export to PowerPoint (like Visio's slide snippets): a title slide, then one slide per page and per rack, for client
 * reviews. Background pages show behind their pages and aren't slides of their own.
 */

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function exportDeck(p: Project, renderPage: PageRenderer): Promise<Uint8Array> {
  const date = new Date().toLocaleDateString();
  const slides: PptSlide[] = [{ title: p.name, subtitle: [p.site, p.address, p.titleBlock?.preparedBy, date].filter(Boolean).join(' · ') }];
  const media: Record<string, Uint8Array> = {};
  const add = (title: string, url: string, w: number, h: number, alt?: string) => {
    const name = `image${Object.keys(media).length + 1}.png`;
    media[name] = dataUrlBytes(url);
    slides.push({ title, media: name, w, h, alt });
  };
  for (const pg of p.pages) {
    const img = await renderPage(pg);
    if (img) add(p.pages.filter((x) => !x.background).length > 1 ? `${pg.kind === 'floorplan' ? 'Floor plan' : 'Network'}: ${pg.name}` : 'Network diagram', img.url, img.width, img.height, pageAlt(p, pg));
  }
  for (const rack of p.racks ?? []) {
    const img = await renderRack(p, rack);
    add(`Rack: ${[rack.name, rack.location].filter(Boolean).join(' – ')}`, img.url, img.width, img.height, rackAlt(p, rack));
  }
  return writePptx(slides, media, { title: p.name, footer: [p.name, p.site, date].filter(Boolean).join(' · ') });
}
