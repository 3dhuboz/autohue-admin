interface MiniBarChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  showLabels?: boolean;
}

export default function MiniBarChart({ data, height = 140, color = '#ef4444', showLabels = true }: MiniBarChartProps) {
  if (data.length === 0) return <div className="text-white/20 text-xs text-center py-8">No data</div>;

  const max = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(4, Math.min(20, (100 / data.length) - 1));
  const gap = 1;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${data.length * (barW + gap)} ${height}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const barH = (d.value / max) * (height - (showLabels ? 20 : 4));
        const x = i * (barW + gap);
        const y = height - barH - (showLabels ? 18 : 2);
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={barH}
              rx={2} fill={color} opacity={0.7 + (d.value / max) * 0.3}
            >
              <title>{d.label}: {d.value.toLocaleString()}</title>
            </rect>
            {showLabels && i % Math.max(1, Math.floor(data.length / 6)) === 0 && (
              <text x={x + barW / 2} y={height - 2} textAnchor="middle"
                fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="system-ui">
                {d.label.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
