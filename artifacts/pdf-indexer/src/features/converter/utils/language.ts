import { ConverterLanguage } from '../types';

export const LANGUAGE_OPTIONS: Array<{ value: ConverterLanguage; label: string; tesseract: string }> = [
  { value: 'eng', label: 'English', tesseract: 'eng' },
  { value: 'msa', label: 'Malay', tesseract: 'msa' },
  { value: 'chi_sim', label: 'Chinese', tesseract: 'chi_sim' },
  { value: 'ara', label: 'Arabic', tesseract: 'ara' },
  { value: 'jpn', label: 'Japanese', tesseract: 'jpn' },
  { value: 'mixed', label: 'Mixed language', tesseract: 'eng+msa+chi_sim+ara+jpn' },
];

export function toTesseractLanguage(languages: ConverterLanguage[]) {
  const selected = languages.length ? languages : ['eng'];
  if (selected.includes('mixed')) return 'eng+msa+chi_sim+ara+jpn';
  return selected
    .map((language) => LANGUAGE_OPTIONS.find((option) => option.value === language)?.tesseract ?? 'eng')
    .join('+');
}
