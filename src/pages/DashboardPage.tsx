import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface DashboardData {
  totalCustomers: number;
  tierBreakdown: { tier: string; count: number }[];
  totalRevenue: number;
  revenueThisMonth: number;
  validationsLast24h: number;
  newCustomersThisWeek: number;
}

interface Props {
  getToken: () => Promise<string | null>;
}

const TIER_COLORS: Record<string, string> = {
  trial: '#eab308', hobbyist: '#3b82f6', pro: '#ef4444', unlimited: '#a855f7',
};

export default function DashboardPage({ getToken }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const d = await api.authed(token).get<DashboardData>('/api/admin/dashboard');
        setData(d);
      } catch (e) {
        console.error('Dashboard load failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => (
          <div key={i} className="glass-card p-6 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) return <p className="text-white/40 text-sm">Failed to load dashboard.</p>;

  const stats = [
    { label: 'Total Customers', value: data.totalCustomers, color: 'text-white' },
    { label: 'Revenue (All Time)', value: `$${data.totalRevenue.toLocaleString()}`, color: 'text-green-400' },
    { label: 'Revenue (30 days)', value: `$${data.revenueThisMonth.toLocaleString()}`, color: 'text-green-400' },
    { label: 'Validations (24h)', value: data.validationsLast24h, color: 'text-blue-400' },
    { label: 'New This Week', value: data.newCustomersThisWeek, color: 'text-purple-400' },
  ];

  const totalInBreakdown = data.tierBreakdown.reduce((s, t) => s + t.count, 0) || 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">
        Dashboard <span className="text-racing-500">Overview</span>
      </h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {stats.map(s => (
          <div key={s.label} className="glass-card p-5">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">{s.label}</p>
            <p className={`text-2xl font-heading font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tier breakdown */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-heading font-semibold text-white/70 mb-4">Customers by Tier</h2>
        <div className="space-y-3">
          {data.tierBreakdown.map(t => {
            const pct = Math.round((t.count / totalInBreakdown) * 100);
            return (
              <div key={t.tier}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="capitalize text-white/60">{t.tier}</span>
                  <span className="text-white/40">{t.count} ({pct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: TIER_COLORS[t.tier] || '#666' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
