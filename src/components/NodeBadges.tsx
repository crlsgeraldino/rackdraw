'use client';

import { useState } from 'react';
import { openUrl, resolveLink } from '@/lib/links';
import { openComments } from './CommentsPanel';
import { allLinks, type ExtraLink, type NodeExtras } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Follows a hyperlink: switches page for page links, opens web links in the browser. */
export function useFollowLink() {
  return (link?: string) => {
    const t = resolveLink(link);
    if (!t) return;
    const s = useDiagram.getState();
    if (t.kind === 'url') openUrl(t.url);
    else if (s.projects[s.currentId].pages.some((p) => p.id === t.pageId)) s.setActivePage(t.pageId);
    else alert('The page this link points to no longer exists.');
  };
}

/** Describes a link for tooltips and the properties panel. */
export function useLinkLabel(link?: string) {
  const t = resolveLink(link);
  // Only the linked page's name is watched (a string), so items don't redraw on every change.
  const pageName = useDiagram((s) => (t?.kind === 'page' ? s.projects[s.currentId].pages.find((p) => p.id === t.pageId)?.name ?? '(deleted page)' : ''));
  if (!t) return '';
  if (t.kind === 'url') return t.url;
  return `Page: ${pageName}`;
}

/** An item's links when it has several: pick one to follow (like Visio's hyperlink list on right-click). */
function LinkMenu({ links, onPick, onClose }: { links: ExtraLink[]; onPick: (address: string) => void; onClose: () => void }) {
  const project = useCurrentProject();
  const name = (l: ExtraLink) => {
    if (l.label?.trim()) return l.label;
    const t = resolveLink(l.address);
    return t?.kind === 'page' ? `Page: ${project.pages.find((p) => p.id === t.pageId)?.name ?? '(deleted page)'}` : l.address;
  };
  return (
    <div className="nodrag nopan absolute right-0 top-6 z-20 min-w-[180px] max-w-[280px] rounded border border-gray-200 bg-white py-1 text-left text-xs shadow-lg" onMouseLeave={onClose}>
      {links.map((l, i) => (
        <button key={i} type="button" className="block w-full truncate px-3 py-1 text-left text-blue-700 hover:bg-blue-50" title={l.address}
          onClick={(e) => { e.stopPropagation(); onPick(l.address); }}>{name(l)}</button>
      ))}
    </div>
  );
}

/** Small link button and lock marker in an item's top-right corner. */
export function NodeBadges({ data, selected }: { data: NodeExtras; selected?: boolean }) {
  const follow = useFollowLink();
  const links = allLinks(data);
  const label = useLinkLabel(links[0]?.address);
  const [menu, setMenu] = useState(false);
  const open = (data.comments ?? []).filter((c) => !c.resolved).length;
  if (!label && !(data.locked && selected) && !open) return null;
  return (
    <div className="absolute -right-2 -top-2 z-10 flex gap-0.5">
      {label && (
        <button
          type="button"
          className="nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 bg-white text-[11px] text-blue-700 shadow hover:bg-blue-50"
          onClick={(e) => { e.stopPropagation(); if (links.length > 1) setMenu(!menu); else follow(links[0]?.address); }}
          title={links.length > 1 ? `${links.length} links` : `Open link: ${label}`}
          aria-label={`Open link: ${label}`}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" strokeLinecap="round" /></svg>
        </button>
      )}
      {label && menu && (
        <LinkMenu links={links} onPick={(a) => { setMenu(false); follow(a); }} onClose={() => setMenu(false)} />
      )}
      {open > 0 && (
        <button
          type="button"
          className="nodrag nopan flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-400 bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 shadow hover:bg-amber-200"
          onClick={(e) => { e.stopPropagation(); openComments(); }}
          title={`${open} open comment${open === 1 ? '' : 's'}: ${data.comments!.filter((c) => !c.resolved).map((c) => c.text).join(' / ')}`}
          aria-label={`${open} comments`}
        >
          💬{open > 1 ? open : ''}
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
