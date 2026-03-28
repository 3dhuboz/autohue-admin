import { useMemo } from 'react';
import type { FullClassificationRules, ReviewImage, ReviewSession } from './types';
import { COLOR_CATEGORIES, COLOR_SWATCHES } from './types';
import { loadGroundTruth } from './storage';
import ConfusionHeatmap from './ConfusionHeatmap';

interface ResultsPhaseProps {
  images: ReviewImage[];
  zipName: string;
  rules: FullClassificationRules;
  sessions: ReviewSession[];
  onReset: () => void;
  onStartLearning: () => void;
}

export default function ResultsPhase({ images, zipName, rules, sessions, onReset, onStartLearning }: ResultsPhaseProps) {
  // Computed metrics
  const metrics = useMemo(() => {
    const reviewed = images.filter(i => i.verdict);
    const correct = reviewed.filter(i => i.verdict === 'correct');
    const incorrect = reviewed.filter(i => i.verdict === 'incorrect');
    const accuracy = reviewed.length > 0 ? (correct.length / reviewed.length) * 100 : 0;

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

    const confusionPairs: { from: string; to: string; count: number }[] = [];
    for (const [assigned, stats] of Object.entries(colorStats)) {
      for (const [actual, count] of Object.entries(stats.confusedWith)) {
        confusionPairs.push({ from: assigned, to: actual, count });
      }
    }
    confusionPairs.sort((a, b) => b.count - a.count);

    const matrixColors = COLOR_CATEGORIES.filter(c =>
      images.some(i => i.assignedColor === c || (i.verdict === 'incorrect' && i.correctColor === c))
    );

    return { reviewed: reviewed.length, correct: correct.length, incorrect: incorrect.length, accuracy, colorStats, confusionPairs, matrixColors };
  }, [images]);

  // Confusion matrix for heatmap
  const confusionMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, number>> = {};
    for (const [color, stats] of Object.entries(metrics.colorStats)) {
      if (stats.total > 0) {
        matrix[color] = { ...stats.confusedWith };
      }
    }
    return matrix;
  }, [metrics]);

  // Per-color accuracy for heatmap
  const perColorAccuracy = useMemo(() => {
    const result: Record<string, { correct: number; total: number }> = {};
    for (const [color, stats] of Object.entries(metrics.colorStats)) {
      if (stats.total > 0) {
        result[color] = { correct: stats.correct, total: stats.total };
      }
    }
    return result;
  }, [metrics]);

  // Tuning recommendations
  const recommendations = useMemo(() => {
    const recs: string[] = [];
    const { confusionPairs, colorStats, accuracy, reviewed } = metrics;

    if (reviewed < 5) return ['Review at least 5 images to get recommendations.'];

    if (accuracy >= 95) {
      recs.push(`Accuracy is ${accuracy.toFixed(1)}% \u2014 above the 95% target. Rules are performing well.`);
    } else {
      recs.push(`Accuracy is ${accuracy.toFixed(1)}% \u2014 below the 95% target. Focus on the top confusion pairs below.`);
    }

    for (const pair of confusionPairs.slice(0, 5)) {
      if (pair.count >= 1) {
        const pct = ((pair.count / (colorStats[pair.from]?.total || 1)) * 100).toFixed(0);
        recs.push(
          `"${pair.from}" misclassified as "${pair.to}" \u2014 ${pair.count} times (${pct}% of ${pair.from} images). ` +
          `Consider tightening deltaE thresholds for ${pair.from}\u2194${pair.to} boundary.`
        );
      }
    }

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

    const darkToBlack = confusionPairs.filter(p => p.to === 'black' && !['silver-grey', 'white'].includes(p.from));
    if (darkToBlack.length > 0) {
      const total = darkToBlack.reduce((s, p) => s + p.count, 0);
      recs.push(
        `Dark chromatic\u2192black confusion: ${total} images. Colors like dark blue/brown/green being called black. ` +
        `Lower the chroma boost threshold (currently ${rules.boost_low_chroma_min}) to better detect faint chromaticity.`
      );
    }

    for (const [cat, stats] of Object.entries(colorStats)) {
      if (stats.total >= 3 && stats.incorrect / stats.total > 0.3) {
        recs.push(
          `"${cat}" has ${((stats.correct / stats.total) * 100).toFixed(0)}% accuracy (${stats.correct}/${stats.total}). ` +
          `Needs attention \u2014 review reference colors for this cluster.`
        );
      }
    }

    return recs;
  }, [metrics, rules]);

  // Cumulative ground truth stats
  const cumulativeStats = useMemo(() => {
    const gt = loadGroundTruth();
    const total = gt.length;
    const correct = gt.filter(g => g.assigned === g.correct).length;
    const accuracy = total > 0 ? (correct / total) * 100 : 0;
    return { total, correct, accuracy };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">
            Analysis <span className="text-racing-500">Results</span>
          </h1>
          <p className="text-xs text-white/30 mt-0.5">{zipName} \u2014 {metrics.reviewed} of {images.length} reviewed</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onReset} className="btn-ghost px-4 py-1.5 text-xs">
            Upload New Results
          </button>
          <button onClick={onStartLearning} className="btn-racing px-5 py-2 text-sm font-heading font-bold">
            Start Learning
          </button>
        </div>
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
          <p className="text-xs text-green-400/60 mt-3">Target achieved \u2014 above 95% accuracy threshold</p>
        )}
        {metrics.accuracy < 95 && metrics.accuracy > 0 && (
          <p className="text-xs text-yellow-400/60 mt-3">
            {(95 - metrics.accuracy).toFixed(1)}% below target \u2014 review recommendations below or start the learning engine
          </p>
        )}
        {/* Start Learning CTA */}
        {metrics.accuracy < 95 && metrics.reviewed >= 5 && (
          <button
            onClick={onStartLearning}
            className="btn-racing px-8 py-3 text-sm font-heading font-bold mt-6 inline-flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Start Learning Engine
          </button>
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
                      {Object.entries(stats.confusedWith).map(([to, n]) => `\u2192${to}(${n})`).join(' ')}
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
          <ConfusionHeatmap
            matrix={confusionMatrix}
            perColor={perColorAccuracy}
            colors={[...metrics.matrixColors]}
          />
        </div>
      )}

      {/* Tuning Recommendations */}
      <div className="glass-card p-5 space-y-3">
        <h2 className="text-sm font-heading font-bold text-white/80">Tuning Recommendations</h2>
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div key={i} className="flex gap-2 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <span className={`text-xs mt-0.5 ${i === 0 ? (metrics.accuracy >= 95 ? 'text-green-400' : 'text-yellow-400') : 'text-racing-400'}`}>
                {i === 0 ? (metrics.accuracy >= 95 ? '\u25cf' : '\u25b2') : '\u2192'}
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
            <p className="text-sm font-mono text-white/60">&gt; {rules.boost_low_chroma_min}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">Coverage Boost</p>
            <p className="text-sm font-mono text-white/60">&gt; {(rules.boost_coverage_min * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30">Agreement Boost</p>
            <p className="text-sm font-mono text-white/60">&ge; {rules.boost_agreement_min} regions</p>
          </div>
        </div>
        {metrics.accuracy < 95 && (
          <p className="text-[10px] text-racing-400/60">
            Tip: Start the Learning Engine to automatically optimize these rules, or go back to Upload to manually adjust.
          </p>
        )}
      </div>
    </div>
  );
}
