/**
 * fitView, but only when the canvas has a size. With no size (a window with no area yet, a hidden pane) nothing is
 * measured, the fitted zoom comes out as NaN, and every cable re-routes forever; skipping the fit avoids that, and the
 * next fit once the window has a size works as usual.
 */
export function safeFitView<O>(rf: { fitView: (o?: O) => Promise<boolean> }, opts?: O): Promise<boolean> {
  const r = typeof document === 'undefined' ? undefined : document.querySelector('.react-flow')?.getBoundingClientRect();
  if (!r || r.width < 1 || r.height < 1) return Promise.resolve(false);
  return rf.fitView(opts);
}
