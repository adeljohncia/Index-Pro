import * as pdfjsLib from 'pdfjs-dist';
import { OcrTextRun } from '../types';
import BackendOCRService from './backend-ocr-service';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).href;

/**
 * Represents a detected index code in a document
 */
export interface IndexCode {
  code: string;
  page: number;
  position: 'top-left' | 'top-right' | 'center' | 'unknown';
  confidence: number;
  raw: string; // The matched string including angle brackets
}

/**
 * Represents a hierarchical structure of index codes
 */
export interface TocEntry {
  code: string;
  page: number;
  level: number; // 0 for main (A1), 1 for sub (A1-1), etc.
  children?: TocEntry[];
  position: 'top-left' | 'top-right' | 'center' | 'unknown';
  confidence: number;
}

/**
 * Output structure for the table of contents
 */
export interface TableOfContents {
  entries: TocEntry[];
  totalPages: number;
  detectedCodes: string[];
  scannedDocument: boolean;
  processingMethod: 'native' | 'ocr' | 'backend';
}

/**
 * Detects index code patterns like <A1>, <A1-1>, <A2>, etc.
 * Patterns supported:
 *   - Main index: <A1>, <A2>, <B1>, etc.
 *   - Sub-index: <A1-1>, <A1-2>, <A2-1>, etc.
 *   - Deep nesting: <A1-1-1> (if needed)
 */
function detectIndexPatterns(text: string): string[] {
  const pattern = /<([A-Z]\d+(?:-\d+)*?)>/g;
  const matches: string[] = [];
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    matches.push(match[1]);
  }
  
  return matches;
}

/**
 * Extract text from a PDF page using native PDF.js
 */
async function extractNativePageText(
  page: pdfjsLib.PDFPageProxy,
): Promise<OcrTextRun[]> {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  
  const runs: OcrTextRun[] = [];
  let itemIndex = 0;
  
  for (const item of textContent.items) {
    if ('str' in item) {
      const text = item.str.trim();
      if (text) {
        runs.push({
          id: `native-${itemIndex}`,
          text,
          box: {
            x: item.x || 0,
            y: viewport.height - (item.y || 0),
            width: item.width || text.length * 5,
            height: item.height || 12,
          },
          fontSize: Math.max(8, Math.round(item.height || 12)),
          fontFamily: 'PDF native',
          confidence: 95,
          language: 'unknown',
        });
        itemIndex++;
      }
    }
  }
  
  return runs;
}

/**
 * Determine if a document is scanned (low text density)
 */
function isScannedDocument(textRuns: OcrTextRun[], pageWidth: number, pageHeight: number): boolean {
  if (textRuns.length === 0) return true;
  if (textRuns.length < 5) return true; // Very few text items likely means scanned
  
  const totalTextLength = textRuns.reduce((sum, run) => sum + run.text.length, 0);
  const pageArea = pageWidth * pageHeight;
  const textDensity = totalTextLength / pageArea;
  
  // Low text density suggests scanned document
  return textDensity < 0.001;
}

/**
 * Detect position of text in page (top-left, top-right, center)
 */
function detectPosition(
  textBox: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
): 'top-left' | 'top-right' | 'center' | 'unknown' {
  const topThreshold = pageHeight * 0.2; // Top 20% of page
  const leftThreshold = pageWidth * 0.4; // Left 40%
  const rightThreshold = pageWidth * 0.6; // Right 60%
  
  if (textBox.y > topThreshold) {
    return 'center';
  }
  
  if (textBox.x < leftThreshold) {
    return 'top-left';
  }
  
  if (textBox.x > rightThreshold) {
    return 'top-right';
  }
  
  return 'unknown';
}

/**
 * Extract index codes from page texts with positions
 */
function extractIndexCodesFromTexts(
  textRuns: OcrTextRun[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
): IndexCode[] {
  const indexCodes: IndexCode[] = [];
  
  for (const run of textRuns) {
    const patterns = detectIndexPatterns(run.text);
    
    for (const code of patterns) {
      indexCodes.push({
        code,
        page: pageNumber,
        position: detectPosition(run.box, pageWidth, pageHeight),
        confidence: run.confidence || 80,
        raw: `<${code}>`,
      });
    }
  }
  
  return indexCodes;
}

/**
 * Parse index code to determine hierarchy level
 * A1 = level 0
 * A1-1 = level 1
 * A1-1-1 = level 2, etc.
 */
function getIndexLevel(code: string): number {
  const parts = code.split('-');
  return parts.length - 1;
}

/**
 * Parse parent index code from a sub-index
 * A1-1 -> A1
 * A1-1-1 -> A1-1
 */
function getParentIndex(code: string): string | null {
  const parts = code.split('-');
  if (parts.length <= 1) return null;
  parts.pop();
  return parts.join('-');
}

/**
 * Build hierarchical TOC structure
 */
function buildHierarchy(indexCodes: IndexCode[]): TocEntry[] {
  // Remove duplicates, keeping first occurrence
  const uniqueCodes = new Map<string, IndexCode>();
  
  for (const code of indexCodes) {
    const key = `${code.code}-${code.page}`;
    if (!uniqueCodes.has(key)) {
      uniqueCodes.set(key, code);
    }
  }
  
  const codeArray = Array.from(uniqueCodes.values());
  const entries: TocEntry[] = [];
  const entryMap = new Map<string, TocEntry>();
  
  // Create entries and build hierarchy
  for (const code of codeArray) {
    const entry: TocEntry = {
      code: code.code,
      page: code.page,
      level: getIndexLevel(code.code),
      position: code.position,
      confidence: code.confidence,
      children: [],
    };
    
    entryMap.set(code.code, entry);
    
    // If it's a main level (no parent), add to root entries
    const parent = getParentIndex(code.code);
    if (!parent) {
      entries.push(entry);
    }
  }
  
  // Assign children to parents
  for (const code of codeArray) {
    const parent = getParentIndex(code.code);
    if (parent && entryMap.has(parent)) {
      const parentEntry = entryMap.get(parent)!;
      const childEntry = entryMap.get(code.code)!;
      
      if (!parentEntry.children) {
        parentEntry.children = [];
      }
      
      parentEntry.children.push(childEntry);
    }
  }
  
  // Sort entries and children by code
  const sortEntries = (entries: TocEntry[]) => {
    entries.sort((a, b) => {
      const aParts = a.code.split('-').map(p => {
        const match = p.match(/([A-Z])(\d+)/);
        return match ? `${match[1]}${parseInt(match[2]).toString().padStart(3, '0')}` : p;
      }).join('-');
      
      const bParts = b.code.split('-').map(p => {
        const match = p.match(/([A-Z])(\d+)/);
        return match ? `${match[1]}${parseInt(match[2]).toString().padStart(3, '0')}` : p;
      }).join('-');
      
      return aParts.localeCompare(bParts);
    });
    
    for (const entry of entries) {
      if (entry.children && entry.children.length > 0) {
        sortEntries(entry.children);
      }
    }
  };
  
  sortEntries(entries);
  
  return entries;
}

/**
 * Main function to generate Table of Contents
 * Supports both native PDFs and scanned PDFs (with OCR)
 */
export async function generateTableOfContents(
  file: File,
  useBackendOCR: boolean = true,
  onProgress?: (progress: { page: number; totalPages: number; status: string }) => void,
): Promise<TableOfContents> {
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF files are supported');
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const totalPages = pdf.numPages;
  
  let allIndexCodes: IndexCode[] = [];
  let processingMethod: 'native' | 'ocr' | 'backend' = 'native';
  let isScanned = false;
  
  // Initialize backend OCR if needed
  const backendOCR = useBackendOCR
    ? new BackendOCRService(import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000')
    : null;
  
  // Check if backend OCR is available
  let useBackend = false;
  if (backendOCR) {
    try {
      useBackend = await backendOCR.checkAvailability();
    } catch {
      useBackend = false;
    }
  }
  
  // Process each page
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    
    onProgress?.({
      page: pageNum,
      totalPages,
      status: 'Detecting index codes...',
    });
    
    // First, try native PDF text extraction
    const nativeTexts = await extractNativePageText(page);
    
    // Check if this is a scanned document
    if (pageNum === 1 && nativeTexts.length > 0) {
      isScanned = isScannedDocument(nativeTexts, viewport.width, viewport.height);
    }
    
    // Extract index codes from native text
    let pageIndexCodes = extractIndexCodesFromTexts(
      nativeTexts,
      pageNum,
      viewport.width,
      viewport.height,
    );
    
    // If document is scanned or no codes found, try OCR
    if (isScanned || pageIndexCodes.length === 0) {
      processingMethod = useBackend ? 'backend' : 'ocr';
      
      // Render page to image for OCR
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      
      const context = canvas.getContext('2d');
      if (context) {
        await page.render({
          canvasContext: context,
          viewport,
          canvas,
        }).promise;
        
        const imageData = canvas.toDataURL('image/png');
        
        // Use OCR to extract text
        let ocrTexts: OcrTextRun[] = [];
        
        if (useBackend && backendOCR) {
          try {
            // Use backend OCR service
            const response = await backendOCR.ocrImage(imageData, ['eng']);
            
            // Convert backend response to OcrTextRun format
            if (response.text) {
              ocrTexts = [{
                id: `ocr-page-${pageNum}`,
                text: response.text,
                box: { x: 0, y: 0, width: viewport.width, height: viewport.height },
                fontSize: 12,
                fontFamily: 'OCR',
                confidence: response.confidence || 80,
                language: response.language || 'unknown',
              }];
            }
          } catch (error) {
            console.warn('Backend OCR failed, falling back to native:', error);
          }
        } else {
          // Use browser-based Tesseract OCR
          try {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker('eng+msa+chi_sim');
            
            const result = await worker.recognize(imageData);
            
            if (result.data.text) {
              ocrTexts = [{
                id: `ocr-page-${pageNum}`,
                text: result.data.text,
                box: { x: 0, y: 0, width: viewport.width, height: viewport.height },
                fontSize: 12,
                fontFamily: 'Tesseract OCR',
                confidence: Math.round((result.data.confidence || 0) / 100),
                language: 'unknown',
              }];
            }
            
            await worker.terminate();
          } catch (error) {
            console.warn('Tesseract OCR failed:', error);
          }
        }
        
        // Extract codes from OCR results
        const ocrCodes = extractIndexCodesFromTexts(
          ocrTexts,
          pageNum,
          viewport.width,
          viewport.height,
        );
        
        pageIndexCodes = [...pageIndexCodes, ...ocrCodes];
      }
    }
    
    allIndexCodes = [...allIndexCodes, ...pageIndexCodes];
  }
  
  // Build hierarchical structure
  const entries = buildHierarchy(allIndexCodes);
  
  // Extract unique detected codes
  const detectedCodes = Array.from(
    new Set(allIndexCodes.map(c => c.code))
  ).sort();
  
  return {
    entries,
    totalPages,
    detectedCodes,
    scannedDocument: isScanned,
    processingMethod,
  };
}

/**
 * Format TOC as markdown-style text
 */
export function formatTocAsText(toc: TableOfContents): string {
  let output = '# Table of Contents\n\n';
  
  if (toc.scannedDocument) {
    output += '*[Scanned Document - OCR Processing Applied]*\n\n';
  }
  
  output += `**Total Pages:** ${toc.totalPages}\n`;
  output += `**Processing Method:** ${toc.processingMethod}\n`;
  output += `**Detected Codes:** ${toc.detectedCodes.length}\n\n`;
  output += '---\n\n';
  
  const formatEntry = (entry: TocEntry, depth: number = 0): string => {
    const indent = '  '.repeat(depth);
    const bullet = depth === 0 ? '• ' : '◦ ';
    let result = `${indent}${bullet}**${entry.code}** — Page ${entry.page}\n`;
    
    if (entry.children && entry.children.length > 0) {
      for (const child of entry.children) {
        result += formatEntry(child, depth + 1);
      }
    }
    
    return result;
  };
  
  for (const entry of toc.entries) {
    output += formatEntry(entry);
  }
  
  return output;
}

/**
 * Format TOC as JSON
 */
export function formatTocAsJson(toc: TableOfContents): string {
  return JSON.stringify(toc, null, 2);
}
