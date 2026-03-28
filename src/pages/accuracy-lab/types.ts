// ── AutoHue canonical color categories ──
export const COLOR_CATEGORIES = [
  'red', 'blue', 'green', 'yellow', 'gold', 'orange', 'purple',
  'pink', 'brown', 'black', 'white', 'silver-grey',
] as const;
export type ColorCategory = (typeof COLOR_CATEGORIES)[number];

// Visual swatches for each category
export const COLOR_SWATCHES: Record<string, string> = {
  red: '#dc2626', blue: '#2563eb', green: '#16a34a', yellow: '#eab308',
  gold: '#d4a017', orange: '#ea580c', purple: '#9333ea', pink: '#ec4899',
  brown: '#92400e', black: '#1c1917', white: '#f5f5f4', 'silver-grey': '#9ca3af',
};

// Tailwind badge colors
export const COLOR_BADGES: Record<string, string> = {
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  gold: 'bg-yellow-600/20 text-yellow-300 border-yellow-600/30',
  orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  brown: 'bg-amber-700/20 text-amber-500 border-amber-700/30',
  black: 'bg-stone-800/40 text-stone-300 border-stone-600/30',
  white: 'bg-white/15 text-white border-white/30',
  'silver-grey': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// ── Full classification rules (mirrors all server.js tunables) ──
export interface FullClassificationRules {
  // DeltaE confidence thresholds
  deltaE_high: number;
  deltaE_medium: number;
  deltaE_low: number;

  // Chroma scoring tiers
  chroma_tiers: { threshold: number; multiplier: number }[];

  // Palette match quality tiers
  palette_tiers: { maxDeltaE: number; multiplier: number }[];

  // Strong chromatic detection
  strong_chroma_threshold: number;
  strong_chroma_min_pct: number;
  strong_chroma_max_dE: number;

  // Achromatic penalty
  achromatic_penalty: number;
  achromatic_chroma_gate: number;

  // Shadow gate
  shadow_chroma: number;
  shadow_lightness: number;

  // Environment detection
  env_smoke_chroma: number;
  env_road_chroma: number;
  env_road_L_range: [number, number];

  // Confidence boosts
  boost_agreement_min: number;
  boost_coverage_min: number;
  boost_low_chroma_min: number;
  boost_low_dE_max: number;

  // Median-cut merge
  merge_deltaE: number;

  // Minimum viable cluster floor
  min_viable_floor: number;

  // Environment remnant penalty
  env_remnant_penalty: number;
}

// ── Image review item ──
export interface ReviewImage {
  id: string;
  filename: string;
  assignedColor: string;
  blobUrl: string;
  verdict?: 'correct' | 'incorrect';
  correctColor?: string;
}

// ── Ground truth entry ──
export interface GroundTruth {
  assigned: string;
  correct: string;
  filename: string;
  date: string;
}

// ── Parameter adjustment from a learning pass ──
export interface ParameterAdjustment {
  parameter: string;
  oldValue: number;
  newValue: number;
  reason: string;
  impact: 'positive' | 'neutral' | 'negative';
}

// ── Agent reasoning log entry ──
export interface AgentThought {
  type: 'observation' | 'diagnosis' | 'action' | 'guardrail' | 'result';
  message: string;
}

// ── Single learning pass snapshot ──
export interface LearningPass {
  passNumber: number;
  timestamp: string;
  rulesBefore: FullClassificationRules;
  rulesAfter: FullClassificationRules;
  accuracy: number;
  previousAccuracy: number;
  deltaAccuracy: number;
  adjustments: ParameterAdjustment[];
  perColorAccuracy: Record<string, { correct: number; total: number }>;
  intelligenceScore: number;
  confusionSnapshot: Record<string, Record<string, number>>;
  agentLog: AgentThought[];     // The agent's reasoning trace for this pass
}

// ── Learning session (contains all passes) ──
export type LearningStatus = 'running' | 'paused' | 'stopped' | 'completed';

export interface LearningSession {
  id: string;
  status: LearningStatus;
  currentPass: number;
  targetAccuracy: number;
  maxPasses: number;
  passes: LearningPass[];
  initialRules: FullClassificationRules;
  currentRules: FullClassificationRules;
}

// ── Review session (persisted summary) ──
export interface ReviewSession {
  id: string;
  date: string;
  zipName: string;
  totalImages: number;
  reviewed: number;
  accuracy: number;
  confusionPairs: { from: string; to: string; count: number }[];
}

// ── Phase type ──
export type Phase = 'upload' | 'review' | 'results' | 'learning';

// ── Speed setting ──
export type LearningSpeed = 'slow' | 'normal' | 'fast';
export const SPEED_MS: Record<LearningSpeed, number> = { slow: 1200, normal: 500, fast: 100 };
