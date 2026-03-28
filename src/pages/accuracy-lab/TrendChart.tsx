import React, { useMemo } from 'react';

interface TrendChartProps {
  data: { pass: number; value: number }[];
  height?: number;
  color?: string;
  targetLine?: number;
  label?: string;
  formatValue?: (v: number) => string;
}

const PADDING = { top: 20, right: 16, bottom: 28, left: 44 };

export default function TrendChart({
  data,
  height = 120,
  color = '#ef4444',
  targetLine,
  label,
  formatValue = (v) => v.toFixed(1),
}: TrendChartProps) {
  const layout = useMemo(() => {
    if (data.length === 0) return null;

    const values = data.map((d) => d.value);
    const allValues = targetLine != null ? [...values, targetLine] : values;

    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const range = rawMax - rawMin || 1;
    const pad = range * 0.15;
    const yMin = Math.max(0, rawMin - pad);
    const yMax = rawMax + pad;

    const chartW = 1; // will use viewBox with 100% width
    const chartH = height - PADDING.top - PADDING.bottom;

    // Generate 3-4 y-axis tick values
    const yRange = yMax - yMin;
    const tickCount = 4;
    const tickStep = yRange / (tickCount - 1);
    const yTicks = Array.from({ length: tickCount }, (_, i) =>
      yMin + i * tickStep,
    );

    return { yMin, yMax, chartH, yTicks };
  }, [data, height, targetLine]);

  if (!layout || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-white/30 text-xs"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const { yMin, yMax, chartH, yTicks } = layout;

  // We'll use a viewBox approach: width is based on data points
  const svgWidth = 500;
  const plotW = svgWidth - PADDING.left - PADDING.right;
  const plotH = chartH;

  const scaleX = (pass: number) => {
    if (data.length === 1) return PADDING.left + plotW / 2;
    const idx = data.findIndex((d) => d.pass === pass);
    return PADDING.left + (idx / (data.length - 1)) * plotW;
  };

  const scaleY = (val: number) => {
    const pct = (val - yMin) / (yMax - yMin);
    return PADDING.top + plotH * (1 - pct);
  };

  // Build polyline path
  const linePath = data
    .map((d, i) => {
      const x = scaleX(d.pass);
      const y = scaleY(d.value);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');

  // Build fill path (area under line)
  const baseY = PADDING.top + plotH;
  const firstX = scaleX(data[0].pass);
  const lastX = scaleX(data[data.length - 1].pass);
  const fillPath = `${linePath} L${lastX},${baseY} L${firstX},${baseY} Z`;

  // Gradient id unique per instance
  const gradId = useMemo(
    () => `trend-grad-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // Determine dot colors
  const dotColor = (i: number): string => {
    if (i === 0) return '#facc15'; // yellow for first
    const prev = data[i - 1].value;
    const curr = data[i].value;
    if (curr > prev) return '#22c55e'; // green - improved
    if (curr < prev) return '#ef4444'; // red - regressed
    return '#facc15'; // yellow - same
  };

  return (
    <div className="w-full">
      {label && (
        <div className="text-[10px] text-white/50 mb-1 font-mono uppercase tracking-wider">
          {label}
        </div>
      )}
      <svg
        viewBox={`0 0 ${svgWidth} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {yTicks.map((tick, i) => {
          const y = scaleY(tick);
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={svgWidth - PADDING.right}
                y2={y}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={0.5}
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                textAnchor="end"
                fill="rgba(255,255,255,0.4)"
                fontSize={9}
                fontFamily="monospace"
              >
                {formatValue(tick)}
              </text>
            </g>
          );
        })}

        {/* Target line */}
        {targetLine != null && (
          <g>
            <line
              x1={PADDING.left}
              y1={scaleY(targetLine)}
              x2={svgWidth - PADDING.right}
              y2={scaleY(targetLine)}
              stroke="#22c55e"
              strokeWidth={1}
              strokeDasharray="6,3"
              opacity={0.6}
            />
            <text
              x={svgWidth - PADDING.right + 2}
              y={scaleY(targetLine) + 3}
              fill="#22c55e"
              fontSize={8}
              fontFamily="monospace"
              opacity={0.7}
            >
              {formatValue(targetLine)}
            </text>
          </g>
        )}

        {/* Area fill */}
        <path d={fillPath} fill={`url(#${gradId})`} />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map((d, i) => {
          const x = scaleX(d.pass);
          const y = scaleY(d.value);
          return (
            <g key={d.pass}>
              <circle
                cx={x}
                cy={y}
                r={3.5}
                fill={dotColor(i)}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth={1}
              >
                <title>
                  Pass {d.pass}: {formatValue(d.value)}
                </title>
              </circle>
            </g>
          );
        })}

        {/* X-axis labels (pass numbers) */}
        {data.map((d) => {
          const x = scaleX(d.pass);
          return (
            <text
              key={d.pass}
              x={x}
              y={height - 4}
              textAnchor="middle"
              fill="rgba(255,255,255,0.4)"
              fontSize={9}
              fontFamily="monospace"
            >
              {d.pass}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
