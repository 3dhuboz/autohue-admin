import { useState } from 'react';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/CustomersPage';
import LicensesPage from './pages/LicensesPage';
import PaymentsPage from './pages/PaymentsPage';
import AccuracyLabPage from './pages/accuracy-lab';
import ReleasesPage from './pages/ReleasesPage';

type Tab = 'dashboard' | 'customers' | 'licenses' | 'payments' | 'releases' | 'accuracy';

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'customers', label: 'Customers' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'payments', label: 'Payments' },
  { id: 'releases', label: 'Releases' },
  { id: 'accuracy', label: 'Accuracy Lab' },
];

// In dev mode (no Clerk key), getToken returns a mock token
const devGetToken = async () => 'dev-token';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  // When Clerk is configured, these will be overridden by ClerkAdminApp
  // For now in dev mode, render directly with mock auth
  const email = 'steve@3dhub.au';
  const getToken = devGetToken;

  return (
    <div className="min-h-screen bg-[#111113]">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[#111113]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 64 64" fill="none" width="28" height="28">
                <defs>
                  <linearGradient id="lr" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#FF4444"/>
                    <stop offset="25%" stopColor="#FF8C00"/>
                    <stop offset="50%" stopColor="#FFD700"/>
                    <stop offset="75%" stopColor="#00C853"/>
                    <stop offset="100%" stopColor="#2979FF"/>
                  </linearGradient>
                </defs>
                <rect width="64" height="64" rx="14" fill="#1A1A2E"/>
                <circle cx="32" cy="32" r="27" stroke="url(#lr)" strokeWidth="3.5" fill="none"/>
                <g transform="translate(32,36)">
                  <path d="M-17,3 L-17,-2 L-13,-13 Q-11,-17 -7,-17 L9,-17 Q13,-17 15,-13 L19,-2 L19,3 Z" fill="white" fillOpacity="0.9"/>
                  <circle cx="-9" cy="5" r="3.5" fill="#1A1A2E"/>
                  <circle cx="13" cy="5" r="3.5" fill="#1A1A2E"/>
                  <circle cx="-4" cy="-4" r="2" fill="#FF4444"/>
                  <circle cx="2" cy="-4" r="2" fill="#FFD700"/>
                  <circle cx="8" cy="-4" r="2" fill="#2979FF"/>
                </g>
              </svg>
              <span className="font-heading font-bold text-sm text-white/80">AutoHue Admin</span>
            </div>
            <div className="flex gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    tab === t.id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-white/30">{email}</span>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'dashboard' && <DashboardPage getToken={getToken} />}
        {tab === 'customers' && <CustomersPage getToken={getToken} />}
        {tab === 'licenses' && <LicensesPage getToken={getToken} />}
        {tab === 'payments' && <PaymentsPage getToken={getToken} />}
        {tab === 'releases' && <ReleasesPage getToken={getToken} />}
        {tab === 'accuracy' && <AccuracyLabPage />}
      </main>
    </div>
  );
}
