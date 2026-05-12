import * as pdfjsLib from 'pdfjs-dist';
import {
  ConverterProgress,
  ConverterSettings,
  OcrImageObject,
  OcrPage,
  OcrTextRun,
} from '../types';
import { toTesseractLanguage } from '../utils/language';
import { reconstructLayout } from './layout-reconstruction';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).href;

type ProgressHandler = (progress: ConverterProgress) => void;

function makeThumbnail(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/jpeg', 0.72);
}

function confidenceFromText(text: string) {
  if (!text.trim()) return 0;
  const readable = text.replace(/[^\p{L}\p{N}\s.,:;'"!?()[\]/-]/gu, '').length;
  return Math.max(55, Math.min(98, Math.round((readable / Math.max(1, text.length)) * 96)));
}

function normalizeTextItem(item: any, pageHeight: number): OcrTextRun | null {
  const text = String(item.str ?? '').trim();
  if (!text) return null;
  const [, b, , d, x, y] = item.transform ?? [1, 0, 0, 12, 0, 0];
  const fontSize = Math.max(8, Math.round(Math.hypot(b, d) || item.height || 12));
  return {
    id: crypto.randomUUID(),
    text,
    box: {
      x: Math.max(0, x),
      y: Math.max(0, pageHeight - y),
      width: Math.max(8, item.width ?? text.length * fontSize * 0.5),
      height: Math.max(fontSize, item.height ?? fontSize),
    },
    fontSize,
    fontFamily: item.fontName ?? 'PDF embedded font',
    confidence: confidenceFromText(text),
    language: 'unknown',
  };
}

async function renderPageCanvas(page: pdfjsLib.PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Unable to create PDF render context');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return { canvas, viewport };
}

async function runTesseract(dataUrl: string, settings: ConverterSettings) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(toTesseractLanguage(settings.languages));
  const result = await worker.recognize(dataUrl);
  await worker.terminate();
  return result.data;
}

export async function analyzeDocument(
  file: File,
  settings: ConverterSettings,
  onProgress: ProgressHandler,
) {
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF files are supported in this converter.');
  }

  onProgress({ stage: 'uploading', page: 0, totalPages: 0, percent: 4, message: 'Validating PDF file' });

  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data,
    password: settings.password || undefined,
    useWorkerFetch: true,
  });
  const pdf = await loadingTask.promise;
  const pages: OcrPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    onProgress({
      stage: 'ocr-processing',
      page: pageNumber,
      totalPages: pdf.numPages,
      percent: Math.round((pageNumber / pdf.numPages) * 52),
      message: `Extracting page ${pageNumber} of ${pdf.numPages}`,
    });

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const textRuns = textContent.items
      .map((item) => normalizeTextItem(item, viewport.height))
      .filter(Boolean) as OcrTextRun[];

    const { canvas } = await renderPageCanvas(page, settings.quality === 'maximum' ? 1.4 : 0.8);
    const thumbnail = makeThumbnail(canvas);
    let finalRuns = textRuns;
    let plainText = textRuns.map((run) => run.text).join(' ').trim();

    if ((!plainText || settings.quality === 'maximum') && settings.aiEnhancement) {
      onProgress({
        stage: 'ocr-processing',
        page: pageNumber,
        totalPages: pdf.numPages,
        percent: Math.round(52 + (pageNumber / pdf.numPages) * 18),
        message: `Running OCR enhancement on page ${pageNumber}`,
      });
      const ocr = await runTesseract(canvas.toDataURL('image/png'), settings);
      const ocrText = ocr.text.trim();
      if (ocrText) {
        finalRuns = [
          ...textRuns,
          {
            id: crypto.randomUUID(),
            text: ocrText,
            box: { x: 36, y: 36, width: viewport.width - 72, height: viewport.height - 72 },
            fontSize: 11,
            fontFamily: 'OCR text layer',
            confidence: Math.max(0, Math.min(100, Math.round(ocr.confidence ?? confidenceFromText(ocrText)))),
            language: settings.languages[0] ?? 'eng',
          },
        ];
        plainText = ocrText;
      }
    }

    const images: OcrImageObject[] = settings.preserveImages
      ? [{
          id: crypto.randomUUID(),
          dataUrl: thumbnail,
          box: { x: 0, y: 0, width: viewport.width, height: viewport.height },
          alt: `Rendered page ${pageNumber}`,
        }]
      : [];

    const confidence = finalRuns.length
      ? Math.round(finalRuns.reduce((sum, run) => sum + run.confidence, 0) / finalRuns.length)
      : 0;

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate,
      thumbnail,
      textRuns: finalRuns,
      tables: [],
      images,
      confidence,
      plainText,
    });
  }

  onProgress({
    stage: 'layout-reconstruction',
    page: pdf.numPages,
    totalPages: pdf.numPages,
    percent: 78,
    message: 'Reconstructing editable layout objects',
  });

  const layout = reconstructLayout(file, pages, settings);

  onProgress({
    stage: 'completed',
    page: pdf.numPages,
    totalPages: pdf.numPages,
    percent: 100,
    message: 'Document analysis complete',
  });

  return layout;
}
