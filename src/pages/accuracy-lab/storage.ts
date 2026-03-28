import type { FullClassificationRules, GroundTruth, ReviewSession, LearningSession } from './types';
import { DEFAULT_RULES } from './constants';

const LS_SESSIONS = 'autohue_accuracy_sessions';
const LS_RULES = 'autohue_full_rules';
const LS_GROUND_TRUTH = 'autohue_ground_truth';
const LS_LEARNING = 'autohue_learning_sessions';

function safeLoad<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function safeSave(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Review Sessions ──
export function loadSessions(): ReviewSession[] { return safeLoad(LS_SESSIONS, []); }
export function saveSessions(s: ReviewSession[]) { safeSave(LS_SESSIONS, s); }

// ── Full Rules ──
export function loadRules(): FullClassificationRules {
  return { ...DEFAULT_RULES, ...safeLoad(LS_RULES, {}) };
}
export function saveRules(r: FullClassificationRules) { safeSave(LS_RULES, r); }

// ── Ground Truth ──
export function loadGroundTruth(): GroundTruth[] { return safeLoad(LS_GROUND_TRUTH, []); }
export function saveGroundTruth(gt: GroundTruth[]) { safeSave(LS_GROUND_TRUTH, gt); }

// ── Learning Sessions ──
export function loadLearningSessions(): LearningSession[] { return safeLoad(LS_LEARNING, []); }
export function saveLearningSessions(ls: LearningSession[]) { safeSave(LS_LEARNING, ls); }
