import type { HeaderFooter, Project } from './types';

/** Codes you can type in a header or footer, replaced on each sheet. */
export const HF_CODES: { code: string; label: string }[] = [
  { code: '&[Page]', label: 'Page number' },
  { code: '&[Pages]', label: 'Number of pages' },
  { code: '&[Date]', label: 'Date' },
  { code: '&[Client]', label: 'Client name' },
  { code: '&[Site]', label: 'Site' },
  { code: '&[Sheet]', label: 'Sheet title' },
  { code: '&[Author]', label: 'Drawn by' },
];

export const hasHeaderFooter = (hf?: HeaderFooter) => !!hf && [...hf.header, ...hf.footer].some((t) => t.trim());

/** One header/footer text with its codes filled in. */
export function expandHF(text: string, p: Project, ctx: { page: number; pages: number; sheet: string }) {
  return text
    .replace(/&\[Page\]/gi, String(ctx.page))
    .replace(/&\[Pages\]/gi, String(ctx.pages))
    .replace(/&\[Date\]/gi, new Date().toLocaleDateString())
    .replace(/&\[Client\]/gi, p.name)
    .replace(/&\[Site\]/gi, p.site ?? '')
    .replace(/&\[Sheet\]/gi, ctx.sheet)
    .replace(/&\[Author\]/gi, p.titleBlock?.author ?? '');
}

/** Text with field codes filled in for a page of the client (Insert → Field on a text box or shape). */
export function expandFields(text: string, p: Project, pageId: string) {
  if (!text.includes('&[')) return text;
  const pages = p.pages.filter((x) => !x.background);
  const i = pages.findIndex((x) => x.id === pageId);
  return expandHF(text, p, { page: i + 1, pages: pages.length, sheet: pages[i]?.name ?? p.pages.find((x) => x.id === pageId)?.name ?? '' });
}

/**
 * The same text as CSS `content` for printed page margins: page numbers become counters; the sheet title isn't
 * known there, so it is left out.
 */
export function hfCss(text: string, p: Project) {
  const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const fixed = expandHF(text.replace(/&\[Page\]/gi, '\u0001').replace(/&\[Pages\]/gi, '\u0002'), p, { page: 0, pages: 0, sheet: '' });
  return fixed.split(/(\u0001|\u0002)/).filter((x) => x !== '').map((x) => (x === '\u0001' ? 'counter(page)' : x === '\u0002' ? 'counter(pages)' : q(x))).join(' ') || '""';
}
