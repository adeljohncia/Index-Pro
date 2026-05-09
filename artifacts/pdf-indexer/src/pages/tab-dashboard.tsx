import React from 'react';
import { FileText, Layers, Stamp, HardDrive, TrendingUp, Upload, Settings2, Download } from 'lucide-react';

interface DashboardTabProps {
  totalDocs: number;
  totalPages: number;
  totalStamps: number;
  totalSize: string;
  anyAnalyzing: boolean;
  onNavigate: (tab: string) => void;
  onAddFiles: () => void;
}

export function DashboardTab({
  totalDocs, totalPages, totalStamps, totalSize, anyAnalyzing, onNavigate, onAddFiles,
}: DashboardTabProps) {
  const stats = [
    { label: 'Documents', value: totalDocs.toString(), icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Pages', value: totalPages.toString(), icon: Layers, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Stamps', value: totalStamps.toString(), icon: Stamp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Total Size', value: totalSize, icon: HardDrive, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  const quickActions = [
    {
      icon: Upload, label: 'Add PDF Files',
      desc: 'Upload documents to process',
      action: onAddFiles, primary: true,
    },
    {
      icon: Settings2, label: 'Index Editor',
      desc: 'Configure stamp codes & layout',
      action: () => onNavigate('index-editor'), primary: false,
    },
    {
      icon: FileText, label: 'PDF Editor',
      desc: 'Rotate, delete and extract text',
      action: () => onNavigate('pdf-editor'), primary: false,
    },
    {
      icon: Download, label: 'Export Hub',
      desc: 'Download stamped PDF',
      action: () => onNavigate('export'), primary: false,
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full">
      {/* Welcome */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-foreground">Welcome to Index Pro</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Stamp index codes onto scanned PDFs — fast, precise, professional.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
              <p className="text-xl font-bold font-mono text-foreground leading-tight">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Status banner */}
      {totalDocs > 0 && (
        <div className={`rounded-xl border p-4 flex items-center gap-3 ${
          anyAnalyzing
            ? 'border-amber-200 bg-amber-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 animate-pulse ${anyAnalyzing ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <div>
            <p className={`text-sm font-semibold ${anyAnalyzing ? 'text-amber-800' : 'text-emerald-800'}`}>
              {anyAnalyzing ? 'Analyzing documents…' : `${totalDocs} document${totalDocs !== 1 ? 's' : ''} ready`}
            </p>
            <p className={`text-xs mt-0.5 ${anyAnalyzing ? 'text-amber-600' : 'text-emerald-600'}`}>
              {anyAnalyzing
                ? 'Detecting blank pages and building thumbnails'
                : `${totalStamps} stamp${totalStamps !== 1 ? 's' : ''} configured across ${totalPages} pages`}
            </p>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Quick Actions</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickActions.map(({ icon: Icon, label, desc, action, primary }) => (
            <button
              key={label}
              onClick={action}
              className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all cursor-pointer
                ${primary
                  ? 'bg-primary border-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-card border-border hover:bg-accent hover:border-primary/30 text-foreground'}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                primary ? 'bg-white/20' : 'bg-muted'
              }`}>
                <Icon className={`w-5 h-5 ${primary ? 'text-white' : 'text-primary'}`} />
              </div>
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className={`text-xs mt-0.5 ${primary ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            icon: TrendingUp, title: 'Workflow', color: 'text-blue-600', bg: 'bg-blue-50',
            steps: ['Upload PDFs', 'Configure index codes', 'Export stamped PDF'],
          },
          {
            icon: FileText, title: 'OCR Support', color: 'text-purple-600', bg: 'bg-purple-50',
            steps: ['Select pages in PDF Editor', 'Click Extract Text', 'Run OCR on scanned pages'],
          },
          {
            icon: Stamp, title: 'Format Levels', color: 'text-emerald-600', bg: 'bg-emerald-50',
            steps: ['<A1> base attachment', '<A1-1> sub-page level', '<A1-1-1> deep level'],
          },
        ].map(({ icon: Icon, title, color, bg, steps }) => (
          <div key={title} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-7 h-7 rounded-md ${bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
            </div>
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className={`w-4 h-4 rounded-full ${bg} ${color} text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
