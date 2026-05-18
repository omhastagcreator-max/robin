import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Users, Plus, Activity, CheckCircle2, Mail, Phone, Loader2, UserCheck, BarChart2, Coffee, CalendarOff, Trash2, WifiOff } from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import { EmployeeReportModal } from '@/components/admin/EmployeeReportModal';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';
import { Avatar } from '@/components/shared/Avatar';
import { USER_TEAMS, USER_TEAM_LABEL } from '@/lib/enums';

// Color per team chip — keys MUST match USER_TEAMS in lib/enums.ts.
// Previously this had `web/marketing/admin` (none in USER_TEAMS), so every
// chip rendered in the muted gray fallback regardless of team.
const teamColors: Record<string, string> = {
  meta:       'bg-blue-500/15   text-blue-600',
  ads:        'bg-pink-500/15   text-pink-600',
  influencer: 'bg-amber-500/15  text-amber-700',
  dev:        'bg-emerald-500/15 text-emerald-600',
  content:    'bg-purple-500/15 text-purple-600',
  sales:      'bg-orange-500/15 text-orange-600',
  design:     'bg-teal-500/15   text-teal-600',
};

function PresenceBadge({ status }: { status: PresenceStatus }) {
  if (status === 'on_leave') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-500 border border-purple-500/30">
      <CalendarOff className="h-3 w-3" /> On leave
    </span>
  );
  if (status === 'on_break') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 border border-amber-500/30">
      <Coffee className="h-3 w-3" /> On break
    </span>
  );
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/15 text-green-600 border border-green-500/30">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> Working
    </span>
  );
  // Clocked-in but Robin tab is closed — heartbeat gone stale. Distinct
  // from 'off_clock' (no session at all) so admins can tell at a glance
  // who's just away from their desk vs who never clocked in.
  if (status === 'away') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/15 text-slate-600 border border-slate-500/30"
      title="Clocked in but Robin tab is closed — timer paused">
      <WifiOff className="h-3 w-3" /> Robin closed
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
      Off the clock
    </span>
  );
}

export default function AdminEmployees() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviting, setInviting] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // One-shot helper: maps the four named teammates to their canonical
  // team + role. Idempotent on the server — safe to click more than once.
  const [assigningRoles, setAssigningRoles] = useState(false);
  const runAssignRoles = async () => {
    if (assigningRoles) return;
    setAssigningRoles(true);
    try {
      const r = await api.assignTeamRoles();
      toast.success(r.message || 'Team roles updated');
      if (Array.isArray(r.notFound) && r.notFound.length) {
        toast.warning(`Not found: ${r.notFound.join(', ')} — add them first, then re-run.`);
      }
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to assign team roles');
    } finally { setAssigningRoles(false); }
  };
  const [reportFor, setReportFor] = useState<any | null>(null);
  const presence = useTeamPresence();

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
      toast.success(`${resp.credentials?.email} created! Password: ${resp.credentials?.password}`, { duration: 8000 });
      setInviteEmail(''); setShowInvite(false);
      load();
    } catch { toast.error('Failed to create user'); }
    finally { setInviting(false); }
  };

  const resetPw = async (id: string, name: string) => {
    const entered = window.prompt(
      `Set new password for ${name}.\n\nType the password you want, or leave blank to use the safe default "Robin2024!".`,
      ''
    );
    if (entered === null) return; // user clicked cancel
    const trimmed = entered.trim();
    if (trimmed && trimmed.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    try {
      const resp = await api.adminResetPass(id, trimmed || undefined);
      toast.success(`Password set for ${name}: ${resp.newPassword}`, { duration: 12000 });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Reset failed');
    }
  };

  const changeRole = async (id: string, role: string) => {
    // Optimistic update with rollback. Previously toasted "Role updated"
    // even when the server rejected, leaving the admin staring at a UI
    // that disagreed with reality.
    const before = employees;
    setEmployees(prev => prev.map(e => e._id === id ? { ...e, role } : e));
    try {
      await api.adminUpdateRole(id, role);
      toast.success('Role updated');
    } catch {
      setEmployees(before);
    }
  };

  // Team chip toggle — adds/removes a team from the user's teams[] array.
  // Primary `team` is preserved; this just updates the secondary set.
  const toggleTeam = async (emp: any, team: string) => {
    const current: string[] = Array.isArray(emp.teams) ? emp.teams : [];
    const next = current.includes(team) ? current.filter(t => t !== team) : [...current, team];
    try {
      await api.adminUpdateUser(emp._id, { teams: next });
      setEmployees(prev => prev.map(e => e._id === emp._id ? { ...e, teams: next } : e));
      toast.success(`Teams updated for ${emp.name || emp.email}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not update teams');
    }
  };

  const removeEmployee = async (emp: any) => {
    const label = emp.name || emp.email;
    if (!confirm(`Remove ${label}?\n\nTheir history is preserved but they won't be able to log in. This action can be reversed by re-creating the account.`)) return;
    try {
      await api.adminRemoveUser(emp._id);
      setEmployees(prev => prev.filter(e => e._id !== emp._id));
      toast.success(`${label} removed`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not remove user');
    }
  };

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Team Members</h1>
            <p className="text-sm text-muted-foreground">{employees.length} members</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runAssignRoles} disabled={assigningRoles}
              title="Sets Om→dev, Sakshi→meta, Priyanka→influencer, Rishi→sales. Safe to re-run."
              className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-xl text-sm font-medium hover:bg-muted/70 disabled:opacity-50">
              {assigningRoles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
              Assign team roles
            </button>
            <button onClick={() => setShowInvite(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Add Member
            </button>
          </div>
        </div>

        {showInvite && (
          <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            onSubmit={handleInvite} className="bg-card border border-primary/30 rounded-2xl p-5">
            <p className="font-semibold text-sm mb-3">Add Team Member</p>
            <p className="text-xs text-muted-foreground mb-3">Creates a new account with default password <code className="bg-muted px-1.5 py-0.5 rounded">Robin2024!</code></p>
            <div className="flex gap-3 flex-wrap">
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@example.com" type="email" required
                className="flex-1 min-w-48 px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="px-3 py-2 bg-background border border-input rounded-xl text-sm">
                {['employee', 'sales', 'workroom', 'client', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button type="submit" disabled={inviting} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />} Create
              </button>
            </div>
          </motion.form>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : employees.length === 0 ? (
          <EmptyState icon={Users} title="No team members" description="Add your first member above." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {employees.map((emp, i) => {
              const status = presence.statusOf(emp._id);
              const accent =
                status === 'active'    ? 'border-green-500/30' :
                status === 'on_break'  ? 'border-amber-500/30' :
                status === 'on_leave'  ? 'border-purple-500/30' :
                status === 'away'      ? 'border-slate-500/30' :
                                          'border-border';
              return (
                <motion.div
                  key={emp._id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className={`bg-card border ${accent} rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow`}
                >
                  {/* Header — avatar + name + presence chip */}
                  <div className="flex items-start gap-3">
                    {/* Avatar handles missing name+email safely (no more
                        TypeError on rows where both are blank). */}
                    <Avatar name={emp.name} email={emp.email} url={emp.avatarUrl} size="md" tone="primary" className="!rounded-xl" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{emp.name || 'Unnamed'}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{emp.email}</p>
                    </div>
                    <PresenceBadge status={status} />
                  </div>

                  {/* Meta — team chip + tasks today */}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                    {emp.team && (
                      <span className={`px-1.5 py-0.5 rounded font-medium ${teamColors[emp.team] || 'bg-muted text-muted-foreground'}`}>
                        {emp.team}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {emp.tasksDoneToday || 0} done today
                    </span>
                  </div>

                  {/* Multi-team assignment — click to toggle a team. Empty
                      array = primary team only. Useful for multi-skill
                      employees (e.g., does both ads + influencer).
                      'meta' grants Meta Ads report access without needing
                      to put them on the broader 'ads' team. */}
                  <div className="flex items-center gap-1 flex-wrap text-[10px]">
                    <span className="text-muted-foreground">Also on:</span>
                    {/* Single source of truth — was previously hard-coded
                        and didn't match the team list in ProfilePage, so
                        team chips between the two pages disagreed. */}
                    {USER_TEAMS.map(t => {
                      if (t === emp.team) return null;          // hide primary team — already shown above
                      const active = (emp.teams || []).includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTeam(emp, t)}
                          className={`px-1.5 py-0.5 rounded font-semibold transition-colors capitalize ${
                            active
                              ? 'bg-primary/20 text-primary border border-primary/30'
                              : 'bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted'
                          }`}
                          title={active ? `Remove from ${t} team` : `Add to ${t} team`}
                        >
                          {active ? '✓ ' : '+ '}{t}
                        </button>
                      );
                    })}
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <button
                      onClick={() => setReportFor(emp)}
                      title="View productivity report"
                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                    >
                      <BarChart2 className="h-3.5 w-3.5" /> Report
                    </button>
                    <select
                      value={emp.role}
                      onChange={e => changeRole(emp._id, e.target.value)}
                      className="text-xs bg-background border border-input rounded-lg px-2 py-1.5"
                    >
                      {['employee', 'sales', 'workroom', 'client', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button
                      onClick={() => resetPw(emp._id, emp.name || emp.email)}
                      title="Reset password"
                      className="text-[10px] text-muted-foreground hover:text-primary transition-colors px-1.5 py-1.5 rounded-lg hover:bg-muted"
                    >
                      Reset PW
                    </button>
                    <button
                      onClick={() => removeEmployee(emp)}
                      title="Remove employee"
                      className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors p-1.5 rounded-lg"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
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
