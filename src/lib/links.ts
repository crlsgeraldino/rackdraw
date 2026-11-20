/** Hyperlinks on diagram items: a web/mailto address, or another page of the same project. */

export const PAGE_LINK = 'page:';

export type LinkTarget = { kind: 'page'; pageId: string } | { kind: 'url'; url: string };

/**
 * Resolves what a link points to. Bare host names and IPs ("192.168.1.1", "fw01.local:8443/admin") become https URLs,
 * since they're usually a device's web interface. Anything else (javascript:, file:…) is refused.
 */
export function resolveLink(link?: string): LinkTarget | null {
  const v = link?.trim();
  if (!v) return null;
  if (v.startsWith(PAGE_LINK)) return v.length > PAGE_LINK.length ? { kind: 'page', pageId: v.slice(PAGE_LINK.length) } : null;
  if (/^(https?:\/\/|mailto:)/i.test(v)) return { kind: 'url', url: v };
  if (/^[\w-]+(\.[\w-]+)*(:\d{1,5})?([/?#]\S*)?$/.test(v)) return { kind: 'url', url: `https://${v}` };
  return null;
}

/** Opens a web link in a new browser tab (the desktop app opens it in the default browser). */
export function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
