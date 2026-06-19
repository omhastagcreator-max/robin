import { useEffect, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Loader2, Plus, UserCheck, ChevronDown, X, Users, BarChart2,
} from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout }   from '@/components/AppLayout';
import { Button }      from '@/components/ui/Button';
import { Row }         from '@/components/ui/Row';
import { StatusPill }  from '@/components/ui/StatusPill';
import { EmptyState }  from '@/components/ui/EmptyState';
import { useDrawer }   from '@/components/ui/RightDrawer';
import { Avatar }      from '@/components/shared/Avatar';
import { PeopleGrid, type PeopleGridItem } from '@/components/ui/PeopleGrid';
import { TeammateAdminPanel } from '@/components/panels/TeammateAdminPanel';
import { EmployeeReportModal } from '@/components/admin/EmployeeReportModal';
import { useUnifiedPresence, type UnifiedPresence } from '@/hooks/useUnifiedPresence';
import { USER_TEAMS } from '@/lib/enums';
import * as api from '@/api';

/**
 * AdminEmployees v2 — rebuilt on design-system primitives.
 *
 * What's gone vs v1:
 *   • 3-column card grid with bespoke chrome (border accents, hover shadow).
 *   • Bespoke `teamColors` map with 7 hand-picked colors (blue/pink/amber/
 *     emerald/purple/orange/teal) — a private design system. Replaced with
 *     a single uniform team chip.
 *   • Inline `PresenceBadge` with hand-rolled green/amber/purple/slate
 *     swatches that conflicted with StatusPill. Replaced by StatusPill
 *     reading from `useUnifiedPresence` (single source of truth).
 *   • Per-row admin controls (role select, WR toggle, reset PW, remove)
 *     scattered across each card. Moved to a single drawer panel
 *     (TeammateAdminPanel) that opens on row click.
 *
 * What stayed:
 *   • Header with "Assign team roles" one-shot helper + "Add member"
 *   • Inline invite form (toggled)
 *   • Every admin capability is still present — just in a denser layout
 *     and a richer drawer instead of a cramped card.
 *
 * Density: 12+ rows visible per fold (13" MacBook) vs. ~6 in v1.
 */

export default function AdminEmployees() {
  const drawer    = useDrawer();
  const presence  = useUnifiedPresence();

  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('employee');
  const [inviting, setInviting]       = useState(false);

  const [assigningRoles, setAssigningRoles] = useState(false);

  const [reportFor, setReportFor] = useState<any | null>(null);

  // Persist view preference across reloads — admins land here repeatedly
  // through the day so resetting to grid each time would be annoying.
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try { return (localStorage.getItem('people.employees.layout') as any) === 'list' ? 'list' : 'grid'; }
    catch { return 'grid'; }
  });
  const setViewPersist = (v: 'grid' | 'list') => {
    setView(v);
    try { localStorage.setItem('people.employees.layout', v); } catch { /* private mode */ }
  };

  const load = async () => {
    try {
      const data = await api.adminEmployees();
      setEmployees(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const resp = await api.adminInvite({ email: inviteEmail, role: inviteRole });
      const verb = resp?.reactivated ? 'Reactivated' : 'Created';
      toast.success(
        `${verb} ${resp.credentials?.email}. Password: ${resp.credentials?.password}`,
        { duration: 10000 },
      );
      setInviteEmail('');
      setShowInvite(false);
      load();
    } catch (err: any) {
      // Surface the real server error instead of a swallowing 'Failed
      // to create user' so the admin can fix it (e.g. email already
      // exists, malformed input, server down).
      const msg = err?.response?.data?.error
        || err?.message
        || 'Could not create the teammate. Try again.';
      toast.error(msg, { duration: 7000 });
    } finally { setInviting(false); }
  };

  const runAssignRoles = async () => {
    if (assigningRoles) return;
    setAssigningRoles(true);
    try {
      const r = await api.assignTeamRoles();
      toast.success(r.message || 'Team roles updated');
      if (Array.isArray(r.notFound) && r.notFound.length) {
        toast.warning(`Not found: ${r.notFound.join(', ')}`);
      }
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to assign team roles');
    } finally { setAssigningRoles(false); }
  };

  // Quick inline role change from the row trail — most-frequent admin action,
  // worth keeping one-click instead of pushing into the drawer.
  const inlineChangeRole = async (id: string, next: string) => {
    const before = employees;
    setEmployees(prev => prev.map(e => e._id === id ? { ...e, role: next } : e));
    try {
      await api.adminUpdateRole(id, next);
      toast.success('Role updated');
    } catch {
      setEmployees(before);
      toast.error('Could not change role');
    }
  };

  const openEmployeeDrawer = (emp: any) => {
    drawer.open({
      title: emp.name || emp.email,
      subtitle: `${emp.role}${emp.team ? ` · ${emp.team}` : ''}`,
      width: 'lg',
      content: (
        <TeammateAdminPanel
          employee={emp}
          onChange={next => setEmployees(prev => prev.map(e => e._id === next._id ? next : e))}
          onRemove={id => setEmployees(prev => prev.filter(e => e._id !== id))}
          onClose={() => drawer.close()}
        />
      ),
    });
  };

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight">Team Members</h1>
            <p className="text-[12px] text-muted-foreground">{employees.length} {employees.length === 1 ? 'member' : 'members'}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Grid / list toggle — grid fits ~20 people per fold on a
                13" MacBook (the current row view fits ~12), so admins
                scanning for a teammate by face/name don't have to scroll. */}
            <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden text-[11.5px]">
              <button
                onClick={() => setViewPersist('grid')}
                className={`flex items-center gap-1 px-2 py-1.5 transition-colors ${view === 'grid' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="Grid view"
              >
                <LayoutGrid className="h-3 w-3" /> Grid
              </button>
              <button
                onClick={() => setViewPersist('list')}
                className={`flex items-center gap-1 px-2 py-1.5 transition-colors ${view === 'list' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="List view — denser, inline role select"
              >
                <ListIcon className="h-3 w-3" /> List
              </button>
            </div>
            <Button
              size="sm"
              intent="secondary"
              loading={assigningRoles}
              iconLeft={<UserCheck className="h-3.5 w-3.5" />}
              onClick={runAssignRoles}
              title="Sets Om→dev, Sakshi→meta, Priyanka→influencer, Rishi→sales. Safe to re-run."
            >
              Assign team roles
            </Button>
            <Button
              size="sm"
              intent="primary"
              iconLeft={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setShowInvite(v => !v)}
            >
              Add member
            </Button>
          </div>
        </div>

        {/* Invite form (toggled) */}
        {showInvite && (
          <motion.form
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            onSubmit={handleInvite}
            className="border border-border rounded-xl p-4 bg-card space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">Create a new member</p>
                <p className="text-[11.5px] text-muted-foreground">
                  Default password is <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">Robin2024!</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                required
                className="flex-1 min-w-[200px] px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="relative">
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="appearance-none px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {['employee', 'sales', 'workroom', 'client', 'admin'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <Button type="submit" size="sm" intent="primary" loading={inviting} iconLeft={<UserCheck className="h-3.5 w-3.5" />}>
                Create
              </Button>
            </div>
          </motion.form>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : employees.length === 0 ? (
          <EmptyState
            size="lg"
            icon={<Users className="h-7 w-7" />}
            title="No team members yet"
            hint="Add your first member with the button above."
          />
        ) : view === 'grid' ? (
          // Grid view: compact tile per member, full controls in drawer
          // (click) — keep the report shortcut as a tile trailing icon.
          <PeopleGrid
            layout="grid"
            hideToggle
            items={employees.map<PeopleGridItem>(emp => {
              const live: UnifiedPresence | null = presence.get(emp._id);
              const teamCount = (Array.isArray(emp.teams) ? emp.teams : []).filter((t: string) => t !== emp.team).length;
              const tasksToday = emp.tasksDoneToday || 0;
              return {
                id:    emp._id,
                name:  emp.name,
                email: emp.email,
                role:  emp.role,
                team:  emp.team || undefined,
                state: live ? (live.displayState as any) : 'off_clock',
                hint:  tasksToday > 0
                  ? `${tasksToday} done today${teamCount > 0 ? ` · +${teamCount} teams` : ''}`
                  : (teamCount > 0 ? `+${teamCount} teams` : undefined),
                onClick: () => openEmployeeDrawer(emp),
                trailing: (
                  <button
                    onClick={e => { e.stopPropagation(); setReportFor(emp); }}
                    title="Productivity report"
                    className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                  >
                    <BarChart2 className="h-3.5 w-3.5" />
                  </button>
                ),
              };
            })}
          />
        ) : (
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            {employees.map(emp => {
              const live: UnifiedPresence | null = presence.get(emp._id);
              const tasksToday = emp.tasksDoneToday || 0;
              const teamCount  = (Array.isArray(emp.teams) ? emp.teams : []).filter((t: string) => t !== emp.team).length;
              return (
                <Row
                  key={emp._id}
                  density="comfy"
                  onClick={() => openEmployeeDrawer(emp)}
                  accent={
                    live?.displayState === 'in_huddle' ? 'primary' :
                    live?.displayState === 'working'   ? 'success' :
                    live?.displayState === 'on_break'  ? 'warning' :
                    live?.displayState === 'on_leave'  ? 'info'    :
                                                          'none'
                  }
                >
                  <Row.Leading>
                    <Avatar name={emp.name} email={emp.email} url={emp.avatarUrl} size="sm" tone="primary" />
                  </Row.Leading>
                  <Row.Main>
                    <Row.Title>{emp.name || 'Unnamed'}</Row.Title>
                    <Row.Meta>
                      {emp.email}
                      {emp.team && <> · <span className="font-medium capitalize text-foreground/70">{emp.team}</span></>}
                      {teamCount > 0 && <> · +{teamCount}</>}
                      {tasksToday > 0 && <> · {tasksToday} done today</>}
                    </Row.Meta>
                  </Row.Main>
                  <Row.Trail>
                    {live && <StatusPill state={live.displayState as any} size="xs" />}
                    <button
                      onClick={e => { e.stopPropagation(); setReportFor(emp); }}
                      title="Productivity report"
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                    >
                      <BarChart2 className="h-3.5 w-3.5" />
                    </button>
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <select
                        value={emp.role}
                        onChange={e => inlineChangeRole(emp._id, e.target.value)}
                        className="appearance-none pl-2 pr-5 h-7 bg-muted/50 hover:bg-muted text-foreground border-0 rounded-md text-[11.5px] font-medium focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                        title="Change role"
                      >
                        {['employee', 'sales', 'workroom', 'client', 'admin'].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </Row.Trail>
                </Row>
              );
            })}
          </div>
        )}

        {/* Footer hint */}
        {!loading && employees.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {USER_TEAMS.length} teams configured · Click a row for full controls (multi-team, permissions, reset password, remove).
          </p>
        )}
      </div>

      <EmployeeReportModal
        open={!!reportFor}
        employee={reportFor}
        onClose={() => setReportFor(null)}
      />
    </AppLayout>
  );
}
