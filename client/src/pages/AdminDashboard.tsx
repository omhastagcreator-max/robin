import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Sparkles, RefreshCw, ArrowRight, AlertTriangle, Flame, Phone,
  Loader2, Users, Building2, CalendarOff, BarChart2,
  ClipboardCheck, ListTodo, Clock,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { Button }     from '@/components/ui/Button';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Row }        from '@/components/ui/Row';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs }       from '@/components/ui/Tabs';
import { useDrawer }  from '@/components/ui/RightDrawer';
import { LeadDetailPanel }      from '@/components/panels/LeadDetailPanel';
import { TeammateDetailPanel }  from '@/components/panels/TeammateDetailPanel';
import { useShortcut } from '@/hooks/useShortcut';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/shared/Avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useUnifiedPresence, type UnifiedPresence } from '@/hooks/useUnifiedPresence';
import * as api from '@/api';

/**
 * AdminDashboard v2 — rebuilt from scratch on the design-system primitives.
 *
 * What changed vs. v1:
 *   • No more KPI card grid. Replaced with a single inline stat strip.
 *   • No more nested cards. Every list section uses the <Row> primitive.
 *   • TeamStatus consumes useUnifiedPresence — fixes the presence-vs-huddle
 *     desync (Priyanka in huddle / Sakshi shows Working) by reading from a
 *     SINGLE unified state instead of cross-referencing two systems.
 *   • Hot leads + open issues are inline-actionable: every row carries the
 *     next action so admin doesn't have to drill into a detail page to
 *     decide what to do.
 *   • Recharts removed — the previous trend chart was 2 weeks of "tasks
 *     completed per day" which read better as a single delta number.
 *   • Morning brief is a hero block at the top, refreshable inline.
 *
 * Density: 3 visible sections per fold on a 13" MacBook, vs. 1.5 in v1.
 */

interface Stats {
  totalTasks?: number;
  completedTasks?: number;
  overdueTasks?: number;
  totalProjects?: number;
  activeProjects?: number;
  activeEmployees?: number;
}
interface Lead {
  _id: string;
  name: string;
  estimatedValue?: number;
  aiScore?: 'hot' | 'warm' | 'cold' | '';
  aiNextAction?: string;
  contact?: string;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const presence = useUnifiedPresence();
  const drawer = useDrawer();
  const navigate = useNavigate();

  /** Open a lead in the right drawer instead of navigating away. */
  const openLead = (lead: { _id: string; name?: string; contact?: string }) => {
    drawer.open({
      title: lead.name || 'Lead',
      subtitle: lead.contact || '',
      width: 'md',
      content: <LeadDetailPanel leadId={lead._id} />,
    });
  };

  /** Open a teammate in the right drawer — live presence + 30-day report. */
  const openTeammate = (p: UnifiedPresence) => {
    drawer.open({
      title: p.name || 'Teammate',
      subtitle: p.role || '',
      width: 'md',
      content: <TeammateDetailPanel userId={p.userId} />,
    });
  };

  // `n` — quick new lead. Sales kanban handles the creation UX; we just
  // jump there with focus.
  useShortcut('n', () => navigate('/sales'));

  const [stats, setStats]                 = useState<Stats | null>(null);
  const [hotLeads, setHotLeads]           = useState<Lead[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);

  /** Cheap structural fingerprint — skip setState when nothing changed.
   * Same pattern that fixed the dashboard-fluctuation complaint earlier. */
  const sigRef = useRef('');

  const load = useCallback(async (bg = false) => {
    if (bg) setRefreshing(true); else setLoading(true);
    try {
      const [s, leads, leaves] = await Promise.all([
        api.getAdminStats().catch(() => null),
        api.listLeads({}).catch(() => []),
        api.adminListLeaves({ status: 'pending' }).catch(() => []),
      ]);
      const hl = (Array.isArray(leads) ? leads : [])
        .filter((l: any) => l.aiScore === 'hot' && !['won', 'lost'].includes(l.stage || l.status))
        .slice(0, 5);
      const lc = Array.isArray(leaves) ? leaves.length : 0;
      const sig = JSON.stringify({
        s: s ? { active: (s as any).activeEmployees, todo: (s as any).completedTasks, prj: (s as any).activeProjects } : null,
        hl: hl.map((l: any) => `${l._id}/${l.aiScore}`).join(','),
        lc,
      });
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setStats(s);
      setHotLeads(hl);
      setPendingLeaves(lc);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Background refresh — 90s, fingerprint-skipped.
  useEffect(() => {
    const i = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') load(true);
    }, 90_000);
    return () => clearInterval(i);
  }, [load]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12)      return 'Good morning';
    if (h < 17)      return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = (user?.name || user?.email || 'there').split(' ')[0];

  return (
    <AppLayout requiredRole="admin">
      <div className="px-6 py-5 space-y-6 max-w-[1400px] mx-auto">

        {/* ───── HEADER ───── */}
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted-foreground">
              {format(new Date(), 'EEEE · d MMM yyyy')}
            </p>
            <h1 className="mt-1 text-[28px] font-bold tracking-tight leading-none">
              {greeting}, <span className="text-primary">{firstName}</span>.
            </h1>
          </div>

          {/* Inline stat strip — replaces the 4-KPI card row. */}
          <div className="flex items-center gap-6 text-[12px]">
            <Stat icon={<Users className="h-3.5 w-3.5" />}       value={presence.working.length + presence.inHuddle.length} label="active" tone="primary" />
            <Stat icon={<Clock className="h-3.5 w-3.5" />}       value={presence.onBreak.length}             label="on break"          tone={presence.onBreak.length > 0 ? 'warning' : 'muted'} />
            <Stat icon={<CalendarOff className="h-3.5 w-3.5" />} value={pendingLeaves}                       label="leave approvals"   tone={pendingLeaves > 0 ? 'warning' : 'muted'} />
            <Stat icon={<Building2 className="h-3.5 w-3.5" />}   value={(stats as any)?.activeProjects ?? 0} label="active projects" />
            <Button intent="ghost" size="xs" onClick={() => load(true)} iconLeft={refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}>
              {refreshing ? '' : 'Refresh'}
            </Button>
          </div>
        </header>

        {/* ───── AI MORNING BRIEF ───── */}
        <MorningBriefBlock />

        {/* ───── TWO-COLUMN: TEAM + WORK ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-5">
          {/* Team — live, unified presence (single source of truth) */}
          <section>
            <SectionHeader title="Team — live" hint="Combined clock + huddle state" />
            <div className="rounded-md border border-border bg-card overflow-hidden">
              {loading && presence.list.length === 0 ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : presence.list.length === 0 ? (
                <EmptyState size="sm" title="Nobody's around" hint="The team status panel updates live as people clock in or join the huddle." />
              ) : (
                presence.list.map(p => <TeamRow key={p.userId} p={p} onOpen={() => openTeammate(p)} />)
              )}
            </div>
          </section>

          {/* Today — focused work list */}
          <aside>
            <SectionHeader title="Today" hint="What needs your eye" />
            <div className="rounded-md border border-border bg-card overflow-hidden">
              <FocusRow icon={<Flame className="h-3.5 w-3.5 text-rose-500" />}
                label={`${hotLeads.length} hot lead${hotLeads.length === 1 ? '' : 's'}`}
                to="/sales" />
              <FocusRow icon={<ClipboardCheck className="h-3.5 w-3.5 text-amber-600" />}
                label={`${pendingLeaves} leave approval${pendingLeaves === 1 ? '' : 's'}`}
                to="/admin/leaves"
                muted={pendingLeaves === 0} />
              <FocusRow icon={<ListTodo className="h-3.5 w-3.5 text-emerald-600" />}
                label={`${(stats as any)?.overdueTasks ?? 0} overdue task${((stats as any)?.overdueTasks === 1) ? '' : 's'}`}
                to="/tasks"
                muted={!(stats as any)?.overdueTasks} />
              <FocusRow icon={<AlertTriangle className="h-3.5 w-3.5 text-orange-600" />}
                label="Issues + AI"
                to="/admin/issues" />
              <FocusRow icon={<BarChart2 className="h-3.5 w-3.5 text-primary" />}
                label="Full reports"
                to="/admin/reports" />
            </div>
          </aside>
        </div>

        {/* ───── HOT LEADS ───── */}
        {hotLeads.length > 0 && (
          <section>
            <SectionHeader title="Hot leads" hint="AI-scored · click for next action" />
            <div className="rounded-md border border-border bg-card overflow-hidden">
              {hotLeads.map(l => <HotLeadRow key={l._id} lead={l} onOpen={() => openLead(l)} />)}
            </div>
          </section>
        )}

      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Building blocks (kept in-file because they're admin-dashboard-specific).
// ─────────────────────────────────────────────────────────────────────────

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <h2 className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/70">{title}</h2>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Single live team row — Avatar + name + role + unified status pill.
 *  Click opens the teammate detail in the right drawer (Phase 3 integration). */
function TeamRow({ p, onOpen }: { p: UnifiedPresence; onOpen: () => void }) {
  const accent =
    p.displayState === 'in_huddle' ? 'primary' :
    p.displayState === 'working'   ? 'success' :
    p.displayState === 'on_break'  ? 'warning' :
    p.displayState === 'on_leave'  ? 'info'    :
                                     'none';
  return (
    <Row accent={accent as any} onClick={onOpen}>
      <Row.Leading>
        <Avatar name={p.name} email={p.email} size="sm" tone="primary" />
      </Row.Leading>
      <Row.Main>
        <Row.Title>{p.name || 'Unknown'}</Row.Title>
        <Row.Meta>
          {p.role || 'employee'}{p.sharingScreen ? ' · sharing screen' : ''}{p.onCall ? ' · on call' : ''}
        </Row.Meta>
      </Row.Main>
      <Row.Trail>
        <StatusPill state={p.displayState as Status} size="xs" />
      </Row.Trail>
    </Row>
  );
}

/** Focused-action row in the right column. */
function FocusRow({ icon, label, to, muted }: { icon: React.ReactNode; label: string; to: string; muted?: boolean }) {
  return (
    <Link to={to} className="block group">
      <Row>
        <Row.Leading>{icon}</Row.Leading>
        <Row.Main>
          <Row.Title className={muted ? 'text-muted-foreground' : ''}>{label}</Row.Title>
        </Row.Main>
        <Row.Trail>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
        </Row.Trail>
      </Row>
    </Link>
  );
}

function HotLeadRow({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  return (
    <Row accent="danger" onClick={onOpen}>
      <Row.Leading>
        <Flame className="h-3.5 w-3.5 text-rose-500" />
      </Row.Leading>
      <Row.Main>
        <Row.Title>{lead.name || 'Unnamed lead'}</Row.Title>
        <Row.Meta>
          {lead.aiNextAction || 'Call today'}
        </Row.Meta>
      </Row.Main>
      <Row.Trail>
        {lead.contact && (
          <a href={`tel:${lead.contact}`} onClick={e => e.stopPropagation()} className="text-[11px] text-primary hover:underline tabular-nums">
            <Phone className="inline h-3 w-3 mr-0.5" />{lead.contact}
          </a>
        )}
        {lead.estimatedValue ? (
          <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">₹{lead.estimatedValue.toLocaleString('en-IN')}</span>
        ) : null}
        <Button size="xs" intent="ghost" onClick={e => { e.stopPropagation(); onOpen(); }}>Open</Button>
      </Row.Trail>
    </Row>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Morning brief — AI-generated, refreshable. Stays as a hero block.
// ─────────────────────────────────────────────────────────────────────────

function MorningBriefBlock() {
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = async () => {
    try { setBrief(await api.aiOrgMorningBrief()); } catch { /* swallow */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const regenerate = async () => {
    setRegenerating(true);
    try { setBrief(await api.aiRegenerateOrgBrief()); toast.success('Brief refreshed'); }
    catch { /* interceptor */ }
    finally { setRegenerating(false); }
  };

  if (loading) return null;
  if (!brief) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/60 px-4 py-3 flex items-center gap-3 flex-wrap">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <p className="text-[12.5px] flex-1 min-w-0">
          <span className="font-semibold">AI brief</span>
          <span className="text-muted-foreground"> — yesterday's recap will appear here every morning at 8 AM IST.</span>
        </p>
        <Button size="xs" intent="secondary" loading={regenerating} onClick={regenerate}>
          Generate now
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/25 bg-primary/[0.04] px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-primary/80">Morning brief</span>
        <span className="text-[10px] text-muted-foreground">{brief.istDate}</span>
        <Button size="xs" intent="ghost" onClick={regenerate} loading={regenerating} className="ml-auto">
          Refresh
        </Button>
      </div>
      <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground">{brief.summary || '—'}</p>
    </div>
  );
}
