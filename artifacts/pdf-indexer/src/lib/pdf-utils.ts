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

export interface RestartRule {
  id: string;
  atPage: number;
  newCode: string;
}

export interface IndexConfig {
  baseCode: string;
  autoIncrement: boolean;
  fromPage: number;
  untilPage: number;
  restartRules: RestartRule[];
}

// Calculate if a page is blank by drawing it to a canvas and checking pixel variance
export async function analyzePdfPages(file: File): Promise<PageAnalysis[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const analysis: PageAnalysis[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 0.2; // Low res for faster processing
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!context) continue;
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    // Calculate std dev of grayscale values
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    
    for (let j = 0; j < data.length; j += 4) {
      // Ignore near-white pixels to speed up, or just process all
      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];
      const a = data[j + 3];
      
      // Grayscale
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      sum += gray;
      sumSq += gray * gray;
      count++;
    }
    
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    const stdDev = Math.sqrt(variance);
    
    // Threshold for "blank" is subjective. 
    // Typical scanned blank pages might have some noise.
    // Pure white = stdDev 0. Noise might push it to 2-10.
    const isBlank = stdDev < 5;
    
    analysis.push({
      pageNumber: i,
      isBlank,
      assignedIndex: null, // Will be computed later
    });
  }
  
  return analysis;
}

export function computeAssignedIndices(
  pages: PageAnalysis[],
  config: IndexConfig
): PageAnalysis[] {
  let currentIndexNumber = extractNumber(config.baseCode);
  let currentPrefix = extractPrefix(config.baseCode);
  let currentSuffix = extractSuffix(config.baseCode);
  
  const sortedRules = [...config.restartRules].sort((a, b) => a.atPage - b.atPage);
  
  return pages.map((page) => {
    const isWithinRange = page.pageNumber >= config.fromPage && page.pageNumber <= config.untilPage;
    
    if (!isWithinRange || page.isBlank) {
      return { ...page, assignedIndex: null };
    }
    
    // Check for restart rule
    const rule = sortedRules.find((r) => r.atPage === page.pageNumber);
    if (rule) {
      currentIndexNumber = extractNumber(rule.newCode);
      currentPrefix = extractPrefix(rule.newCode);
      currentSuffix = extractSuffix(rule.newCode);
    }
    
    const assignedIndex = `<${currentPrefix}${currentIndexNumber}${currentSuffix}>`;
    
    if (config.autoIncrement) {
      currentIndexNumber++;
    }
    
    return { ...page, assignedIndex };
  });
}

function extractNumber(code: string): number {
  const match = code.match(/<.*?(\d+).*?>/);
  if (match) return parseInt(match[1], 10);
  return 1;
}

function extractPrefix(code: string): string {
  const match = code.match(/<(.*?)(\d+)/);
  if (match) return match[1];
  
  // If no number, return everything inside <>
  const allMatch = code.match(/<(.*?)>/);
  return allMatch ? allMatch[1] : code;
}

function extractSuffix(code: string): string {
  const match = code.match(/<.*?\d+(.*?)>/);
  if (match) return match[1];
  return '';
}

export async function processPdfWithIndices(
  file: File,
  pages: PageAnalysis[]
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 16;
  const marginPt = 28.35; // 1cm
  
  const pdfPages = pdfDoc.getPages();
  
  for (const page of pages) {
    if (!page.assignedIndex) continue;
    
    const pdfPage = pdfPages[page.pageNumber - 1];
    if (!pdfPage) continue;
    
    const { width, height } = pdfPage.getSize();
    const textWidth = helveticaFont.widthOfTextAtSize(page.assignedIndex, fontSize);
    
    const isOdd = page.pageNumber % 2 !== 0;
    
    const x = isOdd ? marginPt : width - marginPt - textWidth;
    const y = height - marginPt - fontSize; // top margin
    
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
        body {
          margin: 0;
          padding: 0;
          font-family: Arial, sans-serif;
          background: #f0f0f0;
        }
        @page {
          size: A4;
          margin: 0;
        }
        .page {
          width: 210mm;
          height: 297mm;
          background: white;
          margin: 0 auto;
          position: relative;
          page-break-after: always;
          box-sizing: border-box;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        @media print {
          body { background: white; }
          .page { box-shadow: none; margin: 0; }
          .no-print { display: none; }
        }
        .stamp {
          position: absolute;
          font-size: 16pt;
          top: 10mm;
        }
        .odd .stamp {
          left: 10mm;
        }
        .even .stamp {
          right: 10mm;
        }
        .header {
          position: absolute;
          top: 5mm;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10pt;
          color: #999;
          font-family: monospace;
        }
        .toolbar {
          padding: 20px;
          text-align: center;
          background: #333;
          color: white;
        }
        button {
          padding: 10px 20px;
          font-size: 16px;
          cursor: pointer;
          background: #0066cc;
          color: white;
          border: none;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <div class="toolbar no-print">
        <button onclick="window.print()">Print Template</button>
      </div>`
  ];
  
  for (const page of pages) {
    if (!page.assignedIndex) continue;
    
    const isOdd = page.pageNumber % 2 !== 0;
    const pageClass = isOdd ? 'odd' : 'even';
    
    htmlParts.push(`
      <div class="page ${pageClass}">
        <div class="header no-print">Page ${page.pageNumber}</div>
        <div class="stamp">${page.assignedIndex.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      </div>
    `);
  }
  
  htmlParts.push(`
    <script>
      window.onload = () => {
        // Auto-print option could be enabled here
      };
    </script>
    </body>
    </html>
  `);
  
  return htmlParts.join('\n');
}
