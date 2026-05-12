import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Download,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  ImageIcon,
  Languages,
  Loader2,
  Lock,
  Presentation,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ConverterLanguage, ConverterOutputFormat, ConverterQuality } from '../types';
import { LANGUAGE_OPTIONS } from '../utils/language';
import { downloadBlob } from '../utils/xml';
import { DEFAULT_CONVERTER_SETTINGS } from '../store/converter-defaults';
import { useConverterJob } from '../hooks/use-converter-job';
import { exportConvertedDocument } from '../services/export-service';

const FORMAT_OPTIONS: Array<{ value: ConverterOutputFormat; label: string; icon: React.ElementType }> = [
  { value: 'docx', label: 'DOCX', icon: FileText },
  { value: 'xlsx', label: 'XLSX', icon: FileSpreadsheet },
  { value: 'pptx', label: 'PPTX', icon: Presentation },
  { value: 'txt', label: 'TXT', icon: FileType2 },
  { value: 'html', label: 'HTML', icon: FileArchive },
  { value: 'json', label: 'JSON', icon: FileJson },
];

const QUALITY_OPTIONS: Array<{ value: ConverterQuality; label: string }> = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'maximum', label: 'Maximum' },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function FieldLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <label className="label-caps flex items-center gap-1.5">
      <Icon className="w-3 h-3" />
      {children}
    </label>
  );
}

function NativeSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function ConverterPage() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(DEFAULT_CONVERTER_SETTINGS);
  const [isDragging, setIsDragging] = useState(false);
  const job = useConverterJob(settings);

  const selectedFormat = FORMAT_OPTIONS.find((format) => format.value === settings.outputFormat) ?? FORMAT_OPTIONS[0];
  const hasLayout = !!job.layout;
  const selectedLanguages = useMemo(() => new Set(settings.languages), [settings.languages]);

  const setLanguage = (language: ConverterLanguage) => {
    setSettings((current) => {
      if (language === 'mixed') return { ...current, languages: ['mixed'] };
      const next = new Set(current.languages.filter((item) => item !== 'mixed'));
      if (next.has(language)) next.delete(language);
      else next.add(language);
      return { ...current, languages: next.size ? [...next] : ['eng'] };
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    const file = Array.from(files).find((item) => item.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'));
    if (!file) {
      toast({ title: 'PDF required', description: 'Upload a scanned, native, or mixed-content PDF.', variant: 'destructive' });
      return;
    }
    await job.run(file);
  };

  const exportFile = async (format = settings.outputFormat) => {
    if (!job.layout) return;
    try {
      const result = await exportConvertedDocument(job.layout, format);
      downloadBlob(result.blob, result.fileName);
      toast({ title: `${format.toUpperCase()} export ready`, description: result.fileName });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Unable to render export file.',
        variant: 'destructive',
      });
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
        <section className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
          <div className="space-y-4">
            <div
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleFiles(event.dataTransfer.files);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => inputRef.current?.click()}
              className={`min-h-[220px] rounded-lg border-2 border-dashed bg-card p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                isDragging ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-bold text-foreground">Smart OCR Document Converter</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-[280px]">
                Drop a PDF to reconstruct editable DOCX, XLSX, PPTX, TXT, HTML, or JSON layout output.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => event.target.files && handleFiles(event.target.files)}
              />
              <Button className="mt-5 gap-2" size="sm" disabled={job.isRunning}>
                <Upload className="w-4 h-4" />
                Choose PDF
              </Button>
            </div>

            {job.file && (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-primary mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{job.file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(job.file.size)}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              <div className="space-y-2">
                <FieldLabel icon={Languages}>OCR Languages</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGE_OPTIONS.map((language) => (
                    <button
                      key={language.value}
                      onClick={() => setLanguage(language.value)}
                      className={`h-9 rounded-md border px-2 text-xs font-semibold transition-colors ${
                        selectedLanguages.has(language.value)
                          ? 'border-primary bg-accent text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {language.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <FieldLabel icon={selectedFormat.icon}>Output</FieldLabel>
                  <NativeSelect
                    value={settings.outputFormat}
                    onChange={(outputFormat) => setSettings((current) => ({ ...current, outputFormat }))}
                    options={FORMAT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel icon={BrainCircuit}>Quality</FieldLabel>
                  <NativeSelect
                    value={settings.quality}
                    onChange={(quality) => setSettings((current) => ({ ...current, quality }))}
                    options={QUALITY_OPTIONS}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {[
                  ['AI OCR enhancement', 'aiEnhancement'],
                  ['Preserve page images', 'preserveImages'],
                  ['Detect editable tables', 'preserveTables'],
                  ['Editable preview mode', 'editablePreview'],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{label}</span>
                    <Switch
                      checked={Boolean(settings[key as keyof typeof settings])}
                      onCheckedChange={(checked) => setSettings((current) => ({ ...current, [key]: checked }))}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <FieldLabel icon={Lock}>PDF Password</FieldLabel>
                <Input
                  value={settings.password}
                  onChange={(event) => setSettings((current) => ({ ...current, password: event.target.value }))}
                  type="password"
                  placeholder="Optional unlock password"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card min-h-[640px] overflow-hidden flex flex-col">
            <div className="border-b border-border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Live OCR Preview</h3>
                <p className="text-xs text-muted-foreground">{job.progress.message}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" disabled={!job.file || job.isRunning} onClick={() => job.run()}>
                  {job.isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Reprocess
                </Button>
                <Button size="sm" className="gap-2" disabled={!hasLayout || job.isRunning} onClick={() => exportFile()}>
                  <Download className="w-4 h-4" />
                  Export {settings.outputFormat.toUpperCase()}
                </Button>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-border bg-muted/25">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-foreground capitalize">{job.progress.stage.replace(/-/g, ' ')}</span>
                <span className="text-muted-foreground">{job.progress.percent}%</span>
              </div>
              <Progress value={job.progress.percent} />
            </div>

            {job.error && (
              <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <span>{job.error}</span>
              </div>
            )}

            {!job.layout && !job.isRunning && !job.error && (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div>
                  <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-semibold text-foreground">No document processed yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Upload a PDF to generate a structured layout schema with editable text runs, table candidates, page images, and confidence scores.
                  </p>
                </div>
              </div>
            )}

            {job.isRunning && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-3" />
                  <p className="text-sm font-semibold text-foreground">{job.progress.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Page {job.progress.page || 1} of {job.progress.totalPages || '?'}
                  </p>
                </div>
              </div>
            )}

            {job.layout && (
              <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[220px_1fr]">
                <ScrollArea className="border-r border-border bg-muted/20">
                  <div className="p-3 space-y-3">
                    {job.layout.pages.map((page) => (
                      <div key={page.pageNumber} className="rounded-md border border-border bg-card overflow-hidden">
                        <img src={page.thumbnail} alt={`Page ${page.pageNumber}`} className="w-full block" />
                        <div className="p-2 flex items-center justify-between text-xs">
                          <span className="font-semibold">Page {page.pageNumber}</span>
                          <span className="text-muted-foreground">{page.confidence}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <ScrollArea>
                  <div className="p-5 space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        ['Pages', job.layout.metadata.pageCount],
                        ['Confidence', `${job.layout.metadata.averageConfidence}%`],
                        ['Tables', job.layout.pages.reduce((sum, page) => sum + page.tables.length, 0)],
                        ['Text runs', job.layout.pages.reduce((sum, page) => sum + page.textRuns.length, 0)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-md border border-border p-3">
                          <p className="label-caps">{label}</p>
                          <p className="text-lg font-bold text-foreground mt-1">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {FORMAT_OPTIONS.map(({ value, label, icon: Icon }) => (
                        <Button
                          key={value}
                          variant={value === settings.outputFormat ? 'default' : 'outline'}
                          size="sm"
                          className="gap-2 justify-start"
                          onClick={() => exportFile(value)}
                        >
                          <Icon className="w-4 h-4" />
                          Download {label}
                        </Button>
                      ))}
                    </div>

                    {job.layout.metadata.warnings.map((warning) => (
                      <div key={warning} className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                        <p className="text-xs text-muted-foreground">{warning}</p>
                      </div>
                    ))}

                    <div className="space-y-4">
                      {job.layout.pages.map((page) => (
                        <section key={page.pageNumber} className="rounded-lg border border-border p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <h4 className="text-sm font-bold">Page {page.pageNumber}</h4>
                            <span className="text-xs text-muted-foreground">{page.width.toFixed(0)} x {page.height.toFixed(0)} pt</span>
                          </div>
                          <div
                            contentEditable={settings.editablePreview}
                            suppressContentEditableWarning
                            className="min-h-24 rounded-md border border-border bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring whitespace-pre-wrap"
                          >
                            {page.plainText || page.textRuns.map((run) => run.text).join(' ')}
                          </div>
                          {page.tables.length > 0 && (
                            <div className="mt-4 overflow-auto">
                              <table className="w-full text-xs border-collapse">
                                <tbody>
                                  {Array.from({ length: page.tables[0].rowCount }, (_, rowIndex) => (
                                    <tr key={rowIndex}>
                                      {Array.from({ length: page.tables[0].columnCount }, (_, columnIndex) => {
                                        const cell = page.tables[0].cells.find((item) => item.row === rowIndex && item.column === columnIndex);
                                        return <td key={columnIndex} className="border border-border p-2">{cell?.text ?? ''}</td>;
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
