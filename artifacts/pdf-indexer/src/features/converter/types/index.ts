export type ConverterLanguage =
  | 'eng'
  | 'msa'
  | 'chi_sim'
  | 'ara'
  | 'jpn'
  | 'mixed';

export type ConverterOutputFormat = 'docx' | 'xlsx' | 'pptx' | 'txt' | 'html' | 'json';

export type ConverterQuality = 'fast' | 'balanced' | 'maximum';

export type ConverterStage =
  | 'idle'
  | 'uploading'
  | 'ocr-processing'
  | 'layout-reconstruction'
  | 'export-rendering'
  | 'completed'
  | 'failed';

export interface ConverterSettings {
  languages: ConverterLanguage[];
  outputFormat: ConverterOutputFormat;
  quality: ConverterQuality;
  aiEnhancement: boolean;
  preserveImages: boolean;
  preserveTables: boolean;
  editablePreview: boolean;
  password: string;
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrTextRun {
  id: string;
  text: string;
  box: LayoutBox;
  fontSize: number;
  fontFamily: string;
  confidence: number;
  language: ConverterLanguage | 'unknown';
  bold?: boolean;
  italic?: boolean;
}

export interface OcrTableCell {
  text: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  confidence: number;
  box: LayoutBox;
}

export interface OcrTable {
  id: string;
  box: LayoutBox;
  cells: OcrTableCell[];
  rowCount: number;
  columnCount: number;
  confidence: number;
}

export interface OcrImageObject {
  id: string;
  dataUrl: string;
  box: LayoutBox;
  alt: string;
}

export interface OcrPage {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  thumbnail: string;
  textRuns: OcrTextRun[];
  tables: OcrTable[];
  images: OcrImageObject[];
  confidence: number;
  plainText: string;
}

export interface ConverterLayoutSchema {
  id: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  settings: ConverterSettings;
  pages: OcrPage[];
  metadata: {
    pageCount: number;
    averageConfidence: number;
    detectedLanguages: string[];
    hasTables: boolean;
    hasImages: boolean;
    warnings: string[];
  };
}

export interface ConverterProgress {
  stage: ConverterStage;
  page: number;
  totalPages: number;
  percent: number;
  message: string;
}

export interface ConverterExport {
  blob: Blob;
  fileName: string;
  mimeType: string;
}
