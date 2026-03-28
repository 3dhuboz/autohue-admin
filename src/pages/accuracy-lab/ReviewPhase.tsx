import { useState, useCallback, useMemo } from 'react';
import type { ReviewImage } from './types';
import { COLOR_CATEGORIES, COLOR_SWATCHES, COLOR_BADGES } from './types';

interface ReviewPhaseProps {
  images: ReviewImage[];
  setImages: (imgs: ReviewImage[]) => void;
  zipName: string;
  onFinalize: () => void;
  onReset: () => void;
}

export default function ReviewPhase({ images, setImages, zipName, onFinalize, onReset }: ReviewPhaseProps) {
  const [filterColor, setFilterColor] = useState<string | 'all'>('all');
  const [filterVerdict, setFilterVerdict] = useState<'all' | 'unreviewed' | 'correct' | 'incorrect'>('all');
  const [lightboxImg, setLightboxImg] = useState<ReviewImage | null>(null);

  // Verdict handlers
  const setVerdict = useCallback((id: string, verdict: 'correct' | 'incorrect', correctColor?: string) => {
    setImages(images.map(img =>
      img.id === id ? { ...img, verdict, correctColor: verdict === 'correct' ? undefined : correctColor } : img
    ));
  }, [images, setImages]);

  const setCorrectColor = useCallback((id: string, color: string) => {
    setImages(images.map(img =>
      img.id === id ? { ...img, correctColor: color } : img
    ));
  }, [images, setImages]);

  // Bulk actions
  const markAllCorrect = useCallback(() => {
    setImages(images.map(img => img.verdict ? img : { ...img, verdict: 'correct' }));
  }, [images, setImages]);

  const markFilteredCorrect = useCallback(() => {
    setImages(images.map(img => {
      if (img.verdict) return img;
      if (filterColor !== 'all' && img.assignedColor !== filterColor) return img;
      return { ...img, verdict: 'correct' };
    }));
  }, [images, setImages, filterColor]);

  // Computed metrics
  const metrics = useMemo(() => {
    const reviewed = images.filter(i => i.verdict);
    const correct = reviewed.filter(i => i.verdict === 'correct');
    const incorrect = reviewed.filter(i => i.verdict === 'incorrect');
    const accuracy = reviewed.length > 0 ? (correct.length / reviewed.length) * 100 : 0;
    return { reviewed: reviewed.length, correct: correct.length, incorrect: incorrect.length, accuracy };
  }, [images]);

  // Color distribution
  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const img of images) {
      counts[img.assignedColor] = (counts[img.assignedColor] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [images]);

  // Filtered images
  const filteredImages = useMemo(() => {
    return images.filter(img => {
      if (filterColor !== 'all' && img.assignedColor !== filterColor) return false;
      if (filterVerdict === 'unreviewed' && img.verdict) return false;
      if (filterVerdict === 'correct' && img.verdict !== 'correct') return false;
      if (filterVerdict === 'incorrect' && img.verdict !== 'incorrect') return false;
      return true;
    });
  }, [images, filterColor, filterVerdict]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">
            Review <span className="text-racing-500">Results</span>
          </h1>
          <p className="text-xs text-white/30 mt-0.5">{zipName} — {images.length} images</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onReset} className="btn-ghost px-3 py-1.5 text-xs">
            Start Over
          </button>
          <button
            onClick={onFinalize}
            disabled={metrics.reviewed === 0}
            className="btn-racing px-4 py-1.5 text-xs"
          >
            Finalize ({metrics.reviewed}/{images.length} reviewed)
          </button>
        </div>
      </div>

      {/* Live Stats Bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-white/30 uppercase">Reviewed</p>
          <p className="text-lg font-heading font-bold text-white/80">{metrics.reviewed}<span className="text-xs text-white/20">/{images.length}</span></p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-white/30 uppercase">Correct</p>
          <p className="text-lg font-heading font-bold text-green-400">{metrics.correct}</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-white/30 uppercase">Incorrect</p>
          <p className="text-lg font-heading font-bold text-red-400">{metrics.incorrect}</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-white/30 uppercase">Accuracy</p>
          <p className={`text-lg font-heading font-bold ${metrics.accuracy >= 95 ? 'text-green-400' : metrics.accuracy >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
            {metrics.reviewed > 0 ? `${metrics.accuracy.toFixed(1)}%` : '\u2014'}
          </p>
        </div>
      </div>

      {/* Filters & Bulk Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Color filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/30 uppercase">Color:</span>
          <button
            onClick={() => setFilterColor('all')}
            className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
              filterColor === 'all' ? 'bg-white/10 text-white border-white/20' : 'text-white/30 border-transparent hover:text-white/50'
            }`}
          >
            All ({images.length})
          </button>
          {colorCounts.map(([color, count]) => (
            <button
              key={color}
              onClick={() => setFilterColor(color)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all flex items-center gap-1 ${
                filterColor === color ? `${COLOR_BADGES[color] || 'bg-white/10 text-white border-white/20'}` : 'text-white/30 border-transparent hover:text-white/50'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: COLOR_SWATCHES[color] || '#666' }} />
              {color} ({count})
            </button>
          ))}
        </div>

        {/* Verdict filter */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] text-white/30 uppercase">Show:</span>
          {(['all', 'unreviewed', 'correct', 'incorrect'] as const).map(v => (
            <button
              key={v}
              onClick={() => setFilterVerdict(v)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-all ${
                filterVerdict === v ? 'bg-white/10 text-white border-white/20' : 'text-white/30 border-transparent hover:text-white/50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Bulk actions */}
        <div className="flex gap-2">
          {filterColor !== 'all' ? (
            <button onClick={markFilteredCorrect} className="btn-ghost px-2 py-0.5 text-[10px]">
              Mark all &quot;{filterColor}&quot; correct
            </button>
          ) : (
            <button onClick={markAllCorrect} className="btn-ghost px-2 py-0.5 text-[10px]">
              Mark all remaining correct
            </button>
          )}
        </div>
      </div>

      {/* Image Review Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {filteredImages.map(img => (
          <div
            key={img.id}
            className={`glass-card overflow-hidden group transition-all duration-200 ${
              img.verdict === 'correct' ? 'ring-1 ring-green-500/30' :
              img.verdict === 'incorrect' ? 'ring-1 ring-red-500/30' : ''
            }`}
          >
            {/* Image thumbnail */}
            <div
              className="relative aspect-[4/3] bg-black/20 cursor-pointer overflow-hidden"
              onClick={() => setLightboxImg(img)}
            >
              <img
                src={img.blobUrl}
                alt={img.filename}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              {img.verdict && (
                <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  img.verdict === 'correct' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                }`}>
                  {img.verdict === 'correct' ? '\u2713' : '\u2717'}
                </div>
              )}
            </div>

            {/* Info & Controls */}
            <div className="p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLOR_SWATCHES[img.assignedColor] || '#666' }} />
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${COLOR_BADGES[img.assignedColor] || 'bg-white/10 text-white/50 border-white/10'}`}>
                  {img.assignedColor}
                </span>
              </div>
              <p className="text-[9px] text-white/20 truncate" title={img.filename}>{img.filename}</p>

              {/* Verdict buttons */}
              <div className="flex gap-1">
                <button
                  onClick={() => setVerdict(img.id, 'correct')}
                  className={`flex-1 py-1 rounded text-[10px] font-medium transition-all ${
                    img.verdict === 'correct'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-white/[0.03] text-white/30 hover:bg-green-500/10 hover:text-green-400 border border-transparent'
                  }`}
                >
                  Correct
                </button>
                <button
                  onClick={() => setVerdict(img.id, 'incorrect', img.correctColor)}
                  className={`flex-1 py-1 rounded text-[10px] font-medium transition-all ${
                    img.verdict === 'incorrect'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-white/[0.03] text-white/30 hover:bg-red-500/10 hover:text-red-400 border border-transparent'
                  }`}
                >
                  Wrong
                </button>
              </div>

              {/* Correct color picker */}
              {img.verdict === 'incorrect' && (
                <div className="pt-1">
                  <p className="text-[9px] text-white/20 mb-1">What color should it be?</p>
                  <div className="flex flex-wrap gap-1">
                    {COLOR_CATEGORIES.filter(c => c !== img.assignedColor).map(c => (
                      <button
                        key={c}
                        onClick={() => setCorrectColor(img.id, c)}
                        className={`w-5 h-5 rounded-full border-2 transition-all ${
                          img.correctColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'
                        }`}
                        style={{ background: COLOR_SWATCHES[c] }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredImages.length === 0 && (
        <div className="glass-card p-8 text-center">
          <p className="text-white/30 text-sm">No images match the current filters.</p>
        </div>
      )}

      {/* Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxImg(null)}
        >
          <div className="max-w-4xl max-h-[85vh] relative" onClick={e => e.stopPropagation()}>
            <img src={lightboxImg.blobUrl} alt={lightboxImg.filename} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <div className="absolute bottom-4 left-4 flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-bold uppercase border ${COLOR_BADGES[lightboxImg.assignedColor] || ''}`}>
                {lightboxImg.assignedColor}
              </span>
              <span className="text-xs text-white/50 bg-black/50 px-2 py-1 rounded">{lightboxImg.filename}</span>
            </div>
            <button
              onClick={() => setLightboxImg(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white/60 hover:text-white flex items-center justify-center"
            >
              \u00d7
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
