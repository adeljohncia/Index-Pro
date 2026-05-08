import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { UploadCloud, FileText, Download, Printer, Plus, Trash2, Loader2, Pencil, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  analyzePdfPages,
  computeAssignedIndices,
  processPdfWithIndices,
  generatePrintTemplateHtml,
  PageAnalysis,
  Attachment,
} from '@/lib/pdf-utils';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function IndexerHome() {
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rawPages, setRawPages] = useState<PageAnalysis[]>([]);

  const [attachments, setAttachments] = useState<Attachment[]>([
    { id: generateId(), mainCode: '<A1>', fromPage: 1, untilPage: 9999 },
  ]);

  // Per-page manual overrides: pageNumber -> custom code (empty string = skip)
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  // Inline edit state
  const [editingPage, setEditingPage] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const processedPages = useMemo(() => {
    if (rawPages.length === 0) return [];
    const clampedAttachments = attachments.map((a) => ({
      ...a,
      untilPage: a.untilPage === 9999 ? rawPages.length : Math.min(a.untilPage, rawPages.length),
    }));
    return computeAssignedIndices(rawPages, clampedAttachments, overrides);
  }, [rawPages, attachments, overrides]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;
    if (uploadedFile.type !== 'application/pdf') {
      toast({ title: 'Invalid file', description: 'Please upload a PDF document.', variant: 'destructive' });
      return;
    }
    setFile(uploadedFile);
    setIsAnalyzing(true);
    setRawPages([]);
    setOverrides({});
    setEditingPage(null);

    try {
      const analysis = await analyzePdfPages(uploadedFile);
      setRawPages(analysis);
      setAttachments((prev) =>
        prev.map((a, i) => (i === prev.length - 1 ? { ...a, untilPage: analysis.length } : a))
      );
      toast({ title: 'Analysis complete', description: `Detected ${analysis.length} pages.` });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error analyzing PDF', description: 'Could not read the PDF file.', variant: 'destructive' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const droppedFile = event.dataTransfer.files?.[0];
      if (!droppedFile) return;
      if (droppedFile.type !== 'application/pdf') {
        toast({ title: 'Invalid file', description: 'Please drop a PDF document.', variant: 'destructive' });
        return;
      }
      setFile(droppedFile);
      setIsAnalyzing(true);
      setRawPages([]);
      setOverrides({});
      setEditingPage(null);
      try {
        const analysis = await analyzePdfPages(droppedFile);
        setRawPages(analysis);
        setAttachments((prev) =>
          prev.map((a, i) => (i === prev.length - 1 ? { ...a, untilPage: analysis.length } : a))
        );
        toast({ title: 'Analysis complete', description: `Detected ${analysis.length} pages.` });
      } catch (err) {
        console.error(err);
        toast({ title: 'Error analyzing PDF', description: 'Could not read the PDF file.', variant: 'destructive' });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [toast]
  );

  const handleProcessPdf = async () => {
    if (!file || processedPages.length === 0) return;
    setIsProcessing(true);
    try {
      const blob = await processPdfWithIndices(file, processedPages);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Indexed_${file.name}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Success', description: 'Stamped PDF downloaded successfully.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error processing PDF', description: 'Could not stamp the PDF.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrintTemplate = () => {
    if (processedPages.length === 0) return;
    const html = generatePrintTemplateHtml(processedPages);
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  // Attachment management
  const addAttachment = () => {
    const lastAttachment = attachments[attachments.length - 1];
    const nextFrom = lastAttachment ? lastAttachment.untilPage + 1 : 1;
    const nextNum = attachments.length + 1;
    setAttachments((prev) => [
      ...prev,
      { id: generateId(), mainCode: `<A${nextNum}>`, fromPage: nextFrom, untilPage: 9999 },
    ]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const updateAttachment = (id: string, field: keyof Attachment, value: string | number) => {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  };

  // Inline edit handlers
  const startEdit = (page: PageAnalysis) => {
    setEditingPage(page.pageNumber);
    setEditValue(page.assignedIndex ?? '');
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = (pageNumber: number) => {
    setOverrides((prev) => ({ ...prev, [pageNumber]: editValue }));
    setEditingPage(null);
  };

  const cancelEdit = () => {
    setEditingPage(null);
  };

  const clearOverride = (pageNumber: number) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[pageNumber];
      return next;
    });
  };

  const stampCount = processedPages.filter((p) => p.assignedIndex).length;

  return (
    <div className="flex h-screen bg-muted/30 p-4 gap-4 overflow-hidden">
      {/* Left Panel */}
      <div className="w-[380px] shrink-0 flex flex-col gap-4 overflow-y-auto">
        {/* Upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Source Document</CardTitle>
          </CardHeader>
          <CardContent>
            {!file ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="relative"
              >
                <label
                  className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer bg-background hover:bg-muted/50 border-muted-foreground/25 transition-colors"
                  data-testid="upload-label"
                >
                  <UploadCloud className="w-7 h-7 mb-1.5 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Click or drop to upload PDF</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Scanned document</p>
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    onChange={handleFileUpload}
                    data-testid="input-file"
                  />
                </label>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-background" data-testid="file-info">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText className="w-7 h-7 text-primary shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB &bull; {rawPages.length} pages
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => { setFile(null); setRawPages([]); setOverrides({}); }}
                  data-testid="button-remove-file"
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attachments */}
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Attachments</CardTitle>
              <Button variant="outline" size="sm" onClick={addAttachment} data-testid="button-add-attachment">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-3 pb-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each attachment starts a new index group. Pages within each group are stamped as
              <code className="mx-1 px-1 bg-muted rounded text-xs">&lt;A1&gt;</code>
              <code className="mx-1 px-1 bg-muted rounded text-xs">&lt;A1-1&gt;</code>
              <code className="mx-1 px-1 bg-muted rounded text-xs">&lt;A1-2&gt;</code>&hellip;
            </p>

            {attachments.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No attachments defined.</p>
            )}

            {attachments.map((att, idx) => (
              <div
                key={att.id}
                className="p-3 border rounded-lg bg-background space-y-3"
                data-testid={`attachment-row-${idx}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Attachment {idx + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => removeAttachment(att.id)}
                    data-testid={`button-remove-attachment-${idx}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Main Code</Label>
                  <Input
                    value={att.mainCode}
                    onChange={(e) => updateAttachment(att.id, 'mainCode', e.target.value)}
                    placeholder="<A1>"
                    className="h-8 text-sm font-mono"
                    data-testid={`input-main-code-${idx}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sub-pages auto-generate: {att.mainCode || '<A1>'},{' '}
                    {att.mainCode
                      ? att.mainCode.endsWith('>')
                        ? att.mainCode.slice(0, -1) + '-1>'
                        : att.mainCode + '-1>'
                      : '<A1-1>'}
                    , &hellip;
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">From Page</Label>
                    <Input
                      type="number"
                      min={1}
                      value={att.fromPage}
                      onChange={(e) => updateAttachment(att.id, 'fromPage', parseInt(e.target.value) || 1)}
                      className="h-8 text-sm"
                      data-testid={`input-from-page-${idx}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Until Page</Label>
                    <Input
                      type="number"
                      min={1}
                      value={att.untilPage === 9999 ? '' : att.untilPage}
                      placeholder="Last"
                      onChange={(e) =>
                        updateAttachment(att.id, 'untilPage', parseInt(e.target.value) || 9999)
                      }
                      className="h-8 text-sm"
                      data-testid={`input-until-page-${idx}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 border-b flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Page Analysis</CardTitle>
            <div className="flex items-center gap-3">
              {Object.keys(overrides).length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground h-7"
                  onClick={() => setOverrides({})}
                  data-testid="button-clear-overrides"
                >
                  Clear all edits
                </Button>
              )}
              <span className="text-sm text-muted-foreground font-medium" data-testid="text-stamp-count">
                {stampCount} {stampCount === 1 ? 'code' : 'codes'} to stamp
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden relative">
            {isAnalyzing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                <p className="text-sm font-medium">Analyzing PDF for blank pages...</p>
              </div>
            )}

            {!file ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <p className="text-sm">Upload a PDF to view page analysis</p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[70px] text-center">Page</TableHead>
                      <TableHead className="w-[90px]">Status</TableHead>
                      <TableHead className="w-[90px]">Position</TableHead>
                      <TableHead>Assigned Index</TableHead>
                      <TableHead className="w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedPages.map((page) => {
                      const isEditing = editingPage === page.pageNumber;
                      const hasOverride = page.pageNumber in overrides;
                      const isOdd = page.pageNumber % 2 !== 0;

                      return (
                        <TableRow
                          key={page.pageNumber}
                          className={page.isBlank ? 'opacity-50 bg-muted/10' : ''}
                          data-testid={`row-page-${page.pageNumber}`}
                        >
                          <TableCell className="text-center font-medium tabular-nums">
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
                            {page.assignedIndex ? (isOdd ? 'Top Left' : 'Top Right') : '-'}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  ref={editInputRef}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit(page.pageNumber);
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                  className="h-7 text-sm font-mono w-32"
                                  data-testid={`input-edit-index-${page.pageNumber}`}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-green-600"
                                  onClick={() => commitEdit(page.pageNumber)}
                                  data-testid={`button-confirm-edit-${page.pageNumber}`}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground"
                                  onClick={cancelEdit}
                                  data-testid={`button-cancel-edit-${page.pageNumber}`}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ) : page.assignedIndex ? (
                              <div className="flex items-center gap-2">
                                <code
                                  className={`px-2 py-0.5 rounded font-mono text-sm font-semibold ${
                                    hasOverride
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                                      : 'bg-muted'
                                  }`}
                                  data-testid={`text-index-${page.pageNumber}`}
                                >
                                  {page.assignedIndex}
                                </code>
                                {hasOverride && (
                                  <button
                                    onClick={() => clearOverride(page.pageNumber)}
                                    className="text-xs text-muted-foreground underline hover:text-foreground"
                                    data-testid={`button-clear-override-${page.pageNumber}`}
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
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => startEdit(page)}
                                data-testid={`button-edit-index-${page.pageNumber}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex gap-4">
            <Button
              className="flex-1"
              size="lg"
              disabled={!file || isAnalyzing || isProcessing || stampCount === 0}
              onClick={handleProcessPdf}
              data-testid="button-process-pdf"
            >
              {isProcessing ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Download className="w-5 h-5 mr-2" />
              )}
              Process &amp; Download PDF
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              size="lg"
              disabled={!file || isAnalyzing || stampCount === 0}
              onClick={handlePrintTemplate}
              data-testid="button-print-template"
            >
              <Printer className="w-5 h-5 mr-2" />
              Print Overlay Template
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
