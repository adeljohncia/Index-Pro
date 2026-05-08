import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

export interface PageAnalysis {
  pageNumber: number;
  isBlank: boolean;
  assignedIndex: string | null;
}

export interface Attachment {
  id: string;
  mainCode: string;
  fromPage: number;
  untilPage: number;
}

export async function analyzePdfPages(file: File): Promise<PageAnalysis[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const analysis: PageAnalysis[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 0.2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: context, viewport }).promise;

    const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let j = 0; j < data.length; j += 4) {
      const gray = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      sum += gray;
      sumSq += gray * gray;
      count++;
    }

    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    const stdDev = Math.sqrt(variance);

    analysis.push({ pageNumber: i, isBlank: stdDev < 5, assignedIndex: null });
  }

  return analysis;
}

/**
 * For a given attachment mainCode (e.g. "<A1>") and position within that attachment
 * (0-indexed, counting only non-blank pages):
 *   position 0 → "<A1>"
 *   position 1 → "<A1-1>"
 *   position 2 → "<A1-2>"
 */
export function subIndexCode(mainCode: string, position: number): string {
  if (position === 0) return mainCode;
  const withoutClose = mainCode.endsWith('>') ? mainCode.slice(0, -1) : mainCode;
  return `${withoutClose}-${position}>`;
}

export function computeAssignedIndices(
  pages: PageAnalysis[],
  attachments: Attachment[],
  overrides: Record<number, string>
): PageAnalysis[] {
  const indexMap = new Map<number, string>();

  for (const attachment of attachments) {
    let position = 0;
    for (const page of pages) {
      if (page.pageNumber < attachment.fromPage || page.pageNumber > attachment.untilPage) continue;
      if (page.isBlank) continue;
      indexMap.set(page.pageNumber, subIndexCode(attachment.mainCode, position));
      position++;
    }
  }

  return pages.map((page) => {
    if (page.pageNumber in overrides) {
      return { ...page, assignedIndex: overrides[page.pageNumber] || null };
    }
    return { ...page, assignedIndex: indexMap.get(page.pageNumber) ?? null };
  });
}

export async function processPdfWithIndices(
  file: File,
  pages: PageAnalysis[]
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 16;
  const marginPt = 28.35;

  const pdfPages = pdfDoc.getPages();

  for (const page of pages) {
    if (!page.assignedIndex) continue;
    const pdfPage = pdfPages[page.pageNumber - 1];
    if (!pdfPage) continue;

    const { width, height } = pdfPage.getSize();
    const textWidth = helveticaFont.widthOfTextAtSize(page.assignedIndex, fontSize);
    const isOdd = page.pageNumber % 2 !== 0;

    const x = isOdd ? marginPt : width - marginPt - textWidth;
    const y = height - marginPt - fontSize;

    pdfPage.drawText(page.assignedIndex, {
      x,
      y,
      size: fontSize,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

export function generatePrintTemplateHtml(pages: PageAnalysis[]): string {
  const htmlParts = [
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Template</title>
  <style>
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: #f0f0f0; }
    @page { size: A4; margin: 0; }
    .page {
      width: 210mm; height: 297mm; background: white;
      margin: 0 auto; position: relative;
      page-break-after: always; box-sizing: border-box;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    }
    @media print {
      body { background: white; }
      .page { box-shadow: none; margin: 0; }
      .no-print { display: none; }
    }
    .stamp { position: absolute; font-size: 16pt; top: 10mm; }
    .odd .stamp { left: 10mm; }
    .even .stamp { right: 10mm; }
    .toolbar { padding: 20px; text-align: center; background: #333; color: white; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; background: #0066cc; color: white; border: none; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="toolbar no-print"><button onclick="window.print()">Print Template</button></div>`,
  ];

  for (const page of pages) {
    if (!page.assignedIndex) continue;
    const isOdd = page.pageNumber % 2 !== 0;
    htmlParts.push(`
  <div class="page ${isOdd ? 'odd' : 'even'}">
    <div class="stamp">${page.assignedIndex.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>`);
  }

  htmlParts.push(`</body></html>`);
  return htmlParts.join('\n');
}
