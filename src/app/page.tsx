'use client';

import { useState, FormEvent, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Loader2, CheckCircle, AlertCircle, Terminal, FileArchive, Shield, Code, ArrowRight, Github, Cpu, Network, AlertTriangle } from 'lucide-react';

type Platform = 'auto' | 'framer' | 'wix' | 'webflow' | 'carrd';

interface ExportState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  html?: string;
  filename?: string;
  size?: number;
}

const PLATFORMS: { id: Platform; name: string; description: string }[] = [
  { id: 'auto', name: 'AUTO', description: 'Automatic detection' },
  { id: 'framer', name: 'FRAMER', description: 'Framer sites' },
  { id: 'wix', name: 'WIX', description: 'Wix / Editor X' },
  { id: 'webflow', name: 'WEBFLOW', description: 'Webflow sites' },
  { id: 'carrd', name: 'CARRD', description: 'Carrd pages' },
];

export default function Home() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'html' | 'zip'>('html');
  const [platform, setPlatform] = useState<Platform>('auto');
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setExportState({ status: 'loading' });

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format, platform }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Export failed');
      }

      if (format === 'html') {
        setExportState({
          status: 'success',
          message: 'Export complete',
          html: data.html,
          filename: data.filename,
          size: data.size,
        });
      } else {
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = data.filename || 'website.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        setExportState({
          status: 'success',
          message: 'ZIP downloaded',
        });
      }
    } catch (error) {
      setExportState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Export failed',
      });
    }
  };

  const downloadHtml = () => {
    if (!exportState.html || !exportState.filename) return;

    const blob = new Blob([exportState.html], { type: 'text/html' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = exportState.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="min-h-screen bg-background grid-pattern">
      {/* Noise texture - applied via CSS pseudo-element with pointer-events: none */}

      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center border-2 border-primary/50 bg-primary/10 tech-border">
                <Terminal className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">NOCODE<span className="text-primary">EXPORT</span></h1>
                <p className="text-xs text-muted-foreground font-mono">v1.0.0</p>
              </div>
            </div>
            <nav className="hidden sm:flex items-center gap-6 text-sm">
              <a href="#features" className="text-muted-foreground hover:text-primary transition-colors font-mono text-xs uppercase tracking-wider">[Features]</a>
              <a href="https://github.com/sriramkidambi/nocodeexport" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                <Github className="w-5 h-5" />
                <span className="font-mono text-xs">GitHub</span>
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12 md:py-20">
        {/* Hero Section */}
        <div className={`max-w-4xl mx-auto mb-16 ${mounted ? 'animate-fade-in' : 'opacity-0'}`}>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px bg-primary/30 flex-1" />
            <div className="flex items-center gap-2 px-3 py-1.5 border border-primary/30 bg-primary/5">
              <Cpu className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-mono text-primary uppercase tracking-widest">Open Source</span>
            </div>
            <div className="h-px bg-primary/30 flex-1" />
          </div>

          <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter mb-6 leading-[0.9]">
            <span className="block">BREAK</span>
            <span className="block text-primary">FREE</span>
            <span className="block text-muted-foreground">FROM NO-CODE</span>
          </h2>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-8 font-light leading-relaxed">
            Extract clean, self-contained HTML from Framer, Wix, Webflow, and Carrd.
            <span className="text-primary font-mono text-sm mx-2">&rarr;</span>
            No watermarks, no redirects, no lock-in.
          </p>

          <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full status-pulse" />
              SYSTEM ONLINE
            </span>
            <span>::</span>
            <span>{new Date().toISOString().split('T')[0]}</span>
          </div>
        </div>

        {/* Export Terminal */}
        <div className={`max-w-2xl mx-auto mb-20 ${mounted ? 'animate-fade-in animate-delay-200' : 'opacity-0'}`}>
          <div className="tech-border bg-background backdrop-blur-sm border-2">
            {/* Terminal header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-destructive" />
                <div className="w-3 h-3 rounded-full bg-primary" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs font-mono text-muted-foreground">./export.sh — platform-detector</span>
              </div>
              <div className="w-16" />
            </div>

            {/* Terminal body */}
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* URL Input */}
                <div className="space-y-2">
                  <label htmlFor="url" className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    <Terminal className="w-3.5 h-3.5" />
                    Target URL
                  </label>
                  <div className="relative">
                    <Input
                      id="url"
                      type="url"
                      placeholder="https://your-site.framer.website"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={exportState.status === 'loading'}
                      className="font-mono text-sm bg-muted/50 border-border focus:border-primary focus:ring-primary h-12 pl-4"
                      required
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground/50">
                      {url.length > 0 ? `${url.length} chars` : '_'}
                    </div>
                  </div>
                </div>

                {/* Platform Selection */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    <Network className="w-3.5 h-3.5" />
                    Platform Target
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlatform(p.id)}
                        disabled={exportState.status === 'loading'}
                        className={`group relative px-3 py-3 border transition-all font-mono text-xs tracking-wider glitch-hover ${
                          platform === p.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-primary'
                        }`}
                      >
                        <span className="relative z-10">{p.name}</span>
                        {platform === p.id && (
                          <span className="absolute inset-0 bg-primary/5 animate-pulse" />
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground/70 pl-1">
                    {platform === 'auto'
                      ? '> auto_detect_enabled'
                      : `> targeting_${platform.toUpperCase()}_protocol`
                    }
                  </p>
                </div>

                {/* Format Selection */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    <Code className="w-3.5 h-3.5" />
                    Output Format
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormat('html')}
                      className={`group px-4 py-4 border transition-all text-left glitch-hover ${
                        format === 'html'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/30 hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Terminal className="w-5 h-5" />
                        <span className={`w-2 h-2 ${format === 'html' ? 'bg-primary' : 'bg-muted-foreground/30'} rounded-full`} />
                      </div>
                      <div className="font-mono text-sm font-medium">Single HTML</div>
                      <div className="text-xs text-muted-foreground mt-1">Self-contained file</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormat('zip')}
                      className={`group px-4 py-4 border transition-all text-left glitch-hover ${
                        format === 'zip'
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-muted/30 hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <FileArchive className="w-5 h-5" />
                        <span className={`w-2 h-2 ${format === 'zip' ? 'bg-primary' : 'bg-muted-foreground/30'} rounded-full`} />
                      </div>
                      <div className="font-mono text-sm font-medium">ZIP + Assets</div>
                      <div className="text-xs text-muted-foreground mt-1">Complete package</div>
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={exportState.status === 'loading' || !url.trim()}
                  className="w-full h-14 font-mono text-sm tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 border-0 tech-border"
                >
                  {exportState.status === 'loading' ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                      PROCESSING_
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5 mr-3" />
                      EXECUTE EXPORT
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                {/* Status Messages */}
                {exportState.status === 'success' && (
                  <div className="flex items-start gap-3 p-4 border border-green-500/30 bg-green-500/5">
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-green-500 font-mono text-sm">
                        {exportState.message}
                      </p>
                      {exportState.size && (
                        <p className="text-muted-foreground text-xs font-mono mt-1">
                          output_size: {formatSize(exportState.size)}
                        </p>
                      )}
                      {exportState.html && (
                        <Button
                          onClick={downloadHtml}
                          size="sm"
                          className="mt-3 bg-green-600 hover:bg-green-700 font-mono text-xs"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          DOWNLOAD_FILE
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {exportState.status === 'error' && (
                  <div className="flex items-start gap-3 p-4 border border-destructive/30 bg-destructive/5">
                    <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-destructive font-mono text-sm">ERROR: Export Failed</p>
                      <p className="text-muted-foreground text-xs font-mono mt-1">{exportState.message}</p>
                    </div>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="flex items-start gap-3 p-4 border border-yellow-500/30 bg-yellow-500/5 mt-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-yellow-500 font-mono text-sm font-medium">DISCLAIMER</p>
              <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
                This is a <span className="text-yellow-500">hacky solution</span> for personal/experimental use only. 
                Do not rely on this for production workloads. If you have a CMS-based site or need reliable exports, 
                please use the official export features provided by your no-code platform. 
                This tool may break at any time as platforms update their code.
              </p>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className={`max-w-5xl mx-auto ${mounted ? 'animate-fade-in animate-delay-400' : 'opacity-0'}`}>
          <div className="flex items-center gap-3 mb-12">
            <div className="h-px bg-border flex-1" />
            <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Capabilities</h3>
            <div className="h-px bg-border flex-1" />
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: 'WATERMARK_REMOVAL',
                desc: 'Strip platform badges, watermarks, and branding elements',
                color: 'text-primary',
              },
              {
                icon: Terminal,
                title: 'REDIRECT_NEUTRALIZE',
                desc: 'Eliminate scripts that forward to platform domains',
                color: 'text-green-500',
              },
              {
                icon: FileArchive,
                title: 'SELF_CONTAINED',
                desc: 'Export as single HTML or ZIP with all assets',
                color: 'text-blue-500',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className={`group tech-border bg-card/50 p-6 transition-all hover:border-primary/50 ${mounted ? 'animate-fade-in' : 'opacity-0'}`}
                style={{ animationDelay: `${400 + i * 100}ms` }}
              >
                <div className="w-12 h-12 border border-border flex items-center justify-center mb-4 group-hover:border-primary/50 transition-colors">
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h4 className="font-mono text-sm font-bold mb-3 tracking-wider">{feature.title}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs font-mono text-muted-foreground">
              Built with Next.js + Puppeteer
            </p>
            <div className="flex items-center gap-4">
              <a 
                href="https://github.com/sriramkidambi/nocodeexport" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5"
              >
                <Github className="w-4 h-4" />
                sriramkidambi/nocodeexport
              </a>
              <span className="text-muted-foreground/50">|</span>
              <p className="text-xs font-mono text-muted-foreground">
                MIT License
              </p>
            </div>
          </div>
        </div>
      </footer>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
