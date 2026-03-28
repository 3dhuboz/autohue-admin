import { useState } from 'react';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, useAuth, useUser } from '@clerk/clerk-react';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/CustomersPage';
import LicensesPage from './pages/LicensesPage';
import PaymentsPage from './pages/PaymentsPage';
import ReleasesPage from './pages/ReleasesPage';
import SettingsPage from './pages/SettingsPage';


const ADMIN_EMAILS = ['steve@3dhub.au', 'steve@pennywiseit.com.au'];

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'customers', label: 'Customers' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'payments', label: 'Payments' },
  { id: 'releases', label: 'Releases' },
  { id: 'settings', label: 'Settings' },
];

function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const { getToken } = useAuth();
  const { user } = useUser();

  const email = user?.primaryEmailAddress?.emailAddress || '';
  const isAdmin = ADMIN_EMAILS.includes(email);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111113]">
        <div className="glass-card p-8 max-w-sm w-full text-center">
          <h1 className="text-xl font-heading font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/40 text-sm">{email} is not an admin.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <nav className="sticky top-0 z-50 bg-[#111113]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-racing-500 to-racing-700 flex items-center justify-center">
                <span className="text-white text-xs font-black">A</span>
              </div>
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
      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'dashboard' && <DashboardPage getToken={getToken} />}
        {tab === 'customers' && <CustomersPage getToken={getToken} />}
        {tab === 'licenses' && <LicensesPage getToken={getToken} />}
        {tab === 'payments' && <PaymentsPage getToken={getToken} />}
        {tab === 'releases' && <ReleasesPage getToken={getToken} />}
        {tab === 'settings' && <SettingsPage getToken={getToken} />}
      </main>
    </>
  );
}

export default function AppWithClerk({ clerkKey }: { clerkKey: string }) {
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <div className="min-h-screen bg-[#111113]">
        <SignedOut>
          <div className="min-h-screen flex items-center justify-center">
            <div className="glass-card p-8 max-w-sm w-full text-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-racing-500 to-racing-700 flex items-center justify-center mx-auto mb-4">
                <span className="text-white text-lg font-black">A</span>
              </div>
              <h1 className="text-xl font-heading font-bold text-white mb-2">AutoHue Admin</h1>
              <p className="text-white/40 text-sm mb-6">Sign in to manage licenses, customers, and payments.</p>
              <SignInButton mode="modal">
                <button className="btn-racing w-full py-3 text-sm">Sign In</button>
              </SignInButton>
            </div>
          </div>
        </SignedOut>
        <SignedIn>
          <AdminDashboard />
        </SignedIn>
      </div>
    </ClerkProvider>
  );
}
