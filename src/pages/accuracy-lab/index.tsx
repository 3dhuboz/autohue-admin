import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Phase, ReviewImage, ReviewSession, LearningSession, LearningPass,
  LearningSpeed, FullClassificationRules, AgentThought,
} from './types';
import { SPEED_MS } from './types';
import { loadRules, saveRules, loadSessions, saveSessions, loadGroundTruth, saveGroundTruth } from './storage';
import { analyzeConfusion, computeAdjustments, applyAdjustments, calculateIntelligenceScore, hasConverged, monitorHealth } from './tuning-engine';
import { autoEvaluateImages, reSortImages } from './auto-evaluator';
import UploadPhase from './UploadPhase';
import ReviewPhase from './ReviewPhase';
import ResultsPhase from './ResultsPhase';
import LearningDashboard from './LearningDashboard';
import TestSort from './TestSort';

export default function AccuracyLabPage() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [uploadTab, setUploadTab] = useState<'learn' | 'test'>('learn');
  const [images, setImages] = useState<ReviewImage[]>([]);
  const [zipName, setZipName] = useState('');
  const [rules, setRules] = useState<FullClassificationRules>(loadRules);
  const [sessions, setSessions] = useState<ReviewSession[]>(loadSessions);
  const [autoEvalProgress, setAutoEvalProgress] = useState({ done: 0, total: 0, running: false, method: '' });
  const [learningSession, setLearningSession] = useState<LearningSession | null>(null);
  const [speed, setSpeed] = useState<LearningSpeed>('normal');
  const learningRef = useRef<{ running: boolean }>({ running: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep images + session in refs so the async learning loop always has latest
  const imagesRef = useRef<ReviewImage[]>([]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  const sessionRef = useRef<LearningSession | null>(null);
  useEffect(() => { sessionRef.current = learningSession; }, [learningSession]);

  useEffect(() => { saveRules(rules); }, [rules]);

  // ══════════════════════════════════════════════════════════
  // UPLOAD → Auto-Evaluate → Results (autonomous, no human)
  // ══════════════════════════════════════════════════════════

  const handleImagesLoaded = useCallback(async (loadedImages: ReviewImage[], name: string) => {
    setImages(loadedImages);
    setZipName(name);
    setAutoEvalProgress({ done: 0, total: loadedImages.length, running: true, method: 'Connecting...' });
    setPhase('review');

    const { groundTruth, accuracy, results, method: evalMethod } = await autoEvaluateImages(
      loadedImages, rules,
      (done, total, method) => setAutoEvalProgress({ done, total, running: true, method }),
    );

    const autoReviewedImages = loadedImages.map(img => {
      const result = results.find(r => r.image.id === img.id);
      if (!result) return img;
      return { ...img, verdict: result.agree ? 'correct' as const : 'incorrect' as const, correctColor: result.agree ? undefined : result.autoColor };
    });
    setImages(autoReviewedImages);

    // Save initial ground truth
    const existingGt = loadGroundTruth();
    saveGroundTruth([...existingGt, ...groundTruth]);

    // Save session
    const confMap: Record<string, Record<string, number>> = {};
    for (const gt of groundTruth) {
      if (gt.assigned !== gt.correct) {
        if (!confMap[gt.assigned]) confMap[gt.assigned] = {};
        confMap[gt.assigned][gt.correct] = (confMap[gt.assigned][gt.correct] || 0) + 1;
      }
    }
    const confPairs = Object.entries(confMap).flatMap(([from, targets]) =>
      Object.entries(targets).map(([to, count]) => ({ from, to, count }))
    ).sort((a, b) => b.count - a.count);

    const session: ReviewSession = {
      id: `session_${Date.now()}`, date: new Date().toISOString(), zipName: name,
      totalImages: loadedImages.length, reviewed: loadedImages.length, accuracy, confusionPairs: confPairs,
    };
    const updated = [session, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    setAutoEvalProgress({ done: loadedImages.length, total: loadedImages.length, running: false, method: evalMethod === 'worker' ? 'Full AI Pipeline' : 'Browser Analysis' });

    // ── AUTO-START: Skip results, go straight into learning loop ──
    if (accuracy < 95) {
      const learnSession: LearningSession = {
        id: `learn_${Date.now()}`, status: 'running', currentPass: 0,
        targetAccuracy: 95, maxPasses: 50, passes: [],
        initialRules: JSON.parse(JSON.stringify(rules)),
        currentRules: JSON.parse(JSON.stringify(rules)),
      };
      setLearningSession(learnSession);
      sessionRef.current = learnSession;
      setPhase('learning');
      learningRef.current.running = true;
      timerRef.current = setTimeout(() => runPassRef.current(), 500);
    } else {
      setPhase('results');
    }
  }, [rules, sessions]);

  // ── Manual finalize (fallback if user goes through manual review) ──
  const handleFinalize = useCallback(() => {
    const reviewed = images.filter(i => i.verdict);
    const correct = reviewed.filter(i => i.verdict === 'correct');
    const accuracy = reviewed.length > 0 ? (correct.length / reviewed.length) * 100 : 0;
    const confMap: Record<string, Record<string, number>> = {};
    for (const img of reviewed) {
      if (img.verdict === 'incorrect' && img.correctColor) {
        if (!confMap[img.assignedColor]) confMap[img.assignedColor] = {};
        confMap[img.assignedColor][img.correctColor] = (confMap[img.assignedColor][img.correctColor] || 0) + 1;
      }
    }
    const confPairs = Object.entries(confMap).flatMap(([from, targets]) =>
      Object.entries(targets).map(([to, count]) => ({ from, to, count }))
    ).sort((a, b) => b.count - a.count);

    const gt = loadGroundTruth();
    const date = new Date().toISOString();
    for (const img of reviewed) {
      if (img.verdict === 'incorrect' && img.correctColor) gt.push({ assigned: img.assignedColor, correct: img.correctColor, filename: img.filename, date });
      else if (img.verdict === 'correct') gt.push({ assigned: img.assignedColor, correct: img.assignedColor, filename: img.filename, date });
    }
    saveGroundTruth(gt);

    const session: ReviewSession = {
      id: `session_${Date.now()}`, date: new Date().toISOString(), zipName,
      totalImages: images.length, reviewed: reviewed.length, accuracy, confusionPairs: confPairs,
    };
    setSessions(prev => { const u = [session, ...prev]; saveSessions(u); return u; });
    setPhase('results');
  }, [images, zipName]);

  const handleReset = useCallback(() => {
    for (const img of images) URL.revokeObjectURL(img.blobUrl);
    setImages([]); setZipName(''); setPhase('upload');
    setLearningSession(null);
    learningRef.current.running = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, [images]);

  // ══════════════════════════════════════════════════════════
  // RECURSIVE SELF-IMPROVEMENT LOOP
  //
  // Each pass is a full cycle:
  //   1. RE-CLASSIFY all images with CURRENT rules (the "sort")
  //   2. COMPARE to folder assignments (the "skeptic check")
  //   3. ANALYZE errors → compute parameter adjustments (the "learn")
  //   4. APPLY adjustments → new rules (the "refine")
  //   5. Output becomes input → next pass re-classifies with new rules
  //
  // The agent is its own skeptic — it sorts, then questions its own
  // results, finds where it was wrong, and fixes itself.
  // ══════════════════════════════════════════════════════════

  const runLearningPass = useCallback(async () => {
    if (!learningRef.current.running) return;

    // Read from ref to avoid stale closure
    const prev = sessionRef.current;
    if (!prev || prev.status !== 'running') return;

    const currentImages = imagesRef.current;
    if (currentImages.length < 3) {
      setLearningSession(s => s ? { ...s, status: 'stopped' } : null);
      learningRef.current.running = false;
      return;
    }

    const passNumber = prev.currentPass + 1;
    const rulesBefore = JSON.parse(JSON.stringify(prev.currentRules));

    // ── SELF-MONITORING: Check health before proceeding ──
    const health = monitorHealth(prev.passes, prev.initialRules);
    const frozenParams = new Set(health.oscillating);

    // ── GUARDRAIL: Auto-revert on 3+ consecutive regressions ──
    if (health.regressionCount >= 3 && prev.passes.length > 0) {
      const bestPass = prev.passes.reduce((best, p) => p.accuracy > best.accuracy ? p : best, prev.passes[0]);
      learningRef.current.running = false;
      const revertSession: LearningSession = {
        ...prev, status: 'stopped',
        currentRules: JSON.parse(JSON.stringify(bestPass.rulesAfter)),
        passes: [...prev.passes, {
          passNumber, timestamp: new Date().toISOString(), rulesBefore, rulesAfter: bestPass.rulesAfter,
          accuracy: bestPass.accuracy, previousAccuracy: prev.passes[prev.passes.length - 1]?.accuracy || 0, deltaAccuracy: 0,
          adjustments: [{ parameter: 'AUTO_REVERT', oldValue: 0, newValue: bestPass.accuracy,
            reason: `Auto-reverted to Pass #${bestPass.passNumber} (${bestPass.accuracy.toFixed(1)}%) after ${health.regressionCount} regressions`, impact: 'positive' }],
          perColorAccuracy: bestPass.perColorAccuracy, intelligenceScore: bestPass.intelligenceScore, confusionSnapshot: bestPass.confusionSnapshot,
          agentLog: [
            { type: 'guardrail' as const, message: `Detected ${health.regressionCount} consecutive accuracy regressions` },
            { type: 'action' as const, message: `Auto-reverting to Pass #${bestPass.passNumber} which had best accuracy (${bestPass.accuracy.toFixed(1)}%)` },
            { type: 'result' as const, message: `Rules restored. Learning stopped to prevent further degradation.` },
          ],
        }],
      };
      sessionRef.current = revertSession;
      setLearningSession(revertSession);
      return;
    }

    // ── Agent reasoning log for this pass ──
    const agentLog: AgentThought[] = [];

    // ══ STEP 1: RE-SORT all images through the worker with CURRENT rules ══
    agentLog.push({ type: 'observation', message: `Re-sorting ${currentImages.length} images through worker pipeline (dE_high=${prev.currentRules.deltaE_high}, dE_med=${prev.currentRules.deltaE_medium})` });

    const { results: reSortResults, changedCount, workerOnline } = await reSortImages(currentImages);

    if (!workerOnline) {
      agentLog.push({ type: 'diagnosis', message: 'Worker offline — cannot re-sort. Start worker on port 3001.' });
      learningRef.current.running = false;
      setLearningSession(s => s ? { ...s, status: 'stopped' } : null);
      return;
    }

    // Update image assignments with new worker classifications
    if (changedCount > 0) {
      const updatedImages = currentImages.map(img => {
        const rs = reSortResults.find(r => r.imageId === img.id);
        if (rs && rs.changed) return { ...img, assignedColor: rs.newColor };
        return img;
      });
      setImages(updatedImages);
      imagesRef.current = updatedImages;
      agentLog.push({ type: 'action', message: `Re-sorted: ${changedCount}/${currentImages.length} images changed color (new rules produced different classifications)` });

      // Log the changes
      const changeCounts: Record<string, number> = {};
      for (const rs of reSortResults.filter(r => r.changed)) {
        const key = `${rs.oldColor}→${rs.newColor}`;
        changeCounts[key] = (changeCounts[key] || 0) + 1;
      }
      for (const [pair, count] of Object.entries(changeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        agentLog.push({ type: 'observation', message: `  ${pair}: ${count} image${count > 1 ? 's' : ''} re-classified` });
      }
    } else {
      agentLog.push({ type: 'observation', message: `No images changed color this pass — classifications are stable` });
    }

    // ══ STEP 2: DUAL-SKEPTIC CRITIQUE of the new sort ══
    // Use the UPDATED images (with new assignedColor from re-sort)
    const evalImages = changedCount > 0 ? imagesRef.current : currentImages;
    agentLog.push({ type: 'observation', message: `Running dual-skeptic critique (worker + browser cross-check)...` });

    const { groundTruth: freshGt, accuracy: freshAccuracy, results: freshResults, avgConfidence, highConfRate } = await autoEvaluateImages(
      evalImages, prev.currentRules
    );

    const agrees = freshResults.filter(r => r.agree).length;
    const disagrees = freshResults.filter(r => !r.agree).length;
    const dualAgrees = freshResults.filter(r => r.dualAgree).length;
    const highConf = freshResults.filter(r => r.confidence === 'high').length;
    agentLog.push({ type: 'observation', message: `Skeptic verdict: ${agrees}/${freshResults.length} correct (${freshAccuracy.toFixed(1)}%) | ${dualAgrees} dual-agree | ${highConf} high-confidence` });

    // Compare to previous pass
    if (prev.passes.length > 0) {
      const prevAcc = prev.passes[prev.passes.length - 1].accuracy;
      const delta = freshAccuracy - prevAcc;
      if (delta > 0.5) {
        agentLog.push({ type: 'result', message: `Improved +${delta.toFixed(1)}% (${prevAcc.toFixed(1)}% → ${freshAccuracy.toFixed(1)}%)` });
      } else if (delta < -0.5) {
        agentLog.push({ type: 'diagnosis', message: `Regressed ${delta.toFixed(1)}% (${prevAcc.toFixed(1)}% → ${freshAccuracy.toFixed(1)}%)` });
      } else {
        agentLog.push({ type: 'observation', message: `Stable at ${freshAccuracy.toFixed(1)}%` });
      }
    } else {
      agentLog.push({ type: 'result', message: `Baseline accuracy: ${freshAccuracy.toFixed(1)}% — starting optimization` });
    }

    // Log disagreements
    const disagreements = freshResults.filter(r => !r.agree);
    const confCounts: Record<string, number> = {};
    for (const d of disagreements) {
      const key = `${d.image.assignedColor}→${d.autoColor}`;
      confCounts[key] = (confCounts[key] || 0) + 1;
    }
    for (const [pair, count] of Object.entries(confCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      agentLog.push({ type: 'diagnosis', message: `${pair}: ${count} image${count > 1 ? 's' : ''} — skeptic disagrees` });
    }
    for (const d of disagreements.slice(0, 3)) {
      agentLog.push({ type: 'diagnosis', message: `  ${d.image.filename}: assigned="${d.image.assignedColor}" skeptic="${d.autoColor}" (${d.detail})` });
    }

    // ══ STEP 3: ANALYZE errors → compute what to fix ══
    agentLog.push({ type: 'observation', message: `Analyzing ${Object.keys(confCounts).length} confusion patterns to find parameter fixes` });
    const adjustments = computeAdjustments(prev.currentRules, freshGt);

    for (const warning of health.warnings) {
      adjustments.push({ parameter: 'MONITOR', oldValue: 0, newValue: 0, reason: `[SELF-CHECK] ${warning}`, impact: 'neutral' });
      agentLog.push({ type: 'guardrail', message: warning });
    }

    // Log each adjustment as an action
    const realAdj = adjustments.filter(a => !['palette_quality', 'MONITOR', 'GUARDRAIL', 'AUTO_REVERT', 'CONVERGED'].includes(a.parameter));
    if (realAdj.length > 0) {
      for (const adj of realAdj) {
        agentLog.push({ type: 'action', message: `${adj.parameter}: ${adj.oldValue} → ${adj.newValue} (${adj.reason})` });
      }
    } else {
      agentLog.push({ type: 'observation', message: 'No parameter changes needed this pass — rules are stable for current error patterns' });
    }

    // ══ STEP 4: APPLY adjustments → produce refined rules ══
    const hasRealAdj = realAdj.length > 0;
    const rulesAfter = hasRealAdj
      ? applyAdjustments(prev.currentRules, adjustments, frozenParams)
      : JSON.parse(JSON.stringify(prev.currentRules));

    // ══ STEP 4b: PUSH RULES TO WORKER — so next pass uses updated pipeline ══
    if (hasRealAdj) {
      try {
        const flatRules: Record<string, number> = {
          deltaE_high: rulesAfter.deltaE_high, deltaE_medium: rulesAfter.deltaE_medium, deltaE_low: rulesAfter.deltaE_low,
          achromatic_penalty: rulesAfter.achromatic_penalty, achromatic_chroma_gate: rulesAfter.achromatic_chroma_gate,
          shadow_chroma: rulesAfter.shadow_chroma, shadow_lightness: rulesAfter.shadow_lightness,
          env_smoke_chroma: rulesAfter.env_smoke_chroma, env_road_chroma: rulesAfter.env_road_chroma,
          boost_agreement_min: rulesAfter.boost_agreement_min, boost_coverage_min: rulesAfter.boost_coverage_min,
          boost_low_chroma_min: rulesAfter.boost_low_chroma_min, boost_low_dE_max: rulesAfter.boost_low_dE_max,
          merge_deltaE: rulesAfter.merge_deltaE, min_viable_floor: rulesAfter.min_viable_floor,
          env_remnant_penalty: rulesAfter.env_remnant_penalty,
          strong_chroma_threshold: rulesAfter.strong_chroma_threshold,
          strong_chroma_min_pct: rulesAfter.strong_chroma_min_pct,
          strong_chroma_max_dE: rulesAfter.strong_chroma_max_dE,
        };
        for (const tier of rulesAfter.chroma_tiers) flatRules[`chroma_tier_${tier.threshold}`] = tier.multiplier;
        await fetch('http://localhost:3001/api/learned-rules', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flatRules),
        });
        agentLog.push({ type: 'action', message: `Pushed ${Object.keys(flatRules).length} updated rules to worker — next pass will use new pipeline` });
      } catch {
        agentLog.push({ type: 'observation', message: 'Worker offline — rules applied locally only (browser evaluation)' });
      }
    }

    // Build confusion matrix
    const confMatrix: Record<string, Record<string, number>> = {};
    for (const gt of freshGt) {
      if (gt.assigned !== gt.correct) {
        if (!confMatrix[gt.assigned]) confMatrix[gt.assigned] = {};
        confMatrix[gt.assigned][gt.correct] = (confMatrix[gt.assigned][gt.correct] || 0) + 1;
      }
    }

    // Per-color accuracy
    const perColorAccuracy: Record<string, { correct: number; total: number }> = {};
    const colorTotals: Record<string, number> = {};
    const colorCorrect: Record<string, number> = {};
    for (const gt of freshGt) {
      colorTotals[gt.assigned] = (colorTotals[gt.assigned] || 0) + 1;
      if (gt.assigned === gt.correct) colorCorrect[gt.assigned] = (colorCorrect[gt.assigned] || 0) + 1;
    }
    for (const cat of Object.keys(colorTotals)) {
      perColorAccuracy[cat] = { correct: colorCorrect[cat] || 0, total: colorTotals[cat] };
    }

    const previousAccuracy = prev.passes.length > 0 ? prev.passes[prev.passes.length - 1].accuracy : freshAccuracy;
    const delta = freshAccuracy - previousAccuracy;
    if (prev.passes.length > 0) {
      agentLog.push({ type: 'result', message: delta > 0 ? `Accuracy improved by ${delta.toFixed(1)}% (${previousAccuracy.toFixed(1)}% → ${freshAccuracy.toFixed(1)}%)` : delta < 0 ? `Accuracy dropped by ${Math.abs(delta).toFixed(1)}% (${previousAccuracy.toFixed(1)}% → ${freshAccuracy.toFixed(1)}%) — may need to revert` : `Accuracy unchanged at ${freshAccuracy.toFixed(1)}%` });
    } else {
      agentLog.push({ type: 'result', message: `Baseline accuracy: ${freshAccuracy.toFixed(1)}% — this is the starting point for optimization` });
    }

    const pass: LearningPass = {
      passNumber, timestamp: new Date().toISOString(), rulesBefore, rulesAfter,
      accuracy: freshAccuracy, previousAccuracy, deltaAccuracy: delta,
      adjustments, perColorAccuracy,
      intelligenceScore: calculateIntelligenceScore(freshAccuracy, [...prev.passes], freshGt.length),
      confusionSnapshot: confMatrix,
      agentLog,
    };

    const newPasses = [...prev.passes, pass];

    // ── STOPPING CONDITIONS ──
    const targetReached = freshAccuracy >= prev.targetAccuracy;
    const maxReached = passNumber >= prev.maxPasses;
    const converged = hasConverged(newPasses);
    const tooMuchDrift = health.totalDrift > 300;

    let newStatus: LearningSession['status'] = prev.status;
    if (targetReached || maxReached || converged || tooMuchDrift) {
      newStatus = targetReached ? 'completed' : 'stopped';
      learningRef.current.running = false;
      if (tooMuchDrift) { pass.adjustments.push({ parameter: 'GUARDRAIL', oldValue: 0, newValue: health.totalDrift, reason: `[SAFETY STOP] Drift ${health.totalDrift.toFixed(0)}% exceeds 300%`, impact: 'negative' }); agentLog.push({ type: 'guardrail', message: `SAFETY STOP: Total drift ${health.totalDrift.toFixed(0)}% exceeds 300% limit` }); }
      if (converged) { pass.adjustments.push({ parameter: 'CONVERGED', oldValue: 0, newValue: freshAccuracy, reason: `[CONVERGED] Stable at ${freshAccuracy.toFixed(1)}%`, impact: 'neutral' }); agentLog.push({ type: 'result', message: `CONVERGED: Stable at ${freshAccuracy.toFixed(1)}% for 3 passes. Feed more images to continue improving.` }); }
      if (targetReached) { agentLog.push({ type: 'result', message: `TARGET REACHED: ${freshAccuracy.toFixed(1)}% exceeds ${prev.targetAccuracy}% goal!` }); }
    }

    // ══ STEP 5: OUTPUT BECOMES INPUT — update state for next pass ══
    // The refined rules are now the "current rules" for the next cycle
    const updatedSession: LearningSession = {
      ...prev, status: newStatus, currentPass: passNumber, currentRules: rulesAfter, passes: newPasses,
    };

    // Update BOTH state and ref immediately so next pass reads fresh data
    sessionRef.current = updatedSession;
    setLearningSession(updatedSession);

    // Persist ground truth
    saveGroundTruth(freshGt);

    // Schedule next pass — the loop feeds its own output back as input
    if (newStatus === 'running') {
      timerRef.current = setTimeout(() => runPassRef.current(), SPEED_MS[speed]);
    }
  }, [speed]);

  // Keep the callback fresh when session/speed changes
  const runPassRef = useRef(runLearningPass);
  useEffect(() => { runPassRef.current = runLearningPass; }, [runLearningPass]);

  const scheduleNextPass = useCallback(() => {
    timerRef.current = setTimeout(() => runPassRef.current(), SPEED_MS[speed]);
  }, [speed]);

  const handleStartLearning = useCallback(() => {
    const gt = loadGroundTruth();
    if (gt.length < 3 && images.length < 3) {
      alert('Upload a sorted ZIP first. The agent will auto-evaluate and start learning.');
      return;
    }

    const session: LearningSession = {
      id: `learn_${Date.now()}`, status: 'running', currentPass: 0,
      targetAccuracy: 95, maxPasses: 50, passes: [],
      initialRules: JSON.parse(JSON.stringify(rules)),
      currentRules: JSON.parse(JSON.stringify(rules)),
    };

    setLearningSession(session);
    setPhase('learning');
    learningRef.current.running = true;
    // First pass starts after brief delay for UI render
    timerRef.current = setTimeout(() => runPassRef.current(), 500);
  }, [rules]);

  const handlePause = useCallback(() => {
    learningRef.current.running = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    setLearningSession(prev => prev ? { ...prev, status: 'paused' } : null);
  }, []);

  const handleResume = useCallback(() => {
    learningRef.current.running = true;
    setLearningSession(prev => prev ? { ...prev, status: 'running' } : null);
    timerRef.current = setTimeout(() => runPassRef.current(), SPEED_MS[speed]);
  }, [speed]);

  const handleStop = useCallback(() => {
    learningRef.current.running = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    setLearningSession(prev => prev ? { ...prev, status: 'stopped' } : null);
  }, []);

  const handleRevert = useCallback((passNumber: number) => {
    setLearningSession(prev => {
      if (!prev) return null;
      const targetPass = prev.passes.find(p => p.passNumber === passNumber);
      if (!targetPass) return prev;
      return { ...prev, currentPass: passNumber, currentRules: JSON.parse(JSON.stringify(targetPass.rulesAfter)),
        passes: prev.passes.filter(p => p.passNumber <= passNumber), status: 'paused' };
    });
    learningRef.current.running = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleExport = useCallback(() => {}, []);

  useEffect(() => {
    return () => { learningRef.current.running = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // ── Render ──
  return (
    <>
      {phase === 'upload' && (
        <div className="space-y-6">
          {/* Tab switcher: Learn vs Test */}
          <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg w-fit">
            <button
              onClick={() => setUploadTab('learn')}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                uploadTab === 'learn' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-white/40 hover:text-white/60'
              }`}
            >
              Learn (ZIP)
            </button>
            <button
              onClick={() => setUploadTab('test')}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                uploadTab === 'test' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-white/40 hover:text-white/60'
              }`}
            >
              Test Sort
            </button>
          </div>
          {uploadTab === 'learn' ? (
            <UploadPhase rules={rules} setRules={setRules} sessions={sessions} onImagesLoaded={handleImagesLoaded} />
          ) : (
            <TestSort />
          )}
        </div>
      )}
      {phase === 'review' && autoEvalProgress.running && (
        <div className="space-y-6">
          <h1 className="text-2xl font-heading font-bold">Auto-Evaluating <span className="text-racing-500">Images</span></h1>
          <p className="text-xs text-white/30">
            {autoEvalProgress.method === 'Full AI Pipeline'
              ? 'Using full worker AI pipeline — ONNX detection + SegFormer segmentation + LAB scoring'
              : autoEvalProgress.method === 'Browser Analysis'
                ? 'Worker offline — using browser-side pixel analysis (less accurate)'
                : 'Connecting to worker pipeline...'
            }
          </p>
          <div className="glass-card p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${autoEvalProgress.method === 'Full AI Pipeline' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-sm text-white/60">{autoEvalProgress.method || 'Connecting...'}</span>
              </div>
              <span className="text-sm font-mono text-racing-400">{autoEvalProgress.done}/{autoEvalProgress.total}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-racing-500 transition-all duration-300"
                style={{ width: `${autoEvalProgress.total > 0 ? (autoEvalProgress.done / autoEvalProgress.total) * 100 : 0}%` }} />
            </div>
            {autoEvalProgress.method === 'Full AI Pipeline' ? (
              <div className="text-[10px] text-white/20 space-y-1">
                <p>Each image goes through the complete AI pipeline:</p>
                <p>1. SSD-MobileNet (ONNX) — detect and crop the vehicle</p>
                <p>2. SegFormer — segment car body from background</p>
                <p>3. Environment filtering — remove smoke, grass, sky, road, barriers</p>
                <p>4. Median-cut quantization → CIE LAB deltaE 2000 color matching</p>
                <p>5. Compare classification to folder assignment → disagreement = error signal</p>
              </div>
            ) : (
              <div className="text-[10px] text-yellow-400/40 space-y-1">
                <p>Start the AutoHue worker (port 3001) for full AI pipeline accuracy.</p>
                <p>Browser fallback uses center-crop + pixel quantization only.</p>
              </div>
            )}
          </div>
        </div>
      )}
      {phase === 'review' && !autoEvalProgress.running && (
        <ReviewPhase images={images} setImages={setImages} zipName={zipName} onFinalize={handleFinalize} onReset={handleReset} />
      )}
      {phase === 'results' && (
        <ResultsPhase images={images} zipName={zipName} rules={rules} sessions={sessions} onReset={handleReset} onStartLearning={handleStartLearning} />
      )}
      {phase === 'learning' && learningSession && (
        <LearningDashboard session={learningSession} onPause={handlePause} onResume={handleResume}
          onStop={handleStop} onRevert={handleRevert} onExport={handleExport} speed={speed} setSpeed={setSpeed} />
      )}
    </>
  );
}
