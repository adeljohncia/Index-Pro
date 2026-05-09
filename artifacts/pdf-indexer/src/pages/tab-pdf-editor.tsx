import React, { useState, useCallback, useRef } from 'react';
import {
  RotateCcw, RotateCw, Trash2, Loader2, FileText, Eye,
  ChevronUp, ChevronDown, Type, ScanLine, CheckSquare,
  Square, AlertCircle, Copy, X, UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  extractAllText, renderPageForOcr, ocrImageDataUrl,
  generateThumbnailForPage,
} from '@/lib/pdf-utils';

interface PdfEntry {
  id: string;
  file: File;
  mainCode: string;
  pages: import('@/lib/pdf-utils').PageAnalysis[];
  isAnalyzing: boolean;
  thumbnails: string[];
  isLoadingThumbnails: boolean;
  thumbnailProgress: number;
}

interface PageMod {
  rotation: number; // cumulative extra rotation in degrees (0,90,180,270)
  deleted: boolean;
}

interface PdfEditorTabProps {
  entries: PdfEntry[];
  onAddFiles: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

export function PdfEditorTab({
  entries, onAddFiles, fileInputRef, isDragging, setIsDragging, onDrop,
}: PdfEditorTabProps) {
  const { toast } = useToast();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [pageMods, setPageMods] = useState<Record<string, Record<number, PageMod>>>({}); // entryId -> pn -> mod
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState<{ entryId: string; pn: number; src: string } | null>(null);

  // Text extraction state
  const [extractedText, setExtractedText] = useState<Record<string, string[]>>({}); // entryId -> page texts
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [isOcring, setIsOcring] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrPageProgress, setOcrPageProgress] = useState(0);
  const [activeTextPanel, setActiveTextPanel] = useState(false);

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) ?? null;

  const getMod = (entryId: string, pn: number): PageMod =>
    pageMods[entryId]?.[pn] ?? { rotation: 0, deleted: false };

  const setMod = (entryId: string, pn: number, update: Partial<PageMod>) =>
    setPageMods((prev) => ({
      ...prev,
      [entryId]: {
        ...(prev[entryId] ?? {}),
        [pn]: { ...getMod(entryId, pn), ...update },
      },
    }));

  const rotatePage = (entryId: string, pn: number, dir: 90 | -90) => {
    const cur = getMod(entryId, pn).rotation;
    setMod(entryId, pn, { rotation: ((cur + dir) + 360) % 360 });
  };

  const toggleDelete = (entryId: string, pn: number) => {
    const cur = getMod(entryId, pn).deleted;
    setMod(entryId, pn, { deleted: !cur });
  };

  const togglePageSelect = (pn: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pn)) next.delete(pn); else next.add(pn);
      return next;
    });
  };

  const selectAll = () => {
    if (!selectedEntry) return;
    setSelectedPages(new Set(selectedEntry.pages.map((p) => p.pageNumber)));
  };

  const clearSelection = () => setSelectedPages(new Set());

  const rotateSelected = (dir: 90 | -90) => {
    if (!selectedEntryId) return;
    selectedPages.forEach((pn) => rotatePage(selectedEntryId, pn, dir));
  };

  const deleteSelected = () => {
    if (!selectedEntryId) return;
    selectedPages.forEach((pn) => setMod(selectedEntryId, pn, { deleted: true }));
    setSelectedPages(new Set());
  };

  const restoreAll = () => {
    if (!selectedEntryId) return;
    setPageMods((prev) => ({ ...prev, [selectedEntryId]: {} }));
    setSelectedPages(new Set());
  };

  const movePageUp = (pn: number) => {
    if (!selectedEntry) return;
    const pages = selectedEntry.pages;
    const idx = pages.findIndex((p) => p.pageNumber === pn);
    if (idx <= 0) return;
    toast({ title: 'Reorder requires re-export', description: 'Use page operations to reorder on export' });
  };

  const movePageDown = (pn: number) => {
    if (!selectedEntry) return;
    const pages = selectedEntry.pages;
    const idx = pages.findIndex((p) => p.pageNumber === pn);
    if (idx >= pages.length - 1) return;
    toast({ title: 'Reorder requires re-export', description: 'Use page operations to reorder on export' });
  };

  const handleExtractText = async () => {
    if (!selectedEntry) return;
    setIsExtracting(true);
    setExtractProgress(0);
    setActiveTextPanel(true);
    try {
      const texts = await extractAllText(selectedEntry.file, (page, total) => {
        setExtractProgress(Math.round((page / total) * 100));
      });
      setExtractedText((prev) => ({ ...prev, [selectedEntry.id]: texts }));
      const hasText = texts.some((t) => t.length > 0);
      if (!hasText) {
        toast({
          title: 'No embedded text found',
          description: 'This may be a scanned document. Try OCR instead.',
        });
      }
    } catch {
      toast({ title: 'Text extraction failed', variant: 'destructive' });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleOcr = async () => {
    if (!selectedEntry) return;
    const pages = selectedPages.size > 0
      ? selectedEntry.pages.filter((p) => selectedPages.has(p.pageNumber))
      : selectedEntry.pages;

    if (pages.length === 0) return;
    setIsOcring(true);
    setOcrProgress(0);
    setActiveTextPanel(true);

    try {
      const results: string[] = new Array(selectedEntry.pages.length).fill('');
      const existingTexts = extractedText[selectedEntry.id] ?? [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        setOcrPageProgress(i + 1);
        setOcrProgress(Math.round(((i) / pages.length) * 100));

        const dataUrl = await renderPageForOcr(selectedEntry.file, page.pageNumber);
        const text = await ocrImageDataUrl(dataUrl, (pct) => {
          const overall = Math.round(((i + pct / 100) / pages.length) * 100);
          setOcrProgress(overall);
        });
        results[page.pageNumber - 1] = text;
      }

      const merged = selectedEntry.pages.map((p, i) =>
        results[p.pageNumber - 1] || existingTexts[i] || ''
      );
      setExtractedText((prev) => ({ ...prev, [selectedEntry.id]: merged }));
      toast({ title: `OCR complete — ${pages.length} page${pages.length !== 1 ? 's' : ''} processed` });
    } catch {
      toast({ title: 'OCR failed', variant: 'destructive' });
    } finally {
      setIsOcring(false);
      setOcrProgress(0);
      setOcrPageProgress(0);
    }
  };

  const openPreview = async (entryId: string, pn: number, existingThumb?: string) => {
    if (existingThumb) {
      setPreviewPage({ entryId, pn, src: existingThumb });
      return;
    }
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const src = await generateThumbnailForPage(entry.file, pn, 1.5);
    setPreviewPage({ entryId, pn, src });
  };

  const entryTexts = selectedEntry ? (extractedText[selectedEntry.id] ?? []) : [];
  const activeMods = selectedEntry ? (pageMods[selectedEntry.id] ?? {}) : {};
  const deletedCount = Object.values(activeMods).filter((m) => m.deleted).length;

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden">

      {/* ── Left panel: file list ── */}
      <div className="lg:w-64 xl:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col bg-muted/20">
        {/* Upload zone */}
        <div className="p-3 border-b border-border">
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={onAddFiles}
            className={`flex items-center gap-2.5 h-12 border-2 border-dashed rounded-lg px-3 cursor-pointer transition-all
              ${isDragging ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-accent/50'}`}>
            <UploadCloud className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">Add PDFs</p>
              <p className="text-[10px] text-muted-foreground">Click or drag & drop</p>
            </div>
          </div>
        </div>

        {/* File list */}
        <ScrollArea className="flex-1">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 p-4">
              <FileText className="w-8 h-8 opacity-20" />
              <p className="text-xs text-center">No PDFs loaded. Add files to start editing.</p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {entries.map((entry) => {
                const mods = pageMods[entry.id] ?? {};
                const delCnt = Object.values(mods).filter((m) => m.deleted).length;
                const rotCnt = Object.values(mods).filter((m) => m.rotation !== 0).length;
                const isActive = selectedEntryId === entry.id;
                return (
                  <button
                    key={entry.id}
                    onClick={() => { setSelectedEntryId(entry.id); setSelectedPages(new Set()); setActiveTextPanel(false); }}
                    className={`w-full text-left rounded-lg border p-3 transition-all ${
                      isActive
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-card hover:bg-accent/40'
                    }`}>
                    <div className="flex items-start gap-2">
                      <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{entry.file.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {entry.isAnalyzing ? 'Analyzing…' : `${entry.pages.length} pages · ${formatBytes(entry.file.size)}`}
                        </p>
                        {(delCnt > 0 || rotCnt > 0) && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {delCnt > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-red-600 border-red-200 bg-red-50">
                                {delCnt} deleted
                              </Badge>
                            )}
                            {rotCnt > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600 border-amber-200 bg-amber-50">
                                {rotCnt} rotated
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Right panel: page manager + text ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedEntry ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-8">
            <FileText className="w-12 h-12 opacity-15" />
            <p className="text-sm font-medium">Select a document to edit its pages</p>
            <p className="text-xs text-center max-w-xs">
              Choose a PDF from the list on the left to view its pages, rotate, delete, and extract text.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="border-b border-border bg-card px-4 py-2.5 flex items-center gap-2 flex-wrap shrink-0">
              <span className="text-xs font-semibold text-foreground truncate max-w-[160px] sm:max-w-xs">
                {selectedEntry.file.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedEntry.pages.length} pages
              </span>
              {deletedCount > 0 && (
                <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50">
                  {deletedCount} marked deleted
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                {/* Selection */}
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={selectedPages.size === selectedEntry.pages.length ? clearSelection : selectAll}>
                  {selectedPages.size === selectedEntry.pages.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{selectedPages.size > 0 ? `${selectedPages.size} selected` : 'Select all'}</span>
                </Button>
                {selectedPages.size > 0 && (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => rotateSelected(-90)}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => rotateSelected(90)}>
                      <RotateCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={deleteSelected}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                <div className="w-px h-5 bg-border mx-0.5" />
                {/* Text extraction */}
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2"
                  onClick={() => setActiveTextPanel(!activeTextPanel)}
                  disabled={entryTexts.length === 0 && !isExtracting}>
                  <Type className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Text</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2"
                  onClick={handleExtractText} disabled={isExtracting || isOcring}>
                  {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Type className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Extract</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2"
                  onClick={handleOcr} disabled={isOcring || isExtracting}>
                  {isOcring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{selectedPages.size > 0 ? `OCR (${selectedPages.size})` : 'OCR All'}</span>
                </Button>
                {Object.keys(activeMods).length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2 text-muted-foreground" onClick={restoreAll}>
                    Restore all
                  </Button>
                )}
              </div>
            </div>

            {/* OCR / extraction progress */}
            {(isExtracting || isOcring) && (
              <div className="border-b border-border bg-accent/30 px-4 py-2 flex items-center gap-3 shrink-0">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {isExtracting ? 'Extracting text…' : `OCR running — page ${ocrPageProgress}…`}
                  </p>
                  <Progress value={isExtracting ? extractProgress : ocrProgress} className="h-1 mt-1" />
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {isExtracting ? extractProgress : ocrProgress}%
                </span>
              </div>
            )}

            <div className="flex-1 flex overflow-hidden">
              {/* Page grid */}
              <ScrollArea className="flex-1">
                {selectedEntry.isAnalyzing ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <p className="text-sm">Analyzing pages…</p>
                  </div>
                ) : (
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                    {selectedEntry.pages.map((page) => {
                      const mod = getMod(selectedEntry.id, page.pageNumber);
                      const thumb = selectedEntry.thumbnails[page.pageNumber - 1];
                      const isSelected = selectedPages.has(page.pageNumber);
                      return (
                        <div key={page.pageNumber}
                          className={`relative rounded-lg border-2 overflow-hidden transition-all cursor-pointer group
                            ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}
                            ${mod.deleted ? 'opacity-40' : ''}`}
                          onClick={() => togglePageSelect(page.pageNumber)}>

                          {/* Thumbnail */}
                          <div className="aspect-[3/4] bg-muted/50 relative overflow-hidden">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={`Page ${page.pageNumber}`}
                                className="w-full h-full object-contain"
                                style={{ transform: `rotate(${mod.rotation}deg)`, transition: 'transform 0.2s ease' }}
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center">
                                {selectedEntry.isLoadingThumbnails
                                  ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                  : <FileText className="w-6 h-6 text-muted-foreground/30" />}
                              </div>
                            )}
                            {page.isBlank && (
                              <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Blank</span>
                              </div>
                            )}
                            {mod.deleted && (
                              <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                                <Trash2 className="w-5 h-5 text-red-500" />
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute top-1.5 left-1.5">
                                <CheckSquare className="w-4 h-4 text-primary bg-white rounded" />
                              </div>
                            )}
                            {/* Preview button */}
                            <button
                              onClick={(e) => { e.stopPropagation(); openPreview(selectedEntry.id, page.pageNumber, thumb); }}
                              className="absolute top-1.5 right-1.5 w-6 h-6 rounded bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Eye className="w-3 h-3 text-white" />
                            </button>
                          </div>

                          {/* Page footer + action row */}
                          <div className="bg-card border-t border-border">
                            <div className="flex items-center justify-between px-2 py-1">
                              <span className="text-[10px] font-mono text-muted-foreground">p.{page.pageNumber}</span>
                              {mod.rotation !== 0 && (
                                <span className="text-[9px] text-amber-600 font-mono">{mod.rotation}°</span>
                              )}
                            </div>
                            <div className="flex border-t border-border">
                              <button
                                onClick={(e) => { e.stopPropagation(); rotatePage(selectedEntry.id, page.pageNumber, -90); }}
                                className="flex-1 py-1 flex items-center justify-center hover:bg-muted transition-colors"
                                title="Rotate left">
                                <RotateCcw className="w-3 h-3 text-muted-foreground" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); rotatePage(selectedEntry.id, page.pageNumber, 90); }}
                                className="flex-1 py-1 flex items-center justify-center hover:bg-muted transition-colors border-x border-border"
                                title="Rotate right">
                                <RotateCw className="w-3 h-3 text-muted-foreground" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleDelete(selectedEntry.id, page.pageNumber); }}
                                className={`flex-1 py-1 flex items-center justify-center hover:bg-muted transition-colors
                                  ${mod.deleted ? 'bg-red-50' : ''}`}
                                title={mod.deleted ? 'Restore' : 'Delete'}>
                                {mod.deleted
                                  ? <AlertCircle className="w-3 h-3 text-red-500" />
                                  : <Trash2 className="w-3 h-3 text-muted-foreground" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>

              {/* Text extraction panel */}
              {activeTextPanel && entryTexts.length > 0 && (
                <div className="w-64 xl:w-80 border-l border-border flex flex-col bg-card shrink-0">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                      <Type className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">Extracted Text</span>
                    </div>
                    <button onClick={() => setActiveTextPanel(false)}>
                      <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-3 space-y-3">
                      {entryTexts.map((text, i) => (
                        <div key={i} className="rounded-lg border border-border overflow-hidden">
                          <div className="flex items-center justify-between px-2.5 py-1.5 bg-muted/50 border-b border-border">
                            <span className="text-[10px] font-mono font-semibold text-muted-foreground">Page {i + 1}</span>
                            {text && (
                              <button
                                onClick={() => { navigator.clipboard.writeText(text); }}
                                className="text-muted-foreground hover:text-foreground">
                                <Copy className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="p-2.5">
                            {text ? (
                              <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-mono break-words">{text}</p>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">No text found on this page</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Page preview modal */}
      {previewPage && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewPage(null)}>
          <div className="relative max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewPage(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white flex items-center gap-1 text-sm">
              <X className="w-4 h-4" /> Close
            </button>
            <img
              src={previewPage.src}
              alt={`Page ${previewPage.pn}`}
              className="w-full rounded-xl border border-white/20 shadow-2xl"
            />
            <p className="text-white/60 text-center text-sm mt-2">Page {previewPage.pn}</p>
          </div>
        </div>
      )}
    </div>
  );
}
