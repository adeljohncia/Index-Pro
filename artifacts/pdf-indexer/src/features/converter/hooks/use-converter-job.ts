import { useCallback, useMemo, useState } from 'react';
import {
  ConverterLayoutSchema,
  ConverterProgress,
  ConverterSettings,
  ConverterStage,
} from '../types';
import { analyzeDocument } from '../services/ocr-service';

const initialProgress: ConverterProgress = {
  stage: 'idle',
  page: 0,
  totalPages: 0,
  percent: 0,
  message: 'Ready',
};

export function useConverterJob(settings: ConverterSettings) {
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<ConverterLayoutSchema | null>(null);
  const [progress, setProgress] = useState<ConverterProgress>(initialProgress);
  const [error, setError] = useState<string | null>(null);

  const stage: ConverterStage = progress.stage;
  const isRunning = ['uploading', 'ocr-processing', 'layout-reconstruction', 'export-rendering'].includes(stage);

  const reset = useCallback(() => {
    setFile(null);
    setLayout(null);
    setProgress(initialProgress);
    setError(null);
  }, []);

  const run = useCallback(async (nextFile?: File) => {
    const targetFile = nextFile ?? file;
    if (!targetFile) return null;

    setFile(targetFile);
    setLayout(null);
    setError(null);

    try {
      const result = await analyzeDocument(targetFile, settings, setProgress);
      setLayout(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Conversion failed';
      setError(message);
      setProgress({
        stage: 'failed',
        page: 0,
        totalPages: 0,
        percent: 0,
        message,
      });
      return null;
    }
  }, [file, settings]);

  return useMemo(() => ({
    file,
    setFile,
    layout,
    progress,
    error,
    isRunning,
    reset,
    run,
  }), [error, file, isRunning, layout, progress, reset, run]);
}
