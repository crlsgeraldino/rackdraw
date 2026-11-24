/** Insert → PDF Floor Plan: a PDF page behind the active page at its printed size, with its printed scale. */
import { useDiagram } from '@/store/useDiagramStore';
import { openPdf, parsePrintedScale } from './pdfImport';
import { formatLength } from './units';

export async function insertPdfBackdrop(file: File): Promise<void> {
  const pdf = await openPdf(file);
  let pageNo = 1;
  if (pdf.pages > 1) {
    const answer = prompt(`"${file.name}" has ${pdf.pages} pages. Which page is the floor plan?`, '1');
    if (answer === null) return;
    pageNo = Math.min(pdf.pages, Math.max(1, Math.round(Number(answer)) || 1));
  }
  const r = await pdf.render(pageNo);
  const st = useDiagram.getState();
  st.setBackdrop(r.dataUrl, r.width, r.height, { width: r.paperWidth, height: r.paperHeight });

  // The drawing is shown at its printed size, so the scale printed on it applies as it is.
  const inches = `${(r.paperWidth / 96).toFixed(1)} × ${(r.paperHeight / 96).toFixed(1)} in`;
  for (;;) {
    const answer = prompt(
      `Inserted page ${pageNo} of "${file.name}" at its printed size (${inches}).\n\n` +
      'What scale is it drawn at? Type it as printed on the plan, e.g. 1/8" = 1\', 1/4" = 1\', 1" = 10\' or 1:100.\n' +
      'Leave it empty to set the scale later (Design → Set Scale on a known length).',
      '',
    );
    if (answer === null || !answer.trim()) return;
    const scale = parsePrintedScale(answer);
    if (!scale) { alert(`"${answer}" isn't a scale RackDraw can read. Try 1/8" = 1' or 1:100.`); continue; }
    useDiagram.getState().setPageScale(scale);
    alert(`Page scale set: the whole sheet is ${formatLength((r.paperWidth * scale.perPx), scale.unit)} wide in real life.`);
    return;
  }
}
