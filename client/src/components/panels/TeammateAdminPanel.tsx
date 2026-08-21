import { useState } from 'react';
import { Trash2, KeyRound, ShieldCheck, ShieldOff, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { Button }        from '@/components/ui/Button';
import { TeammateDetailPanel } from '@/components/panels/TeammateDetailPanel';
import { USER_TEAMS }    from '@/lib/enums';
import * as api from '@/api';

/**
 * <TeammateAdminPanel /> — drawer content for an admin acting ON a teammate.
 *
 * Composition:
 *   <TeammateDetailPanel> — read-only presence + 30-day report (reused)
 *   <admin actions block> — role select, multi-team toggles, WR flag,
 *                            reset password, remove employee
 *
 * Lives in the drawer so the AdminEmployees row stays dense (avatar + name +
 * primary team + presence + one inline role select). Heavier actions move
 * here on click instead of cluttering the row.
 *
 * All mutations are optimistic with rollback on failure — matches the v1
 * behaviour and protects against the "I clicked but the server said no"
 * silent-disagreement bug.
 */

interface Props {
  /** Full employee object as it came back from /admin/employees */
  employee: any;
  /** Caller updates its local list after a mutation. */
  onChange: (next: any) => void;
  /** Caller removes the row after a successful delete. */
  onRemove: (id: string) => void;
  /** Optional close-the-drawer callback (used after remove). */
  onClose?: () => void;
}

const ROLES = ['employee', 'sales', 'workroom', 'client', 'admin'];

export function TeammateAdminPanel({ employee, onChange, onRemove, onClose }: Props) {
  const [emp, setEmp]       = useState<any>(employee);
  const [busy, setBusy]     = useState(false);

  const changeRole = async (next: string) => {
    if (next === emp.role) return;
    const before = emp;
    setEmp({ ...emp, role: next });
    onChange({ ...emp, role: next });
    try {
      await api.adminUpdateRole(emp._id, next);
      toast.success(`Role set to ${next}`);
    } catch {
      setEmp(before);
      onChange(before);
      toast.error('Could not change role');
    }
  };

  const toggleTeam = async (t: string) => {
    const cur: string[] = Array.isArray(emp.teams) ? emp.teams : [];
    const nextList = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
    const before = emp;
    const next = { ...emp, teams: nextList };
    setEmp(next);
    onChange(next);
    try {
      await api.adminUpdateUser(emp._id, { teams: nextList });
    } catch {
      setEmp(before);
      onChange(before);
      toast.error('Could not update teams');
    }
  };

  // Aug 2026 — owner ask: "allow Om to have access to Sales Dashboard as
  // well so I can create some client if needed." /sales is gated to
  // role='admin'|'sales' — Om's primary role is 'employee'. Rather than
  // changing his PRIMARY role (which would swap his whole nav/landing
  // page), grant 'sales' as a SECONDARY role via the existing
  // `roles: string[]` field — both ProtectedRoute and the server's
  // requireRole() already treat primary + secondary roles as equally
  // valid (see ProtectedRoute.tsx), so this "just works" once granted.
  // Reuses the same adminUpdateUser endpoint the team-toggle chips use.
  const SECONDARY_ROLES = ['sales', 'employee', 'workroom'];
  const toggleSecondaryRole = async (r: string) => {
    const cur: string[] = Array.isArray(emp.roles) ? emp.roles : [];
    const nextList = cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r];
    const before = emp;
    const next = { ...emp, roles: nextList };
    setEmp(next);
    onChange(next);
    try {
      await api.adminUpdateUser(emp._id, { roles: nextList });
      toast.success(nextList.includes(r)
        ? `${emp.name || emp.email} can now access ${r === 'sales' ? 'the Sales Dashboard' : r}`
        : `Removed ${r} access from ${emp.name || emp.email}`);
    } catch {
      setEmp(before);
      onChange(before);
      toast.error('Could not update roles');
    }
  };

  const toggleWorkroom = async () => {
    const next = { ...emp, canManageWorkroom: !emp.canManageWorkroom };
    const before = emp;
    setEmp(next);
    onChange(next);
    try {
      await api.adminSetCanManageWorkroom(emp._id, !before.canManageWorkroom);
      toast.success(next.canManageWorkroom
        ? `${emp.name || emp.email} can now onboard workroom teammates`
        : `${emp.name || emp.email} can no longer onboard workroom teammates`);
    } catch {
      setEmp(before);
      onChange(before);
      toast.error('Could not update permission');
    }
  };

  // Aug 2026 — the canEditAllClients delegated permission (full Client CRM
  // edit rights — status/checklist/ETA/owner/financials on ANY client, not
  // just ones assigned to you) previously had no admin-UI control at all,
  // only a one-off script (grantClientEditPermission.ts). That meant there
  // was no way to confirm or grant it without shell access — which is how
  // Om ended up without the flag live despite the script existing. Mirrors
  // toggleWorkroom above.
  const toggleEditAllClients = async () => {
    const next = { ...emp, canEditAllClients: !emp.canEditAllClients };
    const before = emp;
    setEmp(next);
    onChange(next);
    try {
      await api.adminSetCanEditAllClients(emp._id, !before.canEditAllClients);
      toast.success(next.canEditAllClients
        ? `${emp.name || emp.email} can now edit any client in the CRM`
        : `${emp.name || emp.email} can no longer edit clients outside their own assignments`);
    } catch {
      setEmp(before);
      onChange(before);
      toast.error('Could not update permission');
    }
  };

  const resetPw = async () => {
    const label = emp.name || emp.email;
    const entered = window.prompt(
      `Set new password for ${label}.\nLeave blank to use the safe default "Robin2024!".`,
      '',
    );
    if (entered === null) return;
    const trimmed = entered.trim();
    if (trimmed && trimmed.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      const resp = await api.adminResetPass(emp._id, trimmed || undefined);
      toast.success(`Password set for ${label}: ${resp.newPassword}`, { duration: 12000 });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Reset failed');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    const label = emp.name || emp.email;
    if (!confirm(`Remove ${label}?\n\nTheir history is preserved but they won't be able to log in.`)) return;
    setBusy(true);
    try {
      await api.adminRemoveUser(emp._id);
      onRemove(emp._id);
      toast.success(`${label} removed`);
      onClose?.();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not remove user');
    } finally { setBusy(false); }
  };

  const secondaryTeams = USER_TEAMS.filter(t => t !== emp.team);
  const activeTeams: string[] = Array.isArray(emp.teams) ? emp.teams : [];

  return (
    <div>
      {/* 1. Read-only presence + report (reuse) */}
      <TeammateDetailPanel userId={emp._id} />

      {/* 2. Admin actions block */}
      <section className="p-4 space-y-4 border-t border-border">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Role</label>
          <div className="relative">
            <select
              value={emp.role}
              onChange={e => changeRole(e.target.value)}
              disabled={busy}
              className="appearance-none w-full px-3 pr-8 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Additional teams</label>
          <div className="flex flex-wrap gap-1.5">
            {secondaryTeams.map(t => {
              const on = activeTeams.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTeam(t)}
                  disabled={busy}
                  className={`px-2 h-7 text-[11.5px] font-semibold rounded-full border transition-colors capitalize ${
                    on
                      ? 'bg-primary/12 text-primary border-primary/30 hover:bg-primary/20'
                      : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted'
                  }`}
                  title={on ? `Remove from ${t} team` : `Add to ${t} team`}
                >
                  {on ? '✓ ' : '+ '}{t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Secondary access (extra dashboards, keeps their primary role)</label>
          <div className="flex flex-wrap gap-1.5">
            {SECONDARY_ROLES.filter(r => r !== emp.role).map(r => {
              const on = (Array.isArray(emp.roles) ? emp.roles : []).includes(r);
              return (
                <button
                  key={r}
                  onClick={() => toggleSecondaryRole(r)}
                  disabled={busy}
                  className={`px-2 h-7 text-[11.5px] font-semibold rounded-full border transition-colors capitalize ${
                    on
                      ? 'bg-primary/12 text-primary border-primary/30 hover:bg-primary/20'
                      : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted'
                  }`}
                  title={on ? `Remove ${r} dashboard access` : `Grant ${r} dashboard access`}
                >
                  {on ? '✓ ' : '+ '}{r}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Permissions</label>
          <Button
            size="sm"
            intent={emp.canManageWorkroom ? 'success' : 'secondary'}
            iconLeft={emp.canManageWorkroom ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
            onClick={toggleWorkroom}
            loading={busy}
            full
          >
            {emp.canManageWorkroom ? 'Can onboard workroom teammates' : 'Allow workroom onboarding'}
          </Button>
          <Button
            size="sm"
            intent={emp.canEditAllClients ? 'success' : 'secondary'}
            iconLeft={emp.canEditAllClients ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
            onClick={toggleEditAllClients}
            loading={busy}
            full
          >
            {emp.canEditAllClients ? 'Can edit any client (full CRM edit)' : 'Allow editing any client in CRM'}
          </Button>
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Account</label>
          <div className="flex gap-2">
            <Button
              size="sm"
              intent="secondary"
              iconLeft={<KeyRound className="h-3.5 w-3.5" />}
              onClick={resetPw}
              loading={busy}
            >
              Reset password
            </Button>
            <Button
              size="sm"
              intent="danger"
              iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              onClick={remove}
              loading={busy}
            >
              Remove
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
