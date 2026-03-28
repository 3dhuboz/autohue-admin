import { useState, useMemo } from 'react';
import type { FullClassificationRules } from './types';
import { generateExportCode, getRulesDiff } from './tuning-engine';

interface ExportPanelProps {
  initialRules: FullClassificationRules;
  currentRules: FullClassificationRules;
  accuracy: number;
  passCount: number;
  groundTruthCount: number;
  onClose: () => void;
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) < 1) return v.toFixed(3);
  return v.toFixed(2);
}

export default function ExportPanel({
  initialRules,
  currentRules,
  accuracy,
  passCount,
  groundTruthCount,
  onClose,
}: ExportPanelProps) {
  const [copied, setCopied] = useState(false);

  const diff = useMemo(() => getRulesDiff(initialRules, currentRules), [initialRules, currentRules]);

  const exportCode = useMemo(
    () => generateExportCode(initialRules, currentRules, accuracy, passCount, groundTruthCount),
    [initialRules, currentRules, accuracy, passCount, groundTruthCount],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = exportCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto space-y-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-heading font-bold text-white/90">
              Export <span className="text-racing-500">Optimized Rules</span>
            </h2>
            <p className="text-[10px] text-white/30 mt-0.5">
              {accuracy.toFixed(1)}% accuracy after {passCount} passes \u2022 {groundTruthCount} ground truth images
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 flex items-center justify-center transition-all"
          >
            \u00d7
          </button>
        </div>

        {/* Diff Table */}
        {diff.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-xs font-heading font-bold text-white/60 uppercase tracking-wide">
              Changed Parameters ({diff.length})
            </h3>
            <div className="rounded-lg border border-white/[0.06] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="px-3 py-2 text-left text-[10px] text-white/30 uppercase font-normal">Parameter</th>
                    <th className="px-3 py-2 text-right text-[10px] text-white/30 uppercase font-normal">Original</th>
                    <th className="px-3 py-2 text-center text-[10px] text-white/30 uppercase font-normal" />
                    <th className="px-3 py-2 text-right text-[10px] text-white/30 uppercase font-normal">Optimized</th>
                    <th className="px-3 py-2 text-right text-[10px] text-white/30 uppercase font-normal">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map(d => {
                    const delta = d.current - d.initial;
                    return (
                      <tr key={d.param} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-mono text-white/60">{d.param}</td>
                        <td className="px-3 py-2 text-right font-mono text-white/30">{fmt(d.initial)}</td>
                        <td className="px-3 py-2 text-center">
                          <svg className="w-3 h-3 text-white/15 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-racing-400">{fmt(d.current)}</td>
                        <td className={`px-3 py-2 text-right font-mono text-[10px] ${
                          delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/20'
                        }`}>
                          {delta > 0 ? '+' : ''}{fmt(delta)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="glass-card p-6 text-center">
            <p className="text-xs text-white/40">No parameters were changed from defaults.</p>
          </div>
        )}

        {/* Code Preview */}
        <div className="space-y-2">
          <h3 className="text-xs font-heading font-bold text-white/60 uppercase tracking-wide">
            Server.js Code Snippet
          </h3>
          <div className="rounded-lg bg-black/40 border border-white/[0.06] p-4 overflow-x-auto">
            <pre className="text-[11px] font-mono text-white/50 leading-relaxed whitespace-pre-wrap">{exportCode}</pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleCopy}
            className="btn-racing px-5 py-2 text-xs font-heading font-bold flex items-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy to Clipboard
              </>
            )}
          </button>
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-xs">
            Close
          </button>
        </div>

        {/* Toast */}
        {copied && (
          <div className="fixed bottom-6 right-6 glass-card px-4 py-2 flex items-center gap-2 animate-in slide-in-from-bottom-2 z-[60]">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs text-white/70">Copied to clipboard</span>
          </div>
        )}
      </div>
    </div>
  );
}
