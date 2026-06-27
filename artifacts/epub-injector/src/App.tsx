import { useState, useEffect, useCallback, useRef, ChangeEvent } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  InfoIcon,
  AlertCircle,
  FileText,
  UploadCloud,
  CheckCircle2,
  Download,
  ChevronDown,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const defaultPreviewText =
  "The ability to read fluently depends not just on recognizing individual words, but on grouping them into meaningful phrases, which helps the eye and brain process language in easier chunks. Skilled readers do this automatically, taking in chunks of language per glance rather than processing one word at a time. This makes the same passage feel effortless to one reader and laborious to another. The difference often lies not in vocabulary, but in how efficiently the eye and brain carve the sentence into natural units. When spacing cues are added at phrase boundaries, even struggling readers begin to show eye-movement patterns closer to those of fluent readers, with fewer regressions and shorter fixation durations, making reading feel less effortful and easier to sustain.";

type Mode = "pseudosyntactic" | "syntactic";
type ReadingSupport = "balanced" | "strong";

function friendlyMode(modeUsed: string): string {
  if (modeUsed === "syntactic") return "Grammar Parse";
  if (modeUsed === "pseudosyntactic") return "Natural Scan";
  return "Keyword mode";
}

function modeLabel(mode: Mode): string {
  return mode === "syntactic" ? "Grammar Parse" : "Natural Scan";
}

function isFallbackMode(modeUsed: string): boolean {
  return modeUsed === "keyword_fallback";
}

// Wobbly hand-drawn highlighter behind "Read in phrases"
function Highlighter({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline whitespace-nowrap">
      <svg
        aria-hidden="true"
        className="highlighter-svg"
        style={{
          position: "absolute",
          top: "4%",
          left: "-2%",
          width: "104%",
          height: "90%",
          zIndex: 0,
          pointerEvents: "none",
        }}
        viewBox="0 0 220 48"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3,11 Q30,5 70,8 Q110,4 150,7 Q185,3 217,10 L218,36 Q190,42 150,39 Q110,43 70,40 Q32,44 3,37 Z"
          fill="rgba(251, 191, 36, 0.28)"
          stroke="rgba(251, 191, 36, 0.10)"
          strokeWidth="0.5"
        />
      </svg>
      <span className="relative" style={{ zIndex: 1 }}>
        {children}
      </span>
    </span>
  );
}

function SweepPhrase({
  children,
  index,
  total,
}: {
  children: React.ReactNode;
  index: number;
  total: number;
}) {
  const cycle = 5.2;
  const slot = cycle / total;
  return (
    <span className="relative inline-block align-baseline">
      <span
        aria-hidden="true"
        className="phrase-sweep"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#FDF3C8",
          borderRadius: "2px",
          animationDelay: `${index * slot}s`,
          zIndex: 0,
        }}
      />
      <span className="relative" style={{ zIndex: 1, padding: "0 3px" }}>
        {children}
      </span>
    </span>
  );
}

function Home() {
  const heroRef = useRef<HTMLElement>(null);
  const [heroVisible, setHeroVisible] = useState(true);

  const [state, setState] = useState({
    mode: "pseudosyntactic" as Mode,
    language: "auto",
    readingSupport: "balanced" as ReadingSupport,
  });

  const [previewText, setPreviewText] = useState(defaultPreviewText);
  const [previewResult, setPreviewResult] = useState("");
  const [previewModeUsed, setPreviewModeUsed] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<
    "idle" | "processing" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fallbackMsg, setFallbackMsg] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadFilename, setDownloadFilename] = useState("");

  const [gapsOpen, setGapsOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setGapsOpen(true), 1700);
    return () => clearTimeout(id);
  }, []);

  // Fade chevron when hero scrolls out of view
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Debounced preview fetch
  useEffect(() => {
    const handler = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: previewText,
            mode: state.mode,
            language: state.language,
            chunk_density: state.readingSupport,
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
    formData.append("chunk_density", state.readingSupport);

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as any).error || "Processing failed");
      }
      const fallback = res.headers.get("X-Fallback-Warning");
      if (fallback) setFallbackMsg(fallback);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = "textglide_output.epub";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      setDownloadUrl(url);
      setDownloadFilename(filename);
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    }
  };

  const handleReset = () => {
    setFile(null);
    setStatus("idle");
    setErrorMsg("");
    setFallbackMsg("");
    setDownloadUrl("");
    setDownloadFilename("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!dropped.name.endsWith(".epub")) {
      setErrorMsg("Please select a valid .epub file.");
      setStatus("error");
      setFile(null);
      return;
    }
    setFile(dropped);
    setStatus("idle");
    setErrorMsg("");
    setFallbackMsg("");
    setDownloadUrl("");
  };

  const getSupportLabel = (val: ReadingSupport) =>
    val === "balanced" ? "Balanced" : "Strong";
  const showFallback = previewModeUsed
    ? isFallbackMode(previewModeUsed)
    : false;

  return (
    <div
      className="min-h-screen pb-20 selection:bg-primary/20"
      data-testid="page-home"
    >
      {/* keyframes */}
      <style>{`
        @keyframes gentleBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(7px); }
        }
        .chevron-bounce { animation: gentleBounce 2.4s ease-in-out infinite; }

        @keyframes highlighterDraw {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .highlighter-svg {
          transform-origin: left center;
          animation: highlighterDraw 750ms ease-out 400ms both;
        }

        @keyframes phraseHighlightSweep {
          0%   { transform: scaleX(0); }
          10%  { transform: scaleX(1); }
          21%  { transform: scaleX(1); }
          23%  { transform: scaleX(0); }
          100% { transform: scaleX(0); }
        }
        .phrase-sweep {
          transform: scaleX(0);
          transform-origin: left center;
          animation: phraseHighlightSweep 5.2s ease-out infinite;
        }

        .gap-span {
          display: inline-block;
          width: 0;
          overflow: hidden;
          transition: width 1700ms ease-out;
        }
        .gaps-open .gap-span {
          width: 0.22em;
        }
      `}</style>
      {/* ── 1. Hero — full viewport ─────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative min-h-screen md:h-screen flex flex-col items-center justify-center text-center overflow-hidden px-6 py-16 md:py-0"
        data-testid="section-hero"
      >
        <div className="max-w-7xl w-full mx-auto space-y-6 md:space-y-10">
          {/* Headline with "Read in phrases" highlighter */}
          <h1
            className="font-serif text-3xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-medium tracking-tight text-foreground leading-tight"
            data-testid="hero-headline"
          >
            <Highlighter>Read in phrases</Highlighter>
            {","}
            <br />
            not word by word.
          </h1>

          <p
            className="text-base sm:text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
            data-testid="hero-subhead"
          >TextGlide adds subtle spacing at the natural phrase boundaries in your EPUBs, so your eyes group words into meaningful phrases the way fluent readers naturally do.</p>

          {/* Before / After cards */}
          <div
            className="grid md:grid-cols-2 gap-4 text-left max-w-4xl mx-auto"
            data-testid="hero-comparison"
          >
            <div className="p-5 md:p-8 rounded-xl bg-muted/30 border border-border/50">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 md:mb-5">
                Before
              </div>
              <p className="font-serif text-base md:text-xl leading-[2] text-foreground">
                She wrote every morning by the window, while the city came
                slowly awake outside and the light changed.
              </p>
            </div>
            <div className="p-5 md:p-8 rounded-xl bg-primary/5 border border-primary/20 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary/40" />
              <div className="text-xs uppercase tracking-wider text-primary font-semibold mb-3 md:mb-5">
                After
              </div>
              <p className={`font-serif text-base md:text-xl leading-[2] text-foreground${gapsOpen ? " gaps-open" : ""}`}>
                She wrote every morning<span className="gap-span" aria-hidden="true" /> by the window,<span className="gap-span" aria-hidden="true" /> while the city came slowly awake outside<span className="gap-span" aria-hidden="true" /> and the light changed.
              </p>
            </div>
          </div>
        </div>

        {/* Scroll chevron — fades when hero leaves viewport */}
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 transition-opacity duration-700 pointer-events-none"
          style={{ opacity: heroVisible ? 1 : 0 }}
          aria-hidden="true"
        >
          <ChevronDown
            className="chevron-bounce h-7 w-7"
            style={{ color: "rgba(180, 140, 80, 0.55)" }}
            strokeWidth={1.5}
          />
        </div>
      </section>
      {/* ── Sections below the fold ─────────────────────────────────────── */}
      <main
        className="max-w-7xl mx-auto px-4 md:px-10 space-y-12 md:space-y-20 pt-12 md:pt-20"
        data-testid="main-content"
      >
        {/* 2. Live Preview */}
        <section data-testid="section-preview">
          <Card
            className="border-border/60 shadow-md bg-card/50 backdrop-blur-sm overflow-hidden"
            data-testid="card-preview"
          >
            <div className="bg-muted/30 px-6 py-4 border-b border-border/50 flex justify-between items-center">
              <h2 className="font-medium text-foreground">
                Try it ➞ Preview before you process
              </h2>
              {previewLoading && (
                <Spinner
                  className="h-4 w-4 text-primary"
                  data-testid="preview-spinner"
                />
              )}
            </div>
            <CardContent className="p-6 space-y-8">
              <div className="space-y-3">
                <Label
                  htmlFor="preview-text"
                  className="text-sm font-medium text-foreground"
                >
                  Test Text
                </Label>
                <Textarea
                  id="preview-text"
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  className="resize-y min-h-[120px] font-serif text-base bg-background"
                  data-testid="textarea-preview"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-8 bg-background p-5 rounded-lg border border-border/40">
                {/* Left col: Mode + Language */}
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">Mode</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            data-testid="tooltip-mode"
                          >
                            <InfoIcon className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] p-3 text-sm">
                          Controls how TextGlide identifies phrase boundaries.
                          Natural Scan uses a fast statistical approach; Grammar
                          Parse uses a full grammatical analysis.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <RadioGroup
                      value={state.mode}
                      onValueChange={(v: Mode) =>
                        setState({ ...state, mode: v })
                      }
                      className="flex flex-col gap-2"
                      data-testid="radio-mode"
                    >
                      <div className="flex items-center justify-between bg-muted/20 px-3 py-2.5 rounded-md border border-border/50">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="pseudosyntactic"
                            id="mode-pseudo"
                          />
                          <Label
                            htmlFor="mode-pseudo"
                            className="cursor-pointer font-normal"
                          >
                            Natural Scan
                          </Label>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground ml-1"
                              data-testid="tooltip-mode-pseudo"
                            >
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] p-3 text-sm">
                            A fast, statistical read of where phrases begin,
                            from word-pattern cues rather than full grammar. It
                            mirrors the quick first-pass your eyes already make.
                            In head-to-head research this rough method actually
                            beat full grammar parsing for readability, which is
                            why it's the default.
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="flex items-center justify-between bg-muted/20 px-3 py-2.5 rounded-md border border-border/50">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="syntactic"
                            id="mode-syntactic"
                          />
                          <Label
                            htmlFor="mode-syntactic"
                            className="cursor-pointer font-normal"
                          >
                            Grammar Parse
                          </Label>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground ml-1"
                              data-testid="tooltip-mode-syntactic"
                            >
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] p-3 text-sm">
                            A complete grammatical analysis of each sentence
                            before placing breaks. More linguistically precise,
                            but precision isn't what helps reading here. Kept as
                            a comparison option.
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

                {/* Right col: Reading Support */}
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        Reading Support
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            data-testid="tooltip-support"
                          >
                            <InfoIcon className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[240px] p-3 text-sm">
                          Controls how often phrase gaps appear. Balanced is
                          tuned to how fluent eyes naturally group text. Strong
                          adds finer breaks especially beneficial for dense
                          material or developing readers.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <RadioGroup
                      value={state.readingSupport}
                      onValueChange={(v: ReadingSupport) =>
                        setState({ ...state, readingSupport: v })
                      }
                      className="flex flex-col gap-2"
                      data-testid="radio-support"
                    >
                      <div className="flex items-center justify-between bg-muted/20 px-3 py-2.5 rounded-md border border-border/50">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="balanced"
                            id="support-balanced"
                          />
                          <Label
                            htmlFor="support-balanced"
                            className="cursor-pointer font-normal"
                          >
                            Balanced
                          </Label>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground ml-1"
                              data-testid="tooltip-balanced"
                            >
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] p-3 text-sm">
                            Breaks at the main phrase boundaries, keeping groups
                            around 2 to 3 words, tuned to how fluent eyes
                            naturally group text. Best for everyday reading.
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="flex items-center justify-between bg-muted/20 px-3 py-2.5 rounded-md border border-border/50">
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="strong" id="support-strong" />
                          <Label
                            htmlFor="support-strong"
                            className="cursor-pointer font-normal"
                          >
                            Strong
                          </Label>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground ml-1"
                              data-testid="tooltip-strong"
                            >
                              <InfoIcon className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] p-3 text-sm">
                            Finer breaks into smaller groups. Research shows
                            this extra support especially helps developing and
                            non-native readers, and it can help anyone tackling
                            dense or difficult material.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
              </div>

              {/* Result */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-sm font-medium text-foreground">
                    Result
                  </Label>
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
                      Without TextGlide
                    </button>
                  </div>
                </div>
                <div
                  className="min-h-[140px] p-6 rounded-lg bg-background border border-border/60 font-serif text-[1.1rem] leading-[1.75] text-foreground shadow-inner whitespace-pre-wrap transition-opacity duration-200"
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

        {/* 3. Upload & Process */}
        <section data-testid="section-process">
          <div className="space-y-6">
            <h2
              className="font-serif text-3xl font-medium text-foreground"
              data-testid="heading-process"
            >
              Process your EPUB
            </h2>

            <div className="flex flex-col items-center gap-4">
              {/* Dropzone */}
              <div
                className={`w-full border-2 border-dashed flex flex-col items-center justify-center py-10 md:py-16 px-5 md:px-8 text-center cursor-pointer transition-colors rounded-xl ${
                  isDragging
                    ? "border-primary bg-primary/10"
                    : file
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-primary/40 hover:bg-muted/30 bg-background"
                }`}
                onClick={() => document.getElementById("epub-upload")?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-testid="upload-area"
              >
                <input
                  id="epub-upload"
                  ref={fileInputRef}
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
                      <p className="font-medium text-foreground text-lg">
                        {file.name}
                      </p>
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
                      <p className="text-sm text-muted-foreground">
                        DRM-free EPUBs only
                      </p>
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
                  <strong className="text-foreground">
                    {modeLabel(state.mode)}
                  </strong>{" "}
                  mode,{" "}
                  <strong className="text-foreground">
                    {getSupportLabel(state.readingSupport).toLowerCase()}
                  </strong>{" "}
                  support (
                  {state.language === "auto"
                    ? "auto-detect language"
                    : state.language}
                  ).
                </span>
              </div>

              {/* Left-align reminder */}
              <p className="text-xs text-muted-foreground/70 text-center w-full leading-relaxed">
                For best results, set your e-reader to <strong className="text-muted-foreground">left-aligned (ragged-right)</strong> text. Justified text stretches normal spaces and can cancel out the phrase spacing.
              </p>

              {/* Process button */}
              <Button
                className="w-full md:max-w-xs h-14 text-lg font-medium shadow-md rounded-xl"
                size="lg"
                disabled={!file || status === "processing"}
                onClick={handleProcess}
                data-testid="button-process"
              >
                Process Book
              </Button>

              {/* Status caption — appears below button during / after processing */}
              {status !== "idle" && (
                <div
                  className="flex items-center gap-2 text-sm animate-in fade-in duration-300"
                  data-testid="process-caption"
                >
                  {status === "processing" && (
                    <>
                      <span
                        className="inline-block h-4 w-4 rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground/80"
                        style={{ animation: "spin 1.1s linear infinite" }}
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground">
                        Processing — please wait…
                      </span>
                    </>
                  )}
                  {status === "success" && (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600/80" />
                      <span className="text-emerald-700/90">
                        Done! Your file is ready.
                      </span>
                    </>
                  )}
                  {status === "error" && (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-400/80 shrink-0" />
                      <span className="text-red-500/80">{errorMsg}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Post-process area */}
            {(fallbackMsg || status === "success") && (
              <div
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300 pt-2"
                data-testid="status-area"
              >
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
                      <span className="text-lg">Ready for e-Reader</span>
                    </div>
                    <div className="flex items-center gap-3">
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
                      <Button
                        variant="outline"
                        size="lg"
                        className="rounded-lg"
                        onClick={handleReset}
                        data-testid="button-reset"
                      >
                        Process Another Book
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 4. How to use */}
        <section
          className="pt-8 border-t border-border/50 space-y-6"
          data-testid="section-how-to"
        >
          <h3 className="font-serif text-2xl text-foreground">How to use</h3>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="bg-muted/30 border border-border/40 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                  1
                </span>
                <strong className="text-foreground font-medium">
                  Upload a DRM-free EPUB
                </strong>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">If your book has DRM, you’ll need to legally remove it. TextGlide only works with DRM-free files and currently supports only EPUBs.</p>
            </div>
            <div className="bg-muted/30 border border-border/40 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                  2
                </span>
                <strong className="text-foreground font-medium">
                  Pick a mode and adjust the sliders
                </strong>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">Try the live preview to find your preferred mode. Natural Scan relies on fast pattern detection, while Grammar Parse employs full grammar analysis.</p>
            </div>
            <div className="bg-muted/30 border border-border/40 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                  3
                </span>
                <strong className="text-foreground font-medium">
                  Download and send to your e-reader
                </strong>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Transfer via USB cable or use the Send to Kindle app. Your
                original file is untouched; you can always reprocess with
                different settings.
              </p>
            </div>
          </div>
        </section>

        {/* 5. How it works and the science */}
        <section
          className="pt-8 border-t border-border/50 space-y-6"
          data-testid="section-science"
        >
          <h3 className="font-serif text-2xl text-foreground">
            How it works, and the science behind it
          </h3>

          <div className="grid md:grid-cols-2 gap-x-12 gap-y-5 text-muted-foreground leading-relaxed">
            <div className="space-y-1">
              <p className="font-medium text-foreground">Chunking</p>
              <p>Fluent readers don’t read word by word. They group words into phrases and take in each group at a glance. TextGlide subtly surfaces these natural word groupings in your text, so your eyes and brain work less.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Syntactically cued formatting
              </p>
              <p>Adding spacing to show phrase breaks helps readers. North & Jenkins first studied this in 1951 and found that readers were faster and understood more when phrase structure was cued. Many later studies have confirmed this.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Pseudosyntax</p>
              <p>Before you consciously parse a sentence, your brain makes a fast, rough guess at its structure from statistical cues. Subtle spacing supports that first-pass guess, making the text easier to read.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Cognitive load and cognitive fluency
              </p>
              <p>
                Pre-grouping words lowers the working-memory cost of reading
                (load) and raises the felt ease of processing (fluency), which
                tracks with comprehension and stamina, especially under fatigue.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Eye-fixation span</p>
              <p>The eye takes in roughly 1–2 words per fixation, spending ~250ms on each. Poor readers make more fixations, hold them longer, and regress more often than skilled readers. Phrase-sized chunks align with this natural fixation rhythm, reducing the work per glance (Lefton, Nagle & Johnson, 1979).</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Regression &amp; backtracking
              </p>
              <p>
                When a phrase boundary is missed, the eye doubles back to
                re-read. Poor readers regress much more often than skilled
                readers. Phrase-cueing reduces this backtracking: Magloire
                (2002) found ~31% faster reading and fewer costly regressions.
                Lefton, Nagle &amp; Johnson (1979) independently found
                significantly more regressions in poor readers than skilled
                readers.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-serif text-lg text-foreground">
              Two ways to read
            </h4>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-muted/30 border border-border/40 rounded-xl p-5 space-y-2">
                <p className="font-medium text-foreground">Natural Scan</p>
                <p className="text-muted-foreground text-sm leading-relaxed">A fast, statistical read of where phrases begin, from word-pattern cues rather than full grammar. Mirrors the intuitive first pass your eyes already make. In head-to-head research, this rough, heuristic method actually beat full-grammar parsing and even a prosodic parse for readability, which is why it's the default.</p>
              </div>
              <div className="bg-muted/30 border border-border/40 rounded-xl p-5 space-y-2">
                <p className="font-medium text-foreground">Grammar Parse</p>
                <p className="text-muted-foreground text-sm leading-relaxed">A complete grammatical analysis of each sentence before inserting gaps. Technically, it's more linguistically precise, but evidence shows that full-phrase-structure parsing was less effective than a heuristic-based phrase segmenter. Kept as a comparison option for research and testing purposes.</p>
              </div>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed text-center">
              <strong className="text-foreground">Why both?</strong> They trade coverage against precision differently. We expect to settle on one single mode soon.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section
          className="pt-8 border-t border-border/50 space-y-6"
          data-testid="section-faq"
        >
          <h3 className="font-serif text-2xl text-foreground">Frequently Asked Questions</h3>
          <dl className="space-y-0 divide-y divide-border/40">
            {[
              {
                q: "Will TextGlide work with my e-reader?",
                a: "TextGlide creates a standard EPUB file. Any e-reader that supports EPUBs should work, like Kindle, Kobo, Apple Books, and most reading apps. The spacing is built in (inline), so it stays even if you change the font size or layout.",
              },
              {
                q: "Does this actually work?",
                a: "Across roughly two dozen studies of phrase-based spacing, the ones that reached statistical significance averaged about a 12.7% gain in comprehension and a 9.9% gain in reading speed; several other studies found no significant effect, so it is best treated as a real but modest, not guaranteed, improvement. The benefit is largest for developing, average, and non-native readers. For example, in one study, weaker readers improved about 37% compared to about 6% for the strongest readers (Bever et al. 1992), and the benefit is greater on harder material. Importantly, the gain comes from breaking at the right phrase boundaries, not from extra whitespace: a control condition with the same amount of extra space spread evenly produced no benefit at all (Jandreau & Bever 1992; Bever et al. 1992).",
              },
              {
                q: "Does TextGlide remove DRM?",
                a: "No, it can’t. TextGlide won’t process any EPUB with DRM and will let you know if that’s the case. It only works on DRM-free files, like books you wrote, public-domain texts, or files you’ve legally made DRM-free yourself.",
              },
              {
                q: "How do I choose between Natural Scan and Grammar Parse?",
                a: "Natural Scan reads word-pattern cues to guess phrase boundaries, similar to the rough first pass your brain makes before fully parsing a sentence. Grammar Parse runs a complete grammatical analysis before placing breaks. Head-to-head research found that the faster statistical method significantly outperformed the precise grammar parse in terms of readability (Bever et al. 1992), which is why Natural Scan is the default. Try Grammar Parse if you want to compare, but the evidence favors Natural Scan.",
              },
              {
                q: "Can I adjust the Reading Support level?",
                a: "Yes. The Reading Support setting lets you pick Balanced or Strong. Balanced breaks at main phrase points, grouping about 3 to 5 words, which works well for most reading. Strong adds more breaks, which research shows help developing and non-native readers, as well as anyone reading tough material. The live preview updates right away, so you can see the difference before you process your file.",
              },
              {
                q: "Why set my e-reader to left-aligned?",
                a: "A justified text layout stretches word spacing to fill each line. This stretching is unpredictable and can erase the calibrated phrase gaps that TextGlide adds. All supporting research on which TextGlide is based used left-aligned (ragged-right) text, where word spacing remains fixed, and phrase gaps are easy to see. TextGlide processing sets a left alignment rule in your file as a best effort, but your device's settings might override it. It's a good idea to set it manually, too.",
              },
              {
                q: "What if I don't like the result?",
                a: "Your original file is never changed. TextGlide makes a copy and gives you the new file to download. You can always return to your original, adjust the settings, and process it again as many times as you want.",
              },
              {
                q: "Does TextGlide store my books or personal data?",
                a: "No. Uploaded files are handled in a temporary folder and deleted right after your download is ready. TextGlide does not log IP addresses, store EPUBs, or collect any personal data. Nothing you upload is ever kept or sent anywhere.",
              },
            ].map(({ q, a }) => (
              <div key={q} className="py-5">
                <dt className="font-serif text-base font-medium text-foreground mb-2">
                  {q}
                </dt>
                <dd className="text-muted-foreground leading-relaxed text-sm">
                  {a}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* References */}
        <section
          className="pt-8 border-t border-border/50 space-y-6"
          data-testid="section-references"
        >
          <h3 className="font-serif text-2xl text-foreground">References</h3>
          <ul className="flex flex-col gap-y-2 text-sm text-muted-foreground list-disc pl-5">
            <li>North &amp; Jenkins (1951): 13.3%* comprehension gain, 10.9%* speed gain — foundational syntactically-cued study</li>
            <li>Coleman &amp; Kim (1961): 6.1% comprehension gain — inline spacing; line-break arms significantly slower</li>
            <li>Graf &amp; Torrey (1966): 30.9%* comprehension gain</li>
            <li>Mason &amp; Kendall (1978): 26.3%* comprehension gain — low-ability readers; high-ability: no significant effect</li>
            <li>Lefton, Nagle &amp; Johnson (1979): eye-fixation dynamics — adults ~1.2 words/fixation, ~250ms; poor readers: more, longer fixations, more regressions</li>
            <li>Keenan (1984): line-break chunking read significantly slower than standard text — line-length variability is the mechanism</li>
            <li>Jandreau, Muncer &amp; Bever (1986): 17.9%* speed gain — inline phrase gaps; gap width 1.7–2.9× normal</li>
            <li>Jandreau &amp; Bever (1992): 14.9%* comprehension gain, 8.9%* speed gain — even-spaced control yielded zero benefit; placement is the mechanism, not extra whitespace</li>
            <li>Bever et al. (1992, Visible Language): crude heuristic beat full grammar parse (p&lt;.025); weak readers +37%, strong readers +6%; gap magnitude had no significant effect</li>
            <li>Negin (1987): 14.9%* comprehension gain — syntactic segmentation; hearing-impaired second-grade readers</li>
            <li>Magloire (2002): 31.0%* speed gain — eye-movement-tracked conditions</li>
            <li>Walker et al. (2005): 40.0%* comprehension gain — Visual-Syntactic Text Formatting</li>
          </ul>
          <p className="text-xs text-muted-foreground/70 leading-relaxed pt-2 border-t border-border/30">
            These results come from studies over many years and use different methods, with some based on small groups. The trend is clear: cueing phrases make reading feel easier, but the effect size varies, and results can differ from person to person.
          </p>
        </section>

        {/* 6. Why it exists */}
        <section
          className="bg-muted/30 p-8 md:p-12 rounded-2xl border border-border/50 text-center space-y-6"
          data-testid="section-why"
        >
          <h3 className="font-serif text-2xl text-foreground">Why it exists</h3>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">Fluent readers don't read one word at a time; they take in meaningful phrases per glance. TextGlide swiftly rebuilds your EPUBs to gently cue those phrase groups with carefully calibrated extra spacing: a free, open-source tool that works on any e-reader that accepts EPUBs.</p>
        </section>
      </main>
      {/* Footer */}
      <footer
        className="max-w-7xl mx-auto px-6 md:px-10 mt-24 pb-8 text-center space-y-2 border-t border-border/30 pt-8"
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
          TextGlide — a reading aid, not a medical device.
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
