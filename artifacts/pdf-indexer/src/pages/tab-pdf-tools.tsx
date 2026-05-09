import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, Merge, Scissors, ImageIcon, Trash2, GripVertical,
  FileText, Loader2, Download, Plus, X, ZoomIn, ZoomOut,
  ChevronLeft, ChevronRight, CheckSquare, Square, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  splitPdf, parsePagesRange, pdfPagesToImages, generateThumbnails,
} from '@/lib/pdf-utils';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

type ToolSubTab = 'merge' | 'split' | 'convert';

function uid() { return Math.random().toString(36).substring(2, 9); }
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

async function getPdfPageCount(file: File): Promise<number> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  return pdf.numPages;
}

async function getPdfFirstThumb(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 0.3 });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas }).promise;
  return canvas.toDataURL('image/jpeg', 0.7);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUB-TAB PILL NAV
═══════════════════════════════════════════════════════════════════════════ */
function SubTabNav({ active, onChange }: { active: ToolSubTab; onChange: (t: ToolSubTab) => void }) {
  const tabs: { id: ToolSubTab; icon: React.ElementType; label: string }[] = [
    { id: 'merge',   icon: Merge,     label: 'PDF Merger' },
    { id: 'split',   icon: Scissors,  label: 'PDF Splitter' },
    { id: 'convert', icon: ImageIcon, label: 'Convert to Image' },
  ];
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
      {tabs.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-1 justify-center sm:flex-none
            ${active === id
              ? 'bg-card text-primary shadow-sm border border-border'
              : 'text-muted-foreground hover:text-foreground'}`}>
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{label.split(' ')[1]}</span>
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPLOAD DROP ZONE (reusable)
═══════════════════════════════════════════════════════════════════════════ */
function DropZone({
  onFiles, multiple = false, label = 'Upload PDF', sublabel = 'Click or drag & drop',
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  label?: string;
  sublabel?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = (files: FileList | null) => {
    if (!files) return;
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (pdfs.length) onFiles(pdfs);
  };

  if (compact) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => inputRef.current?.click()}>
        <Upload className="w-3.5 h-3.5" /> {label}
        <input ref={inputRef} type="file" accept="application/pdf" multiple={multiple} className="hidden"
          onChange={(e) => handle(e.target.files)} />
      </Button>
    );
  }

  return (
    <div
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all
        ${dragging ? 'border-primary bg-accent' : 'border-border hover:border-primary/50 hover:bg-muted/40'}`}>
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <Upload className="w-6 h-6 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
      </div>
      <input ref={inputRef} type="file" accept="application/pdf" multiple={multiple} className="hidden"
        onChange={(e) => handle(e.target.files)} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF MERGER
═══════════════════════════════════════════════════════════════════════════ */
interface MergeItem {
  id: string;
  file: File;
  pageCount: number;
  thumbnail: string;
}

function MergerSection() {
  const { toast } = useToast();
  const [items, setItems] = useState<MergeItem[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const addFiles = async (files: File[]) => {
    const newItems: MergeItem[] = [];
    for (const file of files) {
      try {
        const [pageCount, thumbnail] = await Promise.all([
          getPdfPageCount(file),
          getPdfFirstThumb(file),
        ]);
        newItems.push({ id: uid(), file, pageCount, thumbnail });
      } catch {
        toast({ title: `Failed to read ${file.name}`, variant: 'destructive' });
      }
    }
    setItems((prev) => [...prev, ...newItems]);
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  /* Drag-and-drop reorder */
  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); setDragOverId(id); };
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    setItems((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((i) => i.id === dragId);
      const toIdx   = arr.findIndex((i) => i.id === targetId);
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
    setDragId(null); setDragOverId(null);
  };
  const handleDragEnd = () => { setDragId(null); setDragOverId(null); };

  const executeMerge = async () => {
    if (items.length < 2) { toast({ title: 'Add at least 2 PDFs to merge' }); return; }
    setIsMerging(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const merged = await PDFDocument.create();
      for (const item of items) {
        const buf = await item.file.arrayBuffer();
        const src = await PDFDocument.load(buf);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      const bytes = await merged.save();
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      triggerDownload(blob, 'Merged_Document.pdf');
      toast({ title: `Merged ${items.length} PDFs successfully` });
    } catch {
      toast({ title: 'Merge failed', variant: 'destructive' });
    } finally { setIsMerging(false); }
  };

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const totalPages = items.reduce((s, i) => s + i.pageCount, 0);
  const totalSize  = items.reduce((s, i) => s + i.file.size, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      {items.length > 0 && (
        <div className="border-b border-border bg-muted/30 px-5 py-2.5 flex items-center gap-4 text-xs text-muted-foreground shrink-0">
          <span><span className="font-bold text-foreground">{items.length}</span> documents</span>
          <span><span className="font-bold text-foreground">{totalPages}</span> pages total</span>
          <span><span className="font-bold text-foreground">{formatBytes(totalSize)}</span></span>
          <div className="ml-auto flex items-center gap-2">
            <DropZone onFiles={addFiles} multiple compact label="Add More" />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <DropZone
              onFiles={addFiles}
              multiple
              label="Upload PDFs to Merge"
              sublabel="Add 2 or more PDF files · drag to reorder · multiple supported"
            />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => handleDragStart(item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDrop={(e) => handleDrop(e, item.id)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 bg-card border rounded-xl p-3 transition-all cursor-grab active:cursor-grabbing
                    ${dragOverId === item.id ? 'border-primary ring-2 ring-primary/20 scale-[1.01]' : 'border-border hover:border-primary/40'}
                    ${dragId === item.id ? 'opacity-50' : 'opacity-100'}`}>
                  {/* Drag handle */}
                  <GripVertical className="w-4 h-4 text-muted-foreground/50 shrink-0 cursor-grab" />

                  {/* Order badge */}
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </div>

                  {/* Thumbnail */}
                  {item.thumbnail && (
                    <img src={item.thumbnail} alt="p.1" className="h-10 w-auto rounded border border-border object-contain shrink-0" />
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">{item.pageCount} pages · {formatBytes(item.file.size)}</p>
                  </div>

                  {/* Remove */}
                  <button onClick={() => removeItem(item.id)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Add more row */}
              <div
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true;
                  input.onchange = () => { if (input.files) addFiles(Array.from(input.files)); };
                  input.click();
                }}
                className="flex items-center gap-3 border-2 border-dashed border-border rounded-xl p-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all">
                <Plus className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Add more PDFs…</span>
              </div>
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-border bg-card px-5 py-3 flex items-center gap-3 shrink-0">
        <p className="text-xs text-muted-foreground flex-1">
          {items.length < 2 ? 'Add at least 2 PDFs to merge' : `Ready to merge ${items.length} documents into one PDF`}
        </p>
        <Button variant="outline" size="sm" onClick={executeMerge}
          disabled={items.length < 2 || isMerging}>
          <Download className="w-4 h-4 mr-1.5" /> Download
        </Button>
        <Button size="sm" onClick={executeMerge}
          disabled={items.length < 2 || isMerging}
          className="gap-1.5">
          {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
          Execute Merge
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF SPLITTER
═══════════════════════════════════════════════════════════════════════════ */
function SplitterSection() {
  const { toast } = useToast();
  const splitInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loadingThumbs, setLoadingThumbs] = useState(false);
  const [thumbProgress, setThumbProgress] = useState(0);
  const [rangeStr, setRangeStr] = useState('');
  const [isSplitting, setIsSplitting] = useState(false);
  const [zoom, setZoom] = useState(1);

  const parsedPages = (() => {
    try { return rangeStr.trim() ? parsePagesRange(rangeStr, pageCount) : []; } catch { return null; }
  })();
  const selectedSet = new Set(parsedPages ?? []);

  const handleFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f); setThumbnails([]); setRangeStr('');
    setLoadingThumbs(true); setThumbProgress(0);
    try {
      const count = await getPdfPageCount(f);
      setPageCount(count);
      setRangeStr(`1-${count}`);
      const thumbs = await generateThumbnails(f, (i) => setThumbProgress(Math.round((i / count) * 100)));
      setThumbnails(thumbs);
    } catch { toast({ title: 'Failed to read PDF', variant: 'destructive' }); }
    finally { setLoadingThumbs(false); }
  };

  const togglePage = (pn: number) => {
    const current = parsedPages ?? [];
    const next = current.includes(pn) ? current.filter((p) => p !== pn) : [...current, pn].sort((a, b) => a - b);
    setRangeStr(pagesToRange(next));
  };

  const executeSplit = async () => {
    if (!file || !parsedPages || parsedPages.length === 0) {
      toast({ title: 'Select pages to extract' }); return;
    }
    setIsSplitting(true);
    try {
      const blob = await splitPdf(file, parsedPages);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name.replace('.pdf', '')}_pages_${rangeStr.replace(/\s/g, '')}.pdf`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: `Extracted ${parsedPages.length} pages` });
    } catch { toast({ title: 'Split failed', variant: 'destructive' }); }
    finally { setIsSplitting(false); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-5 py-2.5 flex items-center gap-3 shrink-0">
        {file ? (
          <>
            <FileText className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate flex-1">{file.name}</span>
            <span className="text-xs text-muted-foreground">{pageCount} pages</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(2, z + 0.25))} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => splitInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Upload PDF
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Upload a PDF to split</span>
        )}
        <input ref={splitInputRef} type="file" accept="application/pdf" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile([e.target.files[0]]); e.target.value = ''; }} />
      </div>

      {/* Page range row */}
      {file && (
        <div className="border-b border-border px-5 py-2 flex items-center gap-3 bg-muted/20 shrink-0 flex-wrap">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">Pages</label>
          <Input
            value={rangeStr}
            onChange={(e) => setRangeStr(e.target.value)}
            placeholder={`e.g. 1-3, 5, 7-${pageCount}`}
            className={`h-8 text-xs font-mono flex-1 min-w-[160px] max-w-xs ${parsedPages === null ? 'border-red-400' : ''}`}
          />
          {parsedPages !== null && parsedPages.length > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">{parsedPages.length} page{parsedPages.length !== 1 ? 's' : ''} selected</span>
          )}
          {parsedPages === null && (
            <span className="text-xs text-red-500 flex items-center gap-1 shrink-0">
              <AlertCircle className="w-3.5 h-3.5" /> Invalid range
            </span>
          )}
          <button onClick={() => setRangeStr(`1-${pageCount}`)}
            className="text-xs text-muted-foreground underline hover:text-foreground shrink-0">All</button>
          <button onClick={() => setRangeStr('')}
            className="text-xs text-muted-foreground underline hover:text-foreground shrink-0">Clear</button>
        </div>
      )}

      {/* Thumbnail grid */}
      <ScrollArea className="flex-1">
        {!file ? (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <DropZone onFiles={handleFile} label="Upload PDF to Split" sublabel="Select pages or ranges to extract" />
          </div>
        ) : loadingThumbs ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <div className="w-48">
              <Progress value={thumbProgress} className="h-1.5" />
              <p className="text-xs text-muted-foreground text-center mt-1">{thumbProgress}%</p>
            </div>
          </div>
        ) : (
          <div className="p-4 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(80 * zoom)}px, 1fr))` }}>
            {thumbnails.map((thumb, i) => {
              const pn = i + 1;
              const isSelected = selectedSet.has(pn);
              return (
                <div key={pn}
                  onClick={() => togglePage(pn)}
                  className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all group
                    ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}>
                  <img src={thumb} alt={`p.${pn}`} className="w-full object-contain block" />
                  {isSelected && (
                    <div className="absolute top-1 right-1">
                      <CheckSquare className="w-4 h-4 text-primary bg-white rounded" />
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-background/80 py-0.5 text-center">
                    <span className="text-[10px] font-mono text-muted-foreground">{pn}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border bg-card px-5 py-3 flex items-center gap-3 shrink-0">
        <p className="text-xs text-muted-foreground flex-1">
          {!file ? 'No document loaded' : parsedPages === null ? 'Fix the page range above' : parsedPages.length === 0 ? 'Enter pages to extract' : `Extracting ${parsedPages.length} page${parsedPages.length !== 1 ? 's' : ''} from ${pageCount}`}
        </p>
        <Button variant="outline" size="sm" onClick={executeSplit}
          disabled={!file || !parsedPages || parsedPages.length === 0 || isSplitting}>
          <Download className="w-4 h-4 mr-1.5" /> Export
        </Button>
        <Button size="sm" onClick={executeSplit}
          disabled={!file || !parsedPages || parsedPages.length === 0 || isSplitting}
          className="gap-1.5">
          {isSplitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
          Split Document
        </Button>
      </div>
    </div>
  );
}

function pagesToRange(pages: number[]): string {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) { end = sorted[i]; }
    else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = sorted[i]; end = sorted[i]; }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(', ');
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORMAT CONVERTER (PDF → JPG/PNG)
═══════════════════════════════════════════════════════════════════════════ */
function ConverterSection() {
  const { toast } = useToast();
  const convertInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg');
  const [quality, setQuality] = useState(85);
  const [scale, setScale] = useState(2.0);
  const [rangeStr, setRangeStr] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [convertedImages, setConvertedImages] = useState<{ pn: number; url: string }[]>([]);
  const [previewImg, setPreviewImg] = useState<{ pn: number; url: string } | null>(null);

  const handleFile = async (files: File[]) => {
    const f = files[0]; if (!f) return;
    setFile(f); setConvertedImages([]);
    try {
      const cnt = await getPdfPageCount(f);
      setPageCount(cnt); setRangeStr(`1-${cnt}`);
    } catch { toast({ title: 'Failed to read PDF', variant: 'destructive' }); }
  };

  const parsedPages = (() => {
    try { return rangeStr.trim() ? parsePagesRange(rangeStr, pageCount) : []; } catch { return null; }
  })();

  const executeConvert = async () => {
    if (!file || !parsedPages || parsedPages.length === 0) {
      toast({ title: 'Select pages to convert' }); return;
    }
    setIsConverting(true); setProgress(0); setCurrentPage(0); setConvertedImages([]);
    try {
      const images = await pdfPagesToImages(file, format, quality / 100, parsedPages, (i, total) => {
        setCurrentPage(i); setProgress(Math.round((i / total) * 100));
      });
      setConvertedImages(images.map((img) => ({ pn: img.pageNumber, url: img.dataUrl })));
      toast({ title: `Converted ${images.length} pages to ${format.toUpperCase()}` });
    } catch { toast({ title: 'Conversion failed', variant: 'destructive' }); }
    finally { setIsConverting(false); }
  };

  const downloadAll = async () => {
    if (convertedImages.length === 0) return;
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const baseName = file?.name.replace('.pdf', '') ?? 'page';
    convertedImages.forEach(({ pn, url }) => {
      const base64 = url.split(',')[1];
      zip.file(`${baseName}_page${pn}.${format}`, base64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}_images.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const downloadOne = (url: string, pn: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name.replace('.pdf', '') ?? 'page'}_p${pn}.${format}`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-5 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => convertInputRef.current?.click()}>
          <Upload className="w-3.5 h-3.5" /> Upload PDF
        </Button>
        {file && (
          <>
            <span className="text-sm font-semibold text-foreground truncate max-w-[200px]">{file.name}</span>
            <span className="text-xs text-muted-foreground">{pageCount} pages</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          {/* Format toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-semibold">
            {(['jpg', 'png'] as const).map((f) => (
              <button key={f} onClick={() => setFormat(f)}
                className={`px-3 py-1.5 transition-colors ${format === f ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {/* Quality (only for jpg) */}
          {format === 'jpg' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Quality</span>
              <input type="range" min={20} max={100} step={5} value={quality}
                onChange={(e) => setQuality(+e.target.value)}
                className="w-20 accent-primary" />
              <span className="text-xs font-mono w-8">{quality}%</span>
            </div>
          )}
          {/* Scale */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Scale</span>
            <select value={scale} onChange={(e) => setScale(+e.target.value)}
              className="text-xs border border-border rounded px-2 py-1 bg-card">
              <option value={1}>1× (72dpi)</option>
              <option value={2}>2× (144dpi)</option>
              <option value={3}>3× (216dpi)</option>
              <option value={4}>4× (288dpi)</option>
            </select>
          </div>
        </div>
        <input ref={convertInputRef} type="file" accept="application/pdf" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile([e.target.files[0]]); e.target.value = ''; }} />
      </div>

      {/* Page range */}
      {file && (
        <div className="border-b border-border px-5 py-2 bg-muted/20 flex items-center gap-3 shrink-0 flex-wrap">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">Pages</label>
          <Input
            value={rangeStr}
            onChange={(e) => setRangeStr(e.target.value)}
            placeholder={`e.g. 1-3, 5, 7-${pageCount}`}
            className={`h-8 text-xs font-mono flex-1 min-w-[160px] max-w-xs ${parsedPages === null ? 'border-red-400' : ''}`}
          />
          {parsedPages !== null && parsedPages.length > 0 && (
            <span className="text-xs text-muted-foreground">{parsedPages.length} page{parsedPages.length !== 1 ? 's' : ''}</span>
          )}
          <button onClick={() => setRangeStr(`1-${pageCount}`)} className="text-xs text-muted-foreground underline hover:text-foreground">All</button>
        </div>
      )}

      {/* Progress */}
      {isConverting && (
        <div className="border-b border-border bg-accent/30 px-5 py-2 flex items-center gap-3 shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium">Converting page {currentPage} of {parsedPages?.length ?? 0}…</p>
            <Progress value={progress} className="h-1 mt-1" />
          </div>
          <span className="text-xs font-mono text-muted-foreground">{progress}%</span>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        {!file ? (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <DropZone onFiles={handleFile} label="Upload PDF to Convert" sublabel={`Each page becomes a ${format.toUpperCase()} image`} />
          </div>
        ) : convertedImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4 text-muted-foreground">
            <ImageIcon className="w-10 h-10 opacity-20" />
            <p className="text-sm">Configure options above, then click Convert</p>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {convertedImages.map(({ pn, url }) => (
              <div key={pn} className="relative rounded-lg border border-border overflow-hidden group cursor-pointer"
                onClick={() => setPreviewImg({ pn, url })}>
                <img src={url} alt={`p.${pn}`} className="w-full object-contain block" />
                <div className="absolute bottom-0 inset-x-0 bg-background/80 py-1 flex items-center justify-between px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-mono text-muted-foreground">p.{pn}</span>
                  <button onClick={(e) => { e.stopPropagation(); downloadOne(url, pn); }}
                    className="text-[10px] text-primary underline">Save</button>
                </div>
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-5 h-5 rounded bg-black/40 flex items-center justify-center">
                    <Download className="w-3 h-3 text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border bg-card px-5 py-3 flex items-center gap-3 shrink-0">
        <p className="text-xs text-muted-foreground flex-1">
          {!file ? 'No document loaded' : isConverting ? `Converting… (${currentPage}/${parsedPages?.length ?? 0})` : convertedImages.length > 0 ? `${convertedImages.length} images ready` : 'Ready to convert'}
        </p>
        {convertedImages.length > 0 && (
          <Button variant="outline" size="sm" onClick={downloadAll} className="gap-1.5">
            <Download className="w-4 h-4" /> Download ZIP
          </Button>
        )}
        <Button size="sm" onClick={executeConvert}
          disabled={!file || !parsedPages || parsedPages.length === 0 || isConverting}
          className="gap-1.5">
          {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
          Convert to {format.toUpperCase()}
        </Button>
      </div>

      {/* Preview modal */}
      {previewImg && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreviewImg(null)}>
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewImg(null)}
              className="absolute -top-9 right-0 text-white/70 hover:text-white flex items-center gap-1 text-sm">
              <X className="w-4 h-4" /> Close
            </button>
            <img src={previewImg.url} alt={`p.${previewImg.pn}`} className="w-full rounded-xl border border-white/20 shadow-2xl" />
            <div className="flex items-center justify-between mt-2">
              <span className="text-white/60 text-sm">Page {previewImg.pn}</span>
              <button onClick={() => downloadOne(previewImg.url, previewImg.pn)}
                className="text-white/80 hover:text-white text-sm underline flex items-center gap-1">
                <Download className="w-3.5 h-3.5" /> Save image
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════════════════════════════════════ */
export function PdfToolsTab() {
  const [subTab, setSubTab] = useState<ToolSubTab>('merge');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab nav */}
      <div className="border-b border-border bg-card px-4 py-2.5 shrink-0">
        <SubTabNav active={subTab} onChange={setSubTab} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {subTab === 'merge'   && <MergerSection />}
        {subTab === 'split'   && <SplitterSection />}
        {subTab === 'convert' && <ConverterSection />}
      </div>
    </div>
  );
}
