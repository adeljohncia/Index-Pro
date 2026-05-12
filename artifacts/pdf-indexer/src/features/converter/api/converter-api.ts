import { ConverterOutputFormat, ConverterSettings } from '../types';

export const CONVERTER_API_ENDPOINTS = {
  upload: '/api/converter/upload',
  ocr: '/api/converter/ocr',
  exportDocx: '/api/converter/export/docx',
  exportXlsx: '/api/converter/export/xlsx',
  exportPptx: '/api/converter/export/pptx',
  status: (jobId: string) => `/api/converter/status/${jobId}`,
  download: (jobId: string) => `/api/converter/download/${jobId}`,
};

export interface ConverterJobRequest {
  fileName: string;
  settings: ConverterSettings;
  outputFormat: ConverterOutputFormat;
}

export interface ConverterJobResponse {
  jobId: string;
  statusUrl: string;
  downloadUrl: string;
}

export async function createCloudConverterJob(
  request: ConverterJobRequest,
): Promise<ConverterJobResponse> {
  throw new Error(
    `Cloud converter API is not connected yet. Planned upload endpoint: ${CONVERTER_API_ENDPOINTS.upload} for ${request.fileName}.`,
  );
}
