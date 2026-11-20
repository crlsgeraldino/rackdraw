'use client';

import { openUrl, resolveLink } from '@/lib/links';
import type { NodeExtras } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Follows a hyperlink: switches page for page links, opens web links in the browser. */
export function useFollowLink() {
  const project = useCurrentProject();
  return (link?: string) => {
    const t = resolveLink(link);
    if (!t) return;
    if (t.kind === 'url') openUrl(t.url);
    else if (project.pages.some((p) => p.id === t.pageId)) useDiagram.getState().setActivePage(t.pageId);
    else alert('The page this link points to no longer exists.');
  };
}

/** Describes a link for tooltips and the properties panel. */
export function useLinkLabel(link?: string) {
  const project = useCurrentProject();
  const t = resolveLink(link);
  if (!t) return '';
  if (t.kind === 'url') return t.url;
  return `Page: ${project.pages.find((p) => p.id === t.pageId)?.name ?? '(deleted page)'}`;
}

/** Small link button and lock marker in an item's top-right corner. */
export function NodeBadges({ data, selected }: { data: NodeExtras; selected?: boolean }) {
  const follow = useFollowLink();
  const label = useLinkLabel(data.link);
  if (!label && !(data.locked && selected)) return null;
  return (
    <div className="absolute -right-2 -top-2 z-10 flex gap-0.5">
      {label && (
        <button
          type="button"
          className="nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 bg-white text-[11px] text-blue-700 shadow hover:bg-blue-50"
          onClick={(e) => { e.stopPropagation(); follow(data.link); }}
          title={`Open link: ${label}`}
          aria-label={`Open link: ${label}`}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" strokeLinecap="round" /></svg>
        </button>
      )}
      {data.locked && selected && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 shadow" title="Locked: unlock it in the Arrange menu to move or delete it">
          <svg width="10" height="11" viewBox="0 0 12 14" fill="currentColor" aria-hidden><path d="M3 6V4a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 11 7.5v5A1.5 1.5 0 0 1 9.5 14h-7A1.5 1.5 0 0 1 1 12.5v-5A1.5 1.5 0 0 1 2.5 6H3zm1.5 0h3V4a1.5 1.5 0 0 0-3 0v2z" /></svg>
        </span>
      )}
    </div>
  );
}
