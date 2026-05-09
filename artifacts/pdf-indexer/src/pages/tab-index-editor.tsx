import React, { useState, useRef, useMemo } from 'react';
import {
  FileText, Check, X, Loader2, Database, LayoutGrid, Settings2,
  Pencil, Zap, Eye, Trash2, UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  FormatLevels, DEFAULT_FORMAT_LEVELS, codeForContentPage, computeAttachmentIndices,
} from '@/lib/pdf-utils';
import type { PageAnalysis } from '@/lib/pdf-utils';

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

interface IndexEditorTabProps {
  entries: PdfEntry[];
  settings: GlobalSettings;
  setSettings: React.Dispatch<React.SetStateAction<GlobalSettings>>;
  overrides: Record<string, Record<number, string>>;
  setOverrides: React.Dispatch<React.SetStateAction<Record<string, Record<number, string>>>>;
  updateCode: (id: string, code: string) => void;
  removeEntry: (id: string) => void;
  setPreviewEntryId: (id: string | null) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onAddFiles: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{children}</p>;
}

function Panel({ title, icon: Icon, children, className = '' }: {
  title: string; icon: React.ElementType; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-card border border-border rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function IndexEditorTab({
  entries, settings, setSettings, overrides, setOverrides,
  updateCode, removeEntry, setPreviewEntryId,
  isDragging, setIsDragging, onDrop, onAddFiles, fileInputRef, onFileChange,
}: IndexEditorTabProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const toggleFormatLevel = (level: keyof FormatLevels) =>
    setSettings((p) => ({ ...p, format: { ...p.format, [level]: !p.format[level] } }));

  const updateSetting = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]) =>
    setSettings((p) => ({ ...p, [k]: v }));

  const processedEntries = useMemo(() =>
    entries.map((e) => ({
      ...e,
      pages: computeAttachmentIndices(e.pages, e.mainCode, overrides[e.id] ?? {}, settings.format),
    })), [entries, overrides, settings.format.level1, settings.format.level2, settings.format.level3]);

  const totalStamps = useMemo(() => processedEntries.reduce((s, e) => s + e.pages.filter((p) => p.assignedIndex).length, 0), [processedEntries]);
  const totalPages = useMemo(() => entries.reduce((s, e) => s + e.pages.length, 0), [entries]);
  const totalBlank = useMemo(() => entries.reduce((s, e) => s + e.pages.filter((p) => p.isBlank).length, 0), [entries]);
  const anyAnalyzing = entries.some((e) => e.isAnalyzing);

  function formatBytes(b: number) {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
    return `${(b / 1073741824).toFixed(2)} GB`;
  }

  const totalSize = useMemo(() => entries.reduce((s, e) => s + e.file.size, 0), [entries]);

  const previewMainCode = `<${settings.prefix}${settings.startNumber}>`;
  const previewCodes = useMemo(() =>
    [0, 1, 2, 3].map((i) => codeForContentPage(previewMainCode, i, settings.format)),
    [previewMainCode, settings.format.level1, settings.format.level2, settings.format.level3]
  );

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

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden">

      {/* ── Left: Files ── */}
      <div className="lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col bg-muted/20">
        {/* Upload zone */}
        <div className="p-3 border-b border-border">
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={onAddFiles}
            className={`flex items-center justify-center gap-3 h-14 border-2 border-dashed rounded-lg cursor-pointer transition-all
              ${isDragging ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-accent/50'}`}
            data-testid="drop-zone">
            <UploadCloud className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Add PDF files</p>
              <p className="text-xs text-muted-foreground">Click or drag & drop</p>
            </div>
            <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden"
              onChange={onFileChange} data-testid="input-files" />
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
            <div className="p-3 space-y-3">
              {entries.map((entry, idx) => {
                const processed = processedEntries.find((e) => e.id === entry.id);
                const stamps = processed?.pages.filter((p) => p.assignedIndex).length ?? 0;
                const blank = entry.pages.filter((p) => p.isBlank).length;
                return (
                  <div key={entry.id} className="bg-card border border-border rounded-xl overflow-hidden" data-testid={`pdf-entry-${idx}`}>
                    <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border">
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
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Code</span>
                      <Input value={entry.mainCode}
                        onChange={(e) => updateCode(entry.id, e.target.value)}
                        className="h-7 text-xs font-mono flex-1 border-border"
                        data-testid={`input-code-${idx}`} />
                    </div>
                    {entry.thumbnails.length > 0 && (
                      <div className="flex gap-1.5 px-3 pb-3 overflow-x-auto">
                        {entry.thumbnails.slice(0, 5).map((src, i) => (
                          <div key={i} className="relative shrink-0 cursor-pointer" onClick={() => setPreviewEntryId(entry.id)}>
                            <img src={src} alt={`Page ${i + 1}`}
                              className="h-12 w-auto rounded border border-border object-cover hover:border-primary transition-colors" />
                            {entry.pages[i]?.isBlank && (
                              <div className="absolute inset-0 bg-background/60 rounded flex items-center justify-center">
                                <span className="text-[8px] text-muted-foreground font-semibold">BLANK</span>
                              </div>
                            )}
                          </div>
                        ))}
                        {entry.pages.length > 5 && (
                          <div onClick={() => setPreviewEntryId(entry.id)}
                            className="h-12 w-8 rounded border border-border bg-muted flex items-center justify-center cursor-pointer hover:border-primary transition-colors shrink-0">
                            <span className="text-[9px] text-muted-foreground">+{entry.pages.length - 5}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {entry.isLoadingThumbnails && entry.pages.length > 0 && (
                      <div className="px-3 pb-3">
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
          <div className="border-t border-border bg-card p-3 shrink-0">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Docs', value: entries.length.toString() },
                { label: 'Pages', value: totalPages.toString() },
                { label: 'Stamps', value: totalStamps.toString(), accent: true },
                { label: 'Size', value: formatBytes(totalSize) },
              ].map(({ label, value, accent }) => (
                <div key={label} className="bg-muted/60 rounded-lg p-2 text-center border border-border">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className={`text-xs font-bold font-mono mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Config + Table ── */}
      <ScrollArea className="flex-1">
        <div className="p-4 sm:p-5 space-y-4">

          {/* Index Code Format */}
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
                        ${active ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'}`}
                      onClick={() => toggleFormatLevel(key)}>
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                        ${active ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                        {active && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </div>
                      <code className={`font-mono text-sm font-bold shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                        {label}
                      </code>
                      <span className="text-xs leading-tight hidden sm:block">{desc}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <FieldLabel>Live Preview</FieldLabel>
              <div className="rounded-lg bg-[#1a1d27] border border-white/10 px-4 py-3">
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                  {previewCodes.map((code, i) => (
                    <React.Fragment key={i}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/30 text-[10px] font-mono">p.{i + 1}</span>
                        <span className={`font-mono text-sm font-bold ${i === 0 ? 'text-blue-400' : 'text-blue-300'}`}>{code}</span>
                      </div>
                      {i < previewCodes.length - 1 && <span className="text-white/20 text-xs">→</span>}
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

          {/* Three smaller cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <div className="border border-border rounded-md p-3 flex items-center justify-center bg-muted/30 h-[72px] relative">
                  <div className="w-10 h-14 border border-border rounded bg-card relative shrink-0">
                    <div className="absolute top-0.5 left-0.5 w-1.5 h-0.5 bg-primary rounded-full" />
                    <div className="absolute top-0.5 right-0.5 w-1.5 h-0.5 bg-primary/40 rounded-full" />
                  </div>
                  <div className="ml-2 text-left">
                    <p className="text-[9px] text-muted-foreground leading-4">Odd → Top Left</p>
                    <p className="text-[9px] text-muted-foreground leading-4">Even → Top Right</p>
                    <p className="text-[9px] font-mono text-primary">{settings.topMarginCm}cm / {settings.sideMarginCm}cm</p>
                  </div>
                </div>
              </div>
            </Panel>

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
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-center">
                  <span style={{ fontSize: `${Math.min(settings.fontSize, 22)}px`, fontWeight: settings.bold ? 700 : 400 }}
                    className="font-sans text-foreground">
                    {previewMainCode}
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          {/* Page Analysis table */}
          {entries.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[60px] text-center">Page</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[80px]">Status</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[90px] hidden sm:table-cell">Position</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest">Assigned Index</TableHead>
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
                              <span className="text-xs font-semibold text-foreground truncate max-w-[160px] sm:max-w-xs">{entry.file.name}</span>
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
                                    : <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-0">Content</Badge>}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                                  {page.assignedIndex ? (isOdd ? 'Top Left' : 'Top Right') : '—'}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1">
                                      <Input ref={editInputRef} value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(entry.id, page.pageNumber); if (e.key === 'Escape') setEditingKey(null); }}
                                        className="h-7 text-xs font-mono w-28" />
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
                                      onClick={() => startEdit(entry.id, page)}>
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
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
