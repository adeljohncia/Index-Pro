import React, { useState, useRef, useCallback } from 'react';
import {
  Upload, Download, FileText, Loader2, AlertCircle, Check,
  ChevronDown, ChevronRight, Copy, FileJson, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import {
  generateTableOfContents,
  formatTocAsText,
  formatTocAsJson,
  TableOfContents,
  TocEntry,
} from '@/features/converter/services/toc-service';

type ViewMode = 'hierarchical' | 'text' | 'json';

function uid() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Hierarchical TOC Entry Component
 */
function TocEntryComponent({
  entry,
  onCopyCode,
}: {
  entry: TocEntry;
  onCopyCode?: (code: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = entry.children && entry.children.length > 0;
  const indentClass = 'ml-' + (entry.level * 4);

  return (
    <div className={`border-l border-border pl-${entry.level > 0 ? '4' : '0'}`}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted transition-colors group">
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        ) : (
          <div className="w-5" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
              {entry.code}
            </code>
            <span className="text-xs text-muted-foreground">
              Page {entry.page}
            </span>
            {entry.position && entry.position !== 'unknown' && (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                {entry.position.replace('-', ' ')}
              </span>
            )}
            {entry.confidence && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                {entry.confidence}%
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => onCopyCode?.(entry.code)}
          className="p-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
          title="Copy code"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>

      {hasChildren && expanded && (
        <div className="mt-0.5">
          {entry.children!.map((child) => (
            <TocEntryComponent
              key={child.code}
              entry={child}
              onCopyCode={onCopyCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main Table of Contents Tab Component
 */
export function TabTableOfContents() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ page: 0, totalPages: 0 });

  const [toc, setToc] = useState<TableOfContents | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('hierarchical');
  const [error, setError] = useState<string | null>(null);

  /**
   * Process PDF file to generate TOC
   */
  const processPdf = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast({
        title: 'Invalid file',
        description: 'Please select a PDF file',
        variant: 'destructive',
      });
      return;
    }

    setError(null);
    setIsProcessing(true);
    setCurrentFile(file);
    setToc(null);

    try {
      const result = await generateTableOfContents(
        file,
        true,
        (prog) => {
          setProgress({
            page: prog.page,
            totalPages: prog.totalPages,
          });
        }
      );

      setToc(result);

      if (result.detectedCodes.length === 0) {
        setError('No index codes detected in the document. Make sure the document contains codes in the format <A1>, <A2>, etc.');
      } else {
        toast({
          title: 'Success',
          description: `Detected ${result.detectedCodes.length} unique index codes across ${result.totalPages} pages.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process PDF';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [toast]);

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      await processPdf(file);
    },
    [processPdf]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  /**
   * Copy to clipboard
   */
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: 'Copied',
        description: `${label} copied to clipboard`,
      });
    });
  };

  /**
   * Export TOC as file
   */
  const exportToc = (format: 'json' | 'txt' | 'md') => {
    if (!toc || !currentFile) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      content = formatTocAsJson(toc);
      filename = `toc_${currentFile.name.replace('.pdf', '')}.json`;
      mimeType = 'application/json';
    } else if (format === 'md') {
      content = formatTocAsText(toc);
      filename = `toc_${currentFile.name.replace('.pdf', '')}.md`;
      mimeType = 'text/markdown';
    } else {
      content = formatTocAsText(toc);
      filename = `toc_${currentFile.name.replace('.pdf', '')}.txt`;
      mimeType = 'text/plain';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: `TOC exported as ${format.toUpperCase()}`,
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 shrink-0">
        <h1 className="text-lg font-semibold text-foreground mb-1">
          Table of Contents Auto-Generation
        </h1>
        <p className="text-sm text-muted-foreground">
          Automatically detect index codes and generate a structured table of contents
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          {/* Upload Section */}
          {!toc && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
                ${
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/30'
                }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleInputChange}
                className="hidden"
              />

              <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-foreground mb-1">
                Upload PDF Document
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Select a PDF file to analyze for index codes
              </p>
              <Button variant="outline">Select PDF or Drag & Drop</Button>
            </div>
          )}

          {/* Processing State */}
          {isProcessing && (
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-lg p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  <span className="text-sm font-semibold text-foreground">
                    Processing PDF...
                  </span>
                </div>

                {progress.totalPages > 0 && (
                  <>
                    <Progress
                      value={(progress.page / progress.totalPages) * 100}
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Page {progress.page} of {progress.totalPages}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Results */}
          {toc && !isProcessing && (
            <div className="space-y-6">
              {/* Summary Card */}
              <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Analysis Complete
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {currentFile?.name}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setToc(null);
                      setCurrentFile(null);
                      setError(null);
                    }}
                  >
                    Analyze Another
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest">
                      Total Pages
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {toc.totalPages}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest">
                      Index Codes
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {toc.detectedCodes.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest">
                      Doc Type
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {toc.scannedDocument ? 'Scanned' : 'Digital'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest">
                      Processing
                    </p>
                    <p className="text-sm font-semibold text-foreground capitalize">
                      {toc.processingMethod}
                    </p>
                  </div>
                </div>
              </div>

              {toc.scannedDocument && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This appears to be a scanned document. OCR processing was applied to detect index codes.
                  </AlertDescription>
                </Alert>
              )}

              {/* View Mode Tabs */}
              <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
                {[
                  { mode: 'hierarchical' as ViewMode, label: 'Hierarchical' },
                  { mode: 'text' as ViewMode, label: 'Text' },
                  { mode: 'json' as ViewMode, label: 'JSON' },
                ].map(({ mode, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-3 py-1.5 rounded text-sm font-semibold transition-colors
                      ${
                        viewMode === mode
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Hierarchical View */}
              {viewMode === 'hierarchical' && (
                <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <div className="max-h-96 overflow-auto">
                    {toc.entries.length > 0 ? (
                      <div className="space-y-1">
                        {toc.entries.map((entry) => (
                          <TocEntryComponent
                            key={entry.code}
                            entry={entry}
                            onCopyCode={(code) =>
                              copyToClipboard(code, `Code <${code}>`)
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No index codes detected
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const text = formatTocAsText(toc);
                        copyToClipboard(text, 'Hierarchical TOC');
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                </div>
              )}

              {/* Text View */}
              {viewMode === 'text' && (
                <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <pre className="text-xs overflow-auto max-h-96 bg-muted/30 rounded p-3 font-mono text-foreground whitespace-pre-wrap break-words">
                    {formatTocAsText(toc)}
                  </pre>

                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const text = formatTocAsText(toc);
                        copyToClipboard(text, 'Text TOC');
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                </div>
              )}

              {/* JSON View */}
              {viewMode === 'json' && (
                <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <pre className="text-xs overflow-auto max-h-96 bg-muted/30 rounded p-3 font-mono text-foreground whitespace-pre-wrap break-words">
                    {formatTocAsJson(toc)}
                  </pre>

                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const json = formatTocAsJson(toc);
                        copyToClipboard(json, 'JSON TOC');
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                </div>
              )}

              {/* Export Buttons */}
              <div className="flex gap-2 flex-wrap pt-4 border-t border-border">
                <Button
                  onClick={() => exportToc('json')}
                  variant="outline"
                  size="sm"
                >
                  <FileJson className="w-4 h-4 mr-2" />
                  Export JSON
                </Button>
                <Button
                  onClick={() => exportToc('md')}
                  variant="outline"
                  size="sm"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Export Markdown
                </Button>
                <Button
                  onClick={() => exportToc('txt')}
                  variant="outline"
                  size="sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Text
                </Button>
              </div>
            </div>
          )}

          {/* Empty State Info */}
          {!toc && !isProcessing && !error && (
            <div className="bg-muted/30 rounded-lg p-6 mt-8 space-y-4">
              <h3 className="font-semibold text-foreground">How it works</h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex gap-3">
                  <span className="text-primary font-bold">1.</span>
                  <span>Upload a PDF document containing index codes</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-primary font-bold">2.</span>
                  <span>The system detects patterns like &lt;A1&gt;, &lt;A1-1&gt;, etc.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-primary font-bold">3.</span>
                  <span>Hierarchical structure is automatically generated</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-primary font-bold">4.</span>
                  <span>Export the TOC in JSON, Markdown, or Text format</span>
                </li>
              </ul>

              <div className="pt-4 border-t border-border space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Supported Index Patterns:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-card rounded p-2 font-mono">
                    &lt;A1&gt;, &lt;A2&gt; — Main sections
                  </div>
                  <div className="bg-card rounded p-2 font-mono">
                    &lt;A1-1&gt;, &lt;A1-2&gt; — Subsections
                  </div>
                  <div className="bg-card rounded p-2 font-mono">
                    &lt;B1&gt;, &lt;C1&gt; — Different prefixes
                  </div>
                  <div className="bg-card rounded p-2 font-mono">
                    &lt;A1-1-1&gt; — Deep nesting
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Features:</h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>✓ Automatic index detection from text or scanned PDFs</li>
                  <li>✓ OCR support for scanned documents</li>
                  <li>✓ Hierarchical structure generation</li>
                  <li>✓ Position detection (top-left, top-right)</li>
                  <li>✓ Export in multiple formats</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
