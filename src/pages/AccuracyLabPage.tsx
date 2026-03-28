import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import JSZip from 'jszip';

// ── AutoHue canonical color categories ──
const COLOR_CATEGORIES = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple',
  'pink', 'brown', 'black', 'white', 'silver-grey',
] as const;
type ColorCategory = (typeof COLOR_CATEGORIES)[number];

// Visual swatches for each category
const COLOR_SWATCHES: Record<string, string> = {
  red: '#dc2626', blue: '#2563eb', green: '#16a34a', yellow: '#eab308',
  orange: '#ea580c', purple: '#9333ea', pink: '#ec4899', brown: '#92400e',
  black: '#1c1917', white: '#f5f5f4', 'silver-grey': '#9ca3af',
};

// Tailwind-friendly badge colors
const COLOR_BADGES: Record<string, string> = {
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  brown: 'bg-amber-700/20 text-amber-500 border-amber-700/30',
  black: 'bg-stone-800/40 text-stone-300 border-stone-600/30',
  white: 'bg-white/15 text-white border-white/30',
  'silver-grey': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// ── Classification rules (mirrors server.js thresholds) ──
interface ClassificationRules {
  deltaE_high: number;      // <12 = high confidence
  deltaE_medium: number;    // <20 = medium confidence
  deltaE_low: number;       // <30 = low confidence
  chroma_boost_min: number; // chroma > 25 && dE < 25 → boost low→medium
  coverage_boost: number;   // pct > 0.10 → boost medium→high
  agreement_boost: number;  // agreeing >= 2 → boost
}

const DEFAULT_RULES: ClassificationRules = {
  deltaE_high: 12,
  deltaE_medium: 20,
  deltaE_low: 30,
  chroma_boost_min: 25,
  coverage_boost: 0.10,
  agreement_boost: 2,
};

// ── Image review item ──
interface ReviewImage {
  id: string;
  filename: string;
  assignedColor: string;    // folder it was sorted into
  blobUrl: string;          // object URL for display
  verdict?: 'correct' | 'incorrect';
  correctColor?: string;    // what it SHOULD be (if incorrect)
}

// ── Session history (persisted to localStorage) ──
interface ReviewSession {
  id: string;
  date: string;
  zipName: string;
  totalImages: number;
  reviewed: number;
  accuracy: number;
  confusionPairs: { from: string; to: string; count: number }[];
}

// ── Phase type ──
type Phase = 'upload' | 'review' | 'results';

// ── LocalStorage keys ──
const LS_SESSIONS = 'autohue_accuracy_sessions';
const LS_RULES = 'autohue_accuracy_rules';
const LS_GROUND_TRUTH = 'autohue_ground_truth';

function loadSessions(): ReviewSession[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]'); } catch { return []; }
}
function saveSessions(s: ReviewSession[]) { localStorage.setItem(LS_SESSIONS, JSON.stringify(s)); }
function loadRules(): ClassificationRules {
  try { return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(LS_RULES) || '{}') }; } catch { return DEFAULT_RULES; }
}
function saveRules(r: ClassificationRules) { localStorage.setItem(LS_RULES, JSON.stringify(r)); }

interface GroundTruth { assigned: string; correct: string; filename: string; date: string; }
function loadGroundTruth(): GroundTruth[] {
  try { return JSON.parse(localStorage.getItem(LS_GROUND_TRUTH) || '[]'); } catch { return []; }
}
function saveGroundTruth(gt: GroundTruth[]) { localStorage.setItem(LS_GROUND_TRUTH, JSON.stringify(gt)); }

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────
export default function AccuracyLabPage() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [images, setImages] = useState<ReviewImage[]>([]);
  const [zipName, setZipName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [filterColor, setFilterColor] = useState<string | 'all'>('all');
  const [filterVerdict, setFilterVerdict] = useState<'all' | 'unreviewed' | 'correct' | 'incorrect'>('all');
  const [rules, setRules] = useState<ClassificationRules>(loadRules);
  const [sessions, setSessions] = useState<ReviewSession[]>(loadSessions);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<ReviewImage | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Save rules whenever they change
  useEffect(() => { saveRules(rules); }, [rules]);

  // ── ZIP extraction ──
  const handleZip = useCallback(async (file: File) => {
    setLoading(true);
    setLoadProgress(0);
    setZipName(file.name);

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

        // Extract color folder: path like "session_name/red/image.jpg" → "red"
        const parts = path.split('/').filter(Boolean);
        let assignedColor = 'unknown';
        // Find the color folder — it should be one of our categories
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

      setImages(results);
      setPhase('review');
    } catch (err) {
      alert(`Failed to extract ZIP: ${err instanceof Error ? err.message : err}`);
    }
    setLoading(false);
  }, []);

  // ── Drag & Drop ──
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

  // ── Verdict handlers ──
  const setVerdict = useCallback((id: string, verdict: 'correct' | 'incorrect', correctColor?: string) => {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, verdict, correctColor: verdict === 'correct' ? undefined : correctColor } : img
    ));
  }, []);

  const setCorrectColor = useCallback((id: string, color: string) => {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, correctColor: color } : img
    ));
  }, []);

  // ── Bulk actions ──
  const markAllCorrect = useCallback(() => {
    setImages(prev => prev.map(img => img.verdict ? img : { ...img, verdict: 'correct' }));
  }, []);

  const markFilteredCorrect = useCallback(() => {
    setImages(prev => prev.map(img => {
      if (img.verdict) return img;
      if (filterColor !== 'all' && img.assignedColor !== filterColor) return img;
      return { ...img, verdict: 'correct' };
    }));
  }, [filterColor]);

  // ── Computed metrics ──
  const metrics = useMemo(() => {
    const reviewed = images.filter(i => i.verdict);
    const correct = reviewed.filter(i => i.verdict === 'correct');
    const incorrect = reviewed.filter(i => i.verdict === 'incorrect');
    const accuracy = reviewed.length > 0 ? (correct.length / reviewed.length) * 100 : 0;

    // Per-color stats
    const colorStats: Record<string, { total: number; correct: number; incorrect: number; confusedWith: Record<string, number> }> = {};
    for (const cat of COLOR_CATEGORIES) {
      colorStats[cat] = { total: 0, correct: 0, incorrect: 0, confusedWith: {} };
    }
    for (const img of reviewed) {
      const cat = img.assignedColor;
      if (!colorStats[cat]) colorStats[cat] = { total: 0, correct: 0, incorrect: 0, confusedWith: {} };
      colorStats[cat].total++;
      if (img.verdict === 'correct') colorStats[cat].correct++;
      else {
        colorStats[cat].incorrect++;
        const actual = img.correctColor || 'unknown';
        colorStats[cat].confusedWith[actual] = (colorStats[cat].confusedWith[actual] || 0) + 1;
      }
    }

    // Confusion pairs (sorted by count)
    const confusionPairs: { from: string; to: string; count: number }[] = [];
    for (const [assigned, stats] of Object.entries(colorStats)) {
      for (const [actual, count] of Object.entries(stats.confusedWith)) {
        confusionPairs.push({ from: assigned, to: actual, count });
      }
    }
    confusionPairs.sort((a, b) => b.count - a.count);

    // Confusion matrix data
    const matrixColors = COLOR_CATEGORIES.filter(c =>
      images.some(i => i.assignedColor === c || (i.verdict === 'incorrect' && i.correctColor === c))
    );

    return { reviewed: reviewed.length, correct: correct.length, incorrect: incorrect.length, accuracy, colorStats, confusionPairs, matrixColors };
  }, [images]);

  // ── Tuning recommendations ──
  const recommendations = useMemo(() => {
    const recs: string[] = [];
    const { confusionPairs, colorStats, accuracy, reviewed } = metrics;

    if (reviewed < 5) return ['Review at least 5 images to get recommendations.'];

    if (accuracy >= 95) {
      recs.push(`Accuracy is ${accuracy.toFixed(1)}% — above the 95% target. Rules are performing well.`);
    } else {
      recs.push(`Accuracy is ${accuracy.toFixed(1)}% — below the 95% target. Focus on the top confusion pairs below.`);
    }

    // Top confusion pair recommendations
    for (const pair of confusionPairs.slice(0, 5)) {
      if (pair.count >= 1) {
        const pct = ((pair.count / (colorStats[pair.from]?.total || 1)) * 100).toFixed(0);
        recs.push(
          `"${pair.from}" misclassified as "${pair.to}" — ${pair.count} times (${pct}% of ${pair.from} images). ` +
          `Consider tightening deltaE thresholds for ${pair.from}↔${pair.to} boundary.`
        );
      }
    }

    // Achromatic confusion (common issue)
    const achromaticPairs = confusionPairs.filter(p =>
      ['black', 'silver-grey', 'white'].includes(p.from) && ['black', 'silver-grey', 'white'].includes(p.to)
    );
    if (achromaticPairs.length > 0) {
      const total = achromaticPairs.reduce((s, p) => s + p.count, 0);
      recs.push(
        `Achromatic confusion (black/grey/white): ${total} misclassifications. ` +
        `Consider adjusting chroma thresholds or adding luminance-based sub-classification.`
      );
    }

    // Dark chromatic → black confusion
    const darkToBlack = confusionPairs.filter(p => p.to === 'black' && !['silver-grey', 'white'].includes(p.from));
    if (darkToBlack.length > 0) {
      const total = darkToBlack.reduce((s, p) => s + p.count, 0);
      recs.push(
        `Dark chromatic→black confusion: ${total} images. Colors like dark blue/brown/green being called black. ` +
        `Lower the chroma_boost_min threshold (currently ${rules.chroma_boost_min}) to better detect faint chromaticity.`
      );
    }

    // Per-color accuracy
    for (const [cat, stats] of Object.entries(colorStats)) {
      if (stats.total >= 3 && stats.incorrect / stats.total > 0.3) {
        recs.push(
          `"${cat}" has ${((stats.correct / stats.total) * 100).toFixed(0)}% accuracy (${stats.correct}/${stats.total}). ` +
          `Needs attention — review reference colors for this cluster.`
        );
      }
    }

    return recs;
  }, [metrics, rules]);

  // ── Filtered images ──
  const filteredImages = useMemo(() => {
    return images.filter(img => {
      if (filterColor !== 'all' && img.assignedColor !== filterColor) return false;
      if (filterVerdict === 'unreviewed' && img.verdict) return false;
      if (filterVerdict === 'correct' && img.verdict !== 'correct') return false;
      if (filterVerdict === 'incorrect' && img.verdict !== 'incorrect') return false;
      return true;
    });
  }, [images, filterColor, filterVerdict]);

  // ── Color distribution ──
  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const img of images) {
      counts[img.assignedColor] = (counts[img.assignedColor] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [images]);

  // ── Save session ──
  const saveSession = useCallback(() => {
    const session: ReviewSession = {
      id: `session_${Date.now()}`,
      date: new Date().toISOString(),
      zipName,
      totalImages: images.length,
      reviewed: metrics.reviewed,
      accuracy: metrics.accuracy,
      confusionPairs: metrics.confusionPairs,
    };

    // Save ground truth for all incorrect verdicts
    const gt = loadGroundTruth();
    const date = new Date().toISOString();
    for (const img of images) {
      if (img.verdict === 'incorrect' && img.correctColor) {
        gt.push({ assigned: img.assignedColor, correct: img.correctColor, filename: img.filename, date });
      }
      if (img.verdict === 'correct') {
        gt.push({ assigned: img.assignedColor, correct: img.assignedColor, filename: img.filename, date });
      }
    }
    saveGroundTruth(gt);

    const updated = [session, ...sessions];
    setSessions(updated);
    saveSessions(updated);
  }, [zipName, images, metrics, sessions]);

  // ── Finalize & go to results ──
  const finalize = useCallback(() => {
    saveSession();
    setPhase('results');
  }, [saveSession]);

  // ── Reset ──
  const reset = useCallback(() => {
    // Revoke blob URLs
    for (const img of images) URL.revokeObjectURL(img.blobUrl);
    setImages([]);
    setPhase('upload');
    setFilterColor('all');
    setFilterVerdict('all');
    setLightboxImg(null);
  }, [images]);

  // ── Cumulative ground truth stats ──
  const cumulativeStats = useMemo(() => {
    const gt = loadGroundTruth();
    const total = gt.length;
    const correct = gt.filter(g => g.assigned === g.correct).length;
    const accuracy = total > 0 ? (correct / total) * 100 : 0;

    const confusionMap: Record<string, Record<string, number>> = {};
    for (const g of gt) {
      if (g.assigned !== g.correct) {
        if (!confusionMap[g.assigned]) confusionMap[g.assigned] = {};
        confusionMap[g.assigned][g.correct] = (confusionMap[g.assigned][g.correct] || 0) + 1;
      }
    }

    return { total, correct, accuracy, confusionMap };
  }, [phase]); // recalc when phase changes (after save)

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  // ── UPLOAD PHASE ──
  if (phase === 'upload') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold">
              Accuracy <span className="text-racing-500">Lab</span>
            </h1>
            <p className="text-xs text-white/30 mt-1">
              Define → Check → Refine → Redefine — continuous accuracy improvement loop
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
              {([
                ['deltaE_high', 'High Confidence (deltaE <)', 'Images below this deltaE are classified with high confidence'],
                ['deltaE_medium', 'Medium Confidence (deltaE <)', 'Images below this deltaE are classified with medium confidence'],
                ['deltaE_low', 'Low Confidence (deltaE <)', 'Images below this deltaE get low confidence; above = very-low'],
                ['chroma_boost_min', 'Chroma Boost Min', 'Minimum chroma to boost low→medium when dE < 25'],
                ['coverage_boost', 'Coverage Boost (%)', 'Pixel coverage above this boosts medium→high'],
                ['agreement_boost', 'Agreement Boost (regions)', 'Number of agreeing regions to boost confidence'],
              ] as [keyof ClassificationRules, string, string][]).map(([key, label, hint]) => (
                <div key={key}>
                  <label className="text-[10px] text-white/30 uppercase block mb-1" title={hint}>{label}</label>
                  <input
                    type="number"
                    step={key === 'coverage_boost' ? 0.01 : 1}
                    value={rules[key]}
                    onChange={e => setRules(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
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

  // ── REVIEW PHASE ──
  if (phase === 'review') {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold">
              Review <span className="text-racing-500">Results</span>
            </h1>
            <p className="text-xs text-white/30 mt-0.5">{zipName} — {images.length} images</p>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="btn-ghost px-3 py-1.5 text-xs">
              Start Over
            </button>
            <button
              onClick={finalize}
              disabled={metrics.reviewed === 0}
              className="btn-racing px-4 py-1.5 text-xs"
            >
              Finalize ({metrics.reviewed}/{images.length} reviewed)
            </button>
          </div>
        </div>

        {/* Live Stats Bar */}
        <div className="grid grid-cols-4 gap-3">
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-white/30 uppercase">Reviewed</p>
            <p className="text-lg font-heading font-bold text-white/80">{metrics.reviewed}<span className="text-xs text-white/20">/{images.length}</span></p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-white/30 uppercase">Correct</p>
            <p className="text-lg font-heading font-bold text-green-400">{metrics.correct}</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-white/30 uppercase">Incorrect</p>
            <p className="text-lg font-heading font-bold text-red-400">{metrics.incorrect}</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-white/30 uppercase">Accuracy</p>
            <p className={`text-lg font-heading font-bold ${metrics.accuracy >= 95 ? 'text-green-400' : metrics.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
              {metrics.reviewed > 0 ? `${metrics.accuracy.toFixed(1)}%` : '—'}
            </p>
          </div>
        </div>

        {/* Filters & Bulk Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Color filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/30 uppercase">Color:</span>
            <button
              onClick={() => setFilterColor('all')}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                filterColor === 'all' ? 'bg-white/10 text-white border-white/20' : 'text-white/30 border-transparent hover:text-white/50'
              }`}
            >
              All ({images.length})
            </button>
            {colorCounts.map(([color, count]) => (
              <button
                key={color}
                onClick={() => setFilterColor(color)}
                className={`px-2 py-0.5 rounded text-[10px] border transition-all flex items-center gap-1 ${
                  filterColor === color ? `${COLOR_BADGES[color] || 'bg-white/10 text-white border-white/20'}` : 'text-white/30 border-transparent hover:text-white/50'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: COLOR_SWATCHES[color] || '#666' }} />
                {color} ({count})
              </button>
            ))}
          </div>

          {/* Verdict filter */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] text-white/30 uppercase">Show:</span>
            {(['all', 'unreviewed', 'correct', 'incorrect'] as const).map(v => (
              <button
                key={v}
                onClick={() => setFilterVerdict(v)}
                className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                  filterVerdict === v ? 'bg-white/10 text-white border-white/20' : 'text-white/30 border-transparent hover:text-white/50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Bulk actions */}
          <div className="flex gap-2">
            {filterColor !== 'all' ? (
              <button onClick={markFilteredCorrect} className="btn-ghost px-2 py-0.5 text-[10px]">
                Mark all "{filterColor}" correct
              </button>
            ) : (
              <button onClick={markAllCorrect} className="btn-ghost px-2 py-0.5 text-[10px]">
                Mark all remaining correct
              </button>
            )}
          </div>
        </div>

        {/* Image Review Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filteredImages.map(img => (
            <div
              key={img.id}
              className={`glass-card overflow-hidden group transition-all duration-200 ${
                img.verdict === 'correct' ? 'ring-1 ring-green-500/30' :
                img.verdict === 'incorrect' ? 'ring-1 ring-red-500/30' : ''
              }`}
            >
              {/* Image thumbnail */}
              <div
                className="relative aspect-[4/3] bg-black/20 cursor-pointer overflow-hidden"
                onClick={() => setLightboxImg(img)}
              >
                <img
                  src={img.blobUrl}
                  alt={img.filename}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                {/* Verdict overlay */}
                {img.verdict && (
                  <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    img.verdict === 'correct' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                  }`}>
                    {img.verdict === 'correct' ? '✓' : '✗'}
                  </div>
                )}
              </div>

              {/* Info & Controls */}
              <div className="p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLOR_SWATCHES[img.assignedColor] || '#666' }} />
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${COLOR_BADGES[img.assignedColor] || 'bg-white/10 text-white/50 border-white/10'}`}>
                    {img.assignedColor}
                  </span>
                </div>
                <p className="text-[9px] text-white/20 truncate" title={img.filename}>{img.filename}</p>

                {/* Verdict buttons */}
                <div className="flex gap-1">
                  <button
                    onClick={() => setVerdict(img.id, 'correct')}
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-all ${
                      img.verdict === 'correct'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-white/[0.03] text-white/30 hover:bg-green-500/10 hover:text-green-400 border border-transparent'
                    }`}
                  >
                    Correct
                  </button>
                  <button
                    onClick={() => setVerdict(img.id, 'incorrect', img.correctColor)}
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-all ${
                      img.verdict === 'incorrect'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-white/[0.03] text-white/30 hover:bg-red-500/10 hover:text-red-400 border border-transparent'
                    }`}
                  >
                    Wrong
                  </button>
                </div>

                {/* Correct color picker (shown when marked incorrect) */}
                {img.verdict === 'incorrect' && (
                  <div className="pt-1">
                    <p className="text-[9px] text-white/20 mb-1">What color should it be?</p>
                    <div className="flex flex-wrap gap-1">
                      {COLOR_CATEGORIES.filter(c => c !== img.assignedColor).map(c => (
                        <button
                          key={c}
                          onClick={() => setCorrectColor(img.id, c)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${
                            img.correctColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'
                          }`}
                          style={{ background: COLOR_SWATCHES[c] }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredImages.length === 0 && (
          <div className="glass-card p-8 text-center">
            <p className="text-white/30 text-sm">No images match the current filters.</p>
          </div>
        )}

        {/* Lightbox */}
        {lightboxImg && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightboxImg(null)}
          >
            <div className="max-w-4xl max-h-[85vh] relative" onClick={e => e.stopPropagation()}>
              <img src={lightboxImg.blobUrl} alt={lightboxImg.filename} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-bold uppercase border ${COLOR_BADGES[lightboxImg.assignedColor] || ''}`}>
                  {lightboxImg.assignedColor}
                </span>
                <span className="text-xs text-white/50 bg-black/50 px-2 py-1 rounded">{lightboxImg.filename}</span>
              </div>
              <button
                onClick={() => setLightboxImg(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white/60 hover:text-white flex items-center justify-center"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── RESULTS PHASE ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">
            Analysis <span className="text-racing-500">Results</span>
          </h1>
          <p className="text-xs text-white/30 mt-0.5">{zipName} — {metrics.reviewed} of {images.length} reviewed</p>
        </div>
        <button onClick={reset} className="btn-racing px-4 py-1.5 text-xs">
          Upload New Results
        </button>
      </div>

      {/* Big accuracy number */}
      <div className="glass-card p-8 text-center">
        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Session Accuracy</p>
        <p className={`text-6xl font-heading font-black ${
          metrics.accuracy >= 95 ? 'text-green-400' : metrics.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          {metrics.accuracy.toFixed(1)}%
        </p>
        <p className="text-xs text-white/30 mt-2">{metrics.correct} correct / {metrics.reviewed} reviewed ({metrics.incorrect} errors)</p>
        <div className="w-64 h-2 mx-auto mt-4 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${
              metrics.accuracy >= 95 ? 'bg-green-500' : metrics.accuracy >= 80 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${metrics.accuracy}%` }}
          />
        </div>
        {metrics.accuracy >= 95 && (
          <p className="text-xs text-green-400/60 mt-3">Target achieved — above 95% accuracy threshold</p>
        )}
        {metrics.accuracy < 95 && metrics.accuracy > 0 && (
          <p className="text-xs text-yellow-400/60 mt-3">
            {(95 - metrics.accuracy).toFixed(1)}% below target — review recommendations below
          </p>
        )}
      </div>

      {/* Per-color accuracy bars */}
      <div className="glass-card p-5 space-y-4">
        <h2 className="text-sm font-heading font-bold text-white/80">Per-Color Accuracy</h2>
        <div className="space-y-2">
          {Object.entries(metrics.colorStats)
            .filter(([, s]) => s.total > 0)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([color, stats]) => {
              const acc = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
              return (
                <div key={color} className="flex items-center gap-3">
                  <div className="flex items-center gap-2 w-28 flex-shrink-0">
                    <span className="w-3 h-3 rounded-full" style={{ background: COLOR_SWATCHES[color] }} />
                    <span className="text-xs text-white/60 capitalize">{color}</span>
                  </div>
                  <div className="flex-1 h-5 rounded bg-white/5 overflow-hidden relative">
                    <div
                      className={`h-full rounded transition-all duration-700 ${
                        acc >= 95 ? 'bg-green-500/40' : acc >= 80 ? 'bg-yellow-500/40' : 'bg-red-500/40'
                      }`}
                      style={{ width: `${acc}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold text-white/60">
                      {stats.correct}/{stats.total} ({acc.toFixed(0)}%)
                    </span>
                  </div>
                  {stats.incorrect > 0 && (
                    <span className="text-[10px] text-red-400/60 w-24 text-right">
                      {Object.entries(stats.confusedWith).map(([to, n]) => `→${to}(${n})`).join(' ')}
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Confusion Matrix */}
      {metrics.confusionPairs.length > 0 && (
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-heading font-bold text-white/80">Confusion Matrix</h2>
          <div className="overflow-x-auto">
            <table className="text-[10px]">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-white/30 text-left">Assigned ↓ / Actual →</th>
                  {metrics.matrixColors.map(c => (
                    <th key={c} className="px-2 py-1 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="w-3 h-3 rounded-full" style={{ background: COLOR_SWATCHES[c] }} />
                        <span className="text-white/40 capitalize">{c}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.matrixColors.map(assigned => {
                  const stats = metrics.colorStats[assigned];
                  if (!stats || stats.total === 0) return null;
                  return (
                    <tr key={assigned}>
                      <td className="px-2 py-1.5 text-white/60 capitalize flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full" style={{ background: COLOR_SWATCHES[assigned] }} />
                        {assigned}
                      </td>
                      {metrics.matrixColors.map(actual => {
                        const isCorrect = assigned === actual;
                        const count = isCorrect ? stats.correct : (stats.confusedWith[actual] || 0);
                        const cellPct = stats.total > 0 ? count / stats.total : 0;
                        return (
                          <td key={actual} className="px-2 py-1.5 text-center">
                            {count > 0 ? (
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded font-mono font-bold ${
                                  isCorrect
                                    ? 'bg-green-500/20 text-green-400'
                                    : cellPct > 0.2 ? 'bg-red-500/30 text-red-400'
                                    : 'bg-red-500/10 text-red-400/60'
                                }`}
                              >
                                {count}
                              </span>
                            ) : (
                              <span className="text-white/[0.06]">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tuning Recommendations */}
      <div className="glass-card p-5 space-y-3">
        <h2 className="text-sm font-heading font-bold text-white/80">Tuning Recommendations</h2>
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div key={i} className="flex gap-2 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <span className={`text-xs mt-0.5 ${i === 0 ? (metrics.accuracy >= 95 ? 'text-green-400' : 'text-yellow-400') : 'text-racing-400'}`}>
                {i === 0 ? (metrics.accuracy >= 95 ? '●' : '▲') : '→'}
              </span>
              <p className="text-xs text-white/60 leading-relaxed">{rec}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Cumulative Ground Truth */}
      {cumulativeStats.total > metrics.reviewed && (
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-heading font-bold text-white/80">Cumulative Ground Truth</h2>
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[10px] text-white/30 uppercase">Total Images</p>
              <p className="text-lg font-heading font-bold text-white/80">{cumulativeStats.total}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase">All-Time Accuracy</p>
              <p className={`text-lg font-heading font-bold ${cumulativeStats.accuracy >= 95 ? 'text-green-400' : 'text-yellow-400'}`}>
                {cumulativeStats.accuracy.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase">Sessions</p>
              <p className="text-lg font-heading font-bold text-white/80">{sessions.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Current Rules Reference */}
      <div className="glass-card p-5 space-y-3">
        <h2 className="text-sm font-heading font-bold text-white/80">Current Classification Rules</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] text-white/30">deltaE High</p>
            <p className="text-sm font-mono text-white/60">&lt; {rules.deltaE_high}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">deltaE Medium</p>
            <p className="text-sm font-mono text-white/60">&lt; {rules.deltaE_medium}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">deltaE Low</p>
            <p className="text-sm font-mono text-white/60">&lt; {rules.deltaE_low}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">Chroma Boost</p>
            <p className="text-sm font-mono text-white/60">&gt; {rules.chroma_boost_min}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">Coverage Boost</p>
            <p className="text-sm font-mono text-white/60">&gt; {(rules.coverage_boost * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">Agreement Boost</p>
            <p className="text-sm font-mono text-white/60">&ge; {rules.agreement_boost} regions</p>
          </div>
        </div>
        {metrics.accuracy < 95 && (
          <p className="text-[10px] text-racing-400/60">
            Tip: Go back to Upload, click "Show Rules" to adjust thresholds based on the recommendations above, then re-test.
          </p>
        )}
      </div>
    </div>
  );
}
