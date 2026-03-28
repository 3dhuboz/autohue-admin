import React, { useMemo } from 'react';
import { COLOR_SWATCHES, COLOR_BADGES } from './types';

interface ConfusionHeatmapProps {
  matrix: Record<string, Record<string, number>>;
  perColor: Record<string, { correct: number; total: number }>;
  colors: string[];
  compact?: boolean;
}

/** Clamp 0-1 */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function ConfusionHeatmap({
  matrix,
  perColor,
  colors,
  compact = false,
}: ConfusionHeatmapProps) {
  // Compute max off-diagonal count for intensity scaling
  const maxOffDiag = useMemo(() => {
    let max = 1;
    for (const row of colors) {
      for (const col of colors) {
        if (row !== col) {
          const val = matrix[row]?.[col] ?? 0;
          if (val > max) max = val;
        }
      }
    }
    return max;
  }, [matrix, colors]);

  // Row totals for per-row intensity scaling
  const rowTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of colors) {
      let sum = 0;
      for (const col of colors) {
        sum += matrix[row]?.[col] ?? 0;
      }
      totals[row] = sum || 1;
    }
    return totals;
  }, [matrix, colors]);

  const cellSize = compact ? 'min-w-[28px] h-7' : 'min-w-[36px] h-9';
  const fontSize = compact ? 'text-[10px]' : 'text-xs';
  const labelSize = compact ? 'text-[9px]' : 'text-[11px]';
  const swatchSize = compact ? 'w-2.5 h-2.5' : 'w-3 h-3';

  const cellBg = (row: string, col: string): string => {
    const count = matrix[row]?.[col] ?? 0;
    if (count === 0) return 'rgba(255,255,255,0.02)';

    if (row === col) {
      // Diagonal: green intensity
      const intensity = clamp01(count / rowTotals[row]);
      const alpha = 0.15 + intensity * 0.5;
      return `rgba(34,197,94,${alpha.toFixed(2)})`;
    }

    // Off-diagonal: red intensity based on count relative to row total
    const intensity = clamp01(count / rowTotals[row]);
    const alpha = 0.1 + intensity * 0.6;
    return `rgba(239,68,68,${alpha.toFixed(2)})`;
  };

  const cellText = (row: string, col: string): string => {
    const count = matrix[row]?.[col] ?? 0;
    if (count === 0) return compact ? '' : '-';
    return String(count);
  };

  const textColor = (row: string, col: string): string => {
    const count = matrix[row]?.[col] ?? 0;
    if (count === 0) return 'rgba(255,255,255,0.15)';
    if (row === col) return 'rgba(34,197,94,0.9)';
    return 'rgba(255,255,255,0.8)';
  };

  if (colors.length === 0) {
    return (
      <div className="text-white/30 text-xs text-center py-4">
        No confusion data
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            {/* Corner cell */}
            <th
              className={`${labelSize} text-white/30 font-normal pr-1 pb-1 text-right`}
            >
              <span className="opacity-50">assigned \ actual</span>
            </th>
            {/* Column headers */}
            {colors.map((col) => (
              <th key={col} className="pb-1 px-0.5">
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    className={`${swatchSize} rounded-sm border border-white/10`}
                    style={{ backgroundColor: COLOR_SWATCHES[col] ?? '#888' }}
                    title={col}
                  />
                  <span
                    className={`${labelSize} text-white/50 font-normal leading-none`}
                  >
                    {compact ? col.slice(0, 3) : col.replace('-', '\u2011')}
                  </span>
                </div>
              </th>
            ))}
            {/* Accuracy column */}
            <th
              className={`${labelSize} text-white/40 font-normal pl-2 pb-1`}
            >
              acc%
            </th>
          </tr>
        </thead>
        <tbody>
          {colors.map((row) => {
            const acc = perColor[row];
            const pct =
              acc && acc.total > 0
                ? ((acc.correct / acc.total) * 100).toFixed(0)
                : '-';
            return (
              <tr key={row}>
                {/* Row label */}
                <td className="pr-1.5 py-0">
                  <div className="flex items-center gap-1 justify-end">
                    <span
                      className={`${labelSize} text-white/50 font-normal leading-none`}
                    >
                      {compact ? row.slice(0, 3) : row.replace('-', '\u2011')}
                    </span>
                    <div
                      className={`${swatchSize} rounded-sm border border-white/10 flex-shrink-0`}
                      style={{
                        backgroundColor: COLOR_SWATCHES[row] ?? '#888',
                      }}
                      title={row}
                    />
                  </div>
                </td>

                {/* Matrix cells */}
                {colors.map((col) => (
                  <td key={col} className="p-0.5">
                    <div
                      className={`${cellSize} ${fontSize} flex items-center justify-center rounded font-mono font-medium transition-colors`}
                      style={{
                        backgroundColor: cellBg(row, col),
                        color: textColor(row, col),
                      }}
                      title={`${row} assigned as ${col}: ${matrix[row]?.[col] ?? 0}`}
                    >
                      {cellText(row, col)}
                    </div>
                  </td>
                ))}

                {/* Row accuracy */}
                <td className="pl-2 py-0">
                  <span
                    className={`${fontSize} font-mono ${
                      pct !== '-' && Number(pct) >= 90
                        ? 'text-green-400'
                        : pct !== '-' && Number(pct) >= 70
                          ? 'text-yellow-400'
                          : 'text-red-400'
                    }`}
                  >
                    {pct === '-' ? '-' : `${pct}%`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
