interface ActivityItem {
  event_type: string;
  created_at: string;
  email?: string;
  tier?: string;
  amount_usd?: number;
  status?: string;
  action?: string;
  admin_email?: string;
  details?: string;
}

interface ActivityFeedProps {
  items: ActivityItem[];
}

const EVENT_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  customer_joined: { icon: '+', color: '#22c55e', label: 'New Customer' },
  payment:         { icon: '$', color: '#3b82f6', label: 'Payment' },
  admin_action:    { icon: 'A', color: '#a855f7', label: 'Admin' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function describe(item: ActivityItem): string {
  switch (item.event_type) {
    case 'customer_joined':
      return `${item.email} signed up (${item.tier})`;
    case 'payment':
      return `$${item.amount_usd} from ${item.email || 'unknown'} (${item.tier})`;
    case 'admin_action':
      return `${item.admin_email}: ${item.action}`;
    default:
      return item.event_type;
  }
}

export default function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) return <div className="text-white/20 text-xs text-center py-6">No recent activity</div>;

  return (
    <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
      {items.map((item, i) => {
        const cfg = EVENT_CONFIG[item.event_type] || EVENT_CONFIG.admin_action;
        return (
          <div key={`${item.event_type}-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black shrink-0"
              style={{ backgroundColor: cfg.color + '20', color: cfg.color }}
            >
              {cfg.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/60 truncate">{describe(item)}</p>
            </div>
            <span className="text-[10px] text-white/25 shrink-0">{timeAgo(item.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}
