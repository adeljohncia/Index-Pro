import {
  ConverterLayoutSchema,
  ConverterSettings,
  LayoutBox,
  OcrPage,
  OcrTable,
  OcrTextRun,
} from '../types';

function overlap(a: LayoutBox, b: LayoutBox) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  return Math.max(0, right - left);
}

function detectColumns(textRuns: OcrTextRun[], pageWidth: number): number[] {
  const sortedRuns = [...textRuns].sort((a, b) => a.box.x - b.box.x);
  const columnBreaks: number[] = [];
  
  for (let i = 0; i < sortedRuns.length - 1; i++) {
    const current = sortedRuns[i];
    const next = sortedRuns[i + 1];
    const gap = next.box.x - (current.box.x + current.box.width);
    
    // If gap is significant (more than 2 inches at typical DPI), it's a column break
    if (gap > 144) { // 2 inches at 72 DPI
      columnBreaks.push(current.box.x + current.box.width + gap / 2);
    }
  }
  
  return [0, ...columnBreaks, pageWidth];
}

function groupIntoColumns(textRuns: OcrTextRun[], columns: number[]): OcrTextRun[][] {
  const columnGroups: OcrTextRun[][] = columns.slice(0, -1).map(() => []);
  
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

function groupRows(runs: OcrTextRun[]) {
  const sorted = [...runs].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows: OcrTextRun[][] = [];
  for (const run of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate[0].box.y - run.box.y) < Math.max(8, run.fontSize * 0.8));
    if (row) row.push(run);
    else rows.push([run]);
  }
  return rows.map((row) => row.sort((a, b) => a.box.x - b.box.x));
}

export function detectTables(textRuns: OcrTextRun[]): OcrTable[] {
  const rows = groupRows(textRuns).filter((row) => row.length >= 2);
  if (rows.length < 2) return [];

  const candidateRows = rows.filter((row, index) => {
    const next = rows[index + 1];
    if (!next) return false;
    const sharedColumns = row.filter((cell) => next.some((nextCell) => overlap(cell.box, nextCell.box) > 4)).length;
    return sharedColumns >= Math.min(2, row.length);
  });

  if (candidateRows.length < 2) return [];

  const xStops = [...new Set(candidateRows.flatMap((row) => row.map((run) => Math.round(run.box.x / 20) * 20)))].sort((a, b) => a - b);
  const cells = candidateRows.flatMap((row, rowIndex) =>
    row.map((run) => {
      const column = Math.max(0, xStops.findIndex((x) => Math.abs(x - run.box.x) < 24));
      return {
        text: run.text,
        row: rowIndex,
        column,
        rowSpan: 1,
        colSpan: 1,
        confidence: run.confidence,
        box: run.box,
      };
    }),
  );

  const minX = Math.min(...cells.map((cell) => cell.box.x));
  const minY = Math.min(...cells.map((cell) => cell.box.y));
  const maxX = Math.max(...cells.map((cell) => cell.box.x + cell.box.width));
  const maxY = Math.max(...cells.map((cell) => cell.box.y + cell.box.height));

  return [
    {
      id: 'table-1',
      box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      cells,
      rowCount: candidateRows.length,
      columnCount: Math.max(1, xStops.length),
      confidence: Math.round(cells.reduce((sum, cell) => sum + cell.confidence, 0) / cells.length),
    },
  ];
}

export function reconstructLayout(
  file: File,
  pages: OcrPage[],
  settings: ConverterSettings,
): ConverterLayoutSchema {
  const enrichedPages = pages.map((page) => {
    const tables = settings.preserveTables ? detectTables(page.textRuns) : [];
    
    // Detect columns for better layout preservation
    const columns = detectColumns(page.textRuns, page.width);
    const columnGroups = groupIntoColumns(page.textRuns, columns);
    
    // Sort text runs by reading order (top to bottom, left to right within columns)
    const sortedTextRuns = columnGroups.flatMap(group => 
      groupRows(group).flat()
    );
    
    return { 
      ...page, 
      textRuns: sortedTextRuns,
      tables,
      columns: columns.length > 2 ? columns : undefined, // Only include if multi-column
    };
  });

  const confidences = enrichedPages.flatMap((page) => page.textRuns.map((run) => run.confidence));
  const averageConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length)
    : 0;

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    fileSize: file.size,
    createdAt: new Date().toISOString(),
    settings,
    pages: enrichedPages,
    metadata: {
      pageCount: enrichedPages.length,
      averageConfidence,
      detectedLanguages: settings.languages,
      hasTables: enrichedPages.some((page) => page.tables.length > 0),
      hasImages: enrichedPages.some((page) => page.images.length > 0),
      hasColumns: enrichedPages.some((page) => page.columns && page.columns.length > 2),
      warnings: [
        'Browser mode preserves editable text, page flow, tables, and page thumbnails. Cloud OCR backends can be connected through src/features/converter/api for higher fidelity.',
      ],
    },
  };
}
