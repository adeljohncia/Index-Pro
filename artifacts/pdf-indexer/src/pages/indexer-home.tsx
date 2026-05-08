import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { UploadCloud, FileText, Download, Printer, Plus, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  analyzePdfPages, 
  computeAssignedIndices, 
  processPdfWithIndices, 
  generatePrintTemplateHtml,
  PageAnalysis,
  IndexConfig,
  RestartRule
} from '@/lib/pdf-utils';

export function IndexerHome() {
  const { toast } = useToast();
  
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [rawPages, setRawPages] = useState<PageAnalysis[]>([]);
  
  const [config, setConfig] = useState<IndexConfig>({
    baseCode: '<A1>',
    autoIncrement: true,
    fromPage: 1,
    untilPage: 9999,
    restartRules: []
  });

  const processedPages = useMemo(() => {
    if (rawPages.length === 0) return [];
    return computeAssignedIndices(rawPages, {
      ...config,
      untilPage: config.untilPage === 9999 ? rawPages.length : config.untilPage
    });
  }, [rawPages, config]);

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
    
    try {
      const analysis = await analyzePdfPages(uploadedFile);
      setRawPages(analysis);
      setConfig(prev => ({ ...prev, untilPage: analysis.length }));
      toast({ title: 'Analysis complete', description: `Detected ${analysis.length} pages.` });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error analyzing PDF', description: 'Could not read the PDF file.', variant: 'destructive' });
    } finally {
      setIsAnalyzing(false);
    }
  };

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
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const addRestartRule = () => {
    setConfig(prev => ({
      ...prev,
      restartRules: [...prev.restartRules, { id: Math.random().toString(36).substring(7), atPage: 1, newCode: '<A1>' }]
    }));
  };

  const removeRestartRule = (id: string) => {
    setConfig(prev => ({
      ...prev,
      restartRules: prev.restartRules.filter(r => r.id !== id)
    }));
  };

  const updateRestartRule = (id: string, field: keyof RestartRule, value: any) => {
    setConfig(prev => ({
      ...prev,
      restartRules: prev.restartRules.map(r => r.id === id ? { ...r, [field]: value } : r)
    }));
  };

  return (
    <div className="flex h-screen bg-muted/30 p-4 gap-4 overflow-hidden">
      {/* Left Panel: Upload & Config */}
      <div className="w-1/3 min-w-[400px] flex flex-col gap-4 overflow-y-auto">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Source Document</CardTitle>
          </CardHeader>
          <CardContent>
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-background hover:bg-muted/50 border-muted-foreground/25">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <UploadCloud className="w-8 h-8 mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Click to upload PDF</p>
                  <p className="text-xs text-muted-foreground">Scanned document</p>
                </div>
                <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
              </label>
            ) : (
              <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB • {rawPages.length} pages
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setFile(null); setRawPages([]); }}>
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader className="pb-3">
            <CardTitle>Index Configuration</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="baseCode">Base Code Template</Label>
                <Input 
                  id="baseCode" 
                  value={config.baseCode} 
                  onChange={e => setConfig(prev => ({ ...prev, baseCode: e.target.value }))}
                  placeholder="<A1>"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Brackets &lt; &gt; are retained. Text inside is stamped.</p>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="autoIncrement" 
                  checked={config.autoIncrement}
                  onCheckedChange={(checked) => setConfig(prev => ({ ...prev, autoIncrement: checked === true }))}
                />
                <Label htmlFor="autoIncrement">Auto-increment index per non-blank page</Label>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t">
              <h4 className="text-sm font-semibold">Page Range</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fromPage">From Page</Label>
                  <Input 
                    id="fromPage" 
                    type="number" 
                    min={1}
                    value={config.fromPage} 
                    onChange={e => setConfig(prev => ({ ...prev, fromPage: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="untilPage">Until Page</Label>
                  <Input 
                    id="untilPage" 
                    type="number" 
                    min={1}
                    value={config.untilPage} 
                    onChange={e => setConfig(prev => ({ ...prev, untilPage: parseInt(e.target.value) || 9999 }))}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Restart Rules</h4>
                <Button variant="outline" size="sm" onClick={addRestartRule}>
                  <Plus className="w-4 h-4 mr-1" /> Add Rule
                </Button>
              </div>
              
              {config.restartRules.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">No restart rules defined.</p>
              ) : (
                <div className="space-y-3">
                  {config.restartRules.map((rule) => (
                    <div key={rule.id} className="flex items-end gap-2 p-3 border rounded-md bg-muted/30">
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs">At Page</Label>
                        <Input 
                          type="number" 
                          min={1} 
                          value={rule.atPage}
                          onChange={(e) => updateRestartRule(rule.id, 'atPage', parseInt(e.target.value) || 1)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs">New Code</Label>
                        <Input 
                          value={rule.newCode}
                          onChange={(e) => updateRestartRule(rule.id, 'newCode', e.target.value)}
                          className="h-8 text-sm font-mono"
                        />
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0" onClick={() => removeRestartRule(rule.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel: Analysis & Actions */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 border-b flex flex-row items-center justify-between space-y-0">
            <CardTitle>Page Analysis</CardTitle>
            <div className="text-sm text-muted-foreground font-medium">
              {processedPages.filter(p => p.assignedIndex).length} codes to stamp
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden relative">
            {isAnalyzing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                <p className="text-sm font-medium">Analyzing PDF for blank pages...</p>
              </div>
            ) : null}
            
            {!file ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <p className="text-sm">Upload a PDF to view page analysis</p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[100px] text-center">Page</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Placement</TableHead>
                      <TableHead className="text-right">Assigned Index</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedPages.map((page) => (
                      <TableRow key={page.pageNumber} className={page.isBlank ? 'opacity-60 bg-muted/20' : ''}>
                        <TableCell className="text-center font-medium">
                          {page.pageNumber}
                        </TableCell>
                        <TableCell>
                          {page.isBlank ? (
                            <Badge variant="outline" className="text-muted-foreground">Blank</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">Content</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {!page.assignedIndex ? '-' : (page.pageNumber % 2 !== 0 ? 'Top Left' : 'Top Right')}
                        </TableCell>
                        <TableCell className="text-right">
                          {page.assignedIndex ? (
                            <code className="px-2 py-1 bg-muted rounded font-mono text-sm font-semibold">
                              {page.assignedIndex}
                            </code>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">Skipped</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
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
              disabled={!file || isAnalyzing || isProcessing || processedPages.filter(p => p.assignedIndex).length === 0}
              onClick={handleProcessPdf}
            >
              {isProcessing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
              Process & Download PDF
            </Button>
            <Button 
              variant="outline" 
              className="flex-1" 
              size="lg"
              disabled={!file || isAnalyzing || processedPages.filter(p => p.assignedIndex).length === 0}
              onClick={handlePrintTemplate}
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
