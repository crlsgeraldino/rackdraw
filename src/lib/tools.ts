/** Home → Tools drawing mode (Visio's Line and Pencil tools); null = the pointer tool. */
import { create } from 'zustand';

export type DrawTool = 'line' | 'pencil' | 'connector' | 'rect' | 'ellipse' | 'lasso';

export const useTool = create<{ tool: DrawTool | null }>(() => ({ tool: null }));

export const setTool = (tool: DrawTool | null) => useTool.setState({ tool });

/** Format Painter mode: on = the next item clicked gets the copied format; sticky (double-click) = until Esc. */
export const usePainter = create<{ on: boolean; sticky: boolean }>(() => ({ on: false, sticky: false }));
export const setPainter = (on: boolean, sticky = false) => usePainter.setState({ on, sticky: on && sticky });

/** View → Full Screen (F5): the drawing alone, page by page. */
export const usePresenting = create<{ on: boolean }>(() => ({ on: false }));
export function setPresenting(on: boolean) {
  usePresenting.setState({ on });
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch {
    // Full screen refused (e.g. not from a click): the app still hides its panels.
  }
}
