import { useState, ChangeEvent } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InfoIcon, AlertCircle, FileText, UploadCloud, CheckCircle2, Download } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

const queryClient = new QueryClient();

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"simple" | "smart">("simple");
  const [intensityVal, setIntensityVal] = useState<number>(50);
  const [status, setStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fallbackMsg, setFallbackMsg] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadFilename, setDownloadFilename] = useState("");
  
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.endsWith('.epub')) {
        setErrorMsg("Please select a valid .epub file.");
        setStatus("error");
        setFile(null);
        return;
      }
      setFile(selected);
      setStatus("idle");
      setErrorMsg("");
      setFallbackMsg("");
      setDownloadUrl("");
    }
  };
  
  const handleProcess = async () => {
    if (!file) return;
    setStatus("processing");
    setErrorMsg("");
    setFallbackMsg("");
    setDownloadUrl("");
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);
    const intensityStr = intensityVal === 0 ? "subtle" : intensityVal === 50 ? "medium" : "strong";
    formData.append("intensity", intensityStr);
    
    try {
      const res = await fetch('/api/process', { method: 'POST', body: formData });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Processing failed');
      }
      const fallback = res.headers.get('X-Fallback-Warning');
      if (fallback) setFallbackMsg(fallback);
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = "output_phrase_spaced.epub";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      
      setDownloadUrl(url);
      setDownloadFilename(filename);
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || 'An unexpected error occurred');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 md:p-8" data-testid="page-home">
      <Card className="w-full max-w-lg border-border bg-card shadow-sm rounded-sm border-t-4 border-t-primary" data-testid="card-main">
         <CardHeader className="text-center pb-8 pt-10">
           <CardTitle className="font-serif text-3xl font-medium tracking-tight text-card-foreground" data-testid="text-title">Phrase-Spacing</CardTitle>
           <CardDescription className="text-base mt-3 text-muted-foreground max-w-[280px] mx-auto" data-testid="text-description">
             A quiet, focused utility for reading comfort.
           </CardDescription>
         </CardHeader>
         <CardContent className="space-y-10 px-6 md:px-12">
           {/* 1. File Upload */}
           <div className="space-y-3">
             <Label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold" data-testid="label-upload">1. Select Book</Label>
             <div 
               className={`border-2 border-dashed flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-colors rounded-sm ${file ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-accent/50'}`}
               onClick={() => document.getElementById('epub-upload')?.click()}
               data-testid="upload-area"
             >
               <input 
                 id="epub-upload" 
                 type="file" 
                 accept=".epub" 
                 className="hidden" 
                 onChange={handleFileChange}
                 data-testid="input-file"
               />
               {file ? (
                 <div className="flex flex-col items-center" data-testid="file-selected">
                   <FileText className="h-8 w-8 text-primary mb-3 opacity-80" />
                   <p className="text-sm font-medium text-foreground">{file.name}</p>
                   <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                 </div>
               ) : (
                 <div className="flex flex-col items-center" data-testid="upload-prompt">
                   <UploadCloud className="h-8 w-8 text-muted-foreground mb-3" />
                   <p className="text-sm text-muted-foreground">Click to browse or drag .epub file here</p>
                 </div>
               )}
             </div>
           </div>

           {/* 2. Mode Selector */}
           <div className="space-y-4">
             <div className="flex items-center gap-2">
               <Label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold" data-testid="label-mode">2. Processing Mode</Label>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button variant="ghost" size="icon" className="h-5 w-5 rounded-full" data-testid="button-tooltip-mode">
                     <InfoIcon className="h-3 w-3" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent className="max-w-[250px] text-sm" data-testid="tooltip-mode-content">
                   <p><strong>Simple:</strong> Keyword-based gaps.</p>
                   <p className="mt-1"><strong>Smart:</strong> AI phrase detection (falls back to Simple if unavailable).</p>
                 </TooltipContent>
               </Tooltip>
             </div>
             <RadioGroup value={mode} onValueChange={(v: "simple" | "smart") => setMode(v)} className="flex gap-6" data-testid="radio-mode">
               <div className="flex items-center space-x-2">
                 <RadioGroupItem value="simple" id="mode-simple" data-testid="radio-mode-simple" />
                 <Label htmlFor="mode-simple" className="font-medium cursor-pointer text-sm">Simple</Label>
               </div>
               <div className="flex items-center space-x-2">
                 <RadioGroupItem value="smart" id="mode-smart" data-testid="radio-mode-smart" />
                 <Label htmlFor="mode-smart" className="font-medium cursor-pointer text-sm">Smart</Label>
               </div>
             </RadioGroup>
           </div>

           {/* 3. Gap Intensity */}
           <div className="space-y-4">
             <Label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold" data-testid="label-intensity">3. Gap Intensity</Label>
             <div className="px-1 pt-2">
               <Slider 
                 defaultValue={[50]} 
                 max={100} 
                 step={50} 
                 onValueChange={(v) => setIntensityVal(v[0])}
                 data-testid="slider-intensity"
               />
               <div className="flex justify-between mt-3 text-xs text-muted-foreground font-medium" data-testid="intensity-labels">
                 <span className={intensityVal === 0 ? "text-foreground" : "cursor-pointer hover:text-foreground transition-colors"} onClick={() => setIntensityVal(0)}>Subtle</span>
                 <span className={intensityVal === 50 ? "text-foreground" : "cursor-pointer hover:text-foreground transition-colors"} onClick={() => setIntensityVal(50)}>Medium</span>
                 <span className={intensityVal === 100 ? "text-foreground" : "cursor-pointer hover:text-foreground transition-colors"} onClick={() => setIntensityVal(100)}>Strong</span>
               </div>
             </div>
           </div>

           {/* 4. Process Button */}
           <div className="pt-4">
             <Button 
               className="w-full font-serif text-lg tracking-wide rounded-sm h-14 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" 
               disabled={!file || status === "processing"} 
               onClick={handleProcess}
               data-testid="button-process"
             >
               {status === "processing" ? (
                 <span className="flex items-center" data-testid="status-processing">
                   <Spinner className="mr-3 h-5 w-5" /> Injecting spaces...
                 </span>
               ) : (
                 "Process EPUB"
               )}
             </Button>
           </div>

           {/* 5. Status Area & 6. Download Link */}
           {(status === "error" || status === "success" || fallbackMsg) && (
             <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="status-area">
               {status === "error" && (
                 <Alert variant="destructive" className="rounded-sm bg-destructive/10 text-destructive border border-destructive/20" data-testid="alert-error">
                   <AlertCircle className="h-4 w-4" />
                   <AlertTitle className="font-semibold">Processing Failed</AlertTitle>
                   <AlertDescription>{errorMsg}</AlertDescription>
                 </Alert>
               )}
               {fallbackMsg && status === "success" && (
                 <Alert className="rounded-sm bg-amber-500/10 text-amber-900 border border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-200" data-testid="alert-fallback">
                   <InfoIcon className="h-4 w-4" />
                   <AlertTitle className="font-semibold">Note</AlertTitle>
                   <AlertDescription>{fallbackMsg}</AlertDescription>
                 </Alert>
               )}
               {status === "success" && (
                 <div className="flex flex-col items-center justify-center p-8 bg-primary/5 border border-primary/20 rounded-sm space-y-5" data-testid="area-success">
                   <div className="flex items-center text-primary font-medium gap-2">
                     <CheckCircle2 className="h-5 w-5" />
                     <span>Processing Complete</span>
                   </div>
                   <Button asChild variant="outline" className="rounded-sm border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors h-11 px-6" data-testid="link-download">
                     <a href={downloadUrl} download={downloadFilename}>
                       <Download className="mr-2 h-4 w-4" /> Download Book
                     </a>
                   </Button>
                 </div>
               )}
             </div>
           )}
         </CardContent>
         <CardFooter className="justify-center pb-10 text-xs text-muted-foreground font-serif italic" data-testid="text-footer">
           For a calm and measured reading experience.
         </CardFooter>
      </Card>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
