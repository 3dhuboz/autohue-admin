import { useState, useEffect, useCallback } from 'react';

const API_BASE = 'https://autohue-api.steve-700.workers.dev';

// OpenRouter key info endpoint
const OR_AUTH_URL = 'https://openrouter.ai/api/v1/auth/key';

interface KeyInfo {
  key: string;
  last6: string;
  label: string;
  usage: number;
  limit: number | null;
  remaining: number | null;
  status: 'ok' | 'low' | 'exhausted' | 'error';
  error?: string;
}

interface Props {
  getToken: () => Promise<string>;
}

export default function SystemPage({ getToken }: Props) {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [apiHealth, setApiHealth] = useState<{ status: string; version: string } | null>(null);
  const [r2Info, setR2Info] = useState<{ version: string; windows?: any; mac?: any } | null>(null);

  const checkKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/openrouter-status`);
      if (res.ok) {
        const data = await res.json() as { keys: KeyInfo[] };
        setKeys(data.keys);
      }
    } catch {
      // Fallback: check keys client-side via CORS-friendly endpoint
      const keyRes = await fetch(`${API_BASE}/api/admin/openrouter-keys`);
      if (keyRes.ok) {
        const { keys: keyList } = await keyRes.json() as { keys: string[] };
        const results: KeyInfo[] = [];
        for (const key of keyList) {
          try {
            const r = await fetch(OR_AUTH_URL, {
              headers: { 'Authorization': `Bearer ${key}` },
            });
            const data = await r.json() as any;
            const usage = data.data?.usage || 0;
            const limit = data.data?.limit || null;
            const remaining = data.data?.limit_remaining || null;
            const label = data.data?.label || '';
            results.push({
              key,
              last6: key.slice(-6),
              label,
              usage,
              limit,
              remaining,
              status: limit !== null && remaining !== null
                ? remaining <= 0 ? 'exhausted' : remaining < 1 ? 'low' : 'ok'
                : usage > 1.5 ? 'low' : 'ok',
            });
          } catch {
            results.push({
              key, last6: key.slice(-6), label: '', usage: 0,
              limit: null, remaining: null, status: 'error', error: 'Failed to check',
            });
          }
        }
        setKeys(results);
      }
    }
    setLastChecked(new Date());
    setLoading(false);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const [healthRes, releasesRes] = await Promise.all([
        fetch(`${API_BASE}/api/health`).catch(() => null),
        fetch(`${API_BASE}/api/releases/latest`).catch(() => null),
      ]);
      if (healthRes?.ok) {
        const data = await healthRes.json() as any;
        setApiHealth(data);
      }
      if (releasesRes?.ok) {
        const data = await releasesRes.json() as any;
        setR2Info(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    checkKeys();
    checkHealth();
  }, [checkKeys, checkHealth]);

  const totalUsage = keys.reduce((s, k) => s + k.usage, 0);
  const exhaustedCount = keys.filter(k => k.status === 'exhausted').length;
  const healthyCount = keys.filter(k => k.status === 'ok').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-heading font-bold text-white">System Health</h1>
        <button
          onClick={() => { checkKeys(); checkHealth(); }}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
        >
          {loading ? <span className="animate-spin inline-block">⟳</span> : '⟳'} Refresh
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-white/30 mb-1">API Worker</div>
          <div className="text-lg font-heading font-bold text-green-400">
            {apiHealth ? '● Online' : '○ Unknown'}
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-white/30 mb-1">Latest Release</div>
          <div className="text-lg font-heading font-bold text-white">
            {r2Info?.version || '—'}
          </div>
          <div className="text-[10px] text-white/20 mt-0.5">
            {r2Info?.windows ? '✓ Win' : ''} {r2Info?.mac ? '✓ Mac' : ''}
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-white/30 mb-1">OpenRouter Keys</div>
          <div className={`text-lg font-heading font-bold ${exhaustedCount > 0 ? 'text-amber-400' : 'text-green-400'}`}>
            {healthyCount}/{keys.length} healthy
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-white/30 mb-1">Total API Spend</div>
          <div className="text-lg font-heading font-bold text-white">
            ${totalUsage.toFixed(2)}
          </div>
        </div>
      </div>

      {/* OpenRouter Keys */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-heading font-bold text-white/70">
            OpenRouter API Keys
          </h2>
          {lastChecked && (
            <span className="text-[10px] text-white/20">
              Last checked: {lastChecked.toLocaleTimeString()}
            </span>
          )}
        </div>

        {loading && keys.length === 0 ? (
          <div className="text-center py-8 text-white/30 text-sm">Checking keys...</div>
        ) : (
          <div className="space-y-2">
            {keys.map((k, i) => (
              <div
                key={i}
                className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                  k.status === 'exhausted'
                    ? 'bg-red-500/5 border-red-500/20'
                    : k.status === 'low'
                    ? 'bg-amber-500/5 border-amber-500/20'
                    : k.status === 'error'
                    ? 'bg-white/[0.02] border-white/5'
                    : 'bg-green-500/5 border-green-500/20'
                }`}
              >
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  k.status === 'exhausted' ? 'bg-red-500' :
                  k.status === 'low' ? 'bg-amber-500' :
                  k.status === 'error' ? 'bg-white/20' :
                  'bg-green-500'
                }`} />

                {/* Key info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-white/50">...{k.last6}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      k.status === 'exhausted' ? 'bg-red-500/10 text-red-400' :
                      k.status === 'low' ? 'bg-amber-500/10 text-amber-400' :
                      k.status === 'error' ? 'bg-white/5 text-white/30' :
                      'bg-green-500/10 text-green-400'
                    }`}>
                      {k.status === 'exhausted' ? 'EXHAUSTED' :
                       k.status === 'low' ? 'LOW' :
                       k.status === 'error' ? 'ERROR' :
                       'ACTIVE'}
                    </span>
                  </div>
                </div>

                {/* Usage */}
                <div className="text-right shrink-0">
                  <div className="text-sm font-mono font-bold text-white/70">
                    ${k.usage.toFixed(4)}
                  </div>
                  <div className="text-[10px] text-white/20">
                    {k.limit !== null ? `limit: $${k.limit}` : 'no limit set'}
                  </div>
                </div>

                {/* Usage bar */}
                <div className="w-24 shrink-0">
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        k.status === 'exhausted' ? 'bg-red-500' :
                        k.status === 'low' ? 'bg-amber-500' :
                        'bg-green-500'
                      }`}
                      style={{
                        width: k.limit ? `${Math.min((k.usage / k.limit) * 100, 100)}%` :
                               `${Math.min(k.usage * 50, 100)}%`
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {exhaustedCount > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15 text-xs text-amber-400/80">
            <strong>⚠ {exhaustedCount} key{exhaustedCount > 1 ? 's' : ''} exhausted.</strong>{' '}
            Add credits at{' '}
            <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener" className="underline">
              openrouter.ai/settings/credits
            </a>{' '}
            or switch to direct Gemini API for free higher limits.
          </div>
        )}
      </div>
    </div>
  );
}
