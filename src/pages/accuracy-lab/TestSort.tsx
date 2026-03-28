import { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';

const WORKER_URL = 'http://localhost:3001';

interface TestResult {
  file: File;
  blobUrl: string;
  category: string;
  confidence: string;
  deltaE: number | null;
  chroma: number | null;
  hex: string;
  method: string;
  detail: string;
  processing: boolean;
  error?: string;
}

const COLOR_DOT: Record<string, string> = {
  red: '#dc2626', blue: '#2563eb', green: '#16a34a', yellow: '#eab308',
  orange: '#ea580c', purple: '#9333ea', pink: '#ec4899', brown: '#92400e',
  black: '#1c1917', white: '#f5f5f4', 'silver-grey': '#9ca3af', unknown: '#666',
};

export default function TestSort() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check worker on mount
  useState(() => {
    fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => setWorkerOnline(r.ok))
      .catch(() => setWorkerOnline(false));
  });

  const classifyImage = useCallback(async (file: File): Promise<Partial<TestResult>> => {
    const formData = new FormData();
    formData.append('image', file, file.name);

    try {
      const res = await fetch(`${WORKER_URL}/api/classify`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        category: data.category || 'unknown',
        confidence: data.confidence || 'none',
        deltaE: data.deltaE ?? null,
        chroma: data.chroma ?? null,
        hex: data.hex || '#000',
        method: data.method || 'unknown',
        detail: [
          data.method,
          data.deltaE != null ? `dE=${data.deltaE}` : null,
          data.chroma != null ? `chroma=${Math.round(data.chroma)}` : null,
          data.aiDetected ? 'AI-detected' : null,
          data.segmented ? 'segmented' : null,
        ].filter(Boolean).join(' | '),
        processing: false,
      };
    } catch (e) {
      return { category: 'error', confidence: 'none', deltaE: null, chroma: null, hex: '#000', method: 'error', detail: (e as Error).message, processing: false, error: (e as Error).message };
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    let imageFiles: File[] = [];

    // Handle ZIPs: extract images from ZIP files
    for (const file of Array.from(files)) {
      if (file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = Object.values(zip.files).filter(f =>
            !f.dir && /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(f.name) && !f.name.startsWith('__MACOSX')
          );
          for (const entry of entries) {
            const blob = await entry.async('blob');
            const name = entry.name.split('/').pop() || entry.name;
            imageFiles.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
          }
        } catch (e) {
          console.error('Failed to extract ZIP:', e);
        }
      } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(file.name)) {
        imageFiles.push(file);
      }
    }

    if (imageFiles.length === 0) return;

    // Add placeholders
    const placeholders: TestResult[] = imageFiles.map(f => ({
      file: f,
      blobUrl: URL.createObjectURL(f),
      category: '', confidence: '', deltaE: null, chroma: null,
      hex: '#000', method: '', detail: '', processing: true,
    }));
    setResults(prev => [...placeholders, ...prev]);

    // Classify each
    for (let i = 0; i < imageFiles.length; i++) {
      const result = await classifyImage(imageFiles[i]);
      setResults(prev => prev.map(r =>
        r.file === imageFiles[i] ? { ...r, ...result } : r
      ));
    }
  }, [classifyImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const clearResults = () => {
    results.forEach(r => URL.revokeObjectURL(r.blobUrl));
    setResults([]);
  };

  // Download sorted ZIP — organized by color folders, ready for Learn tab
  const [downloading, setDownloading] = useState(false);
  const downloadSortedZip = useCallback(async () => {
    const done = results.filter(r => !r.processing && !r.error && r.category && r.category !== 'error');
    if (done.length === 0) return;

    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const r of done) {
        const folder = zip.folder(r.category)!;
        const response = await fetch(r.blobUrl);
        const blob = await response.blob();
        folder.file(r.file.name, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sorted-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('ZIP download failed:', e);
    }
    setDownloading(false);
  }, [results]);

  // Stats
  const classified = results.filter(r => !r.processing && !r.error);
  const processing = results.filter(r => r.processing);
  const colorCounts: Record<string, number> = {};
  for (const r of classified) colorCounts[r.category] = (colorCounts[r.category] || 0) + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">
            Test <span className="text-red-500">Sort</span>
          </h2>
          <p className="text-xs text-white/40">
            Drop photos to classify with the worker pipeline — see results instantly
          </p>
        </div>
        <div className="flex items-center gap-3">
          {workerOnline !== null && (
            <span className={`flex items-center gap-1.5 text-xs ${workerOnline ? 'text-green-400' : 'text-red-400'}`}>
              <span className={`w-2 h-2 rounded-full ${workerOnline ? 'bg-green-400' : 'bg-red-400'}`} />
              Worker {workerOnline ? 'Online' : 'Offline'}
            </span>
          )}
          {classified.length > 0 && processing.length === 0 && (
            <button
              onClick={downloadSortedZip}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {downloading ? 'Building ZIP...' : `Download Sorted ZIP (${classified.length})`}
            </button>
          )}
          {processing.length > 0 && (
            <span className="text-xs text-white/30">
              Classifying {processing.length} remaining...
            </span>
          )}
          {results.length > 0 && (
            <button onClick={clearResults} className="text-xs text-white/30 hover:text-white/60 px-2 py-1">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-red-500/60 bg-red-500/5'
            : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.zip"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />
        <p className="text-sm text-white/40">
          {dragging ? 'Drop to classify...' : 'Drop photos or a ZIP here — click to browse'}
        </p>
        <p className="text-[10px] text-white/20 mt-1">
          Accepts images + ZIP files. Each photo runs through the full AI pipeline.
        </p>
      </div>

      {/* Summary bar */}
      {classified.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).map(([color, count]) => (
            <span
              key={color}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/5 border border-white/10"
            >
              <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: COLOR_DOT[color] || '#666' }} />
              {color} ({count})
            </span>
          ))}
          <span className="text-[10px] text-white/20 ml-auto">
            {classified.length} classified
          </span>
        </div>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg overflow-hidden border transition-all ${
                r.error ? 'border-red-500/30 bg-red-500/5'
                : r.processing ? 'border-white/5 bg-white/[0.02] animate-pulse'
                : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <div className="aspect-[4/3] relative">
                <img
                  src={r.blobUrl}
                  alt={r.file.name}
                  className="w-full h-full object-cover"
                />
                {r.processing && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-red-500/40 border-t-red-500 rounded-full animate-spin" />
                  </div>
                )}
                {!r.processing && !r.error && (
                  <div className="absolute top-1.5 right-1.5">
                    <span
                      className="w-5 h-5 rounded-full border-2 border-white/40 block shadow-lg"
                      style={{ backgroundColor: COLOR_DOT[r.category] || '#666' }}
                      title={r.category}
                    />
                  </div>
                )}
              </div>
              {!r.processing && (
                <div className="p-2 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/80 capitalize">{r.category}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      r.confidence === 'high' ? 'bg-green-500/20 text-green-400'
                      : r.confidence === 'medium' ? 'bg-yellow-500/20 text-yellow-400'
                      : r.confidence === 'low' ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-red-500/20 text-red-400'
                    }`}>
                      {r.confidence}
                    </span>
                  </div>
                  <p className="text-[9px] text-white/25 truncate" title={r.detail}>{r.detail}</p>
                  <p className="text-[9px] text-white/15 truncate">{r.file.name}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !workerOnline && (
        <div className="text-center py-6">
          <p className="text-sm text-red-400/60">Worker is offline — start it to test sorting</p>
          <p className="text-[10px] text-white/20 mt-1">Run: cd autohue-desktop/worker && node server.js</p>
        </div>
      )}
    </div>
  );
}
