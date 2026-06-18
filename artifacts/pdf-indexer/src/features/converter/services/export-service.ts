import JSZip from 'jszip';
import { ConverterExport, ConverterLayoutSchema, ConverterOutputFormat, OcrPage } from '../types';
import { escapeXml, sanitizeFileName } from '../utils/xml';

const MIME: Record<ConverterOutputFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  html: 'text/html',
  json: 'application/json',
};

function pageText(page: OcrPage) {
  return page.textRuns
    .slice()
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
    .map((run) => run.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupTextRunsByColumns(textRuns: any[], columns: number[]): any[][] {
  const columnGroups: any[][] = columns.slice(0, -1).map(() => []);
  
  for (const run of textRuns) {
    const columnIndex = columns.findIndex((col, index) => 
      run.box.x >= col && (index === columns.length - 1 || run.box.x < columns[index + 1])
    );
    if (columnIndex >= 0 && columnIndex < columnGroups.length) {
      columnGroups[columnIndex].push(run);
    }
  }
  
  return columnGroups.filter(group => group.length > 0);
}

function groupIntoParagraphs(textRuns: any[]): any[][] {
  const sorted = [...textRuns].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const paragraphs: any[][] = [];
  
  for (const run of sorted) {
    const lastPara = paragraphs[paragraphs.length - 1];
    if (lastPara && Math.abs(lastPara[0].box.y - run.box.y) < 20) { // Same line
      lastPara.push(run);
    } else {
      paragraphs.push([run]);
    }
  }
  
  return paragraphs;
}

function getRunStyle(run: any): string {
  let style = '';
  if (run.bold) style += '<w:b/>';
  if (run.italic) style += '<w:i/>';
  if (run.fontSize) {
    const size = Math.round(run.fontSize * 2); // Half-points
    style += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  }
  return style ? `<w:rPr>${style}</w:rPr>` : '';
}

function contentTypes(extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${extra}
</Types>`;
}

function rels(type: string, target: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${type}" Target="${target}"/>
</Relationships>`;
}

async function exportDocx(layout: ConverterLayoutSchema): Promise<Blob> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'));
  zip.folder('_rels')?.file('.rels', rels('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'word/document.xml'));

  const body = layout.pages.map((page) => {
    let pageContent = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Page ${page.pageNumber}</w:t></w:r></w:p>`;

    // Handle multi-column layout
    if (page.columns && page.columns.length > 2) {
      const columnGroups = groupTextRunsByColumns(page.textRuns, page.columns);
      const columnWidth = Math.floor(11906 / (page.columns.length - 1)); // Page width in twips
      
      pageContent += columnGroups.map((columnRuns, colIndex) => {
        const paragraphs = groupIntoParagraphs(columnRuns);
        return paragraphs.map(para => {
          const runs = para.map(run => {
            const style = getRunStyle(run);
            return `<w:r${style}><w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
          }).join('');
          return `<w:p><w:r>${runs}</w:r></w:p>`;
        }).join('');
      }).join('');
    } else {
      // Single column layout
      const paragraphs = groupIntoParagraphs(page.textRuns);
      pageContent += paragraphs.map(para => {
        const runs = para.map(run => {
          const style = getRunStyle(run);
          return `<w:r${style}><w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
        }).join('');
        return `<w:p><w:r>${runs}</w:r></w:p>`;
      }).join('');
    }

    // Add tables
    const tables = page.tables.map((table) => {
      const rows = Array.from({ length: table.rowCount }, (_, rowIndex) => {
        const cells = Array.from({ length: table.columnCount }, (_, columnIndex) => {
          const cell = table.cells.find((item) => item.row === rowIndex && item.column === columnIndex);
          return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${escapeXml(cell?.text ?? '')}</w:t></w:r></w:p></w:tc>`;
        }).join('');
        return `<w:tr>${cells}</w:tr>`;
      }).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
    }).join('');

    pageContent += tables;
    pageContent += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

    return pageContent;
  }).join('');

  zip.folder('word')?.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body>
</w:document>`);

  return zip.generateAsync({ type: 'blob', mimeType: MIME.docx });
}

async function exportXlsx(layout: ConverterLayoutSchema): Promise<Blob> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'));
  zip.folder('_rels')?.file('.rels', rels('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'xl/workbook.xml'));
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', rels('http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml'));
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OCR Layout" sheetId="1" r:id="rId1"/></sheets></workbook>`);

  const rows: string[] = [];
  let row = 1;
  for (const page of layout.pages) {
    rows.push(`<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>Page ${page.pageNumber}</t></is></c><c r="B${row}" t="inlineStr"><is><t>Confidence ${page.confidence}%</t></is></c></row>`);
    row++;
    const table = page.tables[0];
    if (table) {
      for (let r = 0; r < table.rowCount; r++) {
        const cells = Array.from({ length: table.columnCount }, (_, c) => {
          const cell = table.cells.find((item) => item.row === r && item.column === c);
          const col = String.fromCharCode(65 + Math.min(c, 25));
          return `<c r="${col}${row}" t="inlineStr"><is><t>${escapeXml(cell?.text ?? '')}</t></is></c>`;
        }).join('');
        rows.push(`<row r="${row}">${cells}</row>`);
        row++;
      }
    } else {
      rows.push(`<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${escapeXml(pageText(page))}</t></is></c></row>`);
      row++;
    }
  }

  zip.folder('xl')?.folder('worksheets')?.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'blob', mimeType: MIME.xlsx });
}

async function exportPptx(layout: ConverterLayoutSchema): Promise<Blob> {
  const zip = new JSZip();
  const slideOverrides = layout.pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  zip.file('[Content_Types].xml', contentTypes(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideOverrides}`));
  zip.folder('_rels')?.file('.rels', rels('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'ppt/presentation.xml'));

  const slideIds = layout.pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  const slideRels = layout.pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  zip.folder('ppt')?.file('presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="6858000"/><p:sldIdLst>${slideIds}</p:sldIdLst></p:presentation>`);
  zip.folder('ppt')?.folder('_rels')?.file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRels}</Relationships>`);

  const slides = zip.folder('ppt')?.folder('slides');
  layout.pages.forEach((page, index) => {
    const shapes = page.textRuns.slice(0, 80).map((run, shapeIndex) => {
      const x = Math.round((run.box.x / page.width) * 9144000);
      const y = Math.round((run.box.y / page.height) * 6858000);
      const w = Math.max(400000, Math.round((run.box.width / page.width) * 9144000));
      const h = Math.max(180000, Math.round((run.box.height / page.height) * 6858000));
      return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeIndex + 2}" name="Text ${shapeIndex + 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${Math.round(run.fontSize * 100)}"/><a:t>${escapeXml(run.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
    }).join('');
    slides?.file(`slide${index + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld></p:sld>`);
  });

  return zip.generateAsync({ type: 'blob', mimeType: MIME.pptx });
}

function exportText(layout: ConverterLayoutSchema) {
  return new Blob([layout.pages.map((page) => `Page ${page.pageNumber}\n${pageText(page)}`).join('\n\n')], { type: MIME.txt });
}

function exportHtml(layout: ConverterLayoutSchema) {
  const pages = layout.pages.map((page) => `<section class="page"><h2>Page ${page.pageNumber}</h2><p>${escapeXml(pageText(page))}</p></section>`).join('');
  return new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(layout.fileName)}</title><style>body{font-family:Arial,sans-serif;margin:32px}.page{page-break-after:always;margin-bottom:32px}p{white-space:pre-wrap}</style></head><body>${pages}</body></html>`], { type: MIME.html });
}

export async function exportConvertedDocument(
  layout: ConverterLayoutSchema,
  format: ConverterOutputFormat,
): Promise<ConverterExport> {
  const baseName = sanitizeFileName(layout.fileName);
  let blob: Blob;
  if (format === 'docx') blob = await exportDocx(layout);
  else if (format === 'xlsx') blob = await exportXlsx(layout);
  else if (format === 'pptx') blob = await exportPptx(layout);
  else if (format === 'txt') blob = exportText(layout);
  else if (format === 'html') blob = exportHtml(layout);
  else blob = new Blob([JSON.stringify(layout, null, 2)], { type: MIME.json });

  return {
    blob,
    fileName: `${baseName}.${format}`,
    mimeType: MIME[format],
  };
}
