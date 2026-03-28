import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface Payment {
  id: number; customer_id: number; paypal_order_id: string;
  paypal_payer_id: string | null; paypal_payer_email: string | null;
  amount_usd: number; currency: string; tier: string;
  status: string; created_at: string;
  customer_email?: string; customer_name?: string;
}

interface Props { getToken: () => Promise<string | null>; }

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  refunded: 'bg-red-500/10 text-red-400 border-red-500/20',
  pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

const TIER_BADGE: Record<string, string> = {
  trial: 'text-yellow-400', hobbyist: 'text-blue-400', pro: 'text-racing-400', unlimited: 'text-purple-400',
};

export default function PaymentsPage({ getToken }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.authed(token).get<{
        payments: Payment[]; total: number; pages: number;
      }>(`/api/admin/payments?page=${page}`);
      setPayments(res.payments);
      setTotal(res.total);
      setPages(res.pages);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [getToken, page]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (d: string) => new Date(d).toLocaleString();
  const totalRevenue = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount_usd, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">
          Payments <span className="text-white/30 text-base font-normal">({total})</span>
        </h1>
        {totalRevenue > 0 && (
          <div className="text-sm text-green-400 font-mono">
            Page total: ${totalRevenue.toFixed(2)}
          </div>
        )}
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-white/30 text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Tier</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">PayPal Order</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3].map(i => (
                <tr key={i} className="border-b border-white/[0.03]">
                  {[0,1,2,3,4,5].map(j => <td key={j} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>)}
                </tr>
              ))
            ) : payments.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-white/30">No payments yet</td></tr>
            ) : payments.map(p => (
              <tr key={p.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-xs text-white/40">{fmtDate(p.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="text-xs text-white/70">{p.customer_email || p.paypal_payer_email}</div>
                  {p.customer_name && <div className="text-[10px] text-white/30">{p.customer_name}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold capitalize ${TIER_BADGE[p.tier] || 'text-white/50'}`}>{p.tier}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-green-400">${p.amount_usd.toFixed(2)}</td>
                <td className="px-4 py-3 font-mono text-[10px] text-white/25 truncate max-w-[120px]">{p.paypal_order_id}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${STATUS_STYLE[p.status] || STATUS_STYLE.pending}`}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}
