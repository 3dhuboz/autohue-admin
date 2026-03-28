import type { LearningStatus, LearningSpeed } from './types';

interface CycleControlsProps {
  status: LearningStatus;
  speed: LearningSpeed;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  setSpeed: (s: LearningSpeed) => void;
}

const SPEED_OPTIONS: { value: LearningSpeed; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
];

export default function CycleControls({
  status,
  speed,
  onPause,
  onResume,
  onStop,
  setSpeed,
}: CycleControlsProps) {
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isStopped = status === 'stopped' || status === 'completed';

  return (
    <div className="flex items-center gap-2">
      {/* Speed selector */}
      <div className="flex items-center rounded-lg border border-white/[0.06] overflow-hidden">
        {SPEED_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSpeed(opt.value)}
            disabled={isStopped}
            className={`px-3 py-1.5 text-[10px] font-medium transition-all ${
              speed === opt.value
                ? 'bg-white/10 text-white'
                : 'text-white/30 hover:text-white/50 hover:bg-white/[0.03]'
            } ${isStopped ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Pause / Resume */}
      {!isStopped && (
        <button
          onClick={isRunning ? onPause : onResume}
          className="btn-racing px-3 py-1.5 text-xs flex items-center gap-1.5"
        >
          {isRunning ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Resume
            </>
          )}
        </button>
      )}

      {/* Stop */}
      {!isStopped && (
        <button
          onClick={onStop}
          className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5 text-red-400 hover:text-red-300"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          Stop
        </button>
      )}

      {/* Status indicator for stopped/completed */}
      {isStopped && (
        <div className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <span className="text-[10px] text-white/30 uppercase tracking-wide">
            {status === 'completed' ? 'Converged' : 'Stopped'}
          </span>
        </div>
      )}
    </div>
  );
}
