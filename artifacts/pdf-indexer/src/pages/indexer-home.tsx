import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import {
  UploadCloud, FileText, Download, Printer, Plus, Trash2,
  Loader2, Pencil, Check, X, FileUp, Eye, BarChart3,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  analyzePdfPages,
  generateThumbnails,
  computeAttachmentIndices,
  processAndMergePdfs,
  generatePrintTemplateHtml,
  PageAnalysis,
} from '@/lib/pdf-utils';

function uid() { return Math.random().toString(36).substring(2, 9); }

function nextCode(count: number): string {
  const letter = String.fromCharCode(65 + Math.floor(count / 9) % 26);
  const num = (count % 9) + 1;
  return `<${letter}${num}>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface PdfEntry {
  id: string;
  file: File;
  mainCode: string;
  pages: PageAnalysis[];
  isAnalyzing: boolean;
  thumbnails: string[];
  isLoadingThumbnails: boolean;
  thumbnailProgress: number; // pages rendered
  uploadedAt: Date;
}

export function IndexerHome() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<number, string>>>({});

  // Inline edit
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Preview sheet
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);

  // ── Computed ─────────────────────────────────────────────────────────
  const processedEntries = useMemo(() =>
    entries.map((e) => ({
      ...e,
      pages: computeAttachmentIndices(e.pages, e.mainCode, overrides[e.id] ?? {}),
    })),
    [entries, overrides]
  );

  const totalStamps = useMemo(
    () => processedEntries.reduce((s, e) => s + e.pages.filter((p) => p.assignedIndex).length, 0),
    [processedEntries]
  );

  const totalPages = useMemo(() => entries.reduce((s, e) => s + e.pages.length, 0), [entries]);
  const totalBlank = useMemo(() => entries.reduce((s, e) => s + e.pages.filter((p) => p.isBlank).length, 0), [entries]);
  const totalSize = useMemo(() => entries.reduce((s, e) => s + e.file.size, 0), [entries]);
  const anyAnalyzing = entries.some((e) => e.isAnalyzing);

  // ── File handling ─────────────────────────────────────────────────────
  const loadEntry = useCallback(async (entry: PdfEntry) => {
    // 1. Analyze blank pages
    try {
      const pages = await analyzePdfPages(entry.file);
      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, pages, isAnalyzing: false, isLoadingThumbnails: true } : e));

      // 2. Generate thumbnails in background
      const thumbs: string[] = [];
      await generateThumbnails(entry.file, (idx, total) => {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, thumbnailProgress: idx, thumbnails: [...thumbs] } : e));
      }).then((results) => {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, thumbnails: results, isLoadingThumbnails: false, thumbnailProgress: results.length } : e));
      });
    } catch {
      toast({ title: 'Error reading PDF', description: `Could not analyze ${entry.file.name}.`, variant: 'destructive' });
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    }
  }, [toast]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (!pdfs.length) {
      toast({ title: 'No valid PDFs', description: 'Only PDF files are accepted.', variant: 'destructive' });
      return;
    }

    setEntries((prev) => {
      const newEntries: PdfEntry[] = pdfs.map((file, i) => ({
        id: uid(), file,
        mainCode: nextCode(prev.length + i),
        pages: [], isAnalyzing: true,
        thumbnails: [], isLoadingThumbnails: false, thumbnailProgress: 0,
        uploadedAt: new Date(),
      }));
      // kick off loading for each
      newEntries.forEach((e) => loadEntry(e));
      return [...prev, ...newEntries];
    });
  }, [loadEntry, toast]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files) await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (previewEntryId === id) setPreviewEntryId(null);
  };

  const updateMainCode = (id: string, code: string) =>
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, mainCode: code } : e));

  // ── Inline edit ───────────────────────────────────────────────────────
  const startEdit = (entryId: string, page: PageAnalysis) => {
    setEditingKey(`${entryId}:${page.pageNumber}`);
    setEditValue(page.assignedIndex ?? '');
    setTimeout(() => editInputRef.current?.focus(), 0);
  };
  const commitEdit = (entryId: string, pageNumber: number) => {
    setOverrides((prev) => ({ ...prev, [entryId]: { ...(prev[entryId] ?? {}), [pageNumber]: editValue } }));
    setEditingKey(null);
  };
  const clearOverride = (entryId: string, pageNumber: number) => {
    setOverrides((prev) => {
      const o = { ...(prev[entryId] ?? {}) }; delete o[pageNumber];
      return { ...prev, [entryId]: o };
    });
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const handleProcess = async () => {
    setIsProcessing(true);
    try {
      const blob = await processAndMergePdfs(processedEntries.map((e) => ({ file: e.file, pages: e.pages })));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'Indexed_Combined.pdf'; a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Success', description: 'Stamped PDF downloaded.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Processing failed', description: 'Could not stamp the PDF.', variant: 'destructive' });
    } finally { setIsProcessing(false); }
  };

  const handlePrintTemplate = () => {
    const html = generatePrintTemplateHtml(
      processedEntries.map((e) => ({ fileName: e.file.name, mainCode: e.mainCode, pages: e.pages }))
    );
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  };

  // ── Preview entry ─────────────────────────────────────────────────────
  const previewEntry = previewEntryId
    ? processedEntries.find((e) => e.id === previewEntryId) ?? null
    : null;

  return (
    <div className="flex h-screen bg-[#0f1117] overflow-hidden">

      {/* ══ Left Panel ══════════════════════════════════════════════════ */}
      <div className="w-[340px] shrink-0 flex flex-col gap-3 p-3 border-r border-white/8 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-semibold text-white">Document Indexing</span>
          </div>
          <Button
            variant="ghost" size="sm"
            className="text-xs text-white/50 hover:text-white hover:bg-white/8 h-7"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-add-pdfs"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add PDFs
          </Button>
          <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={handleFileInput} data-testid="input-files" />
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-all
            ${entries.length === 0 ? 'h-28' : 'h-12'}
            ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-white/15 bg-white/3 hover:bg-white/6'}`}
          data-testid="drop-zone"
        >
          <div className={`flex ${entries.length === 0 ? 'flex-col items-center gap-1' : 'flex-row gap-2'}`}>
            <UploadCloud className={`text-white/30 ${entries.length === 0 ? 'w-7 h-7' : 'w-4 h-4'}`} />
            {entries.length === 0 ? (
              <>
                <p className="text-xs font-medium text-white/50">Click or drop PDF files here</p>
                <p className="text-xs text-white/25">Multiple files supported</p>
              </>
            ) : (
              <p className="text-xs text-white/35">Drop more PDFs here</p>
            )}
          </div>
        </div>

        {/* PDF list */}
        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-1">
            {entries.map((entry, idx) => {
              const processed = processedEntries.find((e) => e.id === entry.id);
              const stamps = processed?.pages.filter((p) => p.assignedIndex).length ?? 0;
              const blank = entry.pages.filter((p) => p.isBlank).length;

              return (
                <div key={entry.id} className="rounded-lg border border-white/10 bg-white/4 overflow-hidden" data-testid={`pdf-entry-${idx}`}>
                  {/* Top row */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/3 border-b border-white/8">
                    <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/80 truncate" title={entry.file.name}>{entry.file.name}</p>
                      <p className="text-xs text-white/35">
                        {entry.isAnalyzing
                          ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Analyzing…</span>
                          : `${entry.pages.length} pages · ${blank} blank · ${stamps} stamps`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!entry.isAnalyzing && entry.pages.length > 0 && (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-white/35 hover:text-blue-400 hover:bg-white/8"
                          onClick={() => setPreviewEntryId(entry.id)} data-testid={`button-preview-${idx}`}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-white/35 hover:text-red-400 hover:bg-white/8"
                        onClick={() => removeEntry(entry.id)} data-testid={`button-remove-${idx}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Code row */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="text-xs text-white/35 shrink-0 w-16">Code</span>
                    <Input
                      value={entry.mainCode}
                      onChange={(e) => updateMainCode(entry.id, e.target.value)}
                      className="h-7 text-sm font-mono flex-1 bg-white/6 border-white/15 text-white placeholder:text-white/25 focus:border-blue-500/50"
                      data-testid={`input-code-${idx}`}
                    />
                  </div>

                  {/* Thumbnail strip preview (first 4 pages) */}
                  {entry.thumbnails.length > 0 && (
                    <div className="flex gap-1.5 px-3 pb-2">
                      {entry.thumbnails.slice(0, 4).map((src, i) => (
                        <div key={i} className="relative">
                          <img src={src} alt={`Page ${i + 1}`}
                            className="h-12 w-auto rounded border border-white/10 object-cover cursor-pointer hover:border-blue-400 transition-colors"
                            onClick={() => setPreviewEntryId(entry.id)} />
                          {entry.pages[i]?.isBlank && (
                            <div className="absolute inset-0 bg-black/40 rounded flex items-center justify-center">
                              <span className="text-[8px] text-white/70">blank</span>
                            </div>
                          )}
                        </div>
                      ))}
                      {entry.thumbnails.length < entry.pages.length && (
                        <div className="h-12 w-8 rounded border border-white/10 bg-white/4 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors"
                          onClick={() => setPreviewEntryId(entry.id)}>
                          <span className="text-[9px] text-white/35">+{entry.pages.length - 4}</span>
                        </div>
                      )}
                      {entry.isLoadingThumbnails && (
                        <div className="h-12 flex items-center pl-1">
                          <Loader2 className="w-3 h-3 text-white/30 animate-spin" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Thumbnail loading progress */}
                  {entry.isLoadingThumbnails && entry.pages.length > 0 && (
                    <div className="px-3 pb-2">
                      <Progress value={(entry.thumbnailProgress / entry.pages.length) * 100} className="h-1 bg-white/10" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 pt-1">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white w-full"
            disabled={!entries.length || anyAnalyzing || isProcessing || totalStamps === 0}
            onClick={handleProcess} data-testid="button-process">
            {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Process &amp; Download PDF
          </Button>
          <Button size="sm" variant="outline"
            className="border-white/15 text-white/70 hover:bg-white/8 hover:text-white w-full"
            disabled={!entries.length || anyAnalyzing || totalStamps === 0}
            onClick={handlePrintTemplate} data-testid="button-print">
            <Printer className="w-4 h-4 mr-2" /> Print Overlay Template
          </Button>
        </div>
      </div>

      {/* ══ Right Panel ═════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">

        {/* ── Batch Summary Card ──────────────────────────────────────── */}
        <div className="rounded-lg border border-white/10 bg-[#16181f] p-4 shrink-0">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/8">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
              <BarChart3 className="w-4 h-4 text-blue-400" /> Batch Summary
            </h3>
            <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border
              ${anyAnalyzing
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : entries.length === 0
                  ? 'bg-white/5 text-white/25 border-white/10'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${anyAnalyzing ? 'bg-amber-400 animate-pulse' : entries.length === 0 ? 'bg-white/20' : 'bg-emerald-400 animate-pulse'}`} />
              {anyAnalyzing ? 'Analyzing' : entries.length === 0 ? 'Idle' : 'Ready'}
            </span>
          </div>

          {/* Stat boxes */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: 'Total Documents', value: entries.length.toString(), color: 'text-blue-400' },
              { label: 'Total Pages', value: totalPages.toString(), color: 'text-blue-400' },
              { label: 'Codes to Stamp', value: totalStamps.toString(), color: 'text-blue-400' },
              { label: 'File Size', value: formatBytes(totalSize), color: 'text-emerald-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[#0f1117] border border-white/8 rounded p-3">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-white/35 mb-1">{label}</span>
                <span className={`font-mono text-xl font-bold ${color}`}>{value}</span>
              </div>
            ))}
          </div>

          {/* Per-attachment table */}
          {entries.length > 0 && (
            <div className="rounded border border-white/8 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/4">
                  <tr>
                    {['Document', 'Code', 'Pages', 'Stamps', 'Blank', 'Size', 'Status'].map((h) => (
                      <th key={h} className="px-3 py-2 font-bold uppercase tracking-widest text-[10px] text-white/35 border-r border-white/8 last:border-r-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {processedEntries.map((entry) => {
                    const stamps = entry.pages.filter((p) => p.assignedIndex).length;
                    const blank = entry.pages.filter((p) => p.isBlank).length;
                    return (
                      <tr key={entry.id} className="hover:bg-white/3 transition-colors">
                        <td className="px-3 py-2 font-mono text-white/60 border-r border-white/8 max-w-[140px] truncate" title={entry.file.name}>{entry.file.name}</td>
                        <td className="px-3 py-2 border-r border-white/8">
                          <code className="text-blue-400 font-mono">{entry.mainCode}</code>
                        </td>
                        <td className="px-3 py-2 font-mono text-blue-400 border-r border-white/8">{entry.pages.length}</td>
                        <td className="px-3 py-2 font-mono text-emerald-400 border-r border-white/8">{stamps}</td>
                        <td className="px-3 py-2 font-mono text-white/35 border-r border-white/8">{blank}</td>
                        <td className="px-3 py-2 font-mono text-white/35 border-r border-white/8">{formatBytes(entry.file.size)}</td>
                        <td className="px-3 py-2">
                          {entry.isAnalyzing
                            ? <span className="flex items-center gap-1 text-amber-400 text-[10px] font-bold uppercase"><Loader2 className="w-3 h-3 animate-spin" />Analyzing</span>
                            : <span className="text-emerald-400 text-[10px] font-bold uppercase px-2 py-0.5 bg-emerald-500/8 border border-emerald-500/20 rounded">Ready</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Page Analysis ───────────────────────────────────────────── */}
        <div className="flex-1 rounded-lg border border-white/10 bg-[#16181f] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8 shrink-0">
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Page Analysis</span>
            <div className="flex items-center gap-3">
              {Object.values(overrides).some((o) => Object.keys(o).length > 0) && (
                <button onClick={() => setOverrides({})} className="text-xs text-white/35 hover:text-white underline" data-testid="button-clear-overrides">
                  Clear all edits
                </button>
              )}
              <span className="text-xs font-mono text-blue-400" data-testid="text-stamp-count">{totalStamps} codes to stamp</span>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-white/20 gap-3">
              <FileUp className="w-10 h-10 opacity-30" />
              <p className="text-sm">Add PDF files to begin</p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-[#16181f]">
                  <TableRow className="border-white/8 hover:bg-transparent">
                    <TableHead className="w-[55px] text-center text-[10px] text-white/35 uppercase tracking-widest">Page</TableHead>
                    <TableHead className="w-[75px] text-[10px] text-white/35 uppercase tracking-widest">Status</TableHead>
                    <TableHead className="w-[85px] text-[10px] text-white/35 uppercase tracking-widest">Position</TableHead>
                    <TableHead className="text-[10px] text-white/35 uppercase tracking-widest">Assigned Index</TableHead>
                    <TableHead className="w-[44px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedEntries.map((entry) => (
                    <React.Fragment key={entry.id}>
                      {/* PDF group header row */}
                      <TableRow className="bg-white/3 hover:bg-white/4 border-white/8">
                        <TableCell colSpan={5} className="py-1.5 px-3">
                          <div className="flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span className="text-xs font-semibold text-white/60 truncate max-w-[220px]">{entry.file.name}</span>
                            <code className="text-[11px] px-1.5 py-0.5 bg-blue-500/15 text-blue-400 rounded font-mono ml-1">{entry.mainCode}</code>
                            {entry.isAnalyzing && <Loader2 className="w-3 h-3 animate-spin text-white/30" />}
                            <span className="text-xs text-white/30 ml-auto font-mono">
                              {entry.pages.filter((p) => p.assignedIndex).length} stamped
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>

                      {entry.isAnalyzing ? (
                        <TableRow className="border-white/6">
                          <TableCell colSpan={5} className="text-center py-4 text-sm text-white/30">
                            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Detecting blank pages…
                          </TableCell>
                        </TableRow>
                      ) : (
                        entry.pages.map((page) => {
                          const editKey = `${entry.id}:${page.pageNumber}`;
                          const isEditing = editingKey === editKey;
                          const hasOverride = page.pageNumber in (overrides[entry.id] ?? {});
                          const isOdd = page.pageNumber % 2 !== 0;

                          return (
                            <TableRow key={page.pageNumber}
                              className={`border-white/6 ${page.isBlank ? 'opacity-40' : 'hover:bg-white/2'}`}
                              data-testid={`row-${entry.id}-${page.pageNumber}`}>
                              <TableCell className="text-center font-mono text-xs text-white/50 tabular-nums">{page.pageNumber}</TableCell>
                              <TableCell>
                                {page.isBlank
                                  ? <Badge variant="outline" className="text-[10px] border-white/15 text-white/30 bg-transparent">Blank</Badge>
                                  : <Badge variant="secondary" className="text-[10px] bg-blue-500/15 text-blue-400 hover:bg-blue-500/15 border-0">Content</Badge>}
                              </TableCell>
                              <TableCell className="text-white/35 text-xs">
                                {page.assignedIndex ? (isOdd ? 'Top Left' : 'Top Right') : '—'}
                              </TableCell>
                              <TableCell>
                                {isEditing ? (
                                  <div className="flex items-center gap-1">
                                    <Input ref={editInputRef} value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(entry.id, page.pageNumber); if (e.key === 'Escape') setEditingKey(null); }}
                                      className="h-7 text-xs font-mono w-28 bg-white/6 border-white/20 text-white"
                                      data-testid={`input-edit-${editKey}`} />
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-400 hover:bg-emerald-500/10"
                                      onClick={() => commitEdit(entry.id, page.pageNumber)}><Check className="w-3 h-3" /></Button>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-white/30 hover:bg-white/8"
                                      onClick={() => setEditingKey(null)}><X className="w-3 h-3" /></Button>
                                  </div>
                                ) : page.assignedIndex ? (
                                  <div className="flex items-center gap-2">
                                    <code className={`px-2 py-0.5 rounded font-mono text-sm font-semibold ${hasOverride ? 'bg-amber-500/15 text-amber-400' : 'bg-white/6 text-white/70'}`}>
                                      {page.assignedIndex}
                                    </code>
                                    {hasOverride && (
                                      <button onClick={() => clearOverride(entry.id, page.pageNumber)}
                                        className="text-xs text-white/25 underline hover:text-white/60">reset</button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-white/25 italic">Skipped</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {!page.isBlank && !isEditing && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-white/20 hover:text-white/60 hover:bg-white/8"
                                    onClick={() => startEdit(entry.id, page)} data-testid={`button-edit-${editKey}`}>
                                    <Pencil className="w-3 h-3" />
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
        </div>
      </div>

      {/* ══ Preview Sheet ════════════════════════════════════════════════ */}
      <Sheet open={!!previewEntryId} onOpenChange={(open) => { if (!open) setPreviewEntryId(null); }}>
        <SheetContent side="right" className="w-[420px] bg-[#0f1117] border-white/10 p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b border-white/8 shrink-0">
            <SheetTitle className="text-sm text-white/80 font-semibold flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-400" />
              {previewEntry?.file.name ?? 'Preview'}
            </SheetTitle>
            {previewEntry && (
              <p className="text-xs text-white/35">
                {previewEntry.pages.length} pages · {previewEntry.pages.filter((p) => p.isBlank).length} blank ·{' '}
                <code className="text-blue-400">{previewEntry.mainCode}</code>
              </p>
            )}
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-4 grid grid-cols-2 gap-3">
              {previewEntry?.pages.map((page, i) => {
                const thumb = previewEntry.thumbnails[i];
                const isOdd = page.pageNumber % 2 !== 0;

                return (
                  <div key={page.pageNumber} className="relative group rounded border border-white/10 bg-white/3 overflow-hidden">
                    {/* Thumbnail */}
                    {thumb ? (
                      <img src={thumb} alt={`Page ${page.pageNumber}`} className="w-full object-contain block" />
                    ) : (
                      <div className="aspect-[3/4] flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
                      </div>
                    )}

                    {/* Blank overlay */}
                    {page.isBlank && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-xs font-bold text-white/50 uppercase tracking-widest">Blank</span>
                      </div>
                    )}

                    {/* Index stamp overlay (top-left or top-right) */}
                    {page.assignedIndex && (
                      <div className={`absolute top-1 ${isOdd ? 'left-1' : 'right-1'}`}>
                        <code className="text-[9px] font-bold bg-blue-600 text-white px-1 py-0.5 rounded leading-none">
                          {page.assignedIndex}
                        </code>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-white/50">p.{page.pageNumber}</span>
                      <span className="text-[10px] text-white/30">{isOdd ? 'L' : 'R'}</span>
                    </div>
                  </div>
                );
              })}

              {/* Loading placeholder pages */}
              {previewEntry?.isLoadingThumbnails &&
                Array.from({ length: previewEntry.pages.length - previewEntry.thumbnails.length }).map((_, i) => (
                  <div key={`loading-${i}`} className="aspect-[3/4] rounded border border-white/8 bg-white/2 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-white/15 animate-spin" />
                  </div>
                ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
