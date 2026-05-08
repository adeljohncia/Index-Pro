import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  UploadCloud, FileText, Download, Printer, Plus, Trash2,
  Loader2, Pencil, Check, X, GripVertical, FileUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  analyzePdfPages,
  computeAttachmentIndices,
  processAndMergePdfs,
  generatePrintTemplateHtml,
  PageAnalysis,
} from '@/lib/pdf-utils';

function uid() {
  return Math.random().toString(36).substring(2, 9);
}

function nextCode(count: number): string {
  // Generate <A1>, <A2>, ..., <A26>, <B1>, ...
  const letter = String.fromCharCode(65 + Math.floor(count / 26) % 26);
  const num = (count % 26) + 1;
  return `<${letter}${num}>`;
}

interface PdfEntry {
  id: string;
  file: File;
  mainCode: string;
  pages: PageAnalysis[];
  isAnalyzing: boolean;
}

export function IndexerHome() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Per-entry per-page overrides: { entryId: { pageNumber: customCode } }
  const [overrides, setOverrides] = useState<Record<string, Record<number, string>>>({});

  // Inline edit state
  const [editingKey, setEditingKey] = useState<string | null>(null); // "entryId:pageNum"
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Compute final pages for each entry
  const processedEntries = useMemo(() =>
    entries.map((entry) => ({
      ...entry,
      pages: computeAttachmentIndices(entry.pages, entry.mainCode, overrides[entry.id] ?? {}),
    })),
    [entries, overrides]
  );

  const totalStamps = useMemo(
    () => processedEntries.reduce((sum, e) => sum + e.pages.filter((p) => p.assignedIndex).length, 0),
    [processedEntries]
  );

  const analyzeFile = useCallback(async (file: File, id: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, isAnalyzing: true } : e))
    );
    try {
      const pages = await analyzePdfPages(file);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, pages, isAnalyzing: false } : e))
      );
    } catch {
      toast({ title: 'Error reading PDF', description: `Could not analyze ${file.name}.`, variant: 'destructive' });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    }
  }, [toast]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (pdfs.length === 0) {
      toast({ title: 'No valid PDFs', description: 'Please select PDF files only.', variant: 'destructive' });
      return;
    }
    if (pdfs.length < files.length) {
      toast({ title: 'Some files skipped', description: 'Only PDF files are accepted.' });
    }

    const newEntries: PdfEntry[] = pdfs.map((file, i) => ({
      id: uid(),
      file,
      mainCode: nextCode(entries.length + i),
      pages: [],
      isAnalyzing: true,
    }));

    setEntries((prev) => [...prev, ...newEntries]);

    // Analyze all in parallel
    await Promise.all(newEntries.map((entry) => analyzeFile(entry.file, entry.id)));
  }, [entries.length, analyzeFile, toast]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setOverrides((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const updateMainCode = (id: string, code: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, mainCode: code } : e)));
  };

  // Inline edit
  const startEdit = (entryId: string, page: PageAnalysis) => {
    const key = `${entryId}:${page.pageNumber}`;
    setEditingKey(key);
    setEditValue(page.assignedIndex ?? '');
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = (entryId: string, pageNumber: number) => {
    setOverrides((prev) => ({
      ...prev,
      [entryId]: { ...(prev[entryId] ?? {}), [pageNumber]: editValue },
    }));
    setEditingKey(null);
  };

  const clearOverride = (entryId: string, pageNumber: number) => {
    setOverrides((prev) => {
      const entryOvr = { ...(prev[entryId] ?? {}) };
      delete entryOvr[pageNumber];
      return { ...prev, [entryId]: entryOvr };
    });
  };

  const handleProcess = async () => {
    if (processedEntries.length === 0) return;
    setIsProcessing(true);
    try {
      const blob = await processAndMergePdfs(
        processedEntries.map((e) => ({ file: e.file, pages: e.pages }))
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Indexed_Combined.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Success', description: 'Stamped PDF downloaded.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Processing failed', description: 'Could not stamp the PDF.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrintTemplate = () => {
    if (processedEntries.length === 0) return;
    const html = generatePrintTemplateHtml(
      processedEntries.map((e) => ({ fileName: e.file.name, mainCode: e.mainCode, pages: e.pages }))
    );
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  };

  const anyAnalyzing = entries.some((e) => e.isAnalyzing);

  return (
    <div className="flex h-screen bg-muted/30 p-4 gap-4 overflow-hidden">

      {/* ── Left: PDF list ── */}
      <div className="w-[360px] shrink-0 flex flex-col gap-4 overflow-hidden">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">PDF Files</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-add-pdfs"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add PDFs
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={handleFileInput}
                data-testid="input-files"
              />
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col overflow-hidden p-0">
            {/* Drop zone (always visible, compact when files exist) */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`mx-4 mt-4 flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors
                ${entries.length === 0 ? 'h-36' : 'h-16'}
                ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-background hover:bg-muted/30'}`}
              data-testid="drop-zone"
            >
              <UploadCloud className={`text-muted-foreground ${entries.length === 0 ? 'w-8 h-8 mb-1.5' : 'w-5 h-5 mr-2'}`} />
              {entries.length === 0 ? (
                <>
                  <p className="text-sm font-medium text-foreground">Click or drop PDF files here</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Multiple files supported</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Drop more PDFs here</p>
              )}
            </div>

            {entries.length === 0 ? null : (
              <ScrollArea className="flex-1 mt-3">
                <div className="px-4 pb-4 space-y-2">
                  {entries.map((entry, idx) => {
                    const blankCount = entry.pages.filter((p) => p.isBlank).length;
                    return (
                      <div
                        key={entry.id}
                        className="border rounded-lg bg-background overflow-hidden"
                        data-testid={`pdf-entry-${idx}`}
                      >
                        {/* Header row */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b">
                          <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate" title={entry.file.name}>
                              {entry.file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {entry.isAnalyzing ? (
                                <span className="flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Analyzing…
                                </span>
                              ) : (
                                `${entry.pages.length} pages${blankCount > 0 ? ` · ${blankCount} blank` : ''}`
                              )}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground"
                            onClick={() => removeEntry(entry.id)}
                            data-testid={`button-remove-pdf-${idx}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        {/* Code row */}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <Label className="text-xs text-muted-foreground shrink-0 w-20">
                            Attachment Code
                          </Label>
                          <Input
                            value={entry.mainCode}
                            onChange={(e) => updateMainCode(entry.id, e.target.value)}
                            className="h-7 text-sm font-mono flex-1"
                            placeholder="<A1>"
                            data-testid={`input-code-${idx}`}
                          />
                        </div>

                        {/* Preview of generated codes */}
                        {!entry.isAnalyzing && entry.pages.length > 0 && (
                          <div className="px-3 pb-2 flex flex-wrap gap-1">
                            {(() => {
                              const mc = entry.mainCode || '<A1>';
                              const nonBlank = entry.pages.filter((p) => !p.isBlank).length;
                              const preview = Array.from({ length: Math.min(nonBlank, 4) }, (_, i) => {
                                if (i === 0) return mc;
                                const base = mc.endsWith('>') ? mc.slice(0, -1) : mc;
                                return `${base}-${i}>`;
                              });
                              return preview.map((code) => (
                                <code key={code} className="text-xs px-1.5 py-0.5 bg-primary/8 text-primary rounded font-mono">
                                  {code}
                                </code>
                              ));
                            })()}
                            {entry.pages.filter((p) => !p.isBlank).length > 4 && (
                              <span className="text-xs text-muted-foreground self-center">
                                +{entry.pages.filter((p) => !p.isBlank).length - 4} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            disabled={entries.length === 0 || anyAnalyzing || isProcessing || totalStamps === 0}
            onClick={handleProcess}
            data-testid="button-process"
          >
            {isProcessing
              ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              : <Download className="w-5 h-5 mr-2" />}
            Process &amp; Download PDF
          </Button>
          <Button
            variant="outline"
            size="lg"
            disabled={entries.length === 0 || anyAnalyzing || totalStamps === 0}
            onClick={handlePrintTemplate}
            data-testid="button-print"
          >
            <Printer className="w-5 h-5 mr-2" />
            Print Overlay Template
          </Button>
        </div>
      </div>

      {/* ── Right: Page Analysis ── */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Page Analysis</CardTitle>
          <div className="flex items-center gap-3">
            {Object.values(overrides).some((o) => Object.keys(o).length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground h-7"
                onClick={() => setOverrides({})}
                data-testid="button-clear-all-overrides"
              >
                Clear all edits
              </Button>
            )}
            <span className="text-sm text-muted-foreground font-medium" data-testid="text-stamp-count">
              {totalStamps} {totalStamps === 1 ? 'code' : 'codes'} to stamp
            </span>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0 overflow-hidden">
          {entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-3">
              <FileUp className="w-10 h-10 opacity-30" />
              <p className="text-sm">Add PDF files to begin</p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[60px] text-center">Page</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                    <TableHead className="w-[90px]">Position</TableHead>
                    <TableHead>Assigned Index</TableHead>
                    <TableHead className="w-[44px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedEntries.map((entry) => (
                    <React.Fragment key={entry.id}>
                      {/* PDF group header */}
                      <TableRow className="bg-muted/60 hover:bg-muted/60">
                        <TableCell colSpan={5} className="py-1.5 px-3">
                          <div className="flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="text-xs font-semibold text-foreground truncate max-w-[260px]">
                              {entry.file.name}
                            </span>
                            <code className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded font-mono ml-1">
                              {entry.mainCode}
                            </code>
                            {entry.isAnalyzing && (
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-1" />
                            )}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {entry.pages.filter((p) => p.assignedIndex).length} stamped
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Page rows */}
                      {entry.isAnalyzing ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-4 text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                            Detecting blank pages…
                          </TableCell>
                        </TableRow>
                      ) : (
                        entry.pages.map((page) => {
                          const editKey = `${entry.id}:${page.pageNumber}`;
                          const isEditing = editingKey === editKey;
                          const hasOverride = page.pageNumber in (overrides[entry.id] ?? {});
                          const isOdd = page.pageNumber % 2 !== 0;

                          return (
                            <TableRow
                              key={page.pageNumber}
                              className={page.isBlank ? 'opacity-50 bg-muted/10' : ''}
                              data-testid={`row-${entry.id}-${page.pageNumber}`}
                            >
                              <TableCell className="text-center font-medium tabular-nums text-sm">
                                {page.pageNumber}
                              </TableCell>
                              <TableCell>
                                {page.isBlank ? (
                                  <Badge variant="outline" className="text-muted-foreground text-xs">Blank</Badge>
                                ) : (
                                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10 text-xs">Content</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {page.assignedIndex ? (isOdd ? 'Top Left' : 'Top Right') : '—'}
                              </TableCell>
                              <TableCell>
                                {isEditing ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      ref={editInputRef}
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitEdit(entry.id, page.pageNumber);
                                        if (e.key === 'Escape') setEditingKey(null);
                                      }}
                                      className="h-7 text-sm font-mono w-28"
                                      data-testid={`input-edit-${editKey}`}
                                    />
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600"
                                      onClick={() => commitEdit(entry.id, page.pageNumber)}>
                                      <Check className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                                      onClick={() => setEditingKey(null)}>
                                      <X className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                ) : page.assignedIndex ? (
                                  <div className="flex items-center gap-2">
                                    <code className={`px-2 py-0.5 rounded font-mono text-sm font-semibold ${
                                      hasOverride
                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                                        : 'bg-muted'
                                    }`}>
                                      {page.assignedIndex}
                                    </code>
                                    {hasOverride && (
                                      <button
                                        onClick={() => clearOverride(entry.id, page.pageNumber)}
                                        className="text-xs text-muted-foreground underline hover:text-foreground"
                                      >
                                        reset
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground italic">Skipped</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {!page.isBlank && !isEditing && (
                                  <Button
                                    variant="ghost" size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => startEdit(entry.id, page)}
                                    data-testid={`button-edit-${editKey}`}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
