import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { installGlobalErrorReporters } from '@/lib/errorReporter';
import { applyCacheResetIfNeeded } from '@/lib/cacheReset';

// Catch unhandled JS errors and ship them to /api/logs/error so admins
// have one centralized crash log for both server and client errors.
installGlobalErrorReporters();

// Oct 2026 — one-time org-wide cache/cookie reset (see lib/cacheReset.ts).
// Renders only if no reset is needed; otherwise the page reloads clean.
applyCacheResetIfNeeded().then((reloading) => {
  if (reloading) return;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
// cache bust Thu Sep 24 13:08:18 IST 2026
