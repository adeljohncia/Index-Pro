import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

export interface PageAnalysis {
  pageNumber: number; // 1-indexed within its PDF
  isBlank: boolean;
  assignedIndex: string | null;
}

/**
 * Render each page of a PDF as a thumbnail data URL (JPEG, small scale).
 * onProgress(index, total) called after each page.
 */
export async function generateThumbnails(
  file: File,
  onProgress?: (idx: number, total: number) => void
): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const thumbnails: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 0.35;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    thumbnails.push(canvas.toDataURL('image/jpeg', 0.75));
    onProgress?.(i, pdf.numPages);
  }

  return thumbnails;
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
    await page.render({ canvasContext: context, viewport, canvas }).promise;

    const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let sum = 0, sumSq = 0, count = 0;
    for (let j = 0; j < data.length; j += 4) {
      const gray = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      sum += gray; sumSq += gray * gray; count++;
    }
    const mean = sum / count;
    const stdDev = Math.sqrt(sumSq / count - mean * mean);

    analysis.push({ pageNumber: i, isBlank: stdDev < 5, assignedIndex: null });
  }

  return analysis;
}

/**
 * Given a main code like "<A1>" and a 0-based position within the attachment:
 *   0 → "<A1>", 1 → "<A1-1>", 2 → "<A1-2>", ...
 */
export function subIndexCode(mainCode: string, position: number): string {
  if (position === 0) return mainCode;
  const base = mainCode.endsWith('>') ? mainCode.slice(0, -1) : mainCode;
  return `${base}-${position}>`;
}

/**
 * Compute assigned index codes for pages of a single PDF.
 * overrides: { pageNumber -> custom code (empty = skip) }
 */
export function computeAttachmentIndices(
  pages: PageAnalysis[],
  mainCode: string,
  overrides: Record<number, string>
): PageAnalysis[] {
  let position = 0;
  return pages.map((page) => {
    if (page.isBlank) return { ...page, assignedIndex: null };

    if (page.pageNumber in overrides) {
      const code = overrides[page.pageNumber] || null;
      position++;
      return { ...page, assignedIndex: code };
    }

    const code = subIndexCode(mainCode, position);
    position++;
    return { ...page, assignedIndex: code };
  });
}

export interface PdfEntryForProcessing {
  file: File;
  pages: PageAnalysis[]; // with assignedIndex already computed
}

export interface ProcessingOptions {
  topMarginCm?: number;   // default 0.5
  sideMarginCm?: number;  // default 0.5
  fontSize?: number;      // default 16
  bold?: boolean;         // default false
}

/**
 * Merge multiple PDFs into one, stamping index codes onto each page.
 * Odd/even is determined per-PDF (page 1 of each PDF is always odd = top-left).
 */
export async function processAndMergePdfs(
  entries: PdfEntryForProcessing[],
  options: ProcessingOptions = {}
): Promise<Blob> {
  const {
    topMarginCm = 0.5,
    sideMarginCm = 0.5,
    fontSize = 16,
    bold = false,
  } = options;

  const mergedDoc = await PDFDocument.create();
  const fontName = bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
  const helveticaFont = await mergedDoc.embedFont(fontName);
  const marginTopPt = topMarginCm * 28.35;
  const marginSidePt = sideMarginCm * 28.35;

  for (const entry of entries) {
    const arrayBuffer = await entry.file.arrayBuffer();
    const sourceDoc = await PDFDocument.load(arrayBuffer);
    const pageCount = sourceDoc.getPageCount();
    const pageIndices = Array.from({ length: pageCount }, (_, i) => i);
    const copied = await mergedDoc.copyPages(sourceDoc, pageIndices);

    for (let i = 0; i < copied.length; i++) {
      const copiedPage = copied[i];
      mergedDoc.addPage(copiedPage);

      const pageAnalysis = entry.pages[i];
      if (!pageAnalysis?.assignedIndex) continue;

      const { width, height } = copiedPage.getSize();
      const text = pageAnalysis.assignedIndex;
      const textWidth = helveticaFont.widthOfTextAtSize(text, fontSize);
      const isOdd = (i + 1) % 2 !== 0; // local page number within PDF

      const x = isOdd ? marginSidePt : width - marginSidePt - textWidth;
      const y = height - marginTopPt - fontSize;

      copiedPage.drawText(text, { x, y, size: fontSize, font: helveticaFont, color: rgb(0, 0, 0) });
    }
  }

  const pdfBytes = await mergedDoc.save();
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

export function generatePrintTemplateHtml(
  entries: Array<{ fileName: string; mainCode: string; pages: PageAnalysis[] }>
): string {
  const parts = [
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Overlay Template</title>
  <style>
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: #f0f0f0; }
    @page { size: A4; margin: 0; }
    .page {
      width: 210mm; height: 297mm; background: white;
      margin: 0 auto; position: relative;
      page-break-after: always; box-sizing: border-box;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    }
    @media print { body { background: white; } .page { box-shadow: none; margin: 0; } .no-print { display: none; } }
    .stamp { position: absolute; font-size: 16pt; font-family: Arial, sans-serif; top: 5mm; }
    .odd .stamp { left: 5mm; }
    .even .stamp { right: 5mm; }
    .toolbar { padding: 16px; text-align: center; background: #1e293b; color: white; }
    .toolbar button { padding: 10px 24px; font-size: 15px; cursor: pointer; background: #3b82f6; color: white; border: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="toolbar no-print"><button onclick="window.print()">Print Template</button></div>`,
  ];

  for (const entry of entries) {
    for (const page of entry.pages) {
      if (!page.assignedIndex) continue;
      const isOdd = page.pageNumber % 2 !== 0;
      parts.push(`
  <div class="page ${isOdd ? 'odd' : 'even'}">
    <div class="stamp">${page.assignedIndex.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>`);
    }
  }

  parts.push(`</body></html>`);
  return parts.join('\n');
}
