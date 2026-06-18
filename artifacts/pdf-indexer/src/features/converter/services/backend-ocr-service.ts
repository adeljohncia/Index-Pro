import {
  ConverterProgress,
  ConverterSettings,
  OcrPage,
  ConverterLayoutSchema,
} from '../types';
import { getBackendUrl, OCR_CONFIG } from '../config/ocr-config';

type ProgressHandler = (progress: ConverterProgress) => void;

/**
 * Backend OCR Service
 * Communicates with Python FastAPI backend for advanced OCR
 */

class BackendOCRService {
  private baseUrl: string;
  private isAvailable: boolean = false;
  private timeout: number;

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = baseUrl || getBackendUrl();
    this.timeout = timeout || OCR_CONFIG.backendTimeout;
    this.checkAvailability();
  }

  /**
   * Check if backend is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      this.isAvailable = response.ok;
      return this.isAvailable;
    } catch (error) {
      console.warn('Backend OCR service not available:', error);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Run OCR on uploaded PDF
   */
  async convertPDF(
    file: File,
    settings: ConverterSettings,
    onProgress: ProgressHandler,
  ): Promise<ConverterLayoutSchema> {
    if (!this.isAvailable) {
      throw new Error('Backend OCR service not available. Falling back to browser OCR.');
    }

    try {
      onProgress({
        stage: 'uploading',
        page: 0,
        totalPages: 0,
        percent: 10,
        message: 'Uploading PDF to backend OCR service',
      });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('output_format', 'json');

      const response = await fetch(`${this.baseUrl}/api/convert`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      onProgress({
        stage: 'ocr-processing',
        page: 0,
        totalPages: 1,
        percent: 50,
        message: 'Processing PDF with advanced OCR engines',
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Conversion failed');
      }

      onProgress({
        stage: 'layout-reconstruction',
        page: 1,
        totalPages: 1,
        percent: 90,
        message: 'Reconstructing document layout',
      });

      onProgress({
        stage: 'completed',
        page: 1,
        totalPages: 1,
        percent: 100,
        message: 'Backend OCR processing complete',
      });

      // Download converted file
      const downloadUrl = `${this.baseUrl}${result.download_url}`;
      return await this.downloadConvertedFile(downloadUrl, file.name, settings);

    } catch (error) {
      console.error('Backend OCR conversion failed:', error);
      throw error;
    }
  }

  /**
   * Analyze image with OCR
   */
  async analyzeImage(file: File): Promise<any> {
    if (!this.isAvailable) {
      throw new Error('Backend OCR service not available');
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${this.baseUrl}/api/ocr/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Backend OCR analysis failed:', error);
      throw error;
    }
  }

  async ocrImage(imageDataUrl: string, languages: string[] = ['eng']): Promise<{ text: string; confidence?: number; language?: string }> {
    const blob = await (await fetch(imageDataUrl)).blob();
    const file = new File([blob], 'ocr-image.png', { type: blob.type });
    const result = await this.analyzeImage(file);

    return {
      text: result?.text || '',
      confidence: result?.confidence,
      language: result?.language || languages[0] || 'unknown',
    };
  }

  /**
   * Analyze page layout
   */
  async analyzeLayout(file: File): Promise<any> {
    if (!this.isAvailable) {
      throw new Error('Backend OCR service not available');
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${this.baseUrl}/api/analyze/layout`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Layout analysis failed:', error);
      throw error;
    }
  }

  /**
   * Download converted file
   */
  private async downloadConvertedFile(
    downloadUrl: string,
    originalFileName: string,
    settings: ConverterSettings,
  ): Promise<ConverterLayoutSchema> {
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error('Failed to download converted file');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${originalFileName.replace('.pdf', '')}.${settings.outputFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    // Return mock layout schema (actual data would come from backend)
    return {
      id: crypto.randomUUID(),
      fileName: originalFileName,
      fileSize: 0,
      createdAt: new Date().toISOString(),
      settings,
      pages: [],
      metadata: {
        pageCount: 1,
        averageConfidence: 95,
        detectedLanguages: settings.languages,
        hasTables: false,
        hasImages: false,
        hasColumns: false,
        warnings: ['Converted via backend OCR service'],
      },
    };
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<any> {
    if (!this.isAvailable) {
      throw new Error('Backend OCR service not available');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/status`);
      return await response.json();
    } catch (error) {
      console.error('Failed to get backend status:', error);
      throw error;
    }
  }

  /**
   * Convert batch of PDFs
   */
  async convertBatch(
    files: File[],
    outputFormat: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<string[]> {
    if (!this.isAvailable) {
      throw new Error('Backend OCR service not available');
    }

    try {
      const formData = new FormData();
      
      for (const file of files) {
        formData.append('files', file);
      }
      formData.append('output_format', outputFormat);

      const response = await fetch(`${this.baseUrl}/api/convert/batch`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Batch conversion failed');
      }

      return result.results.map((r: any) => r.output_file);
    } catch (error) {
      console.error('Batch conversion failed:', error);
      throw error;
    }
  }
}

export default BackendOCRService;
