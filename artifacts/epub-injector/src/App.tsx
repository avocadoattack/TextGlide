import { useState, useEffect, useCallback, ChangeEvent } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InfoIcon, AlertCircle, FileText, UploadCloud, CheckCircle2, Download } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const defaultPreviewText =
  "Fluent readers don't read one word at a time; they take in meaningful phrases per glance. PhraseFlow rebuilds your EPUBs to gently cue those phrase groups with spacing: a free, open tool that works on the device where people actually read.";

type Mode = "pseudosyntactic" | "syntactic";

function friendlyMode(modeUsed: string): string {
  if (modeUsed === "syntactic") return "Syntactic mode";
  if (modeUsed === "pseudosyntactic") return "Pseudosyntactic mode";
  return "Keyword mode";
}

function modeLabel(mode: Mode): string {
  return mode === "syntactic" ? "Syntactic" : "Pseudosyntactic";
}

function isFallbackMode(modeUsed: string): boolean {
  return modeUsed === "keyword_fallback";
}

// Faint amber underline marker placed at each inserted gap in the hero After card
function Gap() {
  return (
    <span
      style={{
        display: "inline-block",
        borderBottom: "1.5px solid rgba(251,191,36,0.55)",
        paddingBottom: "1px",
      }}
    >
      {"\u2009"}
    </span>
  );
}

function Home() {
  const [state, setState] = useState({
    mode: "syntactic" as Mode,
    language: "auto",
    spacingWidth: 0,   // 0=subtle, 1=medium, 2=strong
    chunkDensity: 1,   // 0=subtle, 1=medium (default D), 2=obvious
  });

  const [previewText, setPreviewText] = useState(defaultPreviewText);
  const [previewResult, setPreviewResult] = useState("");
  const [previewModeUsed, setPreviewModeUsed] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fallbackMsg, setFallbackMsg] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadFilename, setDownloadFilename] = useState("");

  // Debounced Preview Fetch
  useEffect(() => {
    const handler = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const spacingStr = state.spacingWidth === 0 ? "subtle" : state.spacingWidth === 1 ? "medium" : "strong";
        const densityStr = state.chunkDensity === 0 ? "subtle" : state.chunkDensity === 1 ? "medium" : "obvious";

        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: previewText,
            mode: state.mode,
            language: state.language,
            spacing_width: spacingStr,
            chunk_density: densityStr,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setPreviewResult(data.result);
          setPreviewModeUsed(data.mode_used);
        } else {
          setPreviewResult("Failed to load preview.");
          setPreviewModeUsed("");
        }
      } catch {
        setPreviewResult("Error connecting to server.");
        setPreviewModeUsed("");
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => clearTimeout(handler);
  }, [previewText, state]);

  const stopPeeking = useCallback(() => setPeeking(false), []);
  const startPeeking = useCallback(() => setPeeking(true), []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.endsWith(".epub")) {
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
    formData.append("mode", state.mode);
    formData.append("language", state.language);
    formData.append(
      "spacing_width",
      state.spacingWidth === 0 ? "subtle" : state.spacingWidth === 1 ? "medium" : "strong"
    );
    formData.append(
      "chunk_density",
      state.chunkDensity === 0 ? "subtle" : state.chunkDensity === 1 ? "medium" : "obvious"
    );

    try {
      const res = await fetch("/api/process", { method: "POST", body: formData });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as any).error || "Processing failed");
      }
      const fallback = res.headers.get("X-Fallback-Warning");
      if (fallback) setFallbackMsg(fallback);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = "phraseflow_output.epub";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      setDownloadUrl(url);
      setDownloadFilename(filename);
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred");
    }
  };

  const getSpacingLabel = (val: number) => ["Subtle", "Medium", "Strong"][val];
  const getDensityLabel = (val: number) => ["Subtle", "Medium", "Obvious"][val];

  const showFallback = previewModeUsed ? isFallbackMode(previewModeUsed) : false;

  return (
    <div className="min-h-screen pb-20 selection:bg-primary/20" data-testid="page-home">

      <main className="max-w-3xl mx-auto px-6 pt-16 md:pt-24 space-y-24">

        {/* 1. Hero */}
        <section className="space-y-10 text-center" data-testid="section-hero">
          <div className="space-y-6">
            <h1
              className="font-serif text-5xl md:text-6xl font-medium tracking-tight text-foreground"
              data-testid="hero-headline"
            >
              Read in phrases, not word by word.
            </h1>
            <p
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
              data-testid="hero-subhead"
            >
              PhraseFlow adds subtle spacing at the natural phrase boundaries in your EPUBs, so your
              eyes group words the way fluent readers already do. Then it hands you a file ready for
              Kindle.
            </p>
          </div>

          {/* Before / After comparison */}
          <div className="grid md:grid-cols-2 gap-3 text-left" data-testid="hero-comparison">
            <div className="p-6 rounded-lg bg-muted/30 border border-border/50">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-4">
                Before
              </div>
              <p className="font-serif text-lg leading-[1.9] text-foreground">
                She wrote every morning by the window while the city came slowly awake outside.
              </p>
            </div>
            <div className="p-6 rounded-lg bg-primary/5 border border-primary/20 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary/40" />
              <div className="text-xs uppercase tracking-wider text-primary font-semibold mb-4">After</div>
              {/* Each inserted gap is wrapped in a faint amber underline marker */}
              <p className="font-serif text-lg leading-[1.9] text-foreground">
                She wrote every morning<Gap /> by the window<Gap /> while the city<Gap /> came slowly awake outside.
              </p>
            </div>
          </div>
        </section>

        {/* 2. Live Preview */}
        <section data-testid="section-preview">
          <Card
            className="border-border/60 shadow-md bg-card/50 backdrop-blur-sm overflow-hidden"
            data-testid="card-preview"
          >
            <div className="bg-muted/30 px-6 py-4 border-b border-border/50 flex justify-between items-center">
              <h2 className="font-medium text-foreground">Try it — preview before you process</h2>
              {previewLoading && (
                <Spinner className="h-4 w-4 text-primary" data-testid="preview-spinner" />
              )}
            </div>
            <CardContent className="p-6 space-y-8">

              <div className="space-y-3">
                <Label htmlFor="preview-text" className="text-sm font-medium text-foreground">
                  Test Text
                </Label>
                <Textarea
                  id="preview-text"
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  className="resize-y min-h-[100px] font-serif text-base bg-background"
                  data-testid="textarea-preview"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-8 bg-background p-5 rounded-lg border border-border/40">

                {/* Left col: Mode + Language */}
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Mode</Label>
                    <RadioGroup
                      value={state.mode}
                      onValueChange={(v: Mode) => setState({ ...state, mode: v })}
                      className="flex flex-col gap-2"
                      data-testid="radio-mode"
                    >
                      {/* Pseudosyntactic */}
                      <div className="flex items-center justify-between bg-muted/20 px-3 py-2.5 rounded-md border border-border/50">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="pseudosyntactic" id="mode-pseudo" />
                          <Label htmlFor="mode-pseudo" className="cursor-pointer font-normal">
                            Pseudosyntactic
                          </Label>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="text-muted-foreground hover:text-foreground ml-1" data-testid="tooltip-mode-pseudo">
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] p-3 text-sm">
                            A fast, statistical guess at where phrases begin, from word patterns
                            rather than full grammar. Like the quick first-pass estimate your brain
                            makes before it fully parses a sentence. Subtle, frequent cues.
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {/* Syntactic */}
                      <div className="flex items-center justify-between bg-muted/20 px-3 py-2.5 rounded-md border border-border/50">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="syntactic" id="mode-syntactic" />
                          <Label htmlFor="mode-syntactic" className="cursor-pointer font-normal">
                            Syntactic
                          </Label>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="text-muted-foreground hover:text-foreground ml-1" data-testid="tooltip-mode-syntactic">
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] p-3 text-sm">
                            A full grammatical analysis of each sentence. Breaks land only at real
                            clause and phrase boundaries, and tightly bound word groups are never
                            split. More precise, sometimes sparser.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Language</Label>
                    <Select
                      value={state.language}
                      onValueChange={(v) => setState({ ...state, language: v })}
                      data-testid="select-language"
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Right col: Sliders */}
                <div className="space-y-8">

                  {/* Spacing Width */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium">Spacing Width</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground"
                              data-testid="tooltip-spacing"
                            >
                              <InfoIcon className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px] p-3 text-sm">
                            How wide each inserted gap is, from a thin sliver to a full em space.
                            Changes the size of each break, not how many there are.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {getSpacingLabel(state.spacingWidth)}
                      </span>
                    </div>
                    <Slider
                      value={[state.spacingWidth]}
                      max={2}
                      step={1}
                      onValueChange={(v) => setState({ ...state, spacingWidth: v[0] })}
                      data-testid="slider-spacing"
                    />
                    <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                      <span>Subtle</span>
                      <span>Medium</span>
                      <span>Strong</span>
                    </div>
                  </div>

                  {/* Chunk Density */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium">Chunk Density</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground"
                              data-testid="tooltip-density"
                            >
                              <InfoIcon className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px] p-3 text-sm">
                            How often breaks appear. Subtle keeps phrases long and breaks rare;
                            Obvious breaks more often into smaller chunks.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {getDensityLabel(state.chunkDensity)}
                      </span>
                    </div>
                    <Slider
                      value={[state.chunkDensity]}
                      max={2}
                      step={1}
                      onValueChange={(v) => setState({ ...state, chunkDensity: v[0] })}
                      data-testid="slider-density"
                    />
                    <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                      <span>Subtle</span>
                      <span>Medium</span>
                      <span>Obvious</span>
                    </div>
                  </div>

                </div>
              </div>

              {/* Result */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-sm font-medium text-foreground">Result</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {previewModeUsed && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                        data-testid="badge-mode-used"
                      >
                        {friendlyMode(previewModeUsed)}
                      </span>
                    )}
                    {showFallback && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20"
                        data-testid="badge-mode-fallback"
                      >
                        Keyword mode (grammar parser unavailable)
                      </span>
                    )}
                    {/* Press-and-hold A/B peek */}
                    <button
                      className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70 select-none transition-colors active:bg-muted"
                      onMouseDown={startPeeking}
                      onMouseUp={stopPeeking}
                      onMouseLeave={stopPeeking}
                      onTouchStart={startPeeking}
                      onTouchEnd={stopPeeking}
                      onTouchCancel={stopPeeking}
                      data-testid="button-peek"
                    >
                      Without PhraseFlow
                    </button>
                  </div>
                </div>
                <div
                  className="min-h-[120px] p-6 rounded-lg bg-background border border-border/60 font-serif text-[1.1rem] leading-[1.75] text-foreground shadow-inner whitespace-pre-wrap transition-opacity duration-200"
                  style={{ opacity: previewLoading && !peeking ? 0.5 : 1 }}
                  data-testid="preview-output"
                >
                  {peeking
                    ? previewText
                    : previewResult || (
                        <span className="text-muted-foreground italic">
                          Preview will appear here…
                        </span>
                      )}
                </div>
              </div>

            </CardContent>
          </Card>
        </section>

        {/* 3. Upload & Process — centered single column */}
        <section data-testid="section-process">
          <div className="space-y-6">
            <h2
              className="font-serif text-3xl font-medium text-foreground"
              data-testid="heading-process"
            >
              Process your EPUB
            </h2>

            <div className="flex flex-col items-center gap-5">

              {/* Dropzone */}
              <div
                className={`w-full border-2 border-dashed flex flex-col items-center justify-center py-16 px-8 text-center cursor-pointer transition-colors rounded-xl ${
                  file
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:border-primary/40 hover:bg-muted/30 bg-background"
                }`}
                onClick={() => document.getElementById("epub-upload")?.click()}
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
                  <div className="flex flex-col items-center space-y-3">
                    <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <FileText className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-lg">{file.name}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center space-y-4">
                    <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <UploadCloud className="h-7 w-7" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-foreground text-lg">
                        Click to browse or drag .epub here
                      </p>
                      <p className="text-sm text-muted-foreground">DRM-free EPUBs only</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Settings recap */}
              <div
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/30 px-5 py-3 rounded-lg border border-border/40 w-full text-center"
                data-testid="settings-recap"
              >
                <InfoIcon className="h-4 w-4 shrink-0" />
                <span>
                  Using:{" "}
                  <strong className="text-foreground">{modeLabel(state.mode)}</strong> mode,{" "}
                  <strong className="text-foreground">
                    {getSpacingLabel(state.spacingWidth).toLowerCase()}
                  </strong>{" "}
                  spacing,{" "}
                  <strong className="text-foreground">
                    {getDensityLabel(state.chunkDensity).toLowerCase()}
                  </strong>{" "}
                  density (
                  {state.language === "auto" ? "auto-detect language" : state.language}).
                </span>
              </div>

              {/* Process button */}
              <Button
                className="w-full max-w-xs h-14 text-lg font-medium shadow-md rounded-xl"
                size="lg"
                disabled={!file || status === "processing"}
                onClick={handleProcess}
                data-testid="button-process"
              >
                {status === "processing" ? (
                  <span className="flex items-center">
                    <Spinner className="mr-3 h-5 w-5" /> Processing…
                  </span>
                ) : (
                  "Process Book"
                )}
              </Button>

            </div>

            {/* Status Messages */}
            {(status === "error" || status === "success" || fallbackMsg) && (
              <div
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300 pt-2"
                data-testid="status-area"
              >
                {status === "error" && (
                  <Alert variant="destructive" className="rounded-lg shadow-sm">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Processing Failed</AlertTitle>
                    <AlertDescription>{errorMsg}</AlertDescription>
                  </Alert>
                )}
                {fallbackMsg && status === "success" && (
                  <Alert className="rounded-lg bg-amber-50 text-amber-900 border-amber-200">
                    <InfoIcon className="h-4 w-4" />
                    <AlertTitle>Note</AlertTitle>
                    <AlertDescription>{fallbackMsg}</AlertDescription>
                  </Alert>
                )}
                {status === "success" && (
                  <div
                    className="flex flex-col sm:flex-row items-center justify-between p-6 bg-primary/5 border border-primary/20 rounded-xl shadow-sm gap-4"
                    data-testid="area-success"
                  >
                    <div className="flex items-center text-primary font-medium gap-3">
                      <CheckCircle2 className="h-6 w-6" />
                      <span className="text-lg">Ready for Kindle</span>
                    </div>
                    <Button
                      asChild
                      className="rounded-lg shadow-sm"
                      size="lg"
                      data-testid="link-download"
                    >
                      <a href={downloadUrl} download={downloadFilename}>
                        <Download className="mr-2 h-4 w-4" /> Download Book
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 4. How to use — full-width 3-column */}
        <section className="pt-8 border-t border-border/50 space-y-6" data-testid="section-how-to">
          <h3 className="font-serif text-2xl text-foreground">How to use</h3>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="bg-muted/30 border border-border/40 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">1</span>
                <strong className="text-foreground font-medium">Upload a DRM-free EPUB</strong>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">
                If your book has DRM, you'll need to remove it first. PhraseFlow only works with
                unencrypted files.
              </p>
            </div>
            <div className="bg-muted/30 border border-border/40 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">2</span>
                <strong className="text-foreground font-medium">Pick a mode and adjust the sliders</strong>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Use the live preview to find the rhythm that suits your eyes. Syntactic mode uses
                full grammar analysis; Pseudosyntactic uses fast pattern detection.
              </p>
            </div>
            <div className="bg-muted/30 border border-border/40 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">3</span>
                <strong className="text-foreground font-medium">Download and send to your Kindle</strong>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Transfer via USB cable or use Send to Kindle. Your original file is untouched —
                you can always re-process with different settings.
              </p>
            </div>
          </div>
        </section>

        {/* 5. How it works and the science — full-width, 2-column */}
        <section className="pt-8 border-t border-border/50 space-y-8" data-testid="section-science">
          <h3 className="font-serif text-2xl text-foreground">How it works, and the science behind it</h3>

          {/* Core concepts — two columns */}
          <div className="grid md:grid-cols-2 gap-x-12 gap-y-5 text-muted-foreground leading-relaxed">
            <div className="space-y-1">
              <p className="font-medium text-foreground">Chunking</p>
              <p>
                Fluent readers don't move word by word; they group words into meaningful phrases and
                take in each at a glance. PhraseFlow makes those groupings visible.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Syntactically cued formatting</p>
              <p>
                Making phrase boundaries visible with spacing. North &amp; Jenkins first measured
                the effect in 1951: readers were faster and comprehended more when phrase structure
                was cued.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Pseudosyntax</p>
              <p>
                Before you consciously parse a sentence, your brain makes a fast, rough guess at its
                structure from statistical cues, then refines it. Subtle spacing supports that
                first-pass guess instead of fighting it.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Cognitive load and cognitive fluency</p>
              <p>
                Pre-grouping words lowers the working-memory cost of reading (load) and raises the
                felt ease of processing (fluency), which tracks with comprehension and stamina.
              </p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <p className="font-medium text-foreground">Eye-fixation span</p>
              <p>
                The eye resolves only about 9 to 15 characters per fixation (Legge et al., 1997).
                Chunks sized near that span are read with fewer, shorter fixations and less
                backtracking (Magloire, 2002).
              </p>
            </div>
          </div>

          {/* Two ways to read */}
          <div className="space-y-4">
            <h4 className="font-serif text-lg text-foreground">Two ways to read</h4>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-muted/30 border border-border/40 rounded-xl p-5 space-y-2">
                <p className="font-medium text-foreground">Pseudosyntactic</p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Mirrors the brain's fast first guess at sentence structure, reading word patterns
                  to place gentle, frequent cues. Lightweight.
                </p>
              </div>
              <div className="bg-muted/30 border border-border/40 rounded-xl p-5 space-y-2">
                <p className="font-medium text-foreground">Syntactic</p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Performs a full grammatical parse, breaking only at genuine clause and phrase
                  boundaries and never inside tightly bound groups. More precise.
                </p>
              </div>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              <strong className="text-foreground">Why both?</strong> They trade coverage against
              precision differently, and the better fit depends on the reader and the text. We
              expect to settle on a single default once real reading shows which one wins.
            </p>
          </div>

          {/* References */}
          <div className="space-y-4 pt-2 border-t border-border/40">
            <h4 className="font-serif text-lg text-foreground">References</h4>
            <ul className="grid md:grid-cols-2 gap-x-10 gap-y-2 text-sm text-muted-foreground">
              <li>North &amp; Jenkins (1951) — ~10.9% faster reading; the foundational syntactically-cued study</li>
              <li>Graf &amp; Torrey (1966) — ~30.9% comprehension gain</li>
              <li>Mason &amp; Kendall (1979) — ~26.3% comprehension gain</li>
              <li>Jandreau, Muncer &amp; Bever (1986) — ~17.9% faster reading</li>
              <li>Negin (1987) — ~14.9% comprehension gain</li>
              <li>Magloire (2002) — ~31% faster reading; eye-movement evidence</li>
              <li>Walker et al. (2005), Visual-Syntactic Text Formatting — up to ~40% comprehension gain</li>
              <li>Legge et al. (1997) — eye-fixation span</li>
              <li>Hirotani, Frazier &amp; Rayner (2006) — prosodic boundaries</li>
            </ul>
            <p className="text-xs text-muted-foreground/70 leading-relaxed pt-2 border-t border-border/30">
              These effect sizes span decades and methods, and several come from developer-affiliated
              or small studies. The direction is consistent — cueing phrases helps — but treat the
              magnitudes as a range, and expect individual variation.
            </p>
          </div>
        </section>

        {/* 6. Why it exists */}
        <section
          className="bg-muted/30 p-8 md:p-12 rounded-2xl border border-border/50 text-center space-y-6"
          data-testid="section-why"
        >
          <h3 className="font-serif text-2xl text-foreground">Why it exists</h3>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Fluent readers don't read one word at a time; they take in meaningful phrases per
            glance. PhraseFlow rebuilds your EPUBs to gently cue those phrase groups with spacing:
            a free, open tool that works on the device where people actually read.
          </p>
        </section>

      </main>

      {/* Footer */}
      <footer
        className="max-w-3xl mx-auto px-6 mt-24 pb-8 text-center space-y-2 border-t border-border/30 pt-8"
        data-testid="footer"
      >
        <p className="text-sm text-foreground">
          Free and open on{" "}
          <a
            href="https://github.com"
            className="underline underline-offset-4 decoration-border hover:text-primary hover:decoration-primary transition-colors"
          >
            GitHub
          </a>
          . Contributions and evidence welcome.
        </p>
        <p className="text-xs text-muted-foreground/70">
          PhraseFlow — a reading aid, not a medical device.
        </p>
      </footer>

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
