import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import './assets/index.css';
import { ApiError } from './api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Public content is CDN/Redis-cached server-side (§10.1); the client does
      // not need to re-fetch on every window focus.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an auth/permission failure — it will not succeed.
        if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Opt in to the v7 behaviours now so the console stays clean and the
          eventual upgrade is a no-op. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
