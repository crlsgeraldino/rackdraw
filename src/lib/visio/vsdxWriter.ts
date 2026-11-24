/**
 * Writes a Visio drawing (.vsdx): an Open Packaging (zip) file with one Visio page per page given.
 *
 * Shapes are given in inches with y pointing down from the top-left of the page (like the screen); the writer
 * converts to Visio's page space (y up). Pictures are PNG "foreign" shapes; boxes, ellipses, polygons and lines
 * are native geometry with Visio line/fill/text formatting, so they stay editable in Visio. Device details become
 * Shape Data.
 */
import { strToU8, zipSync } from 'fflate';

export interface VPt { x: number; y: number }
export interface VBox { x: number; y: number; w: number; h: number }

export interface VStyle {
  /** Fill colour (#rrggbb); null/undefined = no fill. */
  fill?: string | null;
  /** 0 (opaque) … 1 (invisible). */
  fillTransparency?: number;
  /** Line colour; null = no line. */
  line?: string | null;
  lineWeightPt?: number;
  dashed?: boolean;
  /** Dash / dot / dash-dot (wins over `dashed`). */
  pattern?: 'solid' | 'dash' | 'dot' | 'dashdot';
  /** Corner radius in inches. */
  rounding?: number;
  /** Drop shadow. */
  shadow?: boolean;
}

export interface VText {
  text: string;
  color?: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  font?: string;
  /** Vertical text: 'down' reads top-to-bottom, 'up' bottom-to-top. */
  dir?: 'across' | 'down' | 'up';
  /** Line spacing, 1 = single. */
  lineSpacing?: number;
  /** Text-block margin in inches (all four sides). */
  margin?: number;
}

export type VShape = {
  name?: string;
  data?: [string, string][];
  /** Hyperlinks: a web address, or a page of this drawing (subAddress = page name). */
  links?: { label?: string; address?: string; subAddress?: string }[];
  text?: VText;
  /** Indexes into the page's layers. */
  layers?: number[];
  /** A Visio container (RackDraw zone). */
  container?: boolean;
  /** Rotation about the centre in radians, counter-clockwise (Visio's Angle); boxes only. */
  angle?: number;
} & (
  /** `ports`: connection points (cables glue here in Visio), inches from the picture's top-left. */
  | { kind: 'image'; box: VBox; media: string; ports?: { x: number; y: number; name: string }[] }
  | ({ kind: 'rect' | 'ellipse'; box: VBox } & VStyle)
  /** Polygon with points as fractions (0–1) of the box, y down. */
  | ({ kind: 'polygon'; box: VBox; points: VPt[] } & VStyle)
  /** Open polyline in page inches (y down). */
  | ({ kind: 'line'; points: VPt[]; arrowStart?: boolean; arrowEnd?: boolean } & VStyle)
);

export interface VPage {
  name: string;
  /** Page size in inches. */
  width: number;
  height: number;
  shapes: VShape[];
  /** Visio layers on this page, in index order. */
  layers?: VLayer[];
  /** A background page. */
  background?: boolean;
  /** Index (in VDocument.pages) of the background page shown behind this one. */
  backPage?: number;
  /**
   * A scaled drawing (floor plan): how many real inches one paper inch stands for (48 at 1/4" = 1'), and the unit
   * Visio shows. Shapes are still given in paper inches; the writer stores them in real-world units, as Visio does.
   */
  drawingScale?: { realPerPaper: number; unit: 'ft' | 'm' };
}

export interface VLayer {
  name: string;
  visible: boolean;
  print: boolean;
  lock: boolean;
  active?: boolean;
}

export interface VDocument {
  pages: VPage[];
  /** PNG pictures by file name (e.g. "image1.png"). */
  media: Record<string, Uint8Array>;
  title?: string;
}

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Characters XML 1.0 can't hold.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
const cell = (name: string, v: string | number, extra = '') => `<Cell N="${name}" V="${typeof v === 'number' ? n(v) : esc(v)}"${extra}/>`;
const hex = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : c && /^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase() : null);

/** Shape Data row names must be identifiers; labels keep the human text. */
const rowName = (label: string, used: Set<string>) => {
  let base = label.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'Field';
  const first = base;
  for (let i = 2; used.has(base); i++) base = `${first}_${i}`;
  used.add(base);
  return base;
};

function styleCells(s: VStyle) {
  const out: string[] = [];
  const line = s.line === undefined ? '#000000' : hex(s.line);
  // Visio line patterns: 1 solid, 2 dash, 3 dot, 4 dash-dot.
  const pat = s.pattern ?? (s.dashed ? 'dash' : 'solid');
  out.push(cell('LinePattern', line ? { solid: 1, dash: 2, dot: 3, dashdot: 4 }[pat] : 0));
  if (line) out.push(cell('LineColor', line), cell('LineWeight', (s.lineWeightPt ?? 0.75) / 72, ' U="PT"'));
  const fill = hex(s.fill ?? null);
  out.push(cell('FillPattern', fill ? 1 : 0));
  if (fill) out.push(cell('FillForegnd', fill), cell('FillForegndTrans', s.fillTransparency ?? 0));
  if (s.rounding) out.push(cell('Rounding', s.rounding));
  if (s.shadow) out.push(cell('ShdwPattern', 1), cell('ShdwForegnd', '#000000'), cell('ShdwForegndTrans', 0.65), cell('ShapeShdwOffsetX', 0.03), cell('ShapeShdwOffsetY', -0.04), cell('ShapeShdwType', 1));
  return out.join('');
}

function textXml(t: VText | undefined, box?: { w: number; h: number }) {
  if (!t?.text) return '';
  const color = hex(t.color) ?? '#000000';
  // Vertical text: the text block is turned a quarter about the shape's centre, so its width is the shape's height.
  const turn = box && (t.dir === 'down' || t.dir === 'up')
    ? cell('TxtPinX', box.w / 2) + cell('TxtPinY', box.h / 2) + cell('TxtWidth', box.h) + cell('TxtHeight', box.w) + cell('TxtLocPinX', box.h / 2) + cell('TxtLocPinY', box.w / 2) + cell('TxtAngle', t.dir === 'down' ? -Math.PI / 2 : Math.PI / 2)
    : '';
  return (
    turn +
    cell('VerticalAlign', t.valign === 'top' ? 0 : t.valign === 'bottom' ? 2 : 1) +
    (t.margin !== undefined
      ? cell('LeftMargin', t.margin) + cell('RightMargin', t.margin) + cell('TopMargin', t.margin) + cell('BottomMargin', t.margin)
      : cell('LeftMargin', 0.04) + cell('RightMargin', 0.04) + cell('TopMargin', 0.03) + cell('BottomMargin', 0.03)) +
    `<Section N="Character"><Row IX="0">${t.font ? cell('Font', t.font) : ''}${cell('Color', color)}${cell('Size', (t.sizePt ?? 8) / 72, ' U="PT"')}${cell('Style', (t.bold ? 1 : 0) + (t.italic ? 2 : 0) + (t.underline ? 4 : 0))}${t.strike ? cell('Strikethru', 1) : ''}</Row></Section>` +
    `<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', t.align === 'left' ? 0 : t.align === 'right' ? 2 : 1)}${t.lineSpacing ? cell('SpLine', -t.lineSpacing) : ''}</Row></Section>`
  );
}

/** Visio Hyperlink section: one row per link; the first is the default (followed on Ctrl+click). */
function linksXml(links?: VShape['links']) {
  if (!links?.length) return '';
  return `<Section N="Hyperlink">${links
    .map((l, i) => `<Row N="Row_${i + 1}">${cell('Description', l.label ?? '')}${cell('Address', l.address ?? '')}${cell('SubAddress', l.subAddress ?? '')}${cell('NewWindow', 0)}${cell('Default', i === 0 ? 1 : 0)}</Row>`)
    .join('')}</Section>`;
}

function dataXml(data?: [string, string][]) {
  const rows = (data ?? []).filter(([, v]) => v !== undefined && v !== null);
  if (!rows.length) return '';
  const used = new Set<string>();
  return `<Section N="Property">${rows
    .map(([label, value]) => `<Row N="${rowName(label, used)}">${cell('Value', String(value), ' U="STR"')}${cell('Label', label)}${cell('Type', 0)}</Row>`)
    .join('')}</Section>`;
}

/** Geometry rows (local inches, y up) for a closed polygon. */
function closedGeometry(pts: VPt[], noFill: boolean) {
  const rows = pts.map((p, i) => `<Row T="${i ? 'LineTo' : 'MoveTo'}" IX="${i + 1}">${cell('X', p.x)}${cell('Y', p.y)}</Row>`);
  rows.push(`<Row T="LineTo" IX="${pts.length + 1}">${cell('X', pts[0].x)}${cell('Y', pts[0].y)}</Row>`);
  return `<Section N="Geometry" IX="0">${cell('NoFill', noFill ? 1 : 0)}${cell('NoLine', 0)}${cell('NoShow', 0)}${rows.join('')}</Section>`;
}

interface PageOut { xml: string; rels: { id: string; target: string }[] }

function pageXml(page: VPage): PageOut {
  const H = page.height;
  const rels: { id: string; target: string }[] = [];
  const relFor = (media: string) => {
    const hit = rels.find((r) => r.target === `../media/${media}`);
    if (hit) return hit.id;
    const id = `rId${rels.length + 1}`;
    rels.push({ id, target: `../media/${media}` });
    return id;
  };
  const shapes = page.shapes.map((s, i) => {
    const id = i + 1;
    const name = s.name ? ` NameU="${esc(s.name)}" Name="${esc(s.name)}"` : '';
    let box: VBox;
    let body = '';
    let foreign = '';
    if (s.kind === 'line') {
      const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      box = { x: x0, y: y0, w: Math.max(Math.max(...xs) - x0, 0.0001), h: Math.max(Math.max(...ys) - y0, 0.0001) };
      const rows = s.points.map((p, k) => `<Row T="${k ? 'LineTo' : 'MoveTo'}" IX="${k + 1}">${cell('X', p.x - box.x)}${cell('Y', box.y + box.h - p.y)}</Row>`);
      body = styleCells({ ...s, fill: null }) +
        (s.arrowStart ? cell('BeginArrow', 13) + cell('BeginArrowSize', 1) : '') +
        (s.arrowEnd ? cell('EndArrow', 13) + cell('EndArrowSize', 1) : '') + dataXml(s.data) + linksXml(s.links) +
        `<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${rows.join('')}</Section>`;
    } else {
      box = s.box;
      if (s.kind === 'image') {
        const used = new Set<string>();
        const conns = s.ports?.length
          ? `<Section N="Connection">${s.ports.map((p, k) => `<Row N="${rowName(p.name, used)}" IX="${k}">${cell('X', p.x)}${cell('Y', box.h - p.y)}${cell('DirX', 0)}${cell('DirY', 0)}${cell('Type', 0)}</Row>`).join('')}</Section>`
          : '';
        body = cell('ImgOffsetX', 0) + cell('ImgOffsetY', 0) + cell('ImgWidth', box.w) + cell('ImgHeight', box.h) +
          cell('LinePattern', 0) + cell('FillPattern', 0) + textXml(s.text) + dataXml(s.data) + linksXml(s.links) + conns;
        // Schema order: cells, sections, Text, then ForeignData.
        foreign = `<ForeignData ForeignType="Bitmap" CompressionType="PNG"><Rel r:id="${relFor(s.media)}"/></ForeignData>`;
      } else {
        const { w, h } = box;
        let geo: string;
        if (s.kind === 'ellipse') {
          geo = `<Section N="Geometry" IX="0">${cell('NoFill', s.fill ? 0 : 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}<Row T="Ellipse" IX="1">${cell('X', w / 2)}${cell('Y', h / 2)}${cell('A', w)}${cell('B', h / 2)}${cell('C', w / 2)}${cell('D', h)}</Row></Section>`;
        } else if (s.kind === 'polygon') {
          geo = closedGeometry(s.points.map((p) => ({ x: p.x * w, y: (1 - p.y) * h })), !s.fill);
        } else {
          geo = closedGeometry([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], !s.fill);
        }
        body = styleCells(s) + textXml(s.text, box) + dataXml(s.data) + linksXml(s.links) + geo;
      }
    }
    const pin = cell('PinX', box.x + box.w / 2) + cell('PinY', H - (box.y + box.h / 2)) + cell('Width', box.w) + cell('Height', box.h) +
      cell('LocPinX', box.w / 2, ' F="Width*0.5"') + cell('LocPinY', box.h / 2, ' F="Height*0.5"') + cell('Angle', s.kind === 'line' ? 0 : s.angle ?? 0);
    const text = s.text?.text ? `<Text>${esc(s.text.text)}</Text>` : '';
    if (s.layers?.length) body += `<Section N="LayerMem"><Row IX="0">${cell('LayerMember', s.layers.join(';'))}</Row></Section>`;
    if (s.container) body += `<Section N="User"><Row N="msvStructureType">${cell('Value', 'Container', ' U="STR"')}</Row><Row N="msvSDContainerMargin">${cell('Value', 0.125, ' U="IN"')}</Row></Section>`;
    return `<Shape ID="${id}"${name} Type="${s.kind === 'image' ? 'Foreign' : 'Shape'}" LineStyle="0" FillStyle="0" TextStyle="0">${pin}${body}${text}${foreign}</Shape>`;
  });
  return {
    xml: `${XML}<PageContents xmlns="${NS}" xmlns:r="${R}" xml:space="preserve"><Shapes>${shapes.join('')}</Shapes></PageContents>`,
    rels,
  };
}

function layersXml(layers?: VLayer[]) {
  if (!layers?.length) return '';
  return `<Section N="Layer">${layers.map((l, i) => `<Row IX="${i}">${cell('Name', l.name)}${cell('NameUniv', l.name)}${cell('Color', 255)}${cell('Status', 0)}` +
    `${cell('Visible', l.visible ? 1 : 0)}${cell('Print', l.print ? 1 : 0)}${cell('Active', l.active ? 1 : 0)}${cell('Lock', l.lock ? 1 : 0)}` +
    `${cell('Snap', 1)}${cell('Glue', 1)}${cell('ColorTrans', 0)}</Row>`).join('')}</Section>`;
}

function relsXml(rels: { id: string; type: string; target: string }[]) {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"/>`)
    .join('')}</Relationships>`;
}

const DOC_XML = `${XML}<VisioDocument xmlns="${NS}" xmlns:r="${R}" xml:space="preserve">` +
  '<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">' +
  '<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><SnapAngles/>' +
  '<DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>' +
  '<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings>' +
  '<Colors><ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#FFFFFF"/></Colors>' +
  '<FaceNames><FaceName NameU="Calibri" Flags="325"/></FaceNames>' +
  '<StyleSheets><StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1">' +
  cell('EnableLineProps', 1) + cell('EnableFillProps', 1) + cell('EnableTextProps', 1) + cell('HideForApply', 0) +
  cell('LineWeight', 0.75 / 72) + cell('LineColor', '#000000') + cell('LinePattern', 1) + cell('Rounding', 0) +
  cell('BeginArrow', 0) + cell('EndArrow', 0) + cell('BeginArrowSize', 2) + cell('EndArrowSize', 2) + cell('LineCap', 0) +
  cell('FillForegnd', '#FFFFFF') + cell('FillBkgnd', '#000000') + cell('FillPattern', 1) + cell('ShdwPattern', 0) +
  cell('LeftMargin', 0.05) + cell('RightMargin', 0.05) + cell('TopMargin', 0.05) + cell('BottomMargin', 0.05) +
  cell('VerticalAlign', 1) + cell('TextBkgnd', 0) +
  `<Section N="Character"><Row IX="0">${cell('Font', 'Calibri')}${cell('Color', '#000000')}${cell('Style', 0)}${cell('Size', 11 / 72)}</Row></Section>` +
  `<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', 1)}</Row></Section>` +
  '</StyleSheet></StyleSheets></VisioDocument>';

/**
 * A shape in real-world units for a scaled page: positions, sizes, points, connection points and corner rounding
 * grow by `k`; line weights, text sizes and text margins stay paper sizes (as Visio keeps them).
 */
function scaleShape(s: VShape, k: number): VShape {
  const box = (b: VBox): VBox => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });
  const r = 'rounding' in s && s.rounding !== undefined ? { rounding: s.rounding * k } : {};
  switch (s.kind) {
    case 'image': return { ...s, box: box(s.box), ports: s.ports?.map((p) => ({ ...p, x: p.x * k, y: p.y * k })) };
    case 'line': return { ...s, ...r, points: s.points.map((p) => ({ x: p.x * k, y: p.y * k })) };
    default: return { ...s, ...r, box: box(s.box) };
  }
}

/** Builds the .vsdx file. */
export function writeVsdx(doc: VDocument): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const T = 'http://schemas.microsoft.com/visio/2010/relationships';
  const pageEntries: string[] = [];
  const pageRels: { id: string; type: string; target: string }[] = [];
  const overrides: string[] = [];
  doc.pages.forEach((given, i) => {
    const k = given.drawingScale?.realPerPaper ?? 1;
    const page = k === 1 ? given : { ...given, width: given.width * k, height: given.height * k, shapes: given.shapes.map((s) => scaleShape(s, k)) };
    const out = pageXml(page);
    const file = `page${i + 1}.xml`;
    files[`visio/pages/${file}`] = strToU8(out.xml);
    if (out.rels.length) files[`visio/pages/_rels/${file}.rels`] = strToU8(relsXml(out.rels.map((r) => ({ ...r, type: `${R}/image` }))));
    pageRels.push({ id: `rId${i + 1}`, type: `${T}/page`, target: file });
    overrides.push(`<Override PartName="/visio/pages/${file}" ContentType="application/vnd.ms-visio.page+xml"/>`);
    pageEntries.push(
      `<Page ID="${i}" NameU="${page.background ? 'Background' : 'Page'}-${i + 1}" Name="${esc(page.name || `Page-${i + 1}`)}" ViewScale="-1"` +
      `${page.background ? ' Background="1"' : ''}${page.backPage !== undefined ? ` BackPage="${page.backPage}"` : ''}>` +
      `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cell('PageWidth', page.width)}${cell('PageHeight', page.height)}` +
      (k === 1
        ? `${cell('PageScale', 1, ' U="IN_F"')}${cell('DrawingScale', 1, ' U="IN_F"')}${cell('DrawingSizeType', 0)}${cell('DrawingScaleType', 0)}`
        // One paper inch = k real inches; custom drawing scale (DrawingScaleType 3), shown in feet or metres.
        : `${cell('PageScale', 1, ' U="IN"')}${cell('DrawingScale', k, given.drawingScale?.unit === 'm' ? ' U="M"' : ' U="FT"')}${cell('DrawingSizeType', 0)}${cell('DrawingScaleType', 3)}`) +
      `${cell('PageLeftMargin', 0.25)}${cell('PageRightMargin', 0.25)}${cell('PageTopMargin', 0.25)}${cell('PageBottomMargin', 0.25)}` +
      `${cell('PrintPageOrientation', given.width >= given.height ? 2 : 1)}${layersXml(page.layers)}</PageSheet><Rel r:id="rId${i + 1}"/></Page>`,
    );
  });
  files['visio/pages/pages.xml'] = strToU8(`${XML}<Pages xmlns="${NS}" xmlns:r="${R}" xml:space="preserve">${pageEntries.join('')}</Pages>`);
  files['visio/pages/_rels/pages.xml.rels'] = strToU8(relsXml(pageRels));
  files['visio/document.xml'] = strToU8(DOC_XML);
  files['visio/_rels/document.xml.rels'] = strToU8(relsXml([{ id: 'rId1', type: `${T}/pages`, target: 'pages/pages.xml' }]));
  for (const [name, bytes] of Object.entries(doc.media)) files[`visio/media/${name}`] = bytes;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(doc.title ?? '')}</dc:title><dc:creator>RackDraw</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  files['docProps/app.xml'] = strToU8(`${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>RackDraw</Application></Properties>`);
  files['_rels/.rels'] = strToU8(relsXml([
    { id: 'rId1', type: `${T}/document`, target: 'visio/document.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
    { id: 'rId3', type: `${R}/extended-properties`, target: 'docProps/app.xml' },
  ]));
  files['[Content_Types].xml'] = strToU8(
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>' +
    '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>' +
    overrides.join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>',
  );
  return zipSync(files, { level: 6 });
}
