export interface OcrWorkerMessage {
  jobId: string;
  pageNumber: number;
  imageDataUrl: string;
  languages: string;
  quality: 'fast' | 'balanced' | 'maximum';
}

export interface OcrWorkerResult {
  jobId: string;
  pageNumber: number;
  text: string;
  confidence: number;
  durationMs: number;
}

export const OCR_WORKER_NOTES = [
  'Browser mode currently runs OCR on demand to keep GitHub Pages deployment static.',
  'The worker contract is stable for a future Web Worker or Python/FastAPI queue worker.',
  'Cloud mode should stream OcrWorkerResult events over WebSocket for progress updates.',
];
