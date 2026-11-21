/** Insert → Symbol: characters that are hard to type, and where they go. */
import { activePage } from './project';
import { useDiagram } from '@/store/useDiagramStore';

export const SYMBOLS: { group: string; chars: string[] }[] = [
  { group: 'Common', chars: ['°', '±', '×', '÷', '≈', '≠', '≤', '≥', '∞', 'µ', 'Ω', '½', '¼', '¾', '²', '³', '…', '•', '—', '–'] },
  { group: 'Arrows', chars: ['→', '←', '↑', '↓', '↔', '↕', '⇄', '⇒', '⇐', '⇔', '↻', '↺'] },
  { group: 'Marks', chars: ['✓', '✗', '★', '☆', '⚠', '⚡', '☎', '✉', '⌂', '©', '®', '™', '§', '¶', '€', '£', '¥', '¢'] },
  { group: 'Greek', chars: ['α', 'β', 'γ', 'δ', 'Δ', 'λ', 'π', 'σ', 'Σ', 'φ', 'ω'] },
];

/** Where the cursor was when a shape's text was last edited, so a symbol goes there rather than at the end. */
let caret: { id: string; pos: number } | null = null;
export const rememberCaret = (id: string, pos: number) => { caret = { id, pos }; };

/** Puts a symbol into the selected text box or shape. Returns false when nothing suitable is selected. */
export function insertSymbol(ch: string): boolean {
  const st = useDiagram.getState();
  const n = activePage(st.projects[st.currentId]).nodes.find((x) => x.selected && x.type === 'shape' && x.data.kind !== 'table' && x.data.kind !== 'image');
  if (!n || n.type !== 'shape') return false;
  const text = n.data.text ?? '';
  const pos = caret && caret.id === n.id ? Math.min(caret.pos, text.length) : text.length;
  st.snapshot();
  st.updateNodeData(n.id, { text: text.slice(0, pos) + ch + text.slice(pos) });
  caret = { id: n.id, pos: pos + ch.length };
  return true;
}
