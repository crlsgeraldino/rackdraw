/** Pictures on the page (Insert → Picture, Ctrl+V of a screenshot, or a picture file dropped on the canvas). */
import { useDiagram } from '@/store/useDiagramStore';
import { loadImageFile } from './imageImport';

/** The diagram point in the middle of the visible canvas. */
export function viewCenter(): { x: number; y: number } {
  const pane = document.querySelector<HTMLElement>('.react-flow');
  const vp = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!pane || !vp) return { x: 300, y: 200 };
  const r = pane.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
  const z = m.a || 1;
  return { x: (r.width / 2 - m.e) / z, y: (r.height / 2 - m.f) / z };
}

/** Reads a picture file (large photos are shrunk) and puts it on the active page. */
export async function insertPictureFile(file: File, at?: { x: number; y: number }) {
  try {
    const img = await loadImageFile(file);
    useDiagram.getState().addPicture(at ?? viewCenter(), img.dataUrl, img.width, img.height);
  } catch (err) {
    alert((err as Error).message);
  }
}
