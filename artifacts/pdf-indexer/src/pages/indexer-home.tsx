import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText, Download, Printer, Loader2, Eye,
  LayoutGrid, Settings2, Wrench, Menu, X, FileOutput, ListOrdered,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  analyzePdfPages, generateThumbnails, computeAttachmentIndices,
  processAndMergePdfs, generatePrintTemplateHtml, PageAnalysis,
  FormatLevels, DEFAULT_FORMAT_LEVELS,
} from '@/lib/pdf-utils';

import { DashboardTab } from './tab-dashboard';
import { PdfToolsTab } from './tab-pdf-tools';
import { IndexEditorTab } from './tab-index-editor';
import { ConverterPage } from '@/features/converter/pages/converter-page';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type AppTab = 'dashboard' | 'pdf-tools' | 'index-editor' | 'converter';

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

function buildMainCode(prefix: string, num: number) {
  return `<${prefix}${num}>`;
}

/* ─── Nav items ─────────────────────────────────────────────────────────── */
const NAV_ITEMS: { tab: AppTab; icon: React.ElementType; label: string; shortLabel: string }[] = [
  { tab: 'dashboard',    icon: LayoutGrid, label: 'Dashboard',    shortLabel: 'Home' },
  { tab: 'pdf-tools',    icon: Wrench,     label: 'PDF Tools',    shortLabel: 'Tools' },
  { tab: 'converter',    icon: FileOutput, label: 'Convert & Edit', shortLabel: 'Convert' },
  { tab: 'index-editor', icon: Settings2,  label: 'Index Editor', shortLabel: 'Index' },];

/* ─── Desktop Sidebar ───────────────────────────────────────────────────── */
function DesktopSidebar({
  activeTab, onTabChange, totalDocs, totalStamps, sidebarOpen, setSidebarOpen,
}: {
  activeTab: AppTab;
  onTabChange: (t: AppTab) => void;
  totalDocs: number;
  totalStamps: number;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}) {
  return (
    <aside className={`
      hidden lg:flex flex-col border-r border-border bg-sidebar h-screen fixed left-0 top-0 z-20
      transition-all duration-300
      ${sidebarOpen ? 'w-56' : 'w-14'}
    `}>
      {/* Brand */}
      <div className={`flex items-center gap-2.5 h-14 border-b border-border shrink-0 ${sidebarOpen ? 'px-4' : 'justify-center'}`}>
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-primary-foreground" />
        </div>
        {sidebarOpen && (
          <span className="font-bold text-sm text-foreground leading-tight truncate">Index Pro</span>
        )}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`ml-auto p-1 rounded hover:bg-muted text-muted-foreground transition-colors ${sidebarOpen ? '' : 'hidden'}`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Collapse toggle when closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="h-14 flex items-center justify-center text-muted-foreground hover:text-foreground border-b border-border">
          <Menu className="w-4 h-4" />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ tab, icon: Icon, label }) => {
          const active = activeTab === tab;
          return (
            <button key={tab} onClick={() => onTabChange(tab)}
              title={!sidebarOpen ? label : undefined}
              className={`w-full flex items-center gap-3 rounded-md cursor-pointer transition-colors text-sm
                ${sidebarOpen ? 'px-3 py-2' : 'justify-center py-2.5'}
                ${active
                  ? 'bg-accent text-primary font-semibold border-l-2 border-primary ' + (sidebarOpen ? 'pl-[10px]' : '')
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <Icon className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Status */}
      {sidebarOpen && (
        <div className="px-4 pb-5 pt-3 border-t border-border space-y-2 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">System</p>
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
      )}
    </aside>
  );
}

/* ─── Mobile Bottom Nav ──────────────────────────────────────────────────── */
function MobileBottomNav({ activeTab, onTabChange }: { activeTab: AppTab; onTabChange: (t: AppTab) => void }) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border flex">
      {NAV_ITEMS.map(({ tab, icon: Icon, shortLabel }) => {
        const active = activeTab === tab;
        return (
          <button key={tab} onClick={() => onTabChange(tab)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors
              ${active ? 'text-primary' : 'text-muted-foreground'}`}>
            <Icon className="w-5 h-5" />
            <span className={`text-[10px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}>
              {shortLabel}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ─── Top bar ────────────────────────────────────────────────────────────── */
function TopBar({
  activeTab, entries, anyAnalyzing, isProcessing, totalStamps,
  onProcess, onPrint, sidebarOpen, setSidebarOpen,
}: {
  activeTab: AppTab;
  entries: PdfEntry[];
  anyAnalyzing: boolean;
  isProcessing: boolean;
  totalStamps: number;
  onProcess: () => void;
  onPrint: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}) {
  const tabInfo = NAV_ITEMS.find((n) => n.tab === activeTab)!;

  const subtitles: Record<AppTab, string> = {
    dashboard: 'Overview of your documents and workflow',
    'pdf-tools': 'Merge, split and convert PDF documents',
    converter: 'OCR PDFs into editable DOCX, XLSX, PPTX and structured data',
    'index-editor': 'Configure stamp codes, margins and typography',
    
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6 shrink-0 gap-3">
      {/* Mobile brand + hamburger */}
      <div className="flex items-center gap-3 lg:hidden">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-sm text-foreground">Index Pro</span>
      </div>

      {/* Desktop title */}
      <div className="hidden lg:block">
        <h2 className="text-sm font-bold text-foreground">{tabInfo.label}</h2>
        <p className="text-xs text-muted-foreground">{subtitles[activeTab]}</p>
      </div>

      {/* Desktop sidebar expand */}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)}
          className="hidden lg:flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted text-muted-foreground">
          <Menu className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-center gap-2 ml-auto">
        <Button variant="outline" size="sm"
          className="hidden sm:flex"
          disabled={!entries.length || anyAnalyzing || totalStamps === 0}
          onClick={onPrint} data-testid="button-print">
          <Printer className="w-4 h-4 mr-1.5" />
          <span className="hidden md:inline">Print Template</span>
        </Button>
        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={!entries.length || anyAnalyzing || isProcessing || totalStamps === 0}
          onClick={onProcess} data-testid="button-process">
          {isProcessing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
          <span className="hidden sm:inline">Apply &amp; Export</span>
          <span className="sm:hidden">Export</span>
        </Button>
      </div>
    </header>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function IndexerHome() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTabState] = useState<AppTab>(() =>
    window.location.pathname.endsWith('/converter') ? 'converter' : 'dashboard',
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<number, string>>>({});
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);

  const [settings, setSettings] = useState<GlobalSettings>({
    prefix: 'A', startNumber: 1, format: DEFAULT_FORMAT_LEVELS,
    topMarginCm: 0.5, sideMarginCm: 0.5,
    fontSize: 16, bold: false,
  });

  /* ── Computed ─────────────────────────────────────────────────────────── */
  const processedEntries = useMemo(() =>
    entries.map((e) => ({
      ...e,
      pages: computeAttachmentIndices(e.pages, e.mainCode, overrides[e.id] ?? {}, settings.format),
    })), [entries, overrides, settings.format.level1, settings.format.level2, settings.format.level3]);

  const totalStamps = useMemo(() => processedEntries.reduce((s, e) => s + e.pages.filter((p) => p.assignedIndex).length, 0), [processedEntries]);
  const totalPages  = useMemo(() => entries.reduce((s, e) => s + e.pages.length, 0), [entries]);
  const totalSize   = useMemo(() => entries.reduce((s, e) => s + e.file.size, 0), [entries]);
  const anyAnalyzing = entries.some((e) => e.isAnalyzing);

  const setActiveTab = useCallback((tab: AppTab) => {
    setActiveTabState(tab);
    const nextPath = tab === 'converter' ? '/converter' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}${nextPath}`);
    }
  }, []);

  /* ── File loading ─────────────────────────────────────────────────────── */
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

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files) await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleOpenFiles = useCallback(() => fileInputRef.current?.click(), []);

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (previewEntryId === id) setPreviewEntryId(null);
  };

  const updateCode = (id: string, code: string) =>
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, mainCode: code } : e));

  /* ── Actions ──────────────────────────────────────────────────────────── */
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

  /* ── Sidebar width for content margin ──────────────────────────────────── */
  const sidebarWidth = sidebarOpen ? 'lg:ml-56' : 'lg:ml-14';

  /* ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* Hidden global file input */}
      <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden"
        onChange={handleFileChange} data-testid="input-files" />

      {/* Desktop sidebar */}
      <DesktopSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        totalDocs={entries.length}
        totalStamps={totalStamps}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarWidth} pb-16 lg:pb-0`}>
        <TopBar
          activeTab={activeTab}
          entries={entries}
          anyAnalyzing={anyAnalyzing}
          isProcessing={isProcessing}
          totalStamps={totalStamps}
          onProcess={handleProcess}
          onPrint={handlePrint}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'dashboard' && (
            <ScrollArea className="h-full">
              <DashboardTab
                totalDocs={entries.length}
                totalPages={totalPages}
                totalStamps={totalStamps}
                totalSize={formatBytes(totalSize)}
                anyAnalyzing={anyAnalyzing}
                onNavigate={(tab) => setActiveTab(tab as AppTab)}
                onAddFiles={() => { setActiveTab('index-editor'); setTimeout(handleOpenFiles, 100); }}
              />
            </ScrollArea>
          )}

          {activeTab === 'pdf-tools' && (
            <PdfToolsTab />
          )}

          {activeTab === 'converter' && (
            <ConverterPage />
          )}

          {activeTab === 'index-editor' && (
            <IndexEditorTab
              entries={entries}
              settings={settings}
              setSettings={setSettings}
              overrides={overrides}
              setOverrides={setOverrides}
              updateCode={updateCode}
              removeEntry={removeEntry}
              setPreviewEntryId={setPreviewEntryId}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              onDrop={handleDrop}
              onAddFiles={handleOpenFiles}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
            />
          )}

          


        </div>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Preview sheet */}
      <Sheet open={!!previewEntryId} onOpenChange={(open) => { if (!open) setPreviewEntryId(null); }}>
        <SheetContent side="right" className="w-full sm:w-[380px] flex flex-col p-0 bg-card border-border">
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
