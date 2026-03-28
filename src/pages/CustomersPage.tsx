import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface Customer {
  id: number; email: string; name: string | null; tier: string;
  license_key: string | null; machine_id: string | null;
  machine_slots: number; machines_used: number;
  activated_at: string | null; expires_at: string | null;
  last_validated: string | null; is_active: number;
  notes: string | null; created_at: string;
  bonus_quota?: number;
}

interface UsageData {
  dailyCounts: { day: string; count: number }[];
  recentValidations: { machine_id: string; app_version: string; ip_address: string; result: string; created_at: string }[];
  appVersions: { app_version: string; last_seen: string }[];
}

interface Props { getToken: () => Promise<string | null>; }

const TIER_BADGE: Record<string, string> = {
  trial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  hobbyist: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  pro: 'bg-racing-500/15 text-racing-400 border-racing-500/25',
  unlimited: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
};

export default function CustomersPage({ getToken }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ tier: '', name: '', notes: '', is_active: true });
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [bonusInput, setBonusInput] = useState('');
  const [bonusReason, setBonusReason] = useState('');
  const [bonusSaving, setBonusSaving] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('search', search);
      const res = await api.authed(token).get<{
        customers: Customer[]; total: number; pages: number;
      }>(`/api/admin/customers?${params}`);
      setCustomers(res.customers);
      setTotal(res.total);
      setPages(res.pages);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [getToken, page, search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!selected) return;
    const token = await getToken();
    if (!token) return;
    await api.authed(token).put(`/api/admin/customers/${selected.id}`, editForm);
    setEditing(false);
    setSelected(null);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this customer permanently?')) return;
    const token = await getToken();
    if (!token) return;
    await api.authed(token).del(`/api/admin/customers/${id}`);
    setSelected(null);
    load();
  };

  const maskKey = (key: string | null) => key ? key.slice(0, 8) + '...' + key.slice(-4) : '—';
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">
          Customers <span className="text-white/30 text-base font-normal">({total})</span>
        </h1>
        <input
          type="text"
          placeholder="Search by email, name, or key..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-72 text-sm"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/30 text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Tier</th>
              <th className="text-left px-4 py-3">License Key</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Last Validated</th>
              <th className="text-left px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3,4].map(i => (
                <tr key={i} className="border-b border-white/[0.03]">
                  {[0,1,2,3,4,5].map(j => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : customers.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-white/30">No customers found</td></tr>
            ) : customers.map(c => (
              <tr
                key={c.id}
                onClick={() => { setSelected(c); setEditing(false); setEditForm({ tier: c.tier, name: c.name || '', notes: c.notes || '', is_active: !!c.is_active }); }}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-white/80 font-mono text-xs">{c.email}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${TIER_BADGE[c.tier] || TIER_BADGE.trial}`}>
                    {c.tier}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-white/40">{maskKey(c.license_key)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${c.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-xs text-white/50">{c.is_active ? 'Active' : 'Revoked'}</span>
                </td>
                <td className="px-4 py-3 text-xs text-white/30">{fmtDate(c.last_validated)}</td>
                <td className="px-4 py-3 text-xs text-white/30">{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`w-8 h-8 rounded text-xs font-medium ${page === i + 1 ? 'bg-racing-500 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Detail slide-out */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md bg-[#16161a] border-l border-white/5 p-6 overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-lg font-heading font-bold text-white">{selected.email}</h2>
                <p className="text-xs text-white/30">{selected.name || 'No name'}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white/60 text-lg">&times;</button>
            </div>

            {!editing ? (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-[10px] text-white/30 uppercase">Tier</span><p className="capitalize text-white/80">{selected.tier}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">Status</span><p className={selected.is_active ? 'text-green-400' : 'text-red-400'}>{selected.is_active ? 'Active' : 'Revoked'}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">License Key</span><p className="font-mono text-xs text-white/60 break-all">{selected.license_key || '—'}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">Machines</span><p className="text-white/60">{selected.machines_used}/{selected.machine_slots}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">Activated</span><p className="text-white/60">{fmtDate(selected.activated_at)}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">Last Validated</span><p className="text-white/60">{fmtDate(selected.last_validated)}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">Expires</span><p className="text-white/60">{selected.expires_at ? fmtDate(selected.expires_at) : 'Never'}</p></div>
                  <div><span className="text-[10px] text-white/30 uppercase">Created</span><p className="text-white/60">{fmtDate(selected.created_at)}</p></div>
                </div>
                {selected.notes && <div><span className="text-[10px] text-white/30 uppercase">Notes</span><p className="text-white/50 text-xs">{selected.notes}</p></div>}
                <div className="flex gap-2 pt-4">
                  <button onClick={() => setEditing(true)} className="btn-ghost px-4 py-2 text-xs flex-1">Edit</button>
                  <button onClick={() => handleDelete(selected.id)} className="px-4 py-2 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 flex-1">Delete</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">Tier</label>
                  <select value={editForm.tier} onChange={e => setEditForm(f => ({ ...f, tier: e.target.value }))} className="w-full">
                    <option value="trial">Trial</option>
                    <option value="hobbyist">Hobbyist</option>
                    <option value="pro">Pro</option>
                    <option value="unlimited">Unlimited</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">Name</label>
                  <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="w-full" />
                </div>
                <div>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">Notes</label>
                  <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="w-full h-20 resize-none" />
                </div>
                <label className="flex items-center gap-2 text-sm text-white/60">
                  <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} />
                  Active
                </label>
                <div className="flex gap-2">
                  <button onClick={handleSave} className="btn-racing px-4 py-2 text-xs flex-1">Save</button>
                  <button onClick={() => setEditing(false)} className="btn-ghost px-4 py-2 text-xs flex-1">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
