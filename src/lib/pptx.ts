/**
 * Minimal PowerPoint (.pptx) writer: 16:9 slides, each with a title, one PNG picture fitted below it and a small
 * footer. Enough for a client review deck that opens and edits in PowerPoint, Keynote and Google Slides.
 */
import { strToU8, zipSync } from 'fflate';

export interface PptSlide {
  title: string;
  /** PNG file name in `media`; none = a title slide (big title and subtitle). */
  media?: string;
  /** Picture size in pixels (for its proportions). */
  w?: number;
  h?: number;
  subtitle?: string;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const rels = (list: { id: string; type: string; target: string }[]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.id}" Type="${RT}/${r.type}" Target="${esc(r.target)}"/>`).join('')}</Relationships>`;

// 16:9 slide in EMU.
const SW = 12192000, SH = 6858000, EMU_IN = 914400;
const emptyTree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function textBox(id: number, name: string, x: number, y: number, w: number, h: number, text: string, sizePt: number, bold: boolean, color: string) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US" sz="${Math.round(sizePt * 100)}" b="${bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Segoe UI"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function slideXml(s: PptSlide, footer: string) {
  const m = Math.round(0.4 * EMU_IN);
  if (!s.media || !s.w || !s.h) {
    return `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${emptyTree}` +
      textBox(2, 'Title', m * 2, Math.round(SH * 0.36), SW - m * 4, Math.round(1.1 * EMU_IN), s.title, 40, true, '1F2937') +
      (s.subtitle ? textBox(3, 'Subtitle', m * 2, Math.round(SH * 0.36 + 1.2 * EMU_IN), SW - m * 4, Math.round(0.8 * EMU_IN), s.subtitle, 18, false, '4B5563') : '') +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }
  const titleH = Math.round(0.6 * EMU_IN), footH = Math.round(0.3 * EMU_IN);
  const top = m + titleH + Math.round(0.1 * EMU_IN);
  const boxW = SW - m * 2, boxH = SH - top - m - footH;
  const k = Math.min(boxW / s.w, boxH / s.h);
  const pw = Math.round(s.w * k), ph = Math.round(s.h * k);
  const px = Math.round((SW - pw) / 2), py = Math.round(top + (boxH - ph) / 2);
  const pic = `<p:pic><p:nvPicPr><p:cNvPr id="3" name="${esc(s.title)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${px}" y="${py}"/><a:ext cx="${pw}" cy="${ph}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  return `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>${emptyTree}` +
    textBox(2, 'Title', m, m, SW - m * 2, titleH, s.title, 26, true, '1F2937') +
    pic +
    textBox(4, 'Footer', m, SH - m - footH + Math.round(0.05 * EMU_IN), SW - m * 2, footH, footer, 10, false, '6B7280') +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

const THEME = `${XML}<a:theme xmlns:a="${A}" name="NetCraft"><a:themeElements>` +
  '<a:clrScheme name="NetCraft"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2><a:accent3><a:srgbClr val="EA580C"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="DC2626"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="NetCraft"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="NetCraft"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
  '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

const MASTER = `${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${emptyTree}</p:spTree></p:cSld>` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';

const LAYOUT = `${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export function writePptx(slides: PptSlide[], media: Record<string, Uint8Array>, opts: { title?: string; footer?: string } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [];
  slides.forEach((s, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(slideXml(s, opts.footer ?? ''));
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(rels([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      ...(s.media ? [{ id: 'rId2', type: 'image', target: `../media/${s.media}` }] : []),
    ]));
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
  });
  for (const [name, bytes] of Object.entries(media)) files[`ppt/media/${name}`] = bytes;
  files['ppt/presentation.xml'] = strToU8(`${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`);
  files['ppt/_rels/presentation.xml.rels'] = strToU8(rels([
    { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' },
    ...slides.map((_, i) => ({ id: `rId${i + 3}`, type: 'slide', target: `slides/slide${i + 1}.xml` })),
  ]));
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(MASTER);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(rels([
    { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
  ]));
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(LAYOUT);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
  files['ppt/theme/theme1.xml'] = strToU8(THEME);
  files['docProps/core.xml'] = strToU8(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(opts.title ?? '')}</dc:title><dc:creator>NetCraft</dc:creator></cp:coreProperties>`);
  files['_rels/.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${RT}/officeDocument" Target="ppt/presentation.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  files['[Content_Types].xml'] = strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    overrides.join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  return zipSync(files, { level: 6 });
}
