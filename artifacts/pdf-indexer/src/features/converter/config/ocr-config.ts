/**
 * OCR Service Configuration
 * Controls whether to use backend OCR service or browser-based fallback
 */

export interface OCRConfig {
  // Backend service configuration
  backendEnabled: boolean;
  backendUrl: string;
  backendTimeout: number; // ms

  // Browser OCR configuration
  browserOCREnabled: boolean;
  defaultLanguages: string[];
  
  // Quality settings
  defaultQuality: 'fast' | 'balanced' | 'maximum';
  autoUpscaling: boolean;
  
  // Feature flags
  enableMultiLanguageDetection: boolean;
  enableLayoutAnalysis: boolean;
  enableTableDetection: boolean;
  enableSpellCorrection: boolean;
}

export const OCR_CONFIG: OCRConfig = {
  // Backend service
  backendEnabled: true, // Set to false to disable backend OCR
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
  backendTimeout: 60000,

  // Browser OCR
  browserOCREnabled: true, // Always enabled for fallback
  defaultLanguages: ['eng'],
  
  // Quality
  defaultQuality: 'balanced',
  autoUpscaling: true,
  
  // Features
  enableMultiLanguageDetection: true,
  enableLayoutAnalysis: true,
  enableTableDetection: true,
  enableSpellCorrection: true,
};

/**
 * Get active OCR configuration
 */
export function getOCRConfig(): OCRConfig {
  return {
    ...OCR_CONFIG,
    backendUrl: import.meta.env.VITE_BACKEND_URL || OCR_CONFIG.backendUrl,
  };
}

/**
 * Check if backend OCR should be used
 */
export function shouldUseBackendOCR(quality: string = 'balanced'): boolean {
  const config = getOCRConfig();
  return config.backendEnabled && quality === 'maximum';
}

/**
 * Get backend URL with validation
 */
export function getBackendUrl(): string {
  const config = getOCRConfig();
  
  if (!config.backendUrl) {
    throw new Error('Backend URL not configured');
  }
  
  // Ensure URL doesn't end with /
  return config.backendUrl.replace(/\/$/, '');
}
