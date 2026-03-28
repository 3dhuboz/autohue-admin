interface MiniLineChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  fill?: boolean;
  showLabels?: boolean;
}

export default function MiniLineChart({ data, height = 140, color = '#22c55e', fill = true, showLabels = true }: MiniLineChartProps) {
  if (data.length < 2) return <div className="text-white/20 text-xs text-center py-8">Not enough data</div>;

  const max = Math.max(...data.map(d => d.value), 1);
  const pad = { top: 8, bottom: showLabels ? 22 : 8, left: 2, right: 2 };
  const w = 400;
  const h = height;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * plotW,
    y: pad.top + plotH - (d.value / max) * plotH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const fillPath = `${linePath} L ${points[points.length - 1].x} ${h - pad.bottom} L ${points[0].x} ${h - pad.bottom} Z`;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && (
        <path d={fillPath} fill={color} opacity={0.1} />
      )}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots on data points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={color} opacity={0.8}>
            <title>{data[i].label}: {data[i].value.toLocaleString()}</title>
          </circle>
          {showLabels && i % Math.max(1, Math.floor(data.length / 6)) === 0 && (
            <text x={p.x} y={h - 4} textAnchor="middle"
              fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="system-ui">
              {data[i].label.slice(5) || data[i].label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
