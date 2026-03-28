/**
 * Auto-Evaluator v3: Dual-Skeptic with RE-SORT capability.
 *
 * The core loop:
 *   1. SORT: Classify images through the worker pipeline
 *   2. CRITIQUE: Independent browser-side analysis cross-checks
 *   3. Where both agree → high confidence that's the real color
 *   4. Where they disagree → error signal for the learning engine
 *   5. After rule adjustments → RE-SORT through worker → repeat
 *
 * Key change from v2: Images are RE-CLASSIFIED each pass, not just
 * compared to static folder names. The folder name is the ORIGINAL
 * classification; each pass produces a NEW classification.
 */

import type { ReviewImage, GroundTruth, FullClassificationRules } from './types';
import { CAR_COLORS_LAB, rgbToLab, deltaE2000 } from './constants';

const WORKER_URL = 'http://localhost:3001';
const ACHROMATIC_CATS = new Set(['black', 'white', 'silver-grey']);

// ── Check if worker is available ──
async function checkWorker(): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Classify via worker's full AI pipeline ──
async function classifyViaWorker(blobUrl: string): Promise<{
  category: string; confidence: string; deltaE: number | null; chroma: number | null;
  method: string; aiDetected: boolean; segmented: boolean; detail: string;
} | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    const formData = new FormData();
    formData.append('image', blob, 'image.jpg');

    const res = await fetch(`${WORKER_URL}/api/classify`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) return null;
    const data = await res.json();

    const detail = [
      `method=${data.method}`,
      data.deltaE != null ? `dE=${data.deltaE}` : null,
      data.chroma != null ? `chroma=${Math.round(data.chroma)}` : null,
      data.aiDetected ? 'AI-detected' : null,
      data.segmented ? 'segmented' : null,
      data.regionsAgreeing ? `agree=${data.regionsAgreeing}/${data.totalRegions}` : null,
      data.nyckelLabel ? `nyckel=${data.nyckelLabel}(${data.nyckelConfidence}%)` : null,
    ].filter(Boolean).join(' ');

    return {
      category: data.category,
      confidence: data.confidence,
      deltaE: data.deltaE,
      chroma: data.chroma,
      method: data.method,
      aiDetected: data.aiDetected,
      segmented: data.segmented,
      detail,
    };
  } catch {
    return null;
  }
}

// ── Browser-side classification (independent cross-check) ──
async function classifyBrowserSide(
  blobUrl: string,
  rules: FullClassificationRules,
): Promise<{ category: string; confidence: string; deltaE: number; chroma: number; detail: string }> {
  const clusters = await extractDominantColors(blobUrl);

  if (clusters.length === 0) {
    return { category: 'unknown', confidence: 'none', deltaE: 99, chroma: 0, detail: 'no valid pixels' };
  }

  const hasStrongChromatic = clusters.some(c =>
    !ACHROMATIC_CATS.has(matchToCategory(c.lab)) &&
    c.chroma > rules.strong_chroma_threshold &&
    c.pct > rules.strong_chroma_min_pct
  );

  const scored = clusters.map(c => {
    const category = matchToCategory(c.lab);
    const dE = matchToDeltaE(c.lab);
    const isAchromatic = ACHROMATIC_CATS.has(category);
    let score = c.pct * 100;

    if (hasStrongChromatic && isAchromatic) {
      if (c.pct > 0.08) score *= 1.05;
    } else {
      if (c.pct > 0.08) score *= 1.2;
      if (c.pct > 0.18) score *= 1.3;
    }

    for (const tier of rules.palette_tiers) {
      if (dE < tier.maxDeltaE) { score *= tier.multiplier; break; }
    }
    for (const tier of rules.chroma_tiers) {
      if (c.chroma > tier.threshold) { score *= tier.multiplier; break; }
    }
    if (hasStrongChromatic && isAchromatic && c.chroma < rules.achromatic_chroma_gate) {
      score *= rules.achromatic_penalty;
    }

    return { category, score, deltaE: dE, chroma: c.chroma, pct: c.pct };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  let confidence: string;
  if (winner.deltaE < rules.deltaE_high) confidence = 'high';
  else if (winner.deltaE < rules.deltaE_medium) confidence = 'medium';
  else if (winner.deltaE < rules.deltaE_low) confidence = 'low';
  else confidence = 'very-low';

  return {
    category: winner.category,
    confidence,
    deltaE: winner.deltaE,
    chroma: winner.chroma,
    detail: `dE=${winner.deltaE.toFixed(1)} chroma=${winner.chroma.toFixed(0)} pct=${(winner.pct*100).toFixed(0)}% [browser]`,
  };
}

function matchToCategory(lab: number[]): string {
  let bestCat = 'unknown', bestDist = Infinity;
  for (const [cat, samples] of Object.entries(CAR_COLORS_LAB)) {
    for (const ref of samples) {
      const d = deltaE2000(lab, ref);
      if (d < bestDist) { bestDist = d; bestCat = cat; }
    }
  }
  return bestCat;
}

function matchToDeltaE(lab: number[]): number {
  let bestDist = Infinity;
  for (const samples of Object.values(CAR_COLORS_LAB)) {
    for (const ref of samples) {
      const d = deltaE2000(lab, ref);
      if (d < bestDist) bestDist = d;
    }
  }
  return bestDist;
}

async function extractDominantColors(blobUrl: string, maxPixels = 120): Promise<{ rgb: number[]; pct: number; lab: number[]; chroma: number }[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const cropX = Math.floor(img.width * 0.20), cropY = Math.floor(img.height * 0.15);
      const cropW = Math.floor(img.width * 0.60), cropH = Math.floor(img.height * 0.55);
      const scale = Math.min(1, maxPixels / Math.max(cropW, cropH));
      const w = Math.max(1, Math.floor(cropW * scale)), h = Math.max(1, Math.floor(cropH * scale));
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const totalPixels = w * h;
      const buckets: Record<string, { r: number; g: number; b: number; count: number }> = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        if ((r+g+b)/3 < 10 || (r+g+b)/3 > 248) continue;
        const key = `${Math.floor(r/16)*16},${Math.floor(g/16)*16},${Math.floor(b/16)*16}`;
        if (!buckets[key]) buckets[key] = { r:0, g:0, b:0, count:0 };
        buckets[key].r += r; buckets[key].g += g; buckets[key].b += b; buckets[key].count++;
      }
      const sorted = Object.values(buckets).filter(b => b.count >= 2).sort((a,b) => b.count - a.count).slice(0, 10);
      resolve(sorted.map(b => {
        const rgb = [Math.round(b.r/b.count), Math.round(b.g/b.count), Math.round(b.b/b.count)];
        const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
        return { rgb, pct: b.count/totalPixels, lab, chroma: Math.sqrt(lab[1]*lab[1]+lab[2]*lab[2]) };
      }));
    };
    img.onerror = () => resolve([]);
    img.src = blobUrl;
  });
}

// ══════════════════════════════════════════════════════════════
// AUTO-EVALUATE: Dual-skeptic evaluation
// ══════════════════════════════════════════════════════════════

export interface AutoEvalResult {
  image: ReviewImage;
  autoColor: string;
  workerColor?: string;
  browserColor?: string;
  confidence: string;
  deltaE: number | null;
  agree: boolean;
  detail: string;
  method: 'worker' | 'browser' | 'dual';
  dualAgree?: boolean;
}

/**
 * Evaluate all images using dual-skeptic approach.
 */
export async function autoEvaluateImages(
  images: ReviewImage[],
  rules: FullClassificationRules,
  onProgress?: (done: number, total: number, method: string) => void,
): Promise<{
  groundTruth: GroundTruth[];
  accuracy: number;
  results: AutoEvalResult[];
  method: 'worker' | 'browser' | 'dual';
  avgConfidence?: number;
  highConfRate?: number;
}> {
  const useWorker = await checkWorker();
  const results: AutoEvalResult[] = [];
  const groundTruth: GroundTruth[] = [];
  const date = new Date().toISOString();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    let workerColor: string | undefined;
    let workerConfidence = 'none';
    let workerDeltaE: number | null = null;
    let workerDetail = '';

    if (useWorker) {
      const wr = await classifyViaWorker(img.blobUrl);
      if (wr) {
        workerColor = wr.category;
        workerConfidence = wr.confidence;
        workerDeltaE = wr.deltaE;
        workerDetail = wr.detail;
      }
    }

    const br = await classifyBrowserSide(img.blobUrl, rules);
    const browserColor = br.category;

    const folderColor = img.assignedColor;
    const dualAgree = workerColor !== undefined && workerColor === browserColor;
    let trueColor: string;
    let confidence: string;
    let deltaE: number | null;
    let detail: string;

    if (dualAgree) {
      trueColor = workerColor!;
      confidence = workerConfidence;
      deltaE = workerDeltaE;
      detail = `DUAL-AGREE: worker=${workerColor} browser=${browserColor} | ${workerDetail}`;
    } else if (workerColor !== undefined) {
      if (workerColor === folderColor && browserColor !== folderColor) {
        trueColor = browserColor;
        confidence = 'low';
        deltaE = br.deltaE;
        detail = `BROWSER-DISSENT: worker=${workerColor} browser=${browserColor} | dE=${br.deltaE.toFixed(1)}`;
      } else if (browserColor === folderColor && workerColor !== folderColor) {
        trueColor = workerColor;
        confidence = workerConfidence;
        deltaE = workerDeltaE;
        detail = `WORKER-DISSENT: worker=${workerColor} browser=${browserColor} | ${workerDetail}`;
      } else {
        trueColor = workerColor;
        confidence = 'very-low';
        deltaE = workerDeltaE;
        detail = `SPLIT: worker=${workerColor} browser=${browserColor} folder=${folderColor} | ${workerDetail}`;
      }
    } else {
      trueColor = browserColor;
      confidence = br.confidence;
      deltaE = br.deltaE;
      detail = br.detail;
    }

    const agree = trueColor === folderColor;
    results.push({
      image: img, autoColor: trueColor, workerColor, browserColor,
      confidence, deltaE, agree, detail,
      method: workerColor !== undefined ? 'dual' : 'browser', dualAgree,
    });

    groundTruth.push({ assigned: folderColor, correct: trueColor, filename: img.filename, date });

    if (onProgress) {
      onProgress(i + 1, images.length, workerColor !== undefined ? 'Dual-Skeptic (Worker + Browser)' : 'Browser Analysis');
    }
  }

  const correct = results.filter(r => r.agree).length;
  const accuracy = results.length > 0 ? (correct / results.length) * 100 : 0;

  const confMap: Record<string, number> = { 'high': 1.0, 'medium': 0.75, 'low': 0.5, 'very-low': 0.25, 'none': 0 };
  const avgConfidence = results.length > 0
    ? (results.reduce((s, r) => s + (confMap[r.confidence] || 0), 0) / results.length) * 100
    : 0;
  const highConfRate = results.length > 0
    ? (results.filter(r => r.confidence === 'high').length / results.length) * 100
    : 0;

  return { groundTruth, accuracy, results, method: useWorker ? 'dual' : 'browser', avgConfidence, highConfRate };
}

// ══════════════════════════════════════════════════════════════
// RE-SORT: Re-classify all images through worker with new rules.
// Called AFTER rules are pushed. Returns new assignments.
// ══════════════════════════════════════════════════════════════

export interface ReSortResult {
  imageId: string;
  filename: string;
  oldColor: string;
  newColor: string;
  confidence: string;
  deltaE: number | null;
  changed: boolean;
  detail: string;
}

export async function reSortImages(
  images: ReviewImage[],
  onProgress?: (done: number, total: number) => void,
): Promise<{
  results: ReSortResult[];
  changedCount: number;
  workerOnline: boolean;
}> {
  const workerOnline = await checkWorker();
  if (!workerOnline) {
    return {
      results: images.map(img => ({
        imageId: img.id, filename: img.filename,
        oldColor: img.assignedColor, newColor: img.assignedColor,
        confidence: 'none', deltaE: null, changed: false,
        detail: 'Worker offline',
      })),
      changedCount: 0, workerOnline: false,
    };
  }

  const results: ReSortResult[] = [];
  let changedCount = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const wr = await classifyViaWorker(img.blobUrl);

    if (wr) {
      const changed = wr.category !== img.assignedColor;
      if (changed) changedCount++;
      results.push({
        imageId: img.id, filename: img.filename,
        oldColor: img.assignedColor, newColor: wr.category,
        confidence: wr.confidence, deltaE: wr.deltaE,
        changed, detail: wr.detail,
      });
    } else {
      results.push({
        imageId: img.id, filename: img.filename,
        oldColor: img.assignedColor, newColor: img.assignedColor,
        confidence: 'none', deltaE: null, changed: false,
        detail: 'Classification failed',
      });
    }

    if (onProgress) onProgress(i + 1, images.length);
  }

  return { results, changedCount, workerOnline };
}
