import { useState, useCallback, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import type { FullClassificationRules, ReviewImage, ReviewSession } from './types';
import { COLOR_CATEGORIES, COLOR_SWATCHES } from './types';
import { DEFAULT_RULES } from './constants';
import { loadGroundTruth } from './storage';

type ColorCategory = (typeof COLOR_CATEGORIES)[number];

interface UploadPhaseProps {
  rules: FullClassificationRules;
  setRules: (r: FullClassificationRules) => void;
  sessions: ReviewSession[];
  onImagesLoaded: (images: ReviewImage[], zipName: string) => void;
}

export default function UploadPhase({ rules, setRules, sessions, onImagesLoaded }: UploadPhaseProps) {
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Cumulative ground truth stats
  const cumulativeStats = useMemo(() => {
    const gt = loadGroundTruth();
    const total = gt.length;
    const correct = gt.filter(g => g.assigned === g.correct).length;
    const accuracy = total > 0 ? (correct / total) * 100 : 0;
    return { total, correct, accuracy };
  }, [sessions]);

  // ZIP extraction
  const handleZip = useCallback(async (file: File) => {
    setLoading(true);
    setLoadProgress(0);

    try {
      const zip = await JSZip.loadAsync(file);
      const entries: { path: string; file: JSZip.JSZipObject }[] = [];

      zip.forEach((path, zipEntry) => {
        if (!zipEntry.dir && /\.(jpe?g|png|webp|bmp|gif)$/i.test(path)) {
          entries.push({ path, file: zipEntry });
        }
      });

      const total = entries.length;
      const results: ReviewImage[] = [];

      for (let i = 0; i < total; i++) {
        const { path, file: zipEntry } = entries[i];
        const blob = await zipEntry.async('blob');
        const blobUrl = URL.createObjectURL(blob);

        const parts = path.split('/').filter(Boolean);
        let assignedColor = 'unknown';
        for (const part of parts) {
          const lower = part.toLowerCase();
          if (COLOR_CATEGORIES.includes(lower as ColorCategory) || lower === 'please-double-check') {
            assignedColor = lower;
            break;
          }
        }

        results.push({
          id: `img_${i}`,
          filename: parts[parts.length - 1] || path,
          assignedColor,
          blobUrl,
        });

        setLoadProgress(Math.round(((i + 1) / total) * 100));
      }

      onImagesLoaded(results, file.name);
    } catch (err) {
      alert(`Failed to extract ZIP: ${err instanceof Error ? err.message : err}`);
    }
    setLoading(false);
  }, [onImagesLoaded]);

  // Drag & Drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('border-racing-500', 'bg-racing-500/5');
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-racing-500', 'bg-racing-500/5');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-racing-500', 'bg-racing-500/5');
    const file = e.dataTransfer.files[0];
    if (file && /\.zip$/i.test(file.name)) handleZip(file);
    else alert('Please drop a .zip file');
  }, [handleZip]);

  // Rules editor fields
  const ruleFields: [keyof FullClassificationRules, string, string, number][] = [
    ['deltaE_high', 'High Confidence (deltaE <)', 'Images below this deltaE are classified with high confidence', 1],
    ['deltaE_medium', 'Medium Confidence (deltaE <)', 'Images below this deltaE are classified with medium confidence', 1],
    ['deltaE_low', 'Low Confidence (deltaE <)', 'Images below this deltaE get low confidence; above = very-low', 1],
    ['boost_low_chroma_min', 'Chroma Boost Min', 'Minimum chroma to boost low to medium when dE < 25', 1],
    ['boost_coverage_min', 'Coverage Boost (%)', 'Pixel coverage above this boosts medium to high', 0.01],
    ['boost_agreement_min', 'Agreement Boost (regions)', 'Number of agreeing regions to boost confidence', 1],
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">
            Accuracy <span className="text-racing-500">Lab</span>
          </h1>
          <p className="text-xs text-white/30 mt-1">
            Define &rarr; Check &rarr; Refine &rarr; Redefine — continuous accuracy improvement loop
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRules(!showRules)} className="btn-ghost px-3 py-1.5 text-xs">
            {showRules ? 'Hide' : 'Show'} Rules
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className="btn-ghost px-3 py-1.5 text-xs">
            History ({sessions.length})
          </button>
        </div>
      </div>

      {/* Current Rules Panel */}
      {showRules && (
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-heading font-bold text-white/80">Classification Rules</h2>
          <p className="text-[10px] text-white/30">
            These mirror the deltaE thresholds in server.js. Adjust here to test, then apply changes to the worker.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {ruleFields.map(([key, label, hint, step]) => (
              <div key={key}>
                <label className="text-[10px] text-white/30 uppercase block mb-1" title={hint}>{label}</label>
                <input
                  type="number"
                  step={step}
                  value={rules[key] as number}
                  onChange={e => {
                    const updated = { ...rules, [key]: parseFloat(e.target.value) || 0 };
                    setRules(updated);
                  }}
                  className="w-full text-sm"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRules(DEFAULT_RULES)} className="btn-ghost px-3 py-1.5 text-[10px]">
              Reset to Defaults
            </button>
          </div>
        </div>
      )}

      {/* Session History */}
      {showHistory && sessions.length > 0 && (
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-heading font-bold text-white/80">Review History</h2>
          <div className="space-y-2">
            {sessions.slice(0, 10).map(s => (
              <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div>
                  <span className="text-xs text-white/60">{s.zipName}</span>
                  <span className="text-[10px] text-white/20 ml-2">{new Date(s.date).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/40">{s.reviewed}/{s.totalImages} reviewed</span>
                  <span className={`text-xs font-mono font-bold ${s.accuracy >= 95 ? 'text-green-400' : s.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {s.accuracy.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* Cumulative stats */}
          <div className="pt-3 border-t border-white/5">
            <div className="flex items-center gap-4">
              <span className="text-[10px] text-white/30 uppercase">All-Time Ground Truth:</span>
              <span className="text-xs text-white/60">{cumulativeStats.total} images</span>
              <span className={`text-xs font-mono font-bold ${cumulativeStats.accuracy >= 95 ? 'text-green-400' : cumulativeStats.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                {cumulativeStats.accuracy.toFixed(1)}% accuracy
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Drop Zone */}
      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className="glass-card p-12 flex flex-col items-center justify-center gap-4 cursor-pointer
                   border-2 border-dashed border-white/10 hover:border-racing-500/50 hover:bg-racing-500/[0.02]
                   transition-all duration-300 min-h-[300px]"
      >
        {loading ? (
          <>
            <div className="w-48 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-racing-500 transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
            <span className="text-sm text-white/40">Extracting images... {loadProgress}%</span>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-racing-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-racing-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm text-white/60 font-medium">Drop a sorted results ZIP here</p>
              <p className="text-[10px] text-white/30 mt-1">
                or click to browse — accepts AutoHue output ZIPs
              </p>
            </div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleZip(f);
          }}
        />
      </div>

      {/* Quick stats about ground truth database */}
      {cumulativeStats.total > 0 && !showHistory && (
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-racing-500/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-racing-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-white/60">Ground Truth Database</p>
              <p className="text-[10px] text-white/30">{cumulativeStats.total} images reviewed across {sessions.length} sessions</p>
            </div>
          </div>
          <span className={`text-lg font-mono font-bold ${cumulativeStats.accuracy >= 95 ? 'text-green-400' : cumulativeStats.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
            {cumulativeStats.accuracy.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
