import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { installGlobalErrorReporters } from '@/lib/errorReporter';

// Catch unhandled JS errors and ship them to /api/logs/error so admins
// have one centralized crash log for both server and client errors.
installGlobalErrorReporters();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
// cache bust Thu Sep 24 13:08:18 IST 2026
