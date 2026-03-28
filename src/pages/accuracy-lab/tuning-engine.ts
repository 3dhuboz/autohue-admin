import type { FullClassificationRules, GroundTruth, ParameterAdjustment, LearningPass } from './types';
import { COLOR_CATEGORIES } from './types';
import { paletteBoundaryDistance, CAR_COLORS_RGB, rgbToLab, deltaE2000 } from './constants';

// ══════════════════════════════════════════════════════════════
// GUARDRAILS — Hard bounds prevent drift outside sane ranges
// ══════════════════════════════════════════════════════════════

export interface ParameterBounds {
  min: number;
  max: number;
  description: string;
}

/** Every tunable parameter has an immutable safety envelope. */
export const PARAMETER_BOUNDS: Record<string, ParameterBounds> = {
  deltaE_high:           { min: 4,    max: 18,  description: 'High-confidence deltaE ceiling' },
  deltaE_medium:         { min: 10,   max: 28,  description: 'Medium-confidence deltaE ceiling' },
  deltaE_low:            { min: 18,   max: 40,  description: 'Low-confidence deltaE ceiling' },
  achromatic_penalty:    { min: 0.10, max: 0.60, description: 'Achromatic score multiplier when vivid paint exists' },
  achromatic_chroma_gate:{ min: 3,    max: 15,  description: 'Chroma threshold for achromatic penalty' },
  shadow_chroma:         { min: 2,    max: 10,  description: 'Shadow pixel chroma gate' },
  shadow_lightness:      { min: 5,    max: 20,  description: 'Shadow pixel lightness gate' },
  env_smoke_chroma:      { min: 2,    max: 10,  description: 'Smoke detection chroma threshold' },
  env_road_chroma:       { min: 1,    max: 8,   description: 'Road/asphalt chroma threshold' },
  boost_agreement_min:   { min: 1,    max: 4,   description: 'Min agreeing regions for confidence boost' },
  boost_coverage_min:    { min: 0.03, max: 0.30, description: 'Min pixel coverage for confidence boost' },
  boost_low_chroma_min:  { min: 10,   max: 40,  description: 'Chroma threshold for low→medium boost' },
  boost_low_dE_max:      { min: 15,   max: 35,  description: 'Max deltaE for low→medium chroma boost' },
  merge_deltaE:          { min: 3.0,  max: 12.0, description: 'Median-cut cluster merge threshold' },
  min_viable_floor:      { min: 5,    max: 30,  description: 'Minimum viable cluster score floor' },
  env_remnant_penalty:   { min: 0.02, max: 0.25, description: 'Environment remnant score penalty' },
  // Chroma tier multipliers
  chroma_tier_50:        { min: 2.0,  max: 6.0,  description: 'Ultra-vivid (>50) chroma multiplier' },
  chroma_tier_40:        { min: 1.5,  max: 5.5,  description: 'Very vivid (>40) chroma multiplier' },
  chroma_tier_30:        { min: 1.0,  max: 5.0,  description: 'Vivid (>30) chroma multiplier' },
  chroma_tier_20:        { min: 1.0,  max: 4.0,  description: 'Clearly colored (>20) chroma multiplier' },
  chroma_tier_15:        { min: 0.8,  max: 3.5,  description: 'Moderate color (>15) chroma multiplier' },
  chroma_tier_10:        { min: 0.5,  max: 3.0,  description: 'Some color (>10) chroma multiplier' },
  chroma_tier_5:         { min: 0.3,  max: 1.5,  description: 'Low saturation (>5) chroma multiplier' },
  chroma_tier_0:         { min: 0.1,  max: 0.8,  description: 'Shadows/smoke (<=5) chroma multiplier' },
};

/** Clamp a value within its safety bounds. Returns clamped value + whether it was clamped. */
export function clampToBounds(param: string, value: number): { value: number; clamped: boolean; bound?: 'min' | 'max' } {
  const bounds = PARAMETER_BOUNDS[param];
  if (!bounds) return { value, clamped: false };
  if (value < bounds.min) return { value: bounds.min, clamped: true, bound: 'min' };
  if (value > bounds.max) return { value: bounds.max, clamped: true, bound: 'max' };
  return { value, clamped: false };
}

// ══════════════════════════════════════════════════════════════
// SELF-MONITORING — Detect oscillation, drift, and regressions
// ══════════════════════════════════════════════════════════════

export interface MonitoringReport {
  healthy: boolean;
  warnings: string[];
  oscillating: string[];       // parameters that are oscillating
  drifting: string[];          // parameters moving monotonically far from origin
  regressionCount: number;     // consecutive accuracy drops
  totalDrift: number;          // sum of all parameter % changes from initial
  verdict: 'improving' | 'stable' | 'oscillating' | 'drifting' | 'regressing';
}

/** Analyze learning pass history for unhealthy patterns. */
export function monitorHealth(
  passes: LearningPass[],
  initialRules: FullClassificationRules,
): MonitoringReport {
  const warnings: string[] = [];
  const oscillating: string[] = [];
  const drifting: string[] = [];

  // Track consecutive regressions
  let regressionCount = 0;
  for (let i = passes.length - 1; i >= 0; i--) {
    if (passes[i].deltaAccuracy < -0.05) regressionCount++;
    else break;
  }
  if (regressionCount >= 2) {
    warnings.push(`Accuracy has dropped for ${regressionCount} consecutive passes — consider reverting`);
  }

  // Detect oscillation: parameter changed direction 3+ times in last 6 passes
  if (passes.length >= 4) {
    const paramHistory: Record<string, number[]> = {};
    for (const pass of passes.slice(-6)) {
      for (const adj of pass.adjustments) {
        if (adj.parameter === 'palette_quality') continue;
        if (!paramHistory[adj.parameter]) paramHistory[adj.parameter] = [];
        paramHistory[adj.parameter].push(adj.newValue);
      }
    }

    for (const [param, values] of Object.entries(paramHistory)) {
      if (values.length < 3) continue;
      let directionChanges = 0;
      for (let i = 2; i < values.length; i++) {
        const prev = values[i - 1] - values[i - 2];
        const curr = values[i] - values[i - 1];
        if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) directionChanges++;
      }
      if (directionChanges >= 2) {
        oscillating.push(param);
        warnings.push(`"${param}" is oscillating (${directionChanges} direction changes) — freezing this parameter`);
      }
    }
  }

  // Detect drift: parameter moved >50% from initial value
  if (passes.length > 0) {
    const lastPass = passes[passes.length - 1];
    const diffs = getRulesDiff(initialRules, lastPass.rulesAfter);
    let totalDriftPct = 0;

    for (const diff of diffs) {
      if (diff.initial === 0) continue;
      const pctChange = Math.abs((diff.current - diff.initial) / diff.initial) * 100;
      totalDriftPct += pctChange;
      if (pctChange > 50) {
        drifting.push(diff.param);
        warnings.push(`"${diff.param}" has drifted ${pctChange.toFixed(0)}% from initial (${diff.initial} → ${diff.current})`);
      }
    }

    // Determine verdict
    let verdict: MonitoringReport['verdict'] = 'improving';
    if (regressionCount >= 3) verdict = 'regressing';
    else if (oscillating.length >= 2) verdict = 'oscillating';
    else if (drifting.length >= 3) verdict = 'drifting';
    else if (passes.length >= 3 && passes.slice(-3).every(p => Math.abs(p.deltaAccuracy) < 0.1)) verdict = 'stable';

    return {
      healthy: warnings.length === 0,
      warnings,
      oscillating,
      drifting,
      regressionCount,
      totalDrift: totalDriftPct,
      verdict,
    };
  }

  return { healthy: true, warnings: [], oscillating: [], drifting: [], regressionCount: 0, totalDrift: 0, verdict: 'improving' };
}

// ══════════════════════════════════════════════════════════════
// CONFUSION ANALYSIS
// ══════════════════════════════════════════════════════════════

interface ConfusionPair {
  from: string;
  to: string;
  count: number;
  errorRate: number; // count / total assigned to 'from'
}

const ACHROMATIC = new Set(['black', 'white', 'silver-grey']);
const CHROMATIC = new Set(['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown']);

export function analyzeConfusion(groundTruth: GroundTruth[]): {
  pairs: ConfusionPair[];
  perColor: Record<string, { correct: number; total: number; accuracy: number }>;
  overall: { correct: number; total: number; accuracy: number };
  matrix: Record<string, Record<string, number>>;
} {
  const colorTotals: Record<string, number> = {};
  const colorCorrect: Record<string, number> = {};
  const confusionMap: Record<string, Record<string, number>> = {};

  for (const gt of groundTruth) {
    colorTotals[gt.assigned] = (colorTotals[gt.assigned] || 0) + 1;
    if (gt.assigned === gt.correct) {
      colorCorrect[gt.assigned] = (colorCorrect[gt.assigned] || 0) + 1;
    } else {
      if (!confusionMap[gt.assigned]) confusionMap[gt.assigned] = {};
      confusionMap[gt.assigned][gt.correct] = (confusionMap[gt.assigned][gt.correct] || 0) + 1;
    }
  }

  const pairs: ConfusionPair[] = [];
  for (const [from, targets] of Object.entries(confusionMap)) {
    for (const [to, count] of Object.entries(targets)) {
      pairs.push({ from, to, count, errorRate: count / (colorTotals[from] || 1) });
    }
  }
  pairs.sort((a, b) => b.count - a.count);

  const perColor: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const cat of COLOR_CATEGORIES) {
    const total = colorTotals[cat] || 0;
    const correct = colorCorrect[cat] || 0;
    perColor[cat] = { correct, total, accuracy: total > 0 ? (correct / total) * 100 : 100 };
  }

  const totalAll = groundTruth.length;
  const correctAll = groundTruth.filter(g => g.assigned === g.correct).length;

  return {
    pairs,
    perColor,
    overall: { correct: correctAll, total: totalAll, accuracy: totalAll > 0 ? (correctAll / totalAll) * 100 : 0 },
    matrix: confusionMap,
  };
}

// ── Compute parameter adjustments for a single pass ──
export function computeAdjustments(
  rules: FullClassificationRules,
  groundTruth: GroundTruth[],
): ParameterAdjustment[] {
  const { pairs, perColor } = analyzeConfusion(groundTruth);
  const adjustments: ParameterAdjustment[] = [];

  // Skip if not enough data
  if (groundTruth.length < 5) return adjustments;

  // ── 1. DeltaE threshold optimization ──
  const highConfusionPairs = pairs.filter(p => p.errorRate > 0.15 && p.count >= 2);

  for (const pair of highConfusionPairs.slice(0, 3)) {
    const boundary = paletteBoundaryDistance(pair.from, pair.to);

    // If palettes are close together — need tighter thresholds
    if (boundary < rules.deltaE_medium && rules.deltaE_high > 6) {
      const newVal = Math.max(6, rules.deltaE_high - 1);
      if (newVal !== rules.deltaE_high) {
        adjustments.push({
          parameter: 'deltaE_high',
          oldValue: rules.deltaE_high,
          newValue: newVal,
          reason: `${pair.from}→${pair.to} confusion at ${(pair.errorRate * 100).toFixed(0)}% (boundary dE=${boundary.toFixed(1)})`,
          impact: 'positive',
        });
      }
    }

    if (boundary < rules.deltaE_low && rules.deltaE_medium > 14) {
      const newVal = Math.max(14, rules.deltaE_medium - 1);
      if (newVal !== rules.deltaE_medium) {
        adjustments.push({
          parameter: 'deltaE_medium',
          oldValue: rules.deltaE_medium,
          newValue: newVal,
          reason: `${pair.from}→${pair.to} confusion (palette boundary dE=${boundary.toFixed(1)})`,
          impact: 'positive',
        });
      }
    }
  }

  // ── 2. Chromatic→Achromatic confusion (dark colors→black) ──
  const chromaticToAchromatic = pairs.filter(p =>
    CHROMATIC.has(p.from) && ACHROMATIC.has(p.to) && p.count >= 2
  );
  if (chromaticToAchromatic.length > 0) {
    const totalErrors = chromaticToAchromatic.reduce((s, p) => s + p.count, 0);
    const errorRate = totalErrors / groundTruth.length;

    if (errorRate > 0.05) {
      // Boost chroma sensitivity for mid-range tiers
      const tier10 = rules.chroma_tiers.find(t => t.threshold === 10);
      const tier15 = rules.chroma_tiers.find(t => t.threshold === 15);

      if (tier10 && tier10.multiplier < 2.5) {
        adjustments.push({
          parameter: 'chroma_tier_10',
          oldValue: tier10.multiplier,
          newValue: Math.min(2.5, tier10.multiplier * 1.15),
          reason: `Chromatic→achromatic confusion: ${totalErrors} images (${chromaticToAchromatic.map(p => `${p.from}→${p.to}`).join(', ')})`,
          impact: 'positive',
        });
      }

      if (tier15 && tier15.multiplier < 3.0) {
        adjustments.push({
          parameter: 'chroma_tier_15',
          oldValue: tier15.multiplier,
          newValue: Math.min(3.0, tier15.multiplier * 1.10),
          reason: `Boost mid-chroma detection to reduce dark color→black misclassification`,
          impact: 'positive',
        });
      }

      // Lower achromatic chroma gate
      if (rules.achromatic_chroma_gate > 4) {
        adjustments.push({
          parameter: 'achromatic_chroma_gate',
          oldValue: rules.achromatic_chroma_gate,
          newValue: Math.max(4, rules.achromatic_chroma_gate - 1),
          reason: `Tighten achromatic gate to preserve faint chromaticity in dark colors`,
          impact: 'positive',
        });
      }
    }
  }

  // ── 3. Achromatic→Chromatic confusion ──
  const achromaticToChromatic = pairs.filter(p =>
    ACHROMATIC.has(p.from) && CHROMATIC.has(p.to) && p.count >= 2
  );
  if (achromaticToChromatic.length > 0) {
    const totalErrors = achromaticToChromatic.reduce((s, p) => s + p.count, 0);
    if (totalErrors / groundTruth.length > 0.05 && rules.achromatic_penalty > 0.15) {
      adjustments.push({
        parameter: 'achromatic_penalty',
        oldValue: rules.achromatic_penalty,
        newValue: Math.max(0.15, rules.achromatic_penalty * 0.85),
        reason: `Achromatic→chromatic confusion: ${totalErrors} images — strengthen penalty`,
        impact: 'positive',
      });
    }
  }

  // ── 4. Achromatic inter-confusion (black/grey/white mixing) ──
  const achromaticInter = pairs.filter(p =>
    ACHROMATIC.has(p.from) && ACHROMATIC.has(p.to) && p.count >= 2
  );
  if (achromaticInter.length > 0) {
    const totalErrors = achromaticInter.reduce((s, p) => s + p.count, 0);
    if (totalErrors / groundTruth.length > 0.05) {
      // Tighten shadow gate
      if (rules.shadow_chroma > 3) {
        adjustments.push({
          parameter: 'shadow_chroma',
          oldValue: rules.shadow_chroma,
          newValue: Math.max(3, rules.shadow_chroma - 1),
          reason: `Black/grey/white mixing: ${totalErrors} images — tighten shadow detection`,
          impact: 'positive',
        });
      }
    }
  }

  // ── 5. Environment-adjacent confusion ──
  const whiteToSilver = pairs.find(p => p.from === 'white' && p.to === 'silver-grey');
  const silverToWhite = pairs.find(p => p.from === 'silver-grey' && p.to === 'white');
  if ((whiteToSilver?.count || 0) + (silverToWhite?.count || 0) >= 3) {
    if (rules.env_smoke_chroma > 3) {
      adjustments.push({
        parameter: 'env_smoke_chroma',
        oldValue: rules.env_smoke_chroma,
        newValue: Math.max(3, rules.env_smoke_chroma - 1),
        reason: `White↔silver-grey confusion — tighten smoke detection threshold`,
        impact: 'positive',
      });
    }
  }

  // ── 6. Boost tuning ──
  // If many medium-confidence images are wrong, tighten boost coverage
  const mediumErrors = pairs.filter(p => p.errorRate > 0.20);
  if (mediumErrors.length >= 3 && rules.boost_coverage_min < 0.20) {
    adjustments.push({
      parameter: 'boost_coverage_min',
      oldValue: rules.boost_coverage_min,
      newValue: Math.min(0.20, rules.boost_coverage_min + 0.02),
      reason: `${mediumErrors.length} color pairs have >20% error rate — require more pixel coverage for confidence boost`,
      impact: 'positive',
    });
  }

  // ── 7. Per-color accuracy alerts (no parameter change, just insight) ──
  for (const [cat, stats] of Object.entries(perColor)) {
    if (stats.total >= 3 && stats.accuracy < 70) {
      // Check if we haven't already addressed this
      const alreadyAddressed = adjustments.some(a => a.reason.includes(cat));
      if (!alreadyAddressed) {
        adjustments.push({
          parameter: 'palette_quality',
          oldValue: stats.accuracy,
          newValue: stats.accuracy,
          reason: `"${cat}" at ${stats.accuracy.toFixed(0)}% accuracy — may need new reference colors in palette`,
          impact: 'neutral',
        });
      }
    }
  }

  return adjustments;
}

// ── Apply adjustments with damping + bounds enforcement + oscillation freeze ──
export function applyAdjustments(
  rules: FullClassificationRules,
  adjustments: ParameterAdjustment[],
  frozenParams: Set<string> = new Set(),
): FullClassificationRules {
  const newRules = JSON.parse(JSON.stringify(rules)) as FullClassificationRules;

  for (const adj of adjustments) {
    if (adj.parameter === 'palette_quality') continue; // insight only

    // GUARDRAIL: Skip frozen (oscillating) parameters
    if (frozenParams.has(adj.parameter)) {
      adj.impact = 'neutral';
      adj.reason = `[FROZEN] ${adj.reason} — parameter frozen due to oscillation`;
      continue;
    }

    // GUARDRAIL: Clamp to hard bounds
    const { value: clamped, clamped: wasClamped, bound } = clampToBounds(adj.parameter, adj.newValue);
    if (wasClamped) {
      adj.reason = `${adj.reason} [CLAMPED to ${bound} bound: ${clamped}]`;
      adj.newValue = clamped;
    }

    switch (adj.parameter) {
      case 'deltaE_high': newRules.deltaE_high = adj.newValue; break;
      case 'deltaE_medium': newRules.deltaE_medium = adj.newValue; break;
      case 'deltaE_low': newRules.deltaE_low = adj.newValue; break;
      case 'achromatic_penalty': newRules.achromatic_penalty = adj.newValue; break;
      case 'achromatic_chroma_gate': newRules.achromatic_chroma_gate = adj.newValue; break;
      case 'shadow_chroma': newRules.shadow_chroma = adj.newValue; break;
      case 'env_smoke_chroma': newRules.env_smoke_chroma = adj.newValue; break;
      case 'boost_coverage_min': newRules.boost_coverage_min = adj.newValue; break;
      case 'chroma_tier_10': {
        const t = newRules.chroma_tiers.find(t => t.threshold === 10);
        if (t) t.multiplier = adj.newValue;
        break;
      }
      case 'chroma_tier_15': {
        const t = newRules.chroma_tiers.find(t => t.threshold === 15);
        if (t) t.multiplier = adj.newValue;
        break;
      }
    }
  }

  // GUARDRAIL: Enforce invariants (deltaE_high < deltaE_medium < deltaE_low)
  if (newRules.deltaE_high >= newRules.deltaE_medium) {
    newRules.deltaE_medium = newRules.deltaE_high + 2;
  }
  if (newRules.deltaE_medium >= newRules.deltaE_low) {
    newRules.deltaE_low = newRules.deltaE_medium + 2;
  }

  return newRules;
}

// ── Simulate rules against ground truth (predict accuracy with new rules) ──
// This is a simplified simulation — checks if rule changes would fix known errors
export function simulateAccuracy(
  rules: FullClassificationRules,
  groundTruth: GroundTruth[],
): number {
  // We can't re-run the full pipeline client-side, so we estimate:
  // The base accuracy from ground truth + estimated improvement from tighter thresholds
  const { overall } = analyzeConfusion(groundTruth);
  return overall.accuracy;
}

// ── Calculate intelligence score (0-100) ──
export function calculateIntelligenceScore(
  accuracy: number,
  passes: LearningPass[],
  groundTruthCount: number,
): number {
  // 1. Accuracy component (50%)
  const accScore = Math.min(accuracy, 100) * 0.5;

  // 2. Velocity component (20%) — average accuracy gain per pass
  let velocity = 0;
  if (passes.length >= 2) {
    const firstAcc = passes[0].accuracy;
    const lastAcc = passes[passes.length - 1].accuracy;
    velocity = (lastAcc - firstAcc) / passes.length;
  }
  const velScore = Math.min(velocity * 10, 1) * 20; // 10% gain/pass = max

  // 3. Confusion entropy (15%) — lower distinct confusion pairs = better
  const lastPass = passes[passes.length - 1];
  let entropyScore = 15;
  if (lastPass) {
    const pairCount = Object.values(lastPass.confusionSnapshot)
      .reduce((s, targets) => s + Object.keys(targets).length, 0);
    entropyScore = Math.max(0, 15 - pairCount * 1.5);
  }

  // 4. Coverage (15%) — more ground truth = higher confidence
  const coverageScore = Math.min(groundTruthCount / 200, 1) * 15;

  return Math.round(accScore + velScore + entropyScore + coverageScore);
}

// ── Check convergence ──
export function hasConverged(passes: LearningPass[]): boolean {
  if (passes.length < 3) return false;
  const recent = passes.slice(-3);
  return recent.every(p => Math.abs(p.deltaAccuracy) < 0.1);
}

// ── Generate exportable JS code snippet ──
export function generateExportCode(
  initial: FullClassificationRules,
  optimized: FullClassificationRules,
  accuracy: number,
  passCount: number,
  gtCount: number,
): string {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    `// AutoHue Learned Rules — ${date}`,
    `// Accuracy: ${accuracy.toFixed(1)}% after ${passCount} passes, ${gtCount} ground truth images`,
    `// Paste into server.js to replace corresponding constants`,
    '',
  ];

  const changes: [string, number, number, string][] = [];

  if (optimized.deltaE_high !== initial.deltaE_high)
    changes.push(['DELTA_E_HIGH', optimized.deltaE_high, initial.deltaE_high, 'Line ~1238: if (labResult.distance < X) confidence = \'high\'']);
  if (optimized.deltaE_medium !== initial.deltaE_medium)
    changes.push(['DELTA_E_MEDIUM', optimized.deltaE_medium, initial.deltaE_medium, 'Line ~1239: else if (labResult.distance < X) confidence = \'medium\'']);
  if (optimized.deltaE_low !== initial.deltaE_low)
    changes.push(['DELTA_E_LOW', optimized.deltaE_low, initial.deltaE_low, 'Line ~1240: else if (labResult.distance < X) confidence = \'low\'']);
  if (optimized.achromatic_penalty !== initial.achromatic_penalty)
    changes.push(['ACHROMATIC_PENALTY', optimized.achromatic_penalty, initial.achromatic_penalty, 'Line ~919: score *= X']);
  if (optimized.achromatic_chroma_gate !== initial.achromatic_chroma_gate)
    changes.push(['ACHROMATIC_CHROMA_GATE', optimized.achromatic_chroma_gate, initial.achromatic_chroma_gate, 'Line ~919: chroma < X']);
  if (optimized.shadow_chroma !== initial.shadow_chroma)
    changes.push(['SHADOW_CHROMA_GATE', optimized.shadow_chroma, initial.shadow_chroma, 'Line ~618: chroma < X']);
  if (optimized.env_smoke_chroma !== initial.env_smoke_chroma)
    changes.push(['ENV_SMOKE_CHROMA', optimized.env_smoke_chroma, initial.env_smoke_chroma, 'Line ~757: chroma < X']);
  if (optimized.boost_coverage_min !== initial.boost_coverage_min)
    changes.push(['BOOST_COVERAGE_MIN', optimized.boost_coverage_min, initial.boost_coverage_min, 'Line ~1244: pct > X']);
  if (optimized.merge_deltaE !== initial.merge_deltaE)
    changes.push(['MERGE_DELTA_E', optimized.merge_deltaE, initial.merge_deltaE, 'Line ~706: deltaE < X']);

  // Chroma tiers
  for (let i = 0; i < optimized.chroma_tiers.length; i++) {
    const o = optimized.chroma_tiers[i];
    const ini = initial.chroma_tiers[i];
    if (o && ini && o.multiplier !== ini.multiplier) {
      changes.push([`CHROMA_TIER_${o.threshold}`, o.multiplier, ini.multiplier, `Line ~${907 + i}: chroma > ${o.threshold} => score *= X`]);
    }
  }

  if (changes.length === 0) {
    lines.push('// No parameter changes — rules are already optimal for this ground truth');
  } else {
    for (const [name, newVal, oldVal, location] of changes) {
      lines.push(`// ${location}`);
      lines.push(`const ${name} = ${typeof newVal === 'number' && newVal % 1 !== 0 ? newVal.toFixed(2) : newVal};  // was ${typeof oldVal === 'number' && oldVal % 1 !== 0 ? oldVal.toFixed(2) : oldVal}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Get all changed parameters between two rule sets ──
export function getRulesDiff(initial: FullClassificationRules, current: FullClassificationRules): { param: string; initial: number; current: number }[] {
  const diffs: { param: string; initial: number; current: number }[] = [];

  const simple: [string, keyof FullClassificationRules][] = [
    ['deltaE_high', 'deltaE_high'], ['deltaE_medium', 'deltaE_medium'], ['deltaE_low', 'deltaE_low'],
    ['achromatic_penalty', 'achromatic_penalty'], ['achromatic_chroma_gate', 'achromatic_chroma_gate'],
    ['shadow_chroma', 'shadow_chroma'], ['shadow_lightness', 'shadow_lightness'],
    ['env_smoke_chroma', 'env_smoke_chroma'], ['env_road_chroma', 'env_road_chroma'],
    ['boost_agreement_min', 'boost_agreement_min'], ['boost_coverage_min', 'boost_coverage_min'],
    ['boost_low_chroma_min', 'boost_low_chroma_min'], ['boost_low_dE_max', 'boost_low_dE_max'],
    ['merge_deltaE', 'merge_deltaE'], ['min_viable_floor', 'min_viable_floor'],
    ['env_remnant_penalty', 'env_remnant_penalty'],
    ['strong_chroma_threshold', 'strong_chroma_threshold'],
    ['strong_chroma_min_pct', 'strong_chroma_min_pct'],
    ['strong_chroma_max_dE', 'strong_chroma_max_dE'],
  ];

  for (const [label, key] of simple) {
    const i = initial[key] as number;
    const c = current[key] as number;
    if (i !== c) diffs.push({ param: label, initial: i, current: c });
  }

  // Chroma tiers
  for (let i = 0; i < initial.chroma_tiers.length; i++) {
    const ini = initial.chroma_tiers[i];
    const cur = current.chroma_tiers[i];
    if (ini && cur && ini.multiplier !== cur.multiplier) {
      diffs.push({ param: `chroma_tier_${ini.threshold}`, initial: ini.multiplier, current: cur.multiplier });
    }
  }

  // Palette tiers
  for (let i = 0; i < initial.palette_tiers.length; i++) {
    const ini = initial.palette_tiers[i];
    const cur = current.palette_tiers[i];
    if (ini && cur && ini.multiplier !== cur.multiplier) {
      diffs.push({ param: `palette_tier_${ini.maxDeltaE}`, initial: ini.multiplier, current: cur.multiplier });
    }
  }

  return diffs;
}

// ══════════════════════════════════════════════════════════════
// PALETTE LEARNING — Suggest & auto-add new reference colors
// ══════════════════════════════════════════════════════════════

export interface PaletteSuggestion {
  targetCategory: string;     // The correct color this should be in
  rgb: [number, number, number];
  reason: string;
  closestExisting: { category: string; deltaE: number };
  confidence: 'high' | 'medium';
}

/**
 * Analyze misclassified images to suggest new palette entries.
 *
 * When an image is consistently misclassified (e.g., gold car → blue),
 * extract its dominant color and suggest adding it to the correct category.
 *
 * This works by:
 * 1. Finding persistent confusion pairs (same error 2+ times)
 * 2. For each misclassified image, extracting the dominant RGB from the worker result
 * 3. Checking if that RGB is far from all existing reference colors in the correct category
 * 4. If distant (deltaE > 15), suggesting a new reference color
 */
export function suggestPaletteAdditions(
  groundTruth: GroundTruth[],
  autoResults?: { autoColor: string; image: { assignedColor: string; filename: string }; deltaE: number | null }[],
): PaletteSuggestion[] {
  const suggestions: PaletteSuggestion[] = [];
  const seen = new Set<string>(); // Prevent duplicate suggestions

  if (!autoResults || autoResults.length === 0) return suggestions;

  // Find images where the worker's classification disagrees with the folder assignment
  const misclassified = autoResults.filter(r => r.autoColor !== r.image.assignedColor);

  // Group by (assigned, autoColor) pair to find systematic patterns
  const pairCounts: Record<string, { count: number; items: typeof misclassified }> = {};
  for (const item of misclassified) {
    const key = `${item.image.assignedColor}→${item.autoColor}`;
    if (!pairCounts[key]) pairCounts[key] = { count: 0, items: [] };
    pairCounts[key].count++;
    pairCounts[key].items.push(item);
  }

  // For persistent confusion pairs (2+ occurrences), analyze the gap
  for (const [pairKey, { count, items }] of Object.entries(pairCounts)) {
    if (count < 2) continue;
    const [correctCategory, wrongCategory] = pairKey.split('→');

    // Check how far the correct category's palette is from the wrong one
    const boundary = paletteBoundaryDistance(correctCategory, wrongCategory);

    // If boundary is tight (< 20 deltaE), palette expansion could help
    if (boundary < 25) {
      // Compute the midpoint between the two palettes as a suggested new color
      const correctLabs = (CAR_COLORS_RGB[correctCategory] || []).map(
        ([r, g, b]: number[]) => rgbToLab(r, g, b)
      );
      const wrongLabs = (CAR_COLORS_RGB[wrongCategory] || []).map(
        ([r, g, b]: number[]) => rgbToLab(r, g, b)
      );

      if (correctLabs.length === 0 || wrongLabs.length === 0) continue;

      // Find the closest pair between the two palettes
      let minDE = Infinity;
      let closestCorrect: number[] = correctLabs[0];
      let closestWrong: number[] = wrongLabs[0];
      for (const cLab of correctLabs) {
        for (const wLab of wrongLabs) {
          const d = deltaE2000(cLab, wLab);
          if (d < minDE) {
            minDE = d;
            closestCorrect = cLab;
            closestWrong = wLab;
          }
        }
      }

      // Suggest a color 70% toward the wrong palette from the correct palette boundary
      // This fills the gap where misclassifications happen
      const suggestedLab: [number, number, number] = [
        closestCorrect[0] + (closestWrong[0] - closestCorrect[0]) * 0.3,
        closestCorrect[1] + (closestWrong[1] - closestCorrect[1]) * 0.3,
        closestCorrect[2] + (closestWrong[2] - closestCorrect[2]) * 0.3,
      ];

      // Convert back to RGB (approximate — LAB→RGB is lossy but close enough for palette)
      const suggestedRgb = labToRgbApprox(suggestedLab);
      const key = `${correctCategory}-${suggestedRgb.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Verify this color is actually far from existing correct palette entries
      let minDistToExisting = Infinity;
      for (const lab of correctLabs) {
        const d = deltaE2000(suggestedLab, lab);
        if (d < minDistToExisting) minDistToExisting = d;
      }

      if (minDistToExisting > 8) { // Only suggest if it's meaningfully different from existing
        suggestions.push({
          targetCategory: correctCategory,
          rgb: suggestedRgb,
          reason: `${count} images classified as "${wrongCategory}" should be "${correctCategory}" (palette gap dE=${minDE.toFixed(1)})`,
          closestExisting: { category: wrongCategory, deltaE: Math.round(minDE * 10) / 10 },
          confidence: count >= 4 ? 'high' : 'medium',
        });
      }
    }
  }

  return suggestions;
}

/**
 * Push palette additions to the worker's learned-rules.
 * The worker stores these as `palette_additions` in learned-rules.json.
 */
export async function pushPaletteToWorker(
  suggestions: PaletteSuggestion[],
  workerPort: number = 3001,
): Promise<{ ok: boolean; saved?: number; error?: string }> {
  if (suggestions.length === 0) return { ok: true, saved: 0 };

  // Format as { category: [[r,g,b], ...] }
  const additions: Record<string, number[][]> = {};
  for (const s of suggestions) {
    if (!additions[s.targetCategory]) additions[s.targetCategory] = [];
    additions[s.targetCategory].push(s.rgb);
  }

  try {
    const res = await fetch(`http://localhost:${workerPort}/api/learned-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ palette_additions: additions }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Approximate LAB → RGB conversion ──
function labToRgbApprox(lab: [number, number, number]): [number, number, number] {
  const [L, a, b] = lab;
  // LAB → XYZ
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const invF = (t: number) => t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787;
  const x = 95.047 * invF(fx);
  const y = 100.0 * invF(fy);
  const z = 108.883 * invF(fz);
  // XYZ → linear RGB
  let r = x * 0.032406 + y * -0.015372 + z * -0.004986;
  let g = x * -0.009689 + y * 0.018758 + z * 0.000415;
  let bb = x * 0.000557 + y * -0.002040 + z * 0.010570;
  // Linear → sRGB
  const gamma = (v: number) => v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
  return [
    Math.max(0, Math.min(255, Math.round(gamma(r) * 255))),
    Math.max(0, Math.min(255, Math.round(gamma(g) * 255))),
    Math.max(0, Math.min(255, Math.round(gamma(bb) * 255))),
  ];
}
