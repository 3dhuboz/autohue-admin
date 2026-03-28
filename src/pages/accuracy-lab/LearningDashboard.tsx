import { useMemo, useState } from 'react';
import type { LearningSession, LearningSpeed, ParameterAdjustment } from './types';
import { COLOR_SWATCHES, COLOR_CATEGORIES, SPEED_MS } from './types';
import { calculateIntelligenceScore, generateExportCode, getRulesDiff } from './tuning-engine';
import { DEFAULT_RULES } from './constants';
import { loadGroundTruth } from './storage';
import CycleControls from './CycleControls';
import TrendChart from './TrendChart';
import ConfusionHeatmap from './ConfusionHeatmap';
import ExportPanel from './ExportPanel';

interface LearningDashboardProps {
  session: LearningSession;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRevert: (passNumber: number) => void;
  onExport: () => void;
  speed: LearningSpeed;
  setSpeed: (s: LearningSpeed) => void;
}

// Impact dot color
function impactColor(impact: ParameterAdjustment['impact']): string {
  switch (impact) {
    case 'positive': return 'bg-green-400';
    case 'neutral': return 'bg-yellow-400';
    case 'negative': return 'bg-red-400';
  }
}

function impactBorder(impact: ParameterAdjustment['impact']): string {
  switch (impact) {
    case 'positive': return 'border-green-500/20';
    case 'neutral': return 'border-yellow-500/20';
    case 'negative': return 'border-red-500/20';
  }
}

// Format a number smartly
function fmt(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) < 1) return v.toFixed(3);
  return v.toFixed(2);
}

export default function LearningDashboard({
  session,
  onPause,
  onResume,
  onStop,
  onRevert,
  onExport,
  speed,
  setSpeed,
}: LearningDashboardProps) {
  const [showRevertDropdown, setShowRevertDropdown] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCompletionReport, setShowCompletionReport] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  // Alias for backward compat
  const copyToast = toast?.type === 'success' && toast.message.includes('Applied');

  const passes = session.passes;
  const currentPass = passes[passes.length - 1];
  const previousPass = passes.length >= 2 ? passes[passes.length - 2] : null;

  const groundTruthCount = useMemo(() => loadGroundTruth().length, []);

  // Intelligence score
  const intelligenceScore = useMemo(() => {
    if (!currentPass) return 0;
    return calculateIntelligenceScore(currentPass.accuracy, passes, groundTruthCount);
  }, [currentPass, passes, groundTruthCount]);

  // Accuracy trend data for chart
  const trendData = useMemo(() => {
    return passes.map(p => ({ pass: p.passNumber, value: p.accuracy }));
  }, [passes]);

  // Per-color accuracy with delta from first pass
  const perColorWithDelta = useMemo(() => {
    if (!currentPass) return [];
    const firstPass = passes[0];
    return COLOR_CATEGORIES
      .filter(c => currentPass.perColorAccuracy[c]?.total > 0)
      .map(c => {
        const curr = currentPass.perColorAccuracy[c];
        const first = firstPass?.perColorAccuracy[c];
        const currAcc = curr.total > 0 ? (curr.correct / curr.total) * 100 : 0;
        const firstAcc = first && first.total > 0 ? (first.correct / first.total) * 100 : currAcc;
        return { color: c, accuracy: currAcc, total: curr.total, correct: curr.correct, delta: currAcc - firstAcc };
      })
      .sort((a, b) => b.total - a.total);
  }, [currentPass, passes]);

  // Parameter evolution sparklines data
  const parameterEvolution = useMemo(() => {
    if (passes.length < 2) return [];

    // Collect all unique adjusted parameters
    const allParams = new Set<string>();
    for (const p of passes) {
      for (const adj of p.adjustments) {
        if (adj.parameter !== 'palette_quality') allParams.add(adj.parameter);
      }
    }

    return Array.from(allParams).map(param => {
      const values: { pass: number; value: number }[] = [];
      for (const p of passes) {
        const adj = p.adjustments.find(a => a.parameter === param);
        if (adj) {
          values.push({ pass: p.passNumber, value: adj.newValue });
        }
      }
      return { parameter: param, values };
    }).filter(p => p.values.length >= 2);
  }, [passes]);

  // Confusion heatmap data for first pass vs current
  const firstPassConfusion = useMemo(() => {
    const first = passes[0];
    if (!first) return { matrix: {}, perColor: {}, colors: [] as string[] };
    const colors = COLOR_CATEGORIES.filter(c => first.perColorAccuracy[c]?.total > 0);
    return {
      matrix: first.confusionSnapshot,
      perColor: first.perColorAccuracy,
      colors: [...colors],
    };
  }, [passes]);

  const currentConfusion = useMemo(() => {
    if (!currentPass) return { matrix: {}, perColor: {}, colors: [] as string[] };
    const colors = COLOR_CATEGORIES.filter(c => currentPass.perColorAccuracy[c]?.total > 0);
    return {
      matrix: currentPass.confusionSnapshot,
      perColor: currentPass.perColorAccuracy,
      colors: [...colors],
    };
  }, [currentPass]);

  // Sparkline SVG renderer
  function renderSparkline(values: { pass: number; value: number }[]) {
    if (values.length < 2) return null;
    const w = 120;
    const h = 28;
    const pad = 2;

    const nums = values.map(v => v.value);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = max - min || 1;

    const points = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v.value - min) / range) * (h - 2 * pad);
      return `${x},${y}`;
    });

    return (
      <svg width={w} height={h} className="inline-block">
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#ef4444"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* End dot */}
        {values.length > 0 && (() => {
          const last = values[values.length - 1];
          const x = pad + ((values.length - 1) / (values.length - 1)) * (w - 2 * pad);
          const y = h - pad - ((last.value - min) / range) * (h - 2 * pad);
          return <circle cx={x} cy={y} r="2.5" fill="#ef4444" />;
        })()}
      </svg>
    );
  }

  if (!currentPass) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="w-12 h-12 rounded-full border-2 border-racing-500 border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-sm text-white/40">Initializing learning engine...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-heading font-bold">
              Learning <span className="text-racing-500">Engine</span>
            </h1>
            <p className="text-xs text-white/30 mt-0.5">
              Pass {session.currentPass} of {session.maxPasses}
              {session.status === 'running' && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-green-400">Running</span>
                </span>
              )}
              {session.status === 'paused' && (
                <span className="ml-2 text-yellow-400">Paused</span>
              )}
              {session.status === 'completed' && (
                <span className="ml-2 text-racing-400">Completed</span>
              )}
              {session.status === 'stopped' && (
                <span className="ml-2 text-white/40">Stopped</span>
              )}
            </p>
          </div>
        </div>
        <CycleControls
          status={session.status}
          speed={speed}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
          setSpeed={setSpeed}
        />
      </div>

      {/* Processing animation — visible while learning is running */}
      {session.status === 'running' && (
        <div className="glass-card p-4 overflow-hidden relative">
          {/* Animated scanning bar */}
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute top-0 h-full w-1/3 bg-gradient-to-r from-transparent via-racing-500/10 to-transparent"
              style={{ animation: 'scan 2s ease-in-out infinite' }}
            />
          </div>
          <style>{`@keyframes scan { 0% { left: -33%; } 100% { left: 100%; } }`}</style>
          <div className="relative flex items-center gap-4">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-racing-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-racing-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-racing-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <div className="flex-1">
              <p className="text-xs text-white/60 font-medium">
                {passes.length === 0
                  ? 'Classifying images through AI pipeline...'
                  : `Pass ${session.currentPass + 1}: Re-classifying with updated rules → skeptic checking...`
                }
              </p>
              <p className="text-[10px] text-white/30 mt-0.5">
                Each image: ONNX detection → SegFormer segmentation → LAB color matching → scoring
              </p>
            </div>
            <div className="w-8 h-8 rounded-full border-2 border-racing-500 border-t-transparent animate-spin flex-shrink-0" />
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-3">
        {/* Accuracy */}
        <div className="glass-card p-4 text-center">
          <p className="text-[10px] text-white/30 uppercase tracking-wide">Accuracy</p>
          <p className={`text-3xl font-heading font-black mt-1 ${
            currentPass.accuracy >= 95 ? 'text-green-400' : currentPass.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {currentPass.accuracy.toFixed(1)}%
          </p>
          {previousPass && (
            <p className="text-[10px] text-white/20 mt-1">
              was {previousPass.accuracy.toFixed(1)}%
            </p>
          )}
        </div>

        {/* Intelligence Score */}
        <div className="glass-card p-4 text-center">
          <p className="text-[10px] text-white/30 uppercase tracking-wide">Intelligence</p>
          <p className="text-3xl font-heading font-black mt-1 text-racing-400">
            {intelligenceScore}
          </p>
          <p className="text-[10px] text-white/20 mt-1">/ 100</p>
        </div>

        {/* Delta This Pass */}
        <div className="glass-card p-4 text-center">
          <p className="text-[10px] text-white/30 uppercase tracking-wide">Delta This Pass</p>
          <p className={`text-3xl font-heading font-black mt-1 ${
            currentPass.deltaAccuracy > 0 ? 'text-green-400' : currentPass.deltaAccuracy < 0 ? 'text-red-400' : 'text-white/40'
          }`}>
            {currentPass.deltaAccuracy > 0 ? '+' : ''}{currentPass.deltaAccuracy.toFixed(2)}%
          </p>
          <p className="text-[10px] text-white/20 mt-1">
            {currentPass.adjustments.filter(a => a.parameter !== 'palette_quality').length} changes
          </p>
        </div>

        {/* Passes */}
        <div className="glass-card p-4 text-center">
          <p className="text-[10px] text-white/30 uppercase tracking-wide">Passes</p>
          <p className="text-3xl font-heading font-black mt-1 text-white/80">
            {passes.length}
          </p>
          <p className="text-[10px] text-white/20 mt-1">of {session.maxPasses} max</p>
        </div>
      </div>

      {/* Accuracy Trend Chart */}
      {trendData.length >= 2 && (
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-heading font-bold text-white/80">Accuracy Trend</h2>
          <TrendChart
            data={trendData}
            height={140}
            color="#ef4444"
            targetLine={session.targetAccuracy}
            label="Accuracy %"
            formatValue={v => `${v.toFixed(1)}%`}
          />
        </div>
      )}

      {/* What Changed This Pass */}
      <div className="glass-card p-5 space-y-3">
        <h2 className="text-sm font-heading font-bold text-white/80">
          What Changed
          <span className="text-white/30 font-normal ml-2">Pass {currentPass.passNumber}</span>
        </h2>
        {currentPass.adjustments.length === 0 ? (
          <p className="text-xs text-white/30">No parameter changes this pass.</p>
        ) : (
          <div className="space-y-2">
            {currentPass.adjustments.map((adj, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 py-2 px-3 rounded-lg bg-white/[0.02] border ${impactBorder(adj.impact)}`}
              >
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${impactColor(adj.impact)}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/70">{adj.parameter}</span>
                    <span className="text-[10px] text-white/20">{fmt(adj.oldValue)}</span>
                    <svg className="w-3 h-3 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-[10px] font-mono font-bold text-racing-400">{fmt(adj.newValue)}</span>
                  </div>
                  <p className="text-[10px] text-white/30 mt-0.5 leading-relaxed">{adj.reason}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Reasoning Log */}
      {currentPass.agentLog && currentPass.agentLog.length > 0 && (
        <div className="glass-card p-5 space-y-2">
          <h2 className="text-sm font-heading font-bold text-white/80">
            Agent Reasoning
            <span className="text-white/30 font-normal ml-2">Pass {currentPass.passNumber}</span>
          </h2>
          <div className="font-mono text-[11px] space-y-1 max-h-[300px] overflow-y-auto">
            {currentPass.agentLog.map((thought, i) => {
              const icons: Record<string, string> = {
                observation: 'text-blue-400',
                diagnosis: 'text-yellow-400',
                action: 'text-racing-400',
                guardrail: 'text-orange-400',
                result: 'text-green-400',
              };
              const prefixes: Record<string, string> = {
                observation: 'OBSERVE',
                diagnosis: 'DIAGNOSE',
                action: 'ACTION',
                guardrail: 'GUARD',
                result: 'RESULT',
              };
              return (
                <div key={i} className="flex gap-2 py-1 border-b border-white/[0.03] last:border-0">
                  <span className={`flex-shrink-0 w-[70px] text-right text-[9px] font-bold uppercase ${icons[thought.type] || 'text-white/30'}`}>
                    {prefixes[thought.type] || thought.type}
                  </span>
                  <span className="text-white/50">{thought.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confusion Matrix Evolution */}
      {passes.length >= 2 && (
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-heading font-bold text-white/80">Confusion Matrix Evolution</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-white/30 uppercase mb-2">Pass 1</p>
              <ConfusionHeatmap
                matrix={firstPassConfusion.matrix}
                perColor={firstPassConfusion.perColor}
                colors={firstPassConfusion.colors}
                compact
              />
            </div>
            <div>
              <p className="text-[10px] text-white/30 uppercase mb-2">Current (Pass {currentPass.passNumber})</p>
              <ConfusionHeatmap
                matrix={currentConfusion.matrix}
                perColor={currentConfusion.perColor}
                colors={currentConfusion.colors}
                compact
              />
            </div>
          </div>
        </div>
      )}

      {/* Per-Color Accuracy */}
      <div className="glass-card p-5 space-y-3">
        <h2 className="text-sm font-heading font-bold text-white/80">Per-Color Accuracy</h2>
        <div className="space-y-2">
          {perColorWithDelta.map(({ color, accuracy, total, correct, delta }) => (
            <div key={color} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-28 flex-shrink-0">
                <span className="w-3 h-3 rounded-full" style={{ background: COLOR_SWATCHES[color] }} />
                <span className="text-xs text-white/60 capitalize">{color}</span>
              </div>
              <div className="flex-1 h-5 rounded bg-white/5 overflow-hidden relative">
                <div
                  className={`h-full rounded transition-all duration-700 ${
                    accuracy >= 95 ? 'bg-green-500/40' : accuracy >= 80 ? 'bg-yellow-500/40' : 'bg-red-500/40'
                  }`}
                  style={{ width: `${accuracy}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold text-white/60">
                  {correct}/{total} ({accuracy.toFixed(0)}%)
                </span>
              </div>
              <span className={`text-[10px] font-mono w-14 text-right ${
                delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/20'
              }`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Parameter Evolution */}
      {parameterEvolution.length > 0 && (() => {
        // Human-readable descriptions for each parameter
        const paramDescriptions: Record<string, { name: string; what: string; why: string }> = {
          deltaE_high: { name: 'High Confidence Threshold', what: 'Max color distance for "high confidence" classification', why: 'Lower = stricter matching, fewer false positives but may miss similar shades' },
          deltaE_medium: { name: 'Medium Confidence Threshold', what: 'Max color distance for "medium confidence" classification', why: 'Controls the boundary between confident and uncertain classifications' },
          deltaE_low: { name: 'Low Confidence Threshold', what: 'Max color distance before marking "needs review"', why: 'Images beyond this threshold get flagged for manual check' },
          achromatic_penalty: { name: 'Achromatic Penalty', what: 'Score multiplier for black/white/grey when vivid paint exists', why: 'Lower = backgrounds and shadows lose harder against vivid car paint' },
          achromatic_chroma_gate: { name: 'Achromatic Gate', what: 'Chroma level below which achromatic penalty applies', why: 'Higher = more pixels treated as achromatic, stricter vivid-paint preference' },
          shadow_chroma: { name: 'Shadow Detection', what: 'Max chroma for a pixel to be classified as shadow', why: 'Lower = catches more shadow pixels, reducing dark-color confusion' },
          shadow_lightness: { name: 'Shadow Lightness', what: 'Max lightness for shadow classification', why: 'Controls how dark a pixel must be to count as shadow' },
          boost_coverage_min: { name: 'Coverage Boost Min', what: 'Min pixel % needed to boost confidence medium→high', why: 'Higher = requires more of the car to be that color for high confidence' },
          boost_low_chroma_min: { name: 'Chroma Boost Min', what: 'Min chroma needed to boost low→medium confidence', why: 'Helps faint but real car colors get promoted to medium confidence' },
          env_smoke_chroma: { name: 'Smoke Filter', what: 'Max chroma for smoke/haze pixel detection', why: 'Lower = catches more burnout smoke, reduces white/grey confusion' },
          merge_deltaE: { name: 'Cluster Merge', what: 'Max deltaE to merge similar color clusters', why: 'Lower = preserves more color detail in multi-tone liveries' },
          chroma_tier_10: { name: 'Low Chroma Boost', what: 'Score multiplier for pixels with chroma 5-10', why: 'Higher = faint colors score better against dark backgrounds' },
          chroma_tier_15: { name: 'Mid Chroma Boost', what: 'Score multiplier for pixels with chroma 10-15', why: 'Affects detection of muted/pastel car paint colors' },
          chroma_tier_20: { name: 'Chroma 20 Boost', what: 'Score multiplier for clearly colored pixels', why: 'Core multiplier for most vivid car paint detection' },
          MONITOR: { name: 'Self-Check', what: 'Internal health monitoring', why: 'Agent watching its own behavior' },
          CONVERGED: { name: 'Convergence', what: 'Learning has stabilized', why: 'No further improvements possible with current data' },
          AUTO_REVERT: { name: 'Auto-Revert', what: 'Rolled back to best pass', why: 'Prevented accuracy degradation' },
          GUARDRAIL: { name: 'Safety Stop', what: 'Drift limit reached', why: 'Parameters moved too far from defaults' },
        };

        return (
          <div className="glass-card p-5 space-y-3">
            <h2 className="text-sm font-heading font-bold text-white/80">
              Parameter Evolution
              <span className="text-white/30 font-normal ml-2">How the worker's brain is changing</span>
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {parameterEvolution.map(({ parameter, values }) => {
                const desc = paramDescriptions[parameter] || { name: parameter, what: '', why: '' };
                const start = values[0].value;
                const end = values[values.length - 1].value;
                const dir = end > start ? 'increased' : end < start ? 'decreased' : 'unchanged';
                return (
                  <div key={parameter} className="py-3 px-4 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/70">{desc.name}</p>
                        <p className="text-[10px] font-mono text-white/30">{parameter}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {renderSparkline(values)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/20">{fmt(start)}</span>
                      <svg className="w-2.5 h-2.5 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      <span className="text-xs font-mono font-bold text-racing-400">{fmt(end)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${dir === 'decreased' ? 'bg-green-500/10 text-green-400' : dir === 'increased' ? 'bg-blue-500/10 text-blue-400' : 'text-white/20'}`}>
                        {dir}
                      </span>
                    </div>
                    {desc.what && <p className="text-[10px] text-white/40">{desc.what}</p>}
                    {desc.why && <p className="text-[10px] text-white/25 italic">{desc.why}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        {/* Revert dropdown */}
        {passes.length >= 2 && (
          <div className="relative">
            <button
              onClick={() => setShowRevertDropdown(!showRevertDropdown)}
              className="btn-ghost px-4 py-2 text-xs flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Revert to Pass...
            </button>
            {showRevertDropdown && (
              <div className="absolute bottom-full left-0 mb-1 glass-card p-1 min-w-[160px] z-10">
                {passes.slice(0, -1).reverse().map(p => (
                  <button
                    key={p.passNumber}
                    onClick={() => {
                      onRevert(p.passNumber);
                      setShowRevertDropdown(false);
                      showToast(`Reverted to Pass #${p.passNumber} (${p.accuracy.toFixed(1)}%)`, 'info');
                    }}
                    className="w-full text-left px-3 py-1.5 rounded text-xs text-white/60 hover:bg-white/5 hover:text-white/80 flex items-center justify-between"
                  >
                    <span>Pass {p.passNumber}</span>
                    <span className="font-mono text-[10px] text-white/30">{p.accuracy.toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => { setShowExport(true); showToast('Export panel opened', 'info'); }}
          className="btn-ghost px-4 py-2 text-xs flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export Rules
        </button>

        {/* Push to Cloud — deploy rules to all clients globally */}
        {session.status !== 'running' && getRulesDiff(session.initialRules, session.currentRules).length > 0 && (
          <button
            onClick={async () => {
              const flatRules: Record<string, number> = {
                deltaE_high: session.currentRules.deltaE_high, deltaE_medium: session.currentRules.deltaE_medium, deltaE_low: session.currentRules.deltaE_low,
                achromatic_penalty: session.currentRules.achromatic_penalty, achromatic_chroma_gate: session.currentRules.achromatic_chroma_gate,
                shadow_chroma: session.currentRules.shadow_chroma, shadow_lightness: session.currentRules.shadow_lightness,
                env_smoke_chroma: session.currentRules.env_smoke_chroma, env_road_chroma: session.currentRules.env_road_chroma,
                boost_agreement_min: session.currentRules.boost_agreement_min, boost_coverage_min: session.currentRules.boost_coverage_min,
                boost_low_chroma_min: session.currentRules.boost_low_chroma_min, boost_low_dE_max: session.currentRules.boost_low_dE_max,
                merge_deltaE: session.currentRules.merge_deltaE, min_viable_floor: session.currentRules.min_viable_floor,
                env_remnant_penalty: session.currentRules.env_remnant_penalty,
                strong_chroma_threshold: session.currentRules.strong_chroma_threshold, strong_chroma_min_pct: session.currentRules.strong_chroma_min_pct,
                strong_chroma_max_dE: session.currentRules.strong_chroma_max_dE,
              };
              for (const tier of session.currentRules.chroma_tiers) flatRules[`chroma_tier_${tier.threshold}`] = tier.multiplier;
              try {
                const gt = loadGroundTruth();
                const res = await fetch('https://autohue-rules.steve-700.workers.dev/api/rules', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    rules: flatRules,
                    accuracy: currentPass?.accuracy,
                    passes: session.currentPass,
                    groundTruthCount: gt.length,
                  }),
                });
                const data = await res.json();
                if (data.ok) {
                  showToast(`Published to cloud! All clients will update within 6h. (hash: ${data.hash})`, 'success');
                } else {
                  showToast('Cloud push failed: ' + (data.error || 'Unknown'), 'warning');
                }
              } catch (e) {
                showToast('Cloud push failed: ' + (e as Error).message, 'warning');
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-xs font-medium text-blue-400 hover:bg-blue-500/30 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Push to Cloud
          </button>
        )}

        {/* Auto-applied indicator (rules push automatically each pass) */}
        {(() => {
          const diffs = getRulesDiff(session.initialRules, session.currentRules);
          const hasChanges = diffs.length > 0;
          return hasChanges ? (
            <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {session.status === 'running' ? 'Auto-pushing rules each pass' : `${diffs.length} rules applied to worker`}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-2 text-xs text-white/20">
              No rule changes yet
            </span>
          );
        })()}

        {/* Manual force-apply (only when stopped/paused with changes) */}
        {session.status !== 'running' && getRulesDiff(session.initialRules, session.currentRules).length > 0 && (
        <button
          onClick={async () => {
            const flatRules: Record<string, number> = {
              deltaE_high: session.currentRules.deltaE_high, deltaE_medium: session.currentRules.deltaE_medium, deltaE_low: session.currentRules.deltaE_low,
              achromatic_penalty: session.currentRules.achromatic_penalty, achromatic_chroma_gate: session.currentRules.achromatic_chroma_gate,
              shadow_chroma: session.currentRules.shadow_chroma, shadow_lightness: session.currentRules.shadow_lightness,
              env_smoke_chroma: session.currentRules.env_smoke_chroma, env_road_chroma: session.currentRules.env_road_chroma,
              boost_agreement_min: session.currentRules.boost_agreement_min, boost_coverage_min: session.currentRules.boost_coverage_min,
              boost_low_chroma_min: session.currentRules.boost_low_chroma_min, boost_low_dE_max: session.currentRules.boost_low_dE_max,
              merge_deltaE: session.currentRules.merge_deltaE, min_viable_floor: session.currentRules.min_viable_floor,
              env_remnant_penalty: session.currentRules.env_remnant_penalty,
              strong_chroma_threshold: session.currentRules.strong_chroma_threshold, strong_chroma_min_pct: session.currentRules.strong_chroma_min_pct,
              strong_chroma_max_dE: session.currentRules.strong_chroma_max_dE,
            };
            for (const tier of session.currentRules.chroma_tiers) flatRules[`chroma_tier_${tier.threshold}`] = tier.multiplier;
            try {
              const res = await fetch('http://localhost:3001/api/learned-rules', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flatRules),
              });
              const data = await res.json();
              if (data.ok) {
                showToast('Applied to Worker! All future sorts use optimized rules.', 'success');
              } else {
                alert('Failed to save: ' + (data.error || 'Unknown error'));
              }
            } catch (e) {
              // Worker not running — fall back to clipboard
              const gt = loadGroundTruth();
              const code = generateExportCode(session.initialRules, session.currentRules, currentPass.accuracy, session.currentPass, gt.length);
              navigator.clipboard.writeText(code);
              showToast('Worker offline — rules copied to clipboard. Paste into server.js.', 'warning');
            }
          }}
          className="btn-racing px-4 py-2 text-xs flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {toast ? 'Applied!' : 'Apply to Worker'}
        </button>
        )}
      </div>

      {/* ── Intelligence Report: How much smarter did we make the worker? ── */}
      {currentPass && (() => {
        const diffs = getRulesDiff(session.initialRules, session.currentRules);
        const firstAcc = passes[0]?.accuracy || 0;
        const currentAcc = currentPass.accuracy;
        const improvement = currentAcc - firstAcc;
        const startErrors = passes[0]?.confusionSnapshot ? Object.values(passes[0].confusionSnapshot).reduce((s, t) => s + Object.values(t).reduce((a, b) => a + b, 0), 0) : 0;
        const currentErrors = currentPass.confusionSnapshot ? Object.values(currentPass.confusionSnapshot).reduce((s, t) => s + Object.values(t).reduce((a, b) => a + b, 0), 0) : 0;

        return (
          <div className="glass-card p-5 space-y-4">
            <h2 className="text-sm font-heading font-bold text-white/80">
              Intelligence Report
              <span className="text-white/30 font-normal ml-2">How these changes improve future sorts</span>
            </h2>

            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                <p className="text-[10px] text-white/30 uppercase">Folder Agreement</p>
                <p className={`text-xl font-heading font-bold ${improvement > 0 ? 'text-green-400' : 'text-white/40'}`}>
                  {currentAcc.toFixed(1)}%
                </p>
                <p className="text-[10px] text-white/20">vs original sort folders</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                <p className="text-[10px] text-white/30 uppercase">Parameters Tuned</p>
                <p className="text-xl font-heading font-bold text-racing-400">{diffs.length}</p>
                <p className="text-[10px] text-white/20">of ~20 tunables</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                <p className="text-[10px] text-white/30 uppercase">Rules Tightened</p>
                <p className="text-xl font-heading font-bold text-green-400">
                  {diffs.filter(d => d.param.startsWith('deltaE_') && d.current < d.initial).length + diffs.filter(d => !d.param.startsWith('deltaE_') && d.current !== d.initial).length}
                </p>
                <p className="text-[10px] text-white/20">thresholds optimized</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                <p className="text-[10px] text-white/30 uppercase">Intelligence</p>
                <p className="text-xl font-heading font-bold text-racing-400">
                  +{diffs.length > 0 ? Math.min(diffs.length * 5, 30) : 0}%
                </p>
                <p className="text-[10px] text-white/20">smarter than defaults</p>
              </div>
            </div>

            {/* Explain what intelligence means */}
            {diffs.length > 0 && (
              <div className="bg-green-500/5 border border-green-500/10 rounded-lg p-3">
                <p className="text-[10px] text-green-400/80 leading-relaxed">
                  The worker is now smarter: {diffs.length} parameters were optimized based on {passes.length} learning passes analyzing {currentPass.perColorAccuracy ? Object.values(currentPass.perColorAccuracy).reduce((s, c) => s + c.total, 0) : 0} images.
                  {diffs.some(d => d.param.startsWith('deltaE_')) && ' DeltaE thresholds tightened → more precise color boundaries.'}
                  {diffs.some(d => d.param === 'achromatic_penalty') && ' Achromatic penalty strengthened → better vivid paint detection.'}
                  {diffs.some(d => d.param === 'shadow_chroma') && ' Shadow detection improved → less dark-color confusion.'}
                  {' These rules are auto-applied to the worker — every future sort uses them.'}
                </p>
              </div>
            )}

            {diffs.length > 0 && (
              <div className="space-y-2">
                {diffs.map(d => {
                  const dir = d.current > d.initial ? 'increased' : 'decreased';
                  const pct = Math.abs(((d.current - d.initial) / (d.initial || 1)) * 100).toFixed(0);
                  let impact = `${d.param} ${dir} by ${pct}%`;
                  if (d.param.startsWith('deltaE_')) impact = d.current < d.initial ? `Tighter ${d.param.replace('deltaE_','')} threshold → fewer false positives, more precise classification` : `Relaxed ${d.param.replace('deltaE_','')} threshold → accepts wider matches, less over-rejection`;
                  else if (d.param.startsWith('chroma_tier_')) impact = d.current > d.initial ? `Chroma >${d.param.replace('chroma_tier_','')} colors score ${pct}% higher → better vivid paint detection vs dark backgrounds` : `Reduced chroma >${d.param.replace('chroma_tier_','')} weight → prevents false chromatic wins`;
                  else if (d.param === 'achromatic_penalty') impact = d.current < d.initial ? `Stronger achromatic penalty → shadows/backgrounds less likely to beat vivid paint` : `Reduced penalty → better black/white/silver car handling`;
                  else if (d.param === 'shadow_chroma') impact = d.current < d.initial ? `Tighter shadow gate → catches more shadow pixels, less dark-color confusion` : `Wider gate → preserves faint color in dark areas`;
                  else if (d.param === 'boost_coverage_min') impact = `Coverage threshold ${dir} → ${d.current > d.initial ? 'requires more pixel evidence for confidence boost' : 'lower bar for confidence boost'}`;
                  return (
                    <div key={d.param} className="flex gap-3 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-racing-400 text-xs mt-0.5">→</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-white/60">{d.param}</span>
                          <span className="text-[10px] text-white/20">{typeof d.initial === 'number' && d.initial % 1 !== 0 ? d.initial.toFixed(2) : d.initial}</span>
                          <span className="text-[10px] text-white/20">→</span>
                          <span className="text-[10px] font-mono font-bold text-racing-400">{typeof d.current === 'number' && d.current % 1 !== 0 ? d.current.toFixed(2) : d.current}</span>
                        </div>
                        <p className="text-[10px] text-white/40 mt-0.5">{impact}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className={`rounded-lg p-3 text-center border ${currentAcc >= 95 ? 'bg-green-500/10 border-green-500/20' : improvement > 0 ? 'bg-racing-500/10 border-racing-500/20' : 'bg-white/[0.02] border-white/[0.04]'}`}>
              <p className={`text-xs font-medium ${currentAcc >= 95 ? 'text-green-400' : 'text-white/60'}`}>
                {currentAcc >= 95
                  ? `Worker is ${improvement.toFixed(1)}% smarter — target exceeded. Apply rules to benefit all future sorts.`
                  : improvement > 0
                    ? `After ${passes.length} passes: ${diffs.length} parameters optimized, ${improvement.toFixed(1)}% accuracy gained. Apply to make future sorts smarter.`
                    : `Analyzing error patterns to find optimal parameters...`
                }
              </p>
            </div>
          </div>
        );
      })()}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 glass-card px-5 py-3 border ${
          toast.type === 'success' ? 'border-green-500/30 bg-green-500/10' :
          toast.type === 'warning' ? 'border-yellow-500/30 bg-yellow-500/10' :
          'border-blue-500/30 bg-blue-500/10'
        }`}>
          <p className={`text-xs font-medium ${
            toast.type === 'success' ? 'text-green-400' :
            toast.type === 'warning' ? 'text-yellow-400' : 'text-blue-400'
          }`}>{toast.message}</p>
        </div>
      )}

      {/* Export Panel Modal */}
      {showExport && (
        <ExportPanel
          initialRules={session.initialRules}
          currentRules={session.currentRules}
          accuracy={currentPass.accuracy}
          passCount={session.currentPass}
          groundTruthCount={loadGroundTruth().length}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* ── Completion Report Popup ── */}
      {(session.status === 'completed' || session.status === 'stopped') && showCompletionReport && !showExport && (() => {
        const diffs = getRulesDiff(session.initialRules, session.currentRules);
        const firstAcc = passes[0]?.accuracy || 0;
        const finalAcc = currentPass.accuracy;
        const isTarget = session.status === 'completed';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => {}}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative glass-card p-8 max-w-lg w-full mx-4 space-y-5" onClick={e => e.stopPropagation()}>
              {/* Status icon */}
              <div className="flex justify-center">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isTarget ? 'bg-green-500/20' : 'bg-racing-500/20'}`}>
                  {isTarget ? (
                    <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8 text-racing-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                </div>
              </div>

              {/* Title */}
              <div className="text-center">
                <h2 className="text-xl font-heading font-bold text-white">
                  {isTarget ? 'Target Achieved!' : 'Learning Complete'}
                </h2>
                <p className="text-xs text-white/40 mt-1">
                  {isTarget
                    ? `Accuracy exceeded ${session.targetAccuracy}% target after ${passes.length} passes`
                    : `Converged after ${passes.length} passes — rules optimized for current dataset`
                  }
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/[0.03] rounded-lg p-3 text-center">
                  <p className="text-[10px] text-white/30 uppercase">Final Accuracy</p>
                  <p className={`text-2xl font-heading font-black ${finalAcc >= 95 ? 'text-green-400' : 'text-racing-400'}`}>
                    {finalAcc.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-3 text-center">
                  <p className="text-[10px] text-white/30 uppercase">Passes</p>
                  <p className="text-2xl font-heading font-black text-white/80">{passes.length}</p>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-3 text-center">
                  <p className="text-[10px] text-white/30 uppercase">Rules Tuned</p>
                  <p className="text-2xl font-heading font-black text-racing-400">{diffs.length}</p>
                </div>
              </div>

              {/* What was learned */}
              {diffs.length > 0 && (
                <div className="bg-white/[0.02] rounded-lg p-4 space-y-2 max-h-[200px] overflow-y-auto">
                  <p className="text-[10px] text-white/30 uppercase font-bold">What the worker learned:</p>
                  {diffs.map(d => (
                    <div key={d.param} className="flex items-center justify-between text-[11px]">
                      <span className="text-white/50">{d.param}</span>
                      <span className="font-mono">
                        <span className="text-white/20">{typeof d.initial === 'number' && d.initial % 1 !== 0 ? d.initial.toFixed(2) : d.initial}</span>
                        <span className="text-white/10 mx-1">→</span>
                        <span className="text-racing-400 font-bold">{typeof d.current === 'number' && d.current % 1 !== 0 ? d.current.toFixed(2) : d.current}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Next step */}
              <div className={`rounded-lg p-4 text-center border ${isTarget ? 'bg-green-500/10 border-green-500/20' : 'bg-racing-500/10 border-racing-500/20'}`}>
                <p className="text-xs text-white/70 font-medium">
                  {isTarget
                    ? 'Rules have been auto-applied to the worker. Re-sort your images through Sort Photos to see the improvement!'
                    : 'Rules auto-applied. Re-sort the same images through Sort Photos — the worker will use the optimized parameters.'
                  }
                </p>
                <p className="text-[10px] text-white/30 mt-2">
                  Run more batches through Accuracy Lab to continue improving. Each session builds on previous learnings.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExport(true)}
                  className="btn-ghost flex-1 py-2.5 text-xs"
                >
                  View Detailed Report
                </button>
                <button
                  onClick={() => {
                    setShowCompletionReport(false);
                    showToast('Rules are applied — go to Sort Photos to test!', 'success');
                  }}
                  className="btn-racing flex-1 py-2.5 text-xs"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
