import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface TierConfig {
  name: string;
  dailyLimit: number;
  monthlyPrice: number;
  yearlyPrice: number;
}

interface Settings {
  tiers: Record<string, TierConfig>;
  trial_duration_days: number;
  machine_slots: number;
  min_app_version: string;
  admin_emails: string[];
}

interface Props {
  getToken: () => Promise<string | null>;
}

const TIER_ORDER = ['trial', 'hobbyist', 'pro', 'unlimited'];

export default function SettingsPage({ getToken }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editTiers, setEditTiers] = useState<Record<string, TierConfig>>({});
  const [editBusiness, setEditBusiness] = useState({
    trial_duration_days: 7,
    machine_slots: 2,
    min_app_version: '3.3.5',
    admin_emails: '',
  });

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await api.authed(token).get<{ settings: Settings }>('/api/admin/settings');
      setSettings(res.settings);
      setEditTiers(res.settings.tiers || {});
      setEditBusiness({
        trial_duration_days: res.settings.trial_duration_days || 7,
        machine_slots: res.settings.machine_slots || 2,
        min_app_version: res.settings.min_app_version || '3.3.5',
        admin_emails: (res.settings.admin_emails || []).join(', '),
      });
    } catch (e) {
      console.error('Settings load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    const token = await getToken();
    if (!token) { setSaving(false); return; }
    try {
      await api.authed(token).put('/api/admin/settings', {
        tiers: editTiers,
        trial_duration_days: editBusiness.trial_duration_days,
        machine_slots: editBusiness.machine_slots,
        min_app_version: editBusiness.min_app_version,
        admin_emails: editBusiness.admin_emails.split(',').map(e => e.trim()).filter(Boolean),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      load();
    } catch (e) {
      console.error('Save failed:', e);
    }
    setSaving(false);
  };

  const updateTier = (tier: string, field: keyof TierConfig, value: string | number) => {
    setEditTiers(prev => ({
      ...prev,
      [tier]: { ...prev[tier], [field]: typeof prev[tier][field] === 'number' ? Number(value) : value },
    }));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[0,1,2].map(i => <div key={i} className="glass-card p-6 h-32 animate-pulse" />)}
      </div>
    );
  }

  if (!settings) return <p className="text-white/40 text-sm">Failed to load settings.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">
          Settings <span className="text-racing-500">Configuration</span>
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
            saved ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
            'bg-racing-500 text-white hover:bg-racing-600'
          }`}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save All Changes'}
        </button>
      </div>

      {/* Tier Pricing */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-heading font-semibold text-white/70 mb-4">Tier Pricing</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-white/30 text-[10px] uppercase tracking-wider">
                <th className="text-left px-3 py-2">Tier</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Daily Limit</th>
                <th className="text-left px-3 py-2">Monthly ($)</th>
                <th className="text-left px-3 py-2">Yearly ($)</th>
              </tr>
            </thead>
            <tbody>
              {TIER_ORDER.map(tier => {
                const t = editTiers[tier];
                if (!t) return null;
                return (
                  <tr key={tier} className="border-b border-white/[0.03]">
                    <td className="px-3 py-2">
                      <span className="capitalize text-white/60 font-mono text-xs">{tier}</span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={t.name}
                        onChange={e => updateTier(tier, 'name', e.target.value)}
                        className="w-full text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" value={t.dailyLimit}
                        onChange={e => updateTier(tier, 'dailyLimit', e.target.value)}
                        className="w-24 text-xs font-mono"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" value={t.monthlyPrice}
                        onChange={e => updateTier(tier, 'monthlyPrice', e.target.value)}
                        className="w-20 text-xs font-mono"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" value={t.yearlyPrice}
                        onChange={e => updateTier(tier, 'yearlyPrice', e.target.value)}
                        className="w-20 text-xs font-mono"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Business Settings */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-heading font-semibold text-white/70 mb-4">Business Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-white/30 uppercase block mb-1">Trial Duration (days)</label>
            <input
              type="number" value={editBusiness.trial_duration_days}
              onChange={e => setEditBusiness(b => ({ ...b, trial_duration_days: Number(e.target.value) }))}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase block mb-1">Machine Slots per License</label>
            <input
              type="number" value={editBusiness.machine_slots}
              onChange={e => setEditBusiness(b => ({ ...b, machine_slots: Number(e.target.value) }))}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase block mb-1">Minimum App Version</label>
            <input
              type="text" value={editBusiness.min_app_version}
              onChange={e => setEditBusiness(b => ({ ...b, min_app_version: e.target.value }))}
              className="w-full text-sm font-mono"
              placeholder="3.3.5"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase block mb-1">Admin Emails (comma-separated)</label>
            <input
              type="text" value={editBusiness.admin_emails}
              onChange={e => setEditBusiness(b => ({ ...b, admin_emails: e.target.value }))}
              className="w-full text-sm font-mono"
              placeholder="steve@3dhub.au, ..."
            />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="glass-card p-4">
        <p className="text-[10px] text-white/20">
          Changes are saved to the database and take effect immediately. Tier pricing changes require
          updating PayPal plans separately. Admin email changes take effect on next login.
        </p>
      </div>
    </div>
  );
}
