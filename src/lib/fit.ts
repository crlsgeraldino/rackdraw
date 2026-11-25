/**
 * fitView, but only when the canvas has a size. With no size (a window with no area yet, a hidden pane) nothing is
 * measured, the fitted zoom comes out as NaN, and every cable re-routes forever; skipping the fit avoids that, and the
 * next fit once the window has a size works as usual.
 */
export function safeFitView<O>(rf: { fitView: (o?: O) => Promise<boolean> }, opts?: O): Promise<boolean> {
  const r = typeof document === 'undefined' ? undefined : document.querySelector('.react-flow')?.getBoundingClientRect();
  if (!r || r.width < 1 || r.height < 1) return Promise.resolve(false);
  const o = opts as { padding?: unknown } | undefined;
  return rf.fitView((o && typeof o.padding === 'number' ? { ...o, padding: fitPadding(o.padding) } : opts) as O);
}

/**
 * React Flow 12 read a numeric padding as a fraction of the drawing (0.2 = 20% larger); React Flow 13 reads it as
 * pixels, so 0.2 became no margin at all. The same look as a margin on each side, as a share of the window.
 */
export function fitPadding(fraction: number): string {
  const f = Number.isFinite(fraction) && fraction > 0 ? fraction : 0;
  return `${Math.round((1000 * f) / (2 * (1 + f))) / 10}%`;
}
