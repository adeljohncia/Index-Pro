import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FileText, Download, Printer, Plus, Trash2, Loader2,
  Pencil, Check, X, Eye, UploadCloud, LayoutGrid,
  Settings2, Gauge, Database, Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  analyzePdfPages, generateThumbnails, computeAttachmentIndices,
  processAndMergePdfs, generatePrintTemplateHtml, PageAnalysis,
  FormatLevels, DEFAULT_FORMAT_LEVELS, codeForContentPage,
} from '@/lib/pdf-utils';

/* ─── Types ─────────────────────────────────────────────────────────────── */
function uid() { return Math.random().toString(36).substring(2, 9); }
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

interface GlobalSettings {
  prefix: string;
  startNumber: number;
  format: FormatLevels;
  topMarginCm: number;
  sideMarginCm: number;
  fontSize: number;
  bold: boolean;
}

interface PdfEntry {
  id: string;
  file: File;
  mainCode: string;
  pages: PageAnalysis[];
  isAnalyzing: boolean;
  thumbnails: string[];
  isLoadingThumbnails: boolean;
  thumbnailProgress: number;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function buildMainCode(prefix: string, num: number) {
  return `<${prefix}${num}>`;
}

/* ─── Sidebar ────────────────────────────────────────────────────────────── */
const NAV = [
  { icon: LayoutGrid, label: 'Dashboard' },
  { icon: FileText,   label: 'Processor' },
  { icon: Settings2,  label: 'Indexing Rules', active: true },
  { icon: Printer,    label: 'Export Hub' },
];

function Sidebar({ totalDocs, totalStamps }: { totalDocs: number; totalStamps: number }) {
  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-sidebar h-screen fixed left-0 top-0 z-20">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-border">
        <div className="w-7 h-7 rounded bg-primary flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-sm text-foreground leading-tight">Index Stamper</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ icon: Icon, label, active }) => (
          <div key={label}
            className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm
              ${active
                ? 'bg-accent text-primary font-semibold border-l-2 border-primary pl-[10px]'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </div>
        ))}
      </nav>

      {/* Status */}
      <div className="px-4 pb-5 pt-3 border-t border-border space-y-3">
        <p className="label-caps text-muted-foreground">System Status</p>
        <div className="space-y-2">
          {[
            { label: 'Engine', value: 'Active', green: true },
            { label: 'Queue', value: `${totalDocs} doc${totalDocs !== 1 ? 's' : ''}` },
            { label: 'Stamps', value: totalStamps.toString(), green: totalStamps > 0 },
          ].map(({ label, value, green }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-muted-foreground">{label}</span>
              <span className={`text-[11px] font-mono font-semibold ${green ? 'text-emerald-600' : 'text-foreground'}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/* ─── Label caps helper ──────────────────────────────────────────────────── */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="label-caps text-muted-foreground mb-1">{children}</p>;
}

/* ─── Card wrapper ───────────────────────────────────────────────────────── */
function Panel({ title, icon: Icon, children, className = '' }: {
  title: string; icon: React.ElementType; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-card border border-card-border rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function IndexerHome() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<number, string>>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);

  const [settings, setSettings] = useState<GlobalSettings>({
    prefix: 'A', startNumber: 1, format: DEFAULT_FORMAT_LEVELS,
    topMarginCm: 0.5, sideMarginCm: 0.5,
    fontSize: 16, bold: false,
  });

  const toggleFormatLevel = (level: keyof FormatLevels) =>
    setSettings((p) => ({ ...p, format: { ...p.format, [level]: !p.format[level] } }));

  const updateSetting = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]) =>
    setSettings((p) => ({ ...p, [k]: v }));

  /* ── Computed ──────────────────────────────────────────────────────────── */
  const processedEntries = useMemo(() =>
    entries.map((e) => ({
      ...e,
      pages: computeAttachmentIndices(e.pages, e.mainCode, overrides[e.id] ?? {}, settings.format),
    })), [entries, overrides, settings.format.level1, settings.format.level2, settings.format.level3]);

  const totalStamps = useMemo(() => processedEntries.reduce((s, e) => s + e.pages.filter((p) => p.assignedIndex).length, 0), [processedEntries]);
  const totalPages  = useMemo(() => entries.reduce((s, e) => s + e.pages.length, 0), [entries]);
  const totalBlank  = useMemo(() => entries.reduce((s, e) => s + e.pages.filter((p) => p.isBlank).length, 0), [entries]);
  const totalSize   = useMemo(() => entries.reduce((s, e) => s + e.file.size, 0), [entries]);
  const anyAnalyzing = entries.some((e) => e.isAnalyzing);

  /* Live preview codes — computed from actual logic */
  const previewMainCode = `<${settings.prefix}${settings.startNumber}>`;
  const previewCodes = useMemo(() => {
    return [0, 1, 2, 3].map((i) => codeForContentPage(previewMainCode, i, settings.format));
  }, [previewMainCode, settings.format.level1, settings.format.level2, settings.format.level3]);

  /* ── File loading ──────────────────────────────────────────────────────── */
  const loadEntry = useCallback(async (entry: PdfEntry) => {
    try {
      const pages = await analyzePdfPages(entry.file);
      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, pages, isAnalyzing: false, isLoadingThumbnails: true } : e));
      generateThumbnails(entry.file, (idx) => {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, thumbnailProgress: idx } : e));
      }).then((thumbs) => {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, thumbnails: thumbs, isLoadingThumbnails: false } : e));
      });
    } catch {
      toast({ title: 'Error reading PDF', description: entry.file.name, variant: 'destructive' });
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    }
  }, [toast]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (!pdfs.length) { toast({ title: 'PDF files only', variant: 'destructive' }); return; }
    setEntries((prev) => {
      const newEntries: PdfEntry[] = pdfs.map((file, i) => {
        const num = settings.startNumber + prev.length + i;
        return {
          id: uid(), file,
          mainCode: buildMainCode(settings.prefix, num),
          pages: [], isAnalyzing: true,
          thumbnails: [], isLoadingThumbnails: false, thumbnailProgress: 0,
        };
      });
      newEntries.forEach((e) => loadEntry(e));
      return [...prev, ...newEntries];
    });
  }, [loadEntry, settings.prefix, settings.startNumber, toast]);

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

  const updateCode = (id: string, code: string) =>
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, mainCode: code } : e));

  /* ── Inline edit ───────────────────────────────────────────────────────── */
  const startEdit = (entryId: string, page: PageAnalysis) => {
    setEditingKey(`${entryId}:${page.pageNumber}`);
    setEditValue(page.assignedIndex ?? '');
    setTimeout(() => editInputRef.current?.focus(), 0);
  };
  const commitEdit = (entryId: string, pn: number) => {
    setOverrides((p) => ({ ...p, [entryId]: { ...(p[entryId] ?? {}), [pn]: editValue } }));
    setEditingKey(null);
  };
  const clearOverride = (entryId: string, pn: number) => {
    setOverrides((p) => { const o = { ...(p[entryId] ?? {}) }; delete o[pn]; return { ...p, [entryId]: o }; });
  };

  /* ── Actions ───────────────────────────────────────────────────────────── */
  const handleProcess = async () => {
    setIsProcessing(true);
    try {
      const blob = await processAndMergePdfs(
        processedEntries.map((e) => ({ file: e.file, pages: e.pages })),
        { topMarginCm: settings.topMarginCm, sideMarginCm: settings.sideMarginCm, fontSize: settings.fontSize, bold: settings.bold }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'Indexed_Combined.pdf'; a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Download ready', description: 'Stamped PDF saved.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Processing failed', variant: 'destructive' });
    } finally { setIsProcessing(false); }
  };

  const handlePrint = () => {
    const html = generatePrintTemplateHtml(
      processedEntries.map((e) => ({ fileName: e.file.name, mainCode: e.mainCode, pages: e.pages }))
    );
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  };

  const previewEntry = previewEntryId ? processedEntries.find((e) => e.id === previewEntryId) ?? null : null;

  /* ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar totalDocs={entries.length} totalStamps={totalStamps} />

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden ml-56">

        {/* Top bar */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-foreground">Indexing Rules</h2>
            <p className="text-xs text-muted-foreground">Define index codes, margins, and typography</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!entries.length || anyAnalyzing || totalStamps === 0}
              onClick={handlePrint} data-testid="button-print">
              <Printer className="w-4 h-4 mr-1.5" /> Print Template
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!entries.length || anyAnalyzing || isProcessing || totalStamps === 0}
              onClick={handleProcess} data-testid="button-process">
              {isProcessing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
              Apply &amp; Export
            </Button>
          </div>
        </header>

        {/* Two-column body */}
        <div className="flex-1 flex overflow-hidden">

          {/* ═══ LEFT: Files ═══════════════════════════════════════════════ */}
          <div className="w-[400px] shrink-0 flex flex-col border-r border-border overflow-hidden bg-muted/30">

            {/* Upload zone */}
            <div className="p-4 border-b border-border">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center justify-center gap-3 h-14 border-2 border-dashed rounded-lg cursor-pointer transition-all
                  ${isDragging ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-accent/50'}`}
                data-testid="drop-zone">
                <UploadCloud className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Add PDF files</p>
                  <p className="text-xs text-muted-foreground">Click or drag &amp; drop · multiple supported</p>
                </div>
                <Button size="sm" variant="outline" className="ml-auto mr-0 shrink-0 pointer-events-none">Browse</Button>
                <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={handleFileInput} data-testid="input-files" />
              </div>
            </div>

            {/* File list */}
            <ScrollArea className="flex-1">
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                  <Database className="w-8 h-8 opacity-20" />
                  <p className="text-sm">No files added yet</p>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {entries.map((entry, idx) => {
                    const processed = processedEntries.find((e) => e.id === entry.id);
                    const stamps = processed?.pages.filter((p) => p.assignedIndex).length ?? 0;
                    const blank = entry.pages.filter((p) => p.isBlank).length;
                    return (
                      <div key={entry.id} className="bg-card border border-border rounded-xl overflow-hidden" data-testid={`pdf-entry-${idx}`}>
                        {/* Header */}
                        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border">
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{entry.file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.isAnalyzing
                                ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Analyzing…</span>
                                : `${entry.pages.length} pages · ${blank} blank · ${stamps} stamps`}
                            </p>
                          </div>
                          {!entry.isAnalyzing && entry.pages.length > 0 && (
                            <button onClick={() => setPreviewEntryId(entry.id)}
                              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                              data-testid={`button-preview-${idx}`}>
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => removeEntry(entry.id)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            data-testid={`button-remove-${idx}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Code input */}
                        <div className="flex items-center gap-2 px-3.5 py-2">
                          <span className="label-caps whitespace-nowrap">Attachment Code</span>
                          <Input value={entry.mainCode}
                            onChange={(e) => updateCode(entry.id, e.target.value)}
                            className="h-7 text-xs font-mono flex-1 border-border"
                            data-testid={`input-code-${idx}`} />
                        </div>

                        {/* Thumbnail strip */}
                        {entry.thumbnails.length > 0 && (
                          <div className="flex gap-1.5 px-3.5 pb-3 overflow-x-auto">
                            {entry.thumbnails.slice(0, 5).map((src, i) => (
                              <div key={i} className="relative shrink-0 cursor-pointer" onClick={() => setPreviewEntryId(entry.id)}>
                                <img src={src} alt={`Page ${i + 1}`}
                                  className="h-14 w-auto rounded border border-border object-cover hover:border-primary transition-colors" />
                                {entry.pages[i]?.isBlank && (
                                  <div className="absolute inset-0 bg-background/60 rounded flex items-center justify-center">
                                    <span className="text-[8px] text-muted-foreground font-semibold">BLANK</span>
                                  </div>
                                )}
                              </div>
                            ))}
                            {entry.pages.length > 5 && (
                              <div onClick={() => setPreviewEntryId(entry.id)}
                                className="h-14 w-10 rounded border border-border bg-muted flex items-center justify-center cursor-pointer hover:border-primary transition-colors shrink-0">
                                <span className="text-[10px] text-muted-foreground">+{entry.pages.length - 5}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {entry.isLoadingThumbnails && entry.pages.length > 0 && (
                          <div className="px-3.5 pb-3">
                            <Progress value={(entry.thumbnailProgress / entry.pages.length) * 100} className="h-1" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Batch summary */}
            {entries.length > 0 && (
              <div className="border-t border-border bg-card p-4 shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-bold text-foreground uppercase tracking-wide">Batch Summary</span>
                  </div>
                  <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                    ${anyAnalyzing ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${anyAnalyzing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse'}`} />
                    {anyAnalyzing ? 'Analyzing' : 'Ready'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Docs',   value: entries.length.toString(), accent: false },
                    { label: 'Pages',  value: totalPages.toString(),     accent: false },
                    { label: 'Stamps', value: totalStamps.toString(),    accent: true  },
                    { label: 'Size',   value: formatBytes(totalSize),    accent: false },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="bg-muted/60 rounded-lg p-2 text-center border border-border">
                      <p className="label-caps text-muted-foreground">{label}</p>
                      <p className={`text-sm font-bold font-mono mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ═══ RIGHT: Config cards ════════════════════════════════════════ */}
          <ScrollArea className="flex-1">
            <div className="p-5 space-y-4">

              {/* ── Index Code Format ──────────────────────────────────── */}
              <Panel title="Index Code Format" icon={Zap}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <FieldLabel>Prefix</FieldLabel>
                    <Input value={settings.prefix} onChange={(e) => updateSetting('prefix', e.target.value)}
                      className="h-9 font-mono text-sm" placeholder="A" data-testid="input-prefix" />
                  </div>
                  <div>
                    <FieldLabel>Start Number</FieldLabel>
                    <Input type="number" min={1} value={settings.startNumber}
                      onChange={(e) => updateSetting('startNumber', parseInt(e.target.value) || 1)}
                      className="h-9 font-mono text-sm" data-testid="input-start-number" />
                  </div>
                </div>
                {/* Format level checkboxes */}
                <div className="mb-4">
                  <FieldLabel>Format Levels</FieldLabel>
                  <div className="space-y-2 mt-1">
                    {([
                      { key: 'level1' as const, label: '<A1>', desc: 'First content page uses the base attachment code' },
                      { key: 'level2' as const, label: '<A1-1>', desc: 'Sub-pages numbered with one extra level' },
                      { key: 'level3' as const, label: '<A1-1-1>', desc: 'Deep sub-pages numbered with two extra levels' },
                    ]).map(({ key, label, desc }) => {
                      const active = settings.format[key];
                      return (
                        <label key={key}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none
                            ${active
                              ? 'border-primary/40 bg-primary/5 text-foreground'
                              : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'}`}
                          onClick={() => toggleFormatLevel(key)}>
                          {/* Custom checkbox */}
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                            ${active ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                            {active && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                          </div>
                          <code className={`font-mono text-sm font-bold shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                            {label}
                          </code>
                          <span className="text-xs leading-tight">{desc}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Live preview — exact codes from real logic */}
                <div>
                  <FieldLabel>Preview — how pages will be stamped</FieldLabel>
                  <div className="rounded-lg bg-[#1a1d27] border border-white/10 px-4 py-3">
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                      {previewCodes.map((code, i) => (
                        <React.Fragment key={i}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-white/30 text-[10px] font-mono">p.{i + 1}</span>
                            <span className={`font-mono text-sm font-bold ${i === 0 ? 'text-blue-400' : 'text-blue-300'}`}>
                              {code}
                            </span>
                          </div>
                          {i < previewCodes.length - 1 && (
                            <span className="text-white/20 text-xs">→</span>
                          )}
                        </React.Fragment>
                      ))}
                      <span className="font-mono text-sm text-white/25">&hellip;</span>
                    </div>
                    {!settings.format.level1 && !settings.format.level2 && !settings.format.level3 && (
                      <p className="text-amber-400/60 text-[10px] font-mono mt-2">No levels enabled — enable at least one.</p>
                    )}
                  </div>
                </div>
              </Panel>

              {/* ── Three smaller cards ──────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-4">

                {/* Sequence */}
                <Panel title="Sequence" icon={Settings2}>
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>From Page</FieldLabel>
                      <Input type="number" min={1} defaultValue={1} className="h-9 font-mono text-sm" />
                    </div>
                    <div>
                      <FieldLabel>To Page</FieldLabel>
                      <Input type="number" min={1} placeholder="Last" className="h-9 font-mono text-sm" />
                    </div>
                    <label className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg border border-border cursor-pointer">
                      <input type="checkbox" defaultChecked className="rounded accent-primary w-3.5 h-3.5" />
                      <span className="text-xs font-medium text-foreground">Auto-increment index</span>
                    </label>
                  </div>
                </Panel>

                {/* Margins */}
                <Panel title="Layout Margins" icon={LayoutGrid}>
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>Top Margin</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Input type="number" step={0.1} min={0} value={settings.topMarginCm}
                          onChange={(e) => updateSetting('topMarginCm', parseFloat(e.target.value) || 0.5)}
                          className="h-9 font-mono text-sm flex-1" data-testid="input-top-margin" />
                        <span className="text-xs text-muted-foreground font-mono w-6">cm</span>
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Side Margin</FieldLabel>
                      <div className="flex items-center gap-2">
                        <Input type="number" step={0.1} min={0} value={settings.sideMarginCm}
                          onChange={(e) => updateSetting('sideMarginCm', parseFloat(e.target.value) || 0.5)}
                          className="h-9 font-mono text-sm flex-1" data-testid="input-side-margin" />
                        <span className="text-xs text-muted-foreground font-mono w-6">cm</span>
                      </div>
                    </div>
                    {/* Visual diagram */}
                    <div className="border border-border rounded-md p-3 flex items-center justify-center bg-muted/30 h-[72px] relative">
                      <div className="w-12 h-16 border border-border rounded bg-card relative shrink-0">
                        <div className="absolute top-0.5 left-0.5 w-1.5 h-0.5 bg-primary rounded-full" />
                        <div className="absolute top-0.5 right-0.5 w-1.5 h-0.5 bg-primary/40 rounded-full" />
                      </div>
                      <div className="ml-3 text-left">
                        <p className="text-[10px] text-muted-foreground leading-4">Odd → Top Left</p>
                        <p className="text-[10px] text-muted-foreground leading-4">Even → Top Right</p>
                        <p className="text-[10px] font-mono text-primary">{settings.topMarginCm}cm / {settings.sideMarginCm}cm</p>
                      </div>
                    </div>
                  </div>
                </Panel>

                {/* Typography */}
                <Panel title="Index Typography" icon={FileText}>
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>Font Family</FieldLabel>
                      <Select defaultValue="arial">
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="arial">Arial (Default)</SelectItem>
                          <SelectItem value="helvetica">Helvetica</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel>Font Size</FieldLabel>
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={8} max={36} value={settings.fontSize}
                            onChange={(e) => updateSetting('fontSize', parseInt(e.target.value) || 16)}
                            className="h-9 font-mono text-sm" data-testid="input-font-size" />
                          <span className="text-xs text-muted-foreground">pt</span>
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Weight</FieldLabel>
                        <Select value={settings.bold ? 'bold' : 'regular'}
                          onValueChange={(v) => updateSetting('bold', v === 'bold')}>
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="regular">Regular</SelectItem>
                            <SelectItem value="bold">Bold</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {/* Typography preview */}
                    <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-center">
                      <span style={{ fontSize: `${Math.min(settings.fontSize, 22)}px`, fontWeight: settings.bold ? 700 : 400 }}
                        className="font-sans text-foreground">
                        {previewMainCode}
                      </span>
                    </div>
                  </div>
                </Panel>
              </div>

              {/* ── Page Analysis table ───────────────────────────────────── */}
              {entries.length > 0 && (
                <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">Page Analysis</h3>
                    </div>
                    <div className="flex items-center gap-3">
                      {Object.values(overrides).some((o) => Object.keys(o).length > 0) && (
                        <button onClick={() => setOverrides({})} className="text-xs text-muted-foreground hover:text-foreground underline">
                          Clear edits
                        </button>
                      )}
                      <span className="text-xs font-mono text-primary font-semibold">{totalStamps} stamps</span>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border">
                        <TableHead className="label-caps w-[60px] text-center">Page</TableHead>
                        <TableHead className="label-caps w-[80px]">Status</TableHead>
                        <TableHead className="label-caps w-[90px]">Position</TableHead>
                        <TableHead className="label-caps">Assigned Index</TableHead>
                        <TableHead className="w-[44px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processedEntries.map((entry) => (
                        <React.Fragment key={entry.id}>
                          <TableRow className="bg-muted/40 hover:bg-muted/50 border-border">
                            <TableCell colSpan={5} className="py-2 px-4">
                              <div className="flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="text-xs font-semibold text-foreground truncate max-w-[240px]">{entry.file.name}</span>
                                <code className="text-[11px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-mono ml-1">{entry.mainCode}</code>
                                {entry.isAnalyzing && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                                <span className="text-xs text-muted-foreground ml-auto font-mono">
                                  {entry.pages.filter((p) => p.assignedIndex).length} stamped
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {entry.isAnalyzing ? (
                            <TableRow className="border-border">
                              <TableCell colSpan={5} className="py-4 text-center text-sm text-muted-foreground">
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
                                  className={`border-border ${page.isBlank ? 'opacity-50' : 'hover:bg-muted/20'}`}
                                  data-testid={`row-${entry.id}-${page.pageNumber}`}>
                                  <TableCell className="text-center font-mono text-xs text-muted-foreground tabular-nums">{page.pageNumber}</TableCell>
                                  <TableCell>
                                    {page.isBlank
                                      ? <Badge variant="outline" className="text-[10px] text-muted-foreground">Blank</Badge>
                                      : <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-0 hover:bg-primary/10">Content</Badge>}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {page.assignedIndex ? (isOdd ? 'Top Left' : 'Top Right') : '—'}
                                  </TableCell>
                                  <TableCell>
                                    {isEditing ? (
                                      <div className="flex items-center gap-1">
                                        <Input ref={editInputRef} value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(entry.id, page.pageNumber); if (e.key === 'Escape') setEditingKey(null); }}
                                          className="h-7 text-xs font-mono w-28" data-testid={`input-edit-${editKey}`} />
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600"
                                          onClick={() => commitEdit(entry.id, page.pageNumber)}><Check className="w-3.5 h-3.5" /></Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                                          onClick={() => setEditingKey(null)}><X className="w-3.5 h-3.5" /></Button>
                                      </div>
                                    ) : page.assignedIndex ? (
                                      <div className="flex items-center gap-2">
                                        <code className={`px-2 py-0.5 rounded font-mono text-sm font-semibold ${hasOverride ? 'bg-amber-100 text-amber-700' : 'bg-muted text-foreground'}`}>
                                          {page.assignedIndex}
                                        </code>
                                        {hasOverride && (
                                          <button onClick={() => clearOverride(entry.id, page.pageNumber)}
                                            className="text-xs text-muted-foreground underline hover:text-foreground">reset</button>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground italic">Skipped</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {!page.isBlank && !isEditing && (
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        onClick={() => startEdit(entry.id, page)} data-testid={`button-edit-${editKey}`}>
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
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* ═══ Preview sheet ══════════════════════════════════════════════════ */}
      <Sheet open={!!previewEntryId} onOpenChange={(open) => { if (!open) setPreviewEntryId(null); }}>
        <SheetContent side="right" className="w-[380px] flex flex-col p-0 bg-card border-border">
          <SheetHeader className="px-5 py-4 border-b border-border shrink-0">
            <SheetTitle className="text-sm font-semibold flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" />
              {previewEntry?.file.name ?? 'Preview'}
            </SheetTitle>
            {previewEntry && (
              <p className="text-xs text-muted-foreground">
                {previewEntry.pages.length} pages · {previewEntry.pages.filter((p) => p.isBlank).length} blank ·{' '}
                <code className="text-primary font-mono">{previewEntry.mainCode}</code>
              </p>
            )}
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="p-4 grid grid-cols-2 gap-3">
              {previewEntry?.pages.map((page, i) => {
                const thumb = previewEntry.thumbnails[i];
                const isOdd = page.pageNumber % 2 !== 0;
                return (
                  <div key={page.pageNumber} className="relative rounded-lg border border-border bg-muted/20 overflow-hidden">
                    {thumb ? (
                      <img src={thumb} alt={`Page ${page.pageNumber}`} className="w-full object-contain block" />
                    ) : (
                      <div className="aspect-[3/4] flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                      </div>
                    )}
                    {page.isBlank && (
                      <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Blank</span>
                      </div>
                    )}
                    {page.assignedIndex && (
                      <div className={`absolute top-1 ${isOdd ? 'left-1' : 'right-1'}`}>
                        <code className="text-[9px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded leading-none">
                          {page.assignedIndex}
                        </code>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-background/80 px-2 py-1 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-muted-foreground">p.{page.pageNumber}</span>
                      <span className="text-[10px] text-muted-foreground">{isOdd ? 'L' : 'R'}</span>
                    </div>
                  </div>
                );
              })}
              {previewEntry?.isLoadingThumbnails &&
                Array.from({ length: (previewEntry.pages.length - previewEntry.thumbnails.length) }).map((_, i) => (
                  <div key={`ph-${i}`} className="aspect-[3/4] rounded-lg border border-border bg-muted/20 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  </div>
                ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
