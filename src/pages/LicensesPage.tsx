import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface Customer {
  id: number; email: string; tier: string; license_key: string | null;
  machine_slots: number; machines_used: number; is_active: number;
  activated_at: string | null; created_at: string;
}

interface Props { getToken: () => Promise<string | null>; }

const TIER_BADGE: Record<string, string> = {
  trial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  hobbyist: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  pro: 'bg-racing-500/15 text-racing-400 border-racing-500/25',
  unlimited: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
};

export default function LicensesPage({ getToken }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genTier, setGenTier] = useState('pro');
  const [genEmail, setGenEmail] = useState('');
  const [genNotes, setGenNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copyToast, setCopyToast] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.authed(token).get<{ customers: Customer[] }>('/api/admin/customers?page=1');
      setCustomers(res.customers.filter(c => c.license_key));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    const token = await getToken();
    if (!token) return;
    setGenerating(true);
    try {
      const res = await api.authed(token).post<{ licenseKey: string }>('/api/admin/licenses/generate', {
        tier: genTier, email: genEmail || undefined, notes: genNotes || undefined,
      });
      setGeneratedKey(res.licenseKey);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to generate');
    }
    setGenerating(false);
  };

  const handleRevoke = async (id: number) => {
    if (!confirm('Revoke this license? The customer will be locked out on next validation.')) return;
    const token = await getToken();
    if (!token) return;
    await api.authed(token).post(`/api/admin/licenses/revoke/${id}`);
    load();
  };

  const copyKey = (key: string, id: number) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">License <span className="text-racing-500">Keys</span></h1>
        <button onClick={() => { setShowGenerate(true); setGeneratedKey(''); }} className="btn-racing px-4 py-2 text-xs">
          + Generate Key
        </button>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/30 text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-3">License Key</th>
              <th className="text-left px-4 py-3">Tier</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Machines</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2].map(i => (
                <tr key={i} className="border-b border-white/[0.03]">
                  {[0,1,2,3,4,5].map(j => <td key={j} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : customers.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-white/30">No license keys yet</td></tr>
            ) : customers.map(c => (
              <tr key={c.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-xs text-white/60">{c.license_key}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${TIER_BADGE[c.tier] || TIER_BADGE.trial}`}>
                    {c.tier}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-white/50">{c.email}</td>
                <td className="px-4 py-3 text-xs text-white/40">{c.machines_used}/{c.machine_slots}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-2 h-2 rounded-full mr-1 ${c.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-xs text-white/50">{c.is_active ? 'Active' : 'Revoked'}</span>
                </td>
                <td className="px-4 py-3 flex gap-2">
                  <button
                    onClick={() => copyKey(c.license_key!, c.id)}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    {copiedId === c.id ? 'Copied!' : 'Copy'}
                  </button>
                  {c.is_active ? (
                    <button
                      onClick={() => handleRevoke(c.id)}
                      className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowGenerate(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative glass-card p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-heading font-bold text-white mb-4">Generate License Key</h2>

            {generatedKey ? (
              <div className="space-y-4">
                <p className="text-sm text-white/50">License key generated successfully:</p>
                <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4 font-mono text-sm text-racing-400 text-center tracking-wider break-all">
                  {generatedKey}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(generatedKey); setCopyToast(true); setTimeout(() => setCopyToast(false), 2000); }} className="btn-racing px-4 py-2 text-xs flex-1">
                    {copyToast ? 'Copied!' : 'Copy Key'}
                  </button>
                  <button onClick={() => setShowGenerate(false)} className="btn-ghost px-4 py-2 text-xs flex-1">
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">Tier</label>
                  <select value={genTier} onChange={e => setGenTier(e.target.value)} className="w-full">
                    <option value="trial">Trial (7 days, 50/day, free)</option>
                    <option value="hobbyist">Hobbyist (500/day, $14/mo)</option>
                    <option value="pro">Pro (5,000/day, $49/mo)</option>
                    <option value="unlimited">Unlimited ($99/mo)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">Email (optional)</label>
                  <input value={genEmail} onChange={e => setGenEmail(e.target.value)} placeholder="customer@email.com" className="w-full" />
                </div>
                <div>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">Notes (optional)</label>
                  <input value={genNotes} onChange={e => setGenNotes(e.target.value)} placeholder="Internal note" className="w-full" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleGenerate} disabled={generating} className="btn-racing px-4 py-2 text-xs flex-1">
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                  <button onClick={() => setShowGenerate(false)} className="btn-ghost px-4 py-2 text-xs flex-1">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
