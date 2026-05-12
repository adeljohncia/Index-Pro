import { ConverterSettings } from '../types';

export const DEFAULT_CONVERTER_SETTINGS: ConverterSettings = {
  languages: ['eng'],
  outputFormat: 'docx',
  quality: 'balanced',
  aiEnhancement: false,
  preserveImages: true,
  preserveTables: true,
  editablePreview: true,
  password: '',
};
