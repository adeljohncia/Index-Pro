import React from 'react';
import { Download, Printer, FileText, Loader2, Stamp, Layers, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ExportTabProps {
  totalDocs: number;
  totalStamps: number;
  totalPages: number;
  totalSize: string;
  anyAnalyzing: boolean;
  isProcessing: boolean;
  onProcess: () => void;
  onPrint: () => void;
  settings: {
    prefix: string;
    startNumber: number;
    topMarginCm: number;
    sideMarginCm: number;
    fontSize: number;
    bold: boolean;
    format: { level1: boolean; level2: boolean; level3: boolean };
  };
}

export function ExportTab({
  totalDocs, totalStamps, totalPages, totalSize,
  anyAnalyzing, isProcessing, onProcess, onPrint, settings,
}: ExportTabProps) {
  const canExport = totalDocs > 0 && !anyAnalyzing && !isProcessing && totalStamps > 0;

  const summaryRows = [
    { label: 'Documents', value: totalDocs.toString(), icon: FileText },
    { label: 'Total pages', value: totalPages.toString(), icon: Layers },
    { label: 'Stamps to apply', value: totalStamps.toString(), icon: Stamp },
    { label: 'Total size', value: totalSize, icon: HardDrive },
  ];

  const configRows = [
    { label: 'Prefix', value: settings.prefix },
    { label: 'Start number', value: settings.startNumber.toString() },
    { label: 'Top margin', value: `${settings.topMarginCm} cm` },
    { label: 'Side margin', value: `${settings.sideMarginCm} cm` },
    { label: 'Font size', value: `${settings.fontSize} pt` },
    { label: 'Font weight', value: settings.bold ? 'Bold' : 'Regular' },
    {
      label: 'Active levels',
      value: [
        settings.format.level1 && '<A1>',
        settings.format.level2 && '<A1-1>',
        settings.format.level3 && '<A1-1-1>',
      ].filter(Boolean).join(', ') || 'None',
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto w-full">
      <div>
        <h2 className="text-lg font-bold text-foreground">Export Hub</h2>
        <p className="text-sm text-muted-foreground mt-1">Review settings, then download your stamped PDF.</p>
      </div>

      {/* Batch summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryRows.map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 flex flex-col items-center text-center gap-1">
            <Icon className="w-5 h-5 text-primary" />
            <p className="text-xl font-bold font-mono text-foreground">{value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Config summary */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Stamp Configuration</h3>
        </div>
        <div className="divide-y divide-border">
          {configRows.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-xs font-semibold font-mono text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Export actions */}
      <div className="space-y-3">
        <Button
          className="w-full h-12 text-sm font-semibold gap-2"
          disabled={!canExport}
          onClick={onProcess}
          data-testid="button-process">
          {isProcessing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
            : <><Download className="w-4 h-4" /> Apply Stamps & Download PDF</>}
        </Button>

        <Button
          variant="outline"
          className="w-full h-12 text-sm font-semibold gap-2"
          disabled={totalDocs === 0 || anyAnalyzing || totalStamps === 0}
          onClick={onPrint}
          data-testid="button-print">
          <Printer className="w-4 h-4" />
          Generate Print Template
        </Button>
      </div>

      {!canExport && totalDocs === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No documents loaded yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add PDFs in the Index Editor tab to get started.</p>
        </div>
      )}

      {totalDocs > 0 && totalStamps === 0 && !anyAnalyzing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-sm font-medium text-amber-800">No stamps configured</p>
          <p className="text-xs text-amber-600 mt-1">Enable at least one format level in the Index Editor tab.</p>
        </div>
      )}
    </div>
  );
}
