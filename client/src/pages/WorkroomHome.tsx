import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Video, ArrowRight, Headphones, CheckSquare, Square, Plus, X,
  Flame, Sparkles, Building2, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AppLayout }  from '@/components/AppLayout';
import { useAuth }    from '@/contexts/AuthContext';
import { useHuddle }  from '@/contexts/HuddleContext';
import { SessionClockCard } from '@/components/shared/SessionClockCard';
import { BriefStrip }              from '@/components/workroom/BriefStrip';
import { MyTasksCard }             from '@/components/workroom/MyTasksCard';
import { MyTargetsCard }           from '@/components/workroom/MyTargetsCard';
import { MeetingReminderBanner }   from '@/components/workroom/MeetingReminderBanner';
import * as api from '@/api';

/**
 * WorkroomHome — agency-wide default landing (May 2026 rebuild).
 *
 * Owner ask: this becomes the canonical home for every internal role
 * (admin / sales / employee / workroom). Lands here on login; legacy
 * role-specific dashboards stay reachable via the sidebar.
 *
 * Anatomy:
 *   1. Hero strip — same Rani Pink → Saffron gradient as Login.
 *   2. Session clock card (work timer + break + clock-out).
 *   3. Two big action tiles — Open Workroom + Join huddle.
 *   4. Important items checklist — personal todo, persisted to
 *      localStorage so it survives reloads without a backend change.
 *      Each user gets their own list, keyed by their userId.
 *   5. Priority Client CRM — top urgent/high projects from the
 *      agency-wide CRM, sorted by priority then by most-recent update.
 *      Each row clicks through to the Client Workspace page.
 */
export default function WorkroomHome() {
  const { user, role }  = useAuth();
  const huddle    = useHuddle();
  const navigate  = useNavigate();
  const firstName = (user?.name || user?.email || '').split(' ')[0];

  const joinHuddle = () => {
    try { huddle.join(); }
    catch { window.location.href = '/workroom'; }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Top-priority — meeting reminders. Renders nothing when the
            user has no meetings in the next 48h, so quiet days stay
            clean. When live, the 'Starting soon' card pulses red. */}
        {role !== 'workroom' && <MeetingReminderBanner />}

        {/* Hero — gradient strip matching the Login brand panel */}
        <div
          className="relative overflow-hidden rounded-2xl p-6 sm:p-7 text-white"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
        >
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="relative space-y-1">
            <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-white/70">Workroom</p>
            <h1 className="text-[26px] sm:text-[30px] font-black tracking-tight">
              Hi {firstName || 'there'}.
            </h1>
            <p className="text-[13px] text-white/85 max-w-md">
              Your workroom is ready. Hop into the huddle when you're set to start.
            </p>
          </div>
        </div>

        <SessionClockCard />

        {/* Daily brief — single row collapsed; expands into a 4-tile
            grid on click + Robin's AI read paragraph. Hides itself
            when empty so quiet days don't see a clutter banner.
            (MeetingReminderBanner above already covers next-up
            meetings prominently, so the secondary UpcomingStrip
            is intentionally removed — single source of truth.) */}
        {role !== 'workroom' && <BriefStrip />}

        {/* Action tiles — Workroom + huddle, same as before but tighter. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            to="/workroom"
            className="group rounded-xl border border-border bg-card p-4 flex items-center gap-3 hover:border-primary/40 transition-all"
          >
            <div className="h-10 w-10 rounded-lg bg-primary/12 text-primary flex items-center justify-center shrink-0">
              <Video className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-bold">Open Workroom</p>
              <p className="text-[11.5px] text-muted-foreground leading-snug">See who's around, share screen, join calls.</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-primary group-hover:translate-x-0.5 transition-transform" />
          </Link>

          <button
            onClick={joinHuddle}
            className="group rounded-xl border border-border bg-card p-4 flex items-center gap-3 text-left hover:border-emerald-500/40 transition-all"
          >
            <div className="h-10 w-10 rounded-lg bg-emerald-500/15 text-emerald-700 flex items-center justify-center shrink-0">
              <Headphones className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-bold">Join the huddle</p>
              <p className="text-[11.5px] text-muted-foreground leading-snug">Drop into the agency-wide voice channel.</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-emerald-700 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* Main content grid.
            - workroom role: 1 col (personal items only)
            - others: 3 cols on lg (items / tasks / priority brands),
                      stacks gracefully to 2 then 1 below.
            Targets live below the row at full width so the bar
            visualisations have room to breathe. */}
        {role === 'workroom' ? (
          <ImportantItemsCard userId={user?.id || ''} />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <ImportantItemsCard userId={user?.id || ''} />
              <MyTasksCard />
              <PriorityClientsCard onOpen={(id) => navigate(`/clients/pipeline/${id}`)} />
            </div>
            <MyTargetsCard />
          </>
        )}

        {role === 'workroom' && (
          <p className="text-[11px] text-muted-foreground text-center">
            You're on the Workroom-only role. Need access to tasks or other tools? Ask your admin.
          </p>
        )}
      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Important items checklist
// ─────────────────────────────────────────────────────────────────────
// Personal to-do list, persisted client-side. Each user gets their
// own key. Server-side checklist would be cleaner but adds API +
// model — this lands the feature today and is easy to migrate later.
interface CLItem { id: string; text: string; done: boolean }
function ImportantItemsCard({ userId }: { userId: string }) {
  const LS_KEY = `robin.workroom.items.${userId || 'anon'}`;
  const [items, setItems] = useState<CLItem[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* ignore — fresh list */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch { /* private mode */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    setItems(prev => [{ id: String(Date.now()), text: t, done: false }, ...prev]);
    setDraft('');
  };
  const toggle = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done } : i));
  const remove = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  const openCount = items.filter(i => !i.done).length;
  const doneCount = items.filter(i =>  i.done).length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-3.5 w-3.5 text-primary" />
          <p className="text-[12px] font-bold">Important items</p>
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          <span className="font-bold text-amber-700">{openCount}</span> open
          <span className="text-muted-foreground/60 mx-1">·</span>
          <span className="font-bold text-emerald-700">{doneCount}</span> done
        </p>
      </div>
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add a personal todo — e.g. follow up with Acme tomorrow"
          className="flex-1 min-w-0 px-3 h-8 bg-background border border-input rounded-md text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50 hover:bg-primary/90 inline-flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground italic">
          No items yet. Add the things you don't want to forget today.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 max-h-[280px] overflow-y-auto">
          {items.map(item => (
            <li key={item.id} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/30 group">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className={`h-4 w-4 rounded flex items-center justify-center shrink-0 ${
                  item.done ? 'bg-emerald-500 text-white' : 'border border-border bg-card hover:border-primary'
                }`}
                aria-label={item.done ? 'Re-open' : 'Mark complete'}
              >
                {item.done && <CheckSquare className="h-2.5 w-2.5" />}
                {!item.done && <Square className="h-2.5 w-2.5 opacity-0" />}
              </button>
              <span className={`flex-1 min-w-0 text-[12.5px] truncate ${item.done ? 'line-through text-muted-foreground' : ''}`}>
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 transition-opacity"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Priority Client CRM
// ─────────────────────────────────────────────────────────────────────
// Top urgent + high priority Client CRM entries. Reads the existing
// /api/client-workflows endpoint, sorts by priority then most-recent,
// shows max 6 rows. Click any row → drill into the Client Workspace.
const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
function PriorityClientsCard({ onOpen }: { onOpen: (workflowId: string) => void }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setL]     = useState(true);

  useEffect(() => {
    api.cwListWorkflows({})
      .then((d: any[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setL(false));
  }, []);

  const top = useMemo(() => {
    return rows
      .slice()
      .sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority || 'medium'] || 2;
        const pb = PRIORITY_RANK[b.priority || 'medium'] || 2;
        if (pa !== pb) return pb - pa;
        return Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '');
      })
      .slice(0, 6);
  }, [rows]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-rose-600" />
          <p className="text-[12px] font-bold">Priority clients</p>
        </div>
        <Link
          to="/clients/pipeline"
          className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
        >
          See all <ArrowRight className="h-2.5 w-2.5" />
        </Link>
      </div>
      {loading ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
          <Sparkles className="h-3 w-3 animate-pulse" /> Loading…
        </p>
      ) : top.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground italic">
          No active Client CRM entries yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 max-h-[280px] overflow-y-auto">
          {top.map(wf => {
            const priority = (wf.priority || 'medium') as keyof typeof PRIORITY_RANK;
            const pCls =
              priority === 'urgent' ? 'bg-rose-500/12 text-rose-700' :
              priority === 'high'   ? 'bg-amber-500/15 text-amber-700' :
              priority === 'medium' ? 'bg-blue-500/12 text-blue-700' :
                                       'bg-muted text-muted-foreground';
            const activeSvc = (wf.services || []).find((s: any) => s.status === 'in_progress')
                           || (wf.services || []).find((s: any) => s.status !== 'done');
            const stageLabel = activeSvc?.label || 'Discovery';
            const updated = wf.updatedAt ? formatDistanceToNow(parseISO(wf.updatedAt), { addSuffix: true }) : '';
            return (
              <li key={wf._id}>
                <button
                  type="button"
                  onClick={() => onOpen(wf._id)}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 text-left"
                >
                  <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                    <Building2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold truncate">{wf.clientName || 'Unnamed'}</p>
                    <p className="text-[10.5px] text-muted-foreground truncate">
                      {stageLabel}{updated && <> · {updated}</>}
                    </p>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${pCls}`}>
                    {priority}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
