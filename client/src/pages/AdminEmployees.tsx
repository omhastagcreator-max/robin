import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { Users, Plus, Activity, CheckCircle2, Mail, Phone, Loader2, UserCheck, BarChart2, Coffee, CalendarOff, Trash2 } from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import { EmployeeReportModal } from '@/components/admin/EmployeeReportModal';
import { useTeamPresence, type PresenceStatus } from '@/hooks/useTeamPresence';

const teamColors: Record<string, string> = {
  web:       'bg-blue-500/15 text-blue-400',
  marketing: 'bg-pink-500/15 text-pink-400',
  content:   'bg-purple-500/15 text-purple-400',
  sales:     'bg-amber-500/15 text-amber-400',
  design:    'bg-teal-500/15 text-teal-400',
  admin:     'bg-red-500/15 text-red-400',
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
    const resp = await api.adminResetPass(id);
    toast.success(`Password reset for ${name}: ${resp.newPassword}`, { duration: 8000 });
  };

  const changeRole = async (id: string, role: string) => {
    await api.adminUpdateRole(id, role);
    setEmployees(prev => prev.map(e => e._id === id ? { ...e, role } : e));
    toast.success('Role updated');
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
          <button onClick={() => setShowInvite(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add Member
          </button>
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
                {['employee', 'sales', 'client', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
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
                                          'border-border';
              return (
                <motion.div
                  key={emp._id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className={`bg-card border ${accent} rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow`}
                >
                  {/* Header — avatar + name + presence chip */}
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 rounded-xl bg-primary/20 flex items-center justify-center text-base font-bold text-primary shrink-0">
                      {(emp.name || emp.email)[0].toUpperCase()}
                    </div>
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
                      {['employee', 'sales', 'client', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
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
