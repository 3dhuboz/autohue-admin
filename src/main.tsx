import React from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

// Always try Clerk first when key is present — NO silent fallback
if (CLERK_KEY) {
  import('./AppWithClerk').then(({ default: AppWithClerk }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <AppWithClerk clerkKey={CLERK_KEY} />
      </React.StrictMode>
    );
  });
} else {
  // Dev mode only — no Clerk key
  import('./App').then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
