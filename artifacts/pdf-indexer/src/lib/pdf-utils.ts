import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

export interface PageAnalysis {
  pageNumber: number; // 1-indexed within its PDF
  isBlank: boolean;
  assignedIndex: string | null;
}

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

export async function generateThumbnailForPage(
  file: File,
  pageNumber: number,
  scale = 0.35
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toDataURL('image/jpeg', 0.8);
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

/** Extract embedded text from a PDF page using pdfjs text layer */
export async function extractTextFromPage(file: File, pageNumber: number): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .trim();
}

/** Extract text from all pages of a PDF */
export async function extractAllText(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const results: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();
    results.push(text);
    onProgress?.(i, pdf.numPages);
  }
  return results;
}

/** Run OCR on an image data URL using Tesseract.js */
export async function ocrImageDataUrl(
  dataUrl: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { progress: number }) => {
      if (m.progress !== undefined) onProgress?.(Math.round(m.progress * 100));
    },
  });
  const { data } = await worker.recognize(dataUrl);
  await worker.terminate();
  return data.text.trim();
}

/** Render a PDF page to a high-res canvas data URL for OCR */
export async function renderPageForOcr(file: File, pageNumber: number): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNumber);
  const scale = 2.0;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d')!;
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toDataURL('image/png');
}

/** Apply page modifications (rotation, deletion, reorder) and return a new File */
export async function applyPageModifications(
  file: File,
  options: {
    pageRotations?: Record<number, number>; // 1-indexed pageNum -> extra degrees (90/180/270)
    deletedPages?: Set<number>;             // 1-indexed page numbers to remove
    pageOrder?: number[];                   // 1-indexed pages in new order
  }
): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();
  const sourceDoc = await PDFDocument.load(arrayBuffer);
  const newDoc = await PDFDocument.create();

  const totalPages = sourceDoc.getPageCount();
  const order = options.pageOrder ?? Array.from({ length: totalPages }, (_, i) => i + 1);
  const deleted = options.deletedPages ?? new Set<number>();
  const rotations = options.pageRotations ?? {};

  const filtered = order.filter((pn) => !deleted.has(pn));
  const zeroIndexed = filtered.map((pn) => pn - 1);
  const copied = await newDoc.copyPages(sourceDoc, zeroIndexed);

  for (let i = 0; i < copied.length; i++) {
    const page = copied[i];
    const originalPn = filtered[i];
    const extraRot = rotations[originalPn] ?? 0;
    if (extraRot !== 0) {
      const current = page.getRotation().angle;
      page.setRotation(degrees(current + extraRot));
    }
    newDoc.addPage(page);
  }

  const pdfBytes = await newDoc.save();
  return new File([pdfBytes.buffer as ArrayBuffer], file.name, { type: 'application/pdf' });
}

export interface FormatLevels {
  level1: boolean;
  level2: boolean;
  level3: boolean;
}

export const DEFAULT_FORMAT_LEVELS: FormatLevels = { level1: true, level2: true, level3: false };

export function codeForContentPage(
  mainCode: string,
  contentIndex: number,
  levels: FormatLevels
): string {
  const base = mainCode.endsWith('>') ? mainCode.slice(0, -1) : mainCode;
  let consumed = 0;

  if (levels.level1) {
    if (contentIndex === consumed) return mainCode;
    consumed++;
  }

  if (levels.level2) {
    if (!levels.level3) {
      const n = contentIndex - consumed + 1;
      return `${base}-${n}>`;
    } else {
      if (contentIndex === consumed) return `${base}-1>`;
      consumed++;
    }
  }

  if (levels.level3) {
    const n = contentIndex - consumed + 1;
    return `${base}-1-${n}>`;
  }

  return mainCode;
}

export function computeAttachmentIndices(
  pages: PageAnalysis[],
  mainCode: string,
  overrides: Record<number, string>,
  levels: FormatLevels = DEFAULT_FORMAT_LEVELS
): PageAnalysis[] {
  let contentIndex = 0;
  return pages.map((page) => {
    if (page.isBlank) return { ...page, assignedIndex: null };

    if (page.pageNumber in overrides) {
      const code = overrides[page.pageNumber] || null;
      contentIndex++;
      return { ...page, assignedIndex: code };
    }

    const code = codeForContentPage(mainCode, contentIndex, levels);
    contentIndex++;
    return { ...page, assignedIndex: code };
  });
}

export interface PdfEntryForProcessing {
  file: File;
  pages: PageAnalysis[];
}

export interface ProcessingOptions {
  topMarginCm?: number;
  sideMarginCm?: number;
  fontSize?: number;
  bold?: boolean;
}

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
      const isOdd = (i + 1) % 2 !== 0;

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
