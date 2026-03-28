interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({ data, width = 60, height = 20, color = '#3b82f6' }: SparklineProps) {
  if (data.length < 2) return <span className="text-white/10 text-[8px]">--</span>;

  const max = Math.max(...data, 1);
  const pad = 2;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * plotW,
    y: pad + plotH - (v / max) * plotH,
  }));

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} fill={color} />
    </svg>
  );
}
