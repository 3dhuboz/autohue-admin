import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface ReleaseFile {
  name: string;
  size: number;
  uploaded: string;
}

interface LatestInfo {
  version: string;
  windows?: { filename: string; size: number };
  mac?: { filename: string; size: number };
}

interface Props { getToken: () => Promise<string | null>; }

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReleasesPage({ getToken }: Props) {
  const [files, setFiles] = useState<ReleaseFile[]>([]);
  const [latest, setLatest] = useState<LatestInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const [relRes, latRes] = await Promise.all([
        api.authed(token).get<{ files: ReleaseFile[] }>('/api/admin/releases'),
        api.request<LatestInfo>('/api/releases/latest'),
      ]);
      setFiles(relRes.files.sort((a, b) => b.uploaded.localeCompare(a.uploaded)));
      setLatest(latRes);
    } catch (err) {
      console.error('Failed to load releases:', err);
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-heading font-bold">Releases</h1>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-32 rounded-xl bg-white/[0.03] animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">
          Releases <span className="text-racing-500">Manager</span>
        </h1>
        {latest && (
          <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/25 px-3 py-1 rounded-full">
            Latest: v{latest.version}
          </span>
        )}
      </div>

      {/* Latest release cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Windows */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className="text-blue-400">
                <path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5L3 17.75V12.5zM11.5 5.4l9.5-1.4v8h-9.5V5.4zm0 7.1h9.5v8l-9.5-1.4V12.5z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-white/80">Windows</div>
              <div className="text-xs text-white/30">
                {latest?.windows ? `${formatSize(latest.windows.size)}` : 'No build available'}
              </div>
            </div>
          </div>
          {latest?.windows && (
            <a
              href={`${API_BASE}/api/download/latest/windows`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/15 text-blue-400 text-xs font-medium hover:bg-blue-500/25 transition-colors"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V3h3v5H12L8 12z"/><path d="M3 13h10v1H3z"/></svg>
              Download .exe
            </a>
          )}
        </div>

        {/* Mac */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className="text-white/50">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-white/80">macOS</div>
              <div className="text-xs text-white/30">
                {latest?.mac ? `${formatSize(latest.mac.size)}` : 'No build available'}
              </div>
            </div>
          </div>
          {latest?.mac ? (
            <a
              href={`${API_BASE}/api/download/latest/mac`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 text-white/50 text-xs font-medium hover:bg-white/10 transition-colors"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V3h3v5H12L8 12z"/><path d="M3 13h10v1H3z"/></svg>
              Download .dmg
            </a>
          ) : (
            <span className="text-xs text-white/20">Coming soon</span>
          )}
        </div>
      </div>

      {/* All files in R2 */}
      <div>
        <h2 className="text-sm font-semibold text-white/50 mb-3">All Releases in R2</h2>
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="text-left px-4 py-2.5 text-white/30 font-medium">Filename</th>
                <th className="text-left px-4 py-2.5 text-white/30 font-medium">Size</th>
                <th className="text-left px-4 py-2.5 text-white/30 font-medium">Uploaded</th>
                <th className="text-right px-4 py-2.5 text-white/30 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => {
                const version = f.name.match(/(\d+\.\d+\.\d+)/)?.[1];
                const isLatest = version === latest?.version;
                return (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 text-white/70 font-mono">
                      {f.name.split('/').pop()}
                      {isLatest && (
                        <span className="ml-2 text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded">latest</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-white/40">{formatSize(f.size)}</td>
                    <td className="px-4 py-2.5 text-white/40">{formatDate(f.uploaded)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`${API_BASE}/api/download/${f.name.split('/').pop()}`}
                        className="text-racing-400 hover:text-racing-300 transition-colors"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                );
              })}
              {files.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-white/20">No releases uploaded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
