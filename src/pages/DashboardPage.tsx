import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import MiniBarChart from '../components/MiniBarChart';
import MiniLineChart from '../components/MiniLineChart';
import ActivityFeed from '../components/ActivityFeed';

interface DashboardData {
  totalCustomers: number;
  tierBreakdown: { tier: string; count: number }[];
  totalRevenue: number;
  revenueThisMonth: number;
  validationsLast24h: number;
  newCustomersThisWeek: number;
}

interface ChartData {
  validationsPerDay: { day: string; count: number }[];
  revenuePerMonth: { month: string; total: number }[];
  activeUsersPerDay: { day: string; count: number }[];
}

interface Props {
  getToken: () => Promise<string | null>;
}

const TIER_COLORS: Record<string, string> = {
  trial: '#eab308', hobbyist: '#3b82f6', pro: '#ef4444', unlimited: '#a855f7',
};

export default function DashboardPage({ getToken }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [charts, setCharts] = useState<ChartData | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const [d, c, a] = await Promise.all([
        api.authed(token).get<DashboardData>('/api/admin/dashboard'),
        api.authed(token).get<ChartData>('/api/admin/dashboard/charts'),
        api.authed(token).get<{ activity: any[] }>('/api/admin/activity'),
      ]);
      setData(d);
      setCharts(c);
      setActivity(a.activity || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Dashboard load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds
    pollRef.current = setInterval(load, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[0,1,2,3,4].map(i => <div key={i} className="glass-card p-6 h-24 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0,1].map(i => <div key={i} className="glass-card p-6 h-52 animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!data) return <p className="text-white/40 text-sm">Failed to load dashboard.</p>;

  const stats = [
    { label: 'Total Customers', value: String(data.totalCustomers), color: 'text-white', accent: '#fff' },
    { label: 'Revenue (All Time)', value: `$${data.totalRevenue.toLocaleString()}`, color: 'text-green-400', accent: '#22c55e' },
    { label: 'Revenue (30 days)', value: `$${data.revenueThisMonth.toLocaleString()}`, color: 'text-green-400', accent: '#22c55e' },
    { label: 'Validations (24h)', value: String(data.validationsLast24h.toLocaleString()), color: 'text-blue-400', accent: '#3b82f6' },
    { label: 'New This Week', value: String(data.newCustomersThisWeek), color: 'text-purple-400', accent: '#a855f7' },
  ];

  const totalInBreakdown = data.tierBreakdown.reduce((s, t) => s + t.count, 0) || 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">
          Dashboard <span className="text-racing-500">Overview</span>
        </h1>
        {lastUpdated && (
          <span className="text-[10px] text-white/20">
            Updated {lastUpdated.toLocaleTimeString()} &middot; refreshes every 30s
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {stats.map(s => (
          <div key={s.label} className="glass-card p-5 group hover:border-white/10 transition-colors">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">{s.label}</p>
            <p className={`text-2xl font-heading font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Charts Row 1: Validations + Revenue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h2 className="text-xs font-heading font-semibold text-white/50 mb-3">Validations (30 days)</h2>
          <MiniBarChart
            data={(charts?.validationsPerDay || []).map(d => ({ label: d.day, value: d.count }))}
            color="#3b82f6"
            height={150}
          />
        </div>
        <div className="glass-card p-5">
          <h2 className="text-xs font-heading font-semibold text-white/50 mb-3">Revenue (Monthly)</h2>
          <MiniLineChart
            data={(charts?.revenuePerMonth || []).map(d => ({ label: d.month, value: d.total }))}
            color="#22c55e"
            height={150}
            fill
          />
        </div>
      </div>

      {/* Charts Row 2: Active Users + Tier Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h2 className="text-xs font-heading font-semibold text-white/50 mb-3">Active Users (30 days)</h2>
          <MiniLineChart
            data={(charts?.activeUsersPerDay || []).map(d => ({ label: d.day, value: d.count }))}
            color="#a855f7"
            height={150}
            fill
          />
        </div>
        <div className="glass-card p-5">
          <h2 className="text-xs font-heading font-semibold text-white/50 mb-3">Customers by Tier</h2>
          <div className="space-y-3 pt-2">
            {data.tierBreakdown.map(t => {
              const pct = Math.round((t.count / totalInBreakdown) * 100);
              return (
                <div key={t.tier}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="capitalize text-white/60">{t.tier}</span>
                    <span className="text-white/40">{t.count} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: TIER_COLORS[t.tier] || '#666' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="glass-card p-5">
        <h2 className="text-xs font-heading font-semibold text-white/50 mb-3">Recent Activity</h2>
        <ActivityFeed items={activity} />
      </div>
    </div>
  );
}
