import { useEffect, useRef, useState, useCallback } from 'react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { ClientQuickUpdateModal } from '@/components/shared/ClientQuickUpdateModal';

/**
 * ClientPillsBar — every ACTIVE client Rishi has onboarded, always on screen.
 *
 * Owner asks (Aug 2026), in order:
 *  1. "all the client pills fixed on header always … active clients are
 *      always visible … make sure it's static"
 *  2. "as soon as Rishi adds it should be visible across all the Robin"
 *  3. "make sure these clients should be added by Rishi and then only it
 *      should come here"
 *  4. "when clicked open a popup for all type of update being on that same
 *      page only"
 *  5. "make sure the row is stacked"
 *
 * How each is met:
 *
 *  (1) "static" → mounted in the persistent AppLayout shell directly under
 *      the TopBar, inside a shared sticky z-40 wrapper, so the header block
 *      pins as one unit and survives every route change. (First attempt made
 *      THIS component sticky on its own at z-20; SessionTopBar is sticky
 *      top-0 z-30 and painted over it the moment you scrolled — hence the
 *      wrapper. See AppLayout for the full note.)
 *
 *  (2) live → listens for `robin:data-changed`, the DOM event AppLayout
 *      re-dispatches from the server's `data:changed` socket broadcast.
 *      createWorkflow fires it ('workflow.created'), so a client Rishi
 *      onboards on the Sales Dashboard appears in every teammate's header
 *      within ~1s. Debounced 800ms so a burst = one refetch.
 *
 *  (3) "added by Rishi and then only it should come here" — resolved, after
 *      a round trip, as a statement about the FLOW, not a filter: Rishi
 *      enters a client on the Sales Dashboard and it lands here by itself
 *      (that's (2) above). An earlier pass read it as "show only
 *      sales-attributed workflows" and filtered on onboardedBy/createdBy —
 *      that was wrong, and it hid every older bulk-imported client. The
 *      owner's follow-up ("the pop up should open when I click on ANY
 *      client") settled it: every active client belongs in the strip.
 *
 *  (4) click → opens ClientQuickUpdateModal OVER the current page. It does
 *      not navigate; that was the explicit complaint.
 *
 *  (5) "stacked" → the pill container wraps (flex-wrap) onto as many rows as
 *      it needs instead of scrolling sideways, so every client name is
 *      readable at once without horizontal scrolling.
 *
 * Bandwidth note: Robin's Render workspace was suspended in Aug 2026 for
 * blowing its bandwidth cap, so this deliberately does NOT poll hard — 5-min
 * interval, skipped while the tab is hidden, freshness comes from the socket.
 */

interface ClientPill {
  _id: string;
  clientName: string;
  healthLevel?: 'green' | 'yellow' | 'orange' | 'red';
  operationalStatus?: string;
  ownerFlag?: string;
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

// The owner's manual flag OUTRANKS the auto-computed health dot — if a
// human has said "this one is critical", that's the signal that should be
// on screen, not the cron's guess. Unflagged clients fall back to health.
const FLAG_DOT: Record<string, string> = {
  smooth:          'bg-emerald-500',
  needs_attention: 'bg-amber-500',
  critical:        'bg-red-600',
};
// Critical also gets a ring so it stands out even at a glance across a
// wall of pills — colour alone is easy to miss (and unreadable for the
// colour-blind).
const FLAG_RING: Record<string, string> = {
  critical: 'border-red-500/60 bg-red-500/10',
};

const POLL_MS = 5 * 60_000;

export function ClientPillsBar() {
  const { role } = useAuth();
  const [clients, setClients] = useState<ClientPill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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
      .catch(() => { /* silent — the strip keeps its last good list */ });
  }, [isStaff]);

  useEffect(() => {
    if (!isStaff) return;
    load();

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
    <>
      {/* Not sticky itself — AppLayout wraps this + TopBar in ONE sticky
          z-40 container so the whole header block pins together and stays
          above SessionTopBar (which is sticky top-0 z-30 and used to paint
          over these pills on scroll). */}
      <div className="bg-card/95 backdrop-blur border-b border-border">
        {/* Stacked: wraps onto as many rows as needed — no sideways scroll,
            every client name readable at a glance. */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5">
          <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground pr-1">
            Clients
          </span>
          {clients.map(c => {
            const flag = c.ownerFlag || '';
            const dot  = FLAG_DOT[flag] || DOT[c.healthLevel || 'green'] || DOT.green;
            const skin = FLAG_RING[flag] || 'border-border bg-muted/50';
            return (
              <button
                key={c._id}
                onClick={() => setOpenId(c._id)}
                title={`${c.clientName}${flag ? ` — ${flag.replace(/_/g, ' ')}` : ''} · click to update`}
                className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-foreground text-[11.5px] font-semibold hover:bg-muted transition-colors ${skin}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                <span className="max-w-[160px] truncate">{c.clientName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {openId && (
        <ClientQuickUpdateModal clientId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
