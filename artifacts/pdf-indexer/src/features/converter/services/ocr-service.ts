import * as pdfjsLib from 'pdfjs-dist';
import { franc } from 'franc-min';
import {
  ConverterProgress,
  ConverterSettings,
  OcrImageObject,
  OcrPage,
  OcrTextRun,
} from '../types';
import { toTesseractLanguage } from '../utils/language';
import { reconstructLayout } from './layout-reconstruction';
import BackendOCRService from './backend-ocr-service';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).href;

type ProgressHandler = (progress: ConverterProgress) => void;

// Initialize backend service
const backendOCR = new BackendOCRService(
  import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
);

function detectLanguages(text: string): string[] {
  const detected = franc(text);
  const languageMap: Record<string, string> = {
    eng: 'eng',
    msa: 'msa',
    zho: 'chi_sim',
    ara: 'ara',
    jpn: 'jpn',
  };
  const primary = languageMap[detected] || 'eng';
  
  // Check for multiple languages by splitting text and detecting each part
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const detectedLanguages = new Set([primary]);
  
  for (const sentence of sentences.slice(0, 5)) { // Check first 5 sentences
    const lang = franc(sentence.trim());
    if (languageMap[lang] && languageMap[lang] !== primary) {
      detectedLanguages.add(languageMap[lang]);
    }
  }
  
  return Array.from(detectedLanguages);
}

function isScannedDocument(textRuns: OcrTextRun[], pageWidth: number, pageHeight: number): boolean {
  if (textRuns.length === 0) return true;
  
  const totalTextLength = textRuns.reduce((sum, run) => sum + run.text.length, 0);
  const pageArea = pageWidth * pageHeight;
  const textDensity = totalTextLength / pageArea;
  
  // If text density is very low, likely scanned
  return textDensity < 0.001 || textRuns.every(run => run.confidence < 50);
}

function parseOcrResult(ocrResult: any, viewport: any): OcrTextRun[] {
  const runs: OcrTextRun[] = [];
  
  if (ocrResult.words) {
    for (const word of ocrResult.words) {
      if (word.text && word.text.trim()) {
        // Basic heuristics for bold/italic detection
        const isBold = word.confidence > 90 && word.text.length > 1 && /^[A-Z\s]+$/.test(word.text);
        const isItalic = word.confidence > 85 && word.text.includes('italic') || word.fontName?.toLowerCase().includes('italic');
        
        runs.push({
          id: crypto.randomUUID(),
          text: word.text.trim(),
          box: {
            x: word.bbox.x0,
            y: viewport.height - word.bbox.y1, // Flip Y coordinate
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0,
          },
          fontSize: Math.max(8, word.bbox.y1 - word.bbox.y0),
          fontFamily: 'OCR detected font',
          confidence: Math.round(word.confidence || 80),
          language: 'unknown', // Will be set later
          bold: isBold,
          italic: isItalic,
        });
      }
    }
  }
  
  return runs;
}

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

async function runTesseract(dataUrl: string, settings: ConverterSettings, autoDetectLang: boolean = false) {
  const { createWorker } = await import('tesseract.js');
  let languages = settings.languages;
  
  if (autoDetectLang) {
    // First run with common languages to detect
    const worker = await createWorker('eng+msa+chi_sim+ara+jpn');
    const result = await worker.recognize(dataUrl);
    const detectedLangs = detectLanguages(result.data.text);
    await worker.terminate();
    
    if (detectedLangs.length > 0) {
      languages = detectedLangs as any;
    }
  }
  
  const worker = await createWorker(toTesseractLanguage(languages));
  
  // Note: Using default high-accuracy settings for Tesseract
  
  const result = await worker.recognize(dataUrl, {
    rectangle: undefined, // Full page
  });
  
  await worker.terminate();
  return { ...result.data, detectedLanguages: languages };
}

export async function analyzeDocument(
  file: File,
  settings: ConverterSettings,
  onProgress: ProgressHandler,
) {
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF files are supported in this converter.');
  }

  // Try backend OCR first (advanced multi-engine support)
  try {
    const backendAvailable = await backendOCR.checkAvailability();
    
    if (backendAvailable && settings.quality === 'maximum') {
      onProgress({ 
        stage: 'uploading', 
        page: 0, 
        totalPages: 0, 
        percent: 4, 
        message: 'Using backend OCR service for enhanced accuracy' 
      });
      
      try {
        return await backendOCR.convertPDF(file, settings, onProgress);
      } catch (backendError) {
        console.warn('Backend OCR failed, falling back to browser OCR:', backendError);
        onProgress({ 
          stage: 'uploading', 
          page: 0, 
          totalPages: 0, 
          percent: 4, 
          message: 'Falling back to browser-based OCR' 
        });
      }
    }
  } catch (error) {
    console.warn('Backend availability check failed:', error);
  }

  // Browser-based OCR (fallback or when backend not available)
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
    let detectedLanguages = settings.languages;

    // Always run OCR for scanned documents or when quality is maximum
    const shouldRunOCR = isScannedDocument(textRuns, viewport.width, viewport.height) || 
                        settings.quality === 'maximum' || 
                        settings.aiEnhancement;

    if (shouldRunOCR) {
      onProgress({
        stage: 'ocr-processing',
        page: pageNumber,
        totalPages: pdf.numPages,
        percent: Math.round(52 + (pageNumber / pdf.numPages) * 18),
        message: `Running high-accuracy OCR on page ${pageNumber}`,
      });
      
      const ocrResult = await runTesseract(canvas.toDataURL('image/png'), settings, true);
      const ocrText = ocrResult.text.trim();
      detectedLanguages = ocrResult.detectedLanguages;
      
      if (ocrText) {
        // Parse OCR result to get individual text runs with better positioning
        const ocrRuns = parseOcrResult(ocrResult, viewport).map(run => ({
          ...run,
          language: detectedLanguages[0] as any || 'eng',
        }));
        finalRuns = isScannedDocument(textRuns, viewport.width, viewport.height) ? ocrRuns : [...textRuns, ...ocrRuns];
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
