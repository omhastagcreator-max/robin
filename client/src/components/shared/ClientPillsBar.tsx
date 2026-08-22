import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * ClientPillsBar — every ACTIVE client, always on screen.
 *
 * Owner ask (Aug 2026): "I want all the client pills to be fixed on header
 * always so that each client name should be there so that active clients
 * are always visible as soon as Rishi adds it should be visible across all
 * the Robin, also make sure it's static."
 *
 * Three requirements, three design decisions:
 *
 *  1. "fixed on header always" / "static" → this renders as a sticky strip
 *     pinned directly beneath the 44px TopBar (top: var(--h-topbar)), inside
 *     the persistent AppLayout shell. So it survives every route change and
 *     never scrolls out of view — the client roster is furniture, not page
 *     content.
 *
 *  2. "as soon as Rishi adds it should be visible across all the Robin" →
 *     we listen for the `robin:data-changed` DOM event that AppLayout
 *     re-dispatches from the server's `data:changed` socket broadcast.
 *     createWorkflow already fires that, so a client onboarded on the Sales
 *     Dashboard appears in everyone's header within a second — no refresh.
 *     The 5-min poll is only a fallback for a dropped socket.
 *
 *  3. "active clients" → filtered on operationalStatus. Completed/cancelled
 *     engagements drop out automatically, so the strip stays the CURRENT
 *     roster rather than growing forever.
 *
 * Bandwidth note: Robin's Render workspace was suspended in Aug 2026 for
 * blowing its bandwidth cap, so this deliberately does NOT poll aggressively
 * — 5-minute interval, skipped entirely while the tab is hidden, and it
 * leans on the socket event for freshness instead. Same discipline as
 * useVisiblePoll elsewhere in the app.
 */

interface ClientPill {
  _id: string;
  clientName: string;
  healthLevel?: 'green' | 'yellow' | 'orange' | 'red';
  operationalStatus?: string;
}

// Engagements that are over — they stop being part of the live roster.
const INACTIVE_STATUSES = ['completed', 'cancelled'];

// Health → dot colour. Mirrors the four-colour traffic light used on the
// Client CRM cards so the same client reads the same everywhere.
const DOT: Record<string, string> = {
  green:  'bg-emerald-500',
  yellow: 'bg-amber-500',
  orange: 'bg-orange-500',
  red:    'bg-red-500',
};

const POLL_MS = 5 * 60_000;

export function ClientPillsBar() {
  const { role } = useAuth();
  const location = useLocation();
  const [clients, setClients] = useState<ClientPill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Internal staff only. Clients logging into their own portal shouldn't
  // see the entire agency roster.
  const isStaff = !!role && ['admin', 'sales', 'employee', 'workroom'].includes(role);

  const load = useCallback(() => {
    if (!isStaff) return;
    api.cwListWorkflows()
      .then((list: ClientPill[]) => {
        const active = (list || [])
          .filter(w => !INACTIVE_STATUSES.includes(String(w.operationalStatus || 'in_progress')))
          .sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''));
        setClients(active);
        setLoaded(true);
      })
      .catch(() => { /* silent — the strip just keeps its last good list */ });
  }, [isStaff]);

  useEffect(() => {
    if (!isStaff) return;
    load();

    // Live update — server broadcasts data:changed on every workflow
    // mutation; AppLayout re-dispatches it as a DOM event. Debounced so a
    // burst of changes (bulk edit, script run) triggers one refetch.
    const onDataChanged = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 800);
    };
    window.addEventListener('robin:data-changed', onDataChanged);

    // Fallback poll — skipped while the tab is hidden (bandwidth).
    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load();
    }, POLL_MS);

    return () => {
      window.removeEventListener('robin:data-changed', onDataChanged);
      clearInterval(iv);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isStaff, load]);

  if (!isStaff) return null;
  // Render nothing until the first successful load, so we never flash an
  // empty bar and shove the page down a moment later.
  if (!loaded || clients.length === 0) return null;

  return (
    <div
      className="sticky z-20 bg-card/95 backdrop-blur border-b border-border"
      style={{ top: 'var(--h-topbar)' }}
    >
      <div className="flex items-center gap-1.5 px-4 h-9 overflow-x-auto scrollbar-thin">
        <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground pr-1">
          Clients
        </span>
        {clients.map(c => {
          // Highlight whichever client's workspace is currently open.
          const isActive = location.pathname.startsWith(`/clients/pipeline/${c._id}`);
          return (
            <Link
              key={c._id}
              to={`/clients/pipeline/${c._id}`}
              title={c.clientName}
              className={`shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11.5px] font-semibold transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-foreground border-border hover:bg-muted'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[c.healthLevel || 'green'] || DOT.green}`} />
              <span className="max-w-[140px] truncate">{c.clientName}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
