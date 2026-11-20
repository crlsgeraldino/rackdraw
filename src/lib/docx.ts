/**
 * Minimal Word (.docx) writer: headings, paragraphs, PNG pictures, tables with a repeating header row, and page
 * breaks, on a landscape or portrait Letter page. Enough for a documentation report that opens in Word and
 * Google Docs and can be edited there.
 */
import { strToU8, zipSync } from 'fflate';

export type DocBlock =
  | { kind: 'title' | 'h1' | 'h2'; text: string }
  | { kind: 'para'; text: string; bold?: boolean; color?: string; sizePt?: number }
  | { kind: 'image'; media: string; wIn: number; hIn: number }
  | { kind: 'table'; header: string[]; rows: string[][]; widths?: number[] }
  | { kind: 'pageBreak' }
  /** Starts a new section (on a new page) with this orientation. */
  | { kind: 'section'; landscape: boolean };

export interface DocxInput {
  blocks: DocBlock[];
  media: Record<string, Uint8Array>;
  title?: string;
  landscape?: boolean;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const EMU = 914400;

/** Runs for text with line breaks. */
function runs(text: string, rPr = '') {
  return text.split('\n').map((line, i) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}

export function writeDocx(input: DocxInput): Uint8Array {
  let landscape = input.landscape ?? true;
  // Letter: 12240 × 15840 twips; 0.6" margins.
  const margin = 864;
  const sectPr = () => {
    const [pw, ph] = landscape ? [15840, 12240] : [12240, 15840];
    return `<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${landscape ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="432" w:footer="432" w:gutter="0"/></w:sectPr>`;
  };
  const usable = () => (landscape ? 15840 : 12240) - margin * 2;
  const rels: { id: string; target: string; type: string }[] = [
    { id: 'rId1', type: `${R}/styles`, target: 'styles.xml' },
  ];
  const mediaRel = new Map<string, string>();
  let pic = 0;
  const body = input.blocks.map((b) => {
    switch (b.kind) {
      case 'title': return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runs(b.text)}</w:p>`;
      case 'h1': return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runs(b.text)}</w:p>`;
      case 'h2': return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${runs(b.text)}</w:p>`;
      case 'pageBreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case 'section': {
        // A section's properties sit in the paragraph that ends it.
        const end = `<w:p><w:pPr>${sectPr()}</w:pPr></w:p>`;
        landscape = b.landscape;
        return end;
      }
      case 'para': {
        const rPr = `${b.bold ? '<w:b/>' : ''}${b.color ? `<w:color w:val="${b.color.replace('#', '')}"/>` : ''}${b.sizePt ? `<w:sz w:val="${Math.round(b.sizePt * 2)}"/>` : ''}`;
        return `<w:p>${runs(b.text, rPr)}</w:p>`;
      }
      case 'image': {
        if (!mediaRel.has(b.media)) {
          const id = `rId${rels.length + 1}`;
          rels.push({ id, type: `${R}/image`, target: `media/${b.media}` });
          mediaRel.set(b.media, id);
        }
        pic++;
        const cx = Math.round(b.wIn * EMU), cy = Math.round(b.hIn * EMU);
        return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
          `<wp:docPr id="${pic}" name="Picture ${pic}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
          '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
          `<pic:nvPicPr><pic:cNvPr id="${pic}" name="${esc(b.media)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill><a:blip r:embed="${mediaRel.get(b.media)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
          `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
          '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
      }
      case 'table': {
        const n = b.header.length;
        const fr = b.widths && b.widths.length === n ? b.widths : Array(n).fill(1 / n);
        const total = fr.reduce((s, x) => s + x, 0);
        const cols = fr.map((f) => Math.round((f / total) * usable()));
        const cell = (text: string, w: number, header: boolean) =>
          `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E5E7EB"/>' : ''}</w:tcPr>` +
          `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${runs(text, `${header ? '<w:b/>' : ''}<w:sz w:val="17"/>`)}</w:p></w:tc>`;
        return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${usable()}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
          `<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.header.map((h, i) => cell(h, cols[i], true)).join('')}</w:tr>` +
          b.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${b.header.map((_, i) => cell(r[i] ?? '', cols[i], false)).join('')}</w:tr>`).join('') +
          '</w:tbl><w:p/>';
      }
    }
  });

  const doc = `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body.join('')}${sectPr()}</w:body></w:document>`;

  const style = (id: string, name: string, size: number, extra = '', basedOn = 'Normal') =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr>${extra}<w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${XML}<w:styles xmlns:w="${W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    style('Title', 'Title', 44, '<w:color w:val="1F2937"/>') +
    style('Heading1', 'heading 1', 30, '<w:b/><w:color w:val="1E3A8A"/>') +
    style('Heading2', 'heading 2', 24, '<w:b/><w:color w:val="374151"/>') +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('') +
    '</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    '_rels/.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(styles),
    'word/_rels/document.xml.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"/>`).join('') + '</Relationships>'),
    'docProps/core.xml': strToU8(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:title>${esc(input.title ?? '')}</dc:title><dc:creator>NetCraft</dc:creator></cp:coreProperties>`),
  };
  for (const [name, bytes] of Object.entries(input.media)) files[`word/media/${name}`] = bytes;
  return zipSync(files, { level: 6 });
}
