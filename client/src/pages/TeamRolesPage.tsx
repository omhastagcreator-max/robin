import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { AddMemberModal, TEAM_OPTIONS } from '@/components/admin/AddMemberModal';

/**
 * Team & roles — Oct 2026 (owner: "ask me about the employees, their role and
 * current working employees, then define their Robin as per the role").
 * Admin and Rahul set who is on the team, their role, team and job title.
 * Removing someone switches them off (never deletes) and hands their open
 * client stages to a teammate on the same team.
 */
interface Member { id: string; name: string; email: string; role: string; isAdmin: boolean; teams: string[]; department: string; isActive: boolean; openStages: number }

const ROLE_INFO: Record<string, string> = {
  admin: 'Everything, incl. payroll reports, access and settings',
  employee: 'Their clients & stages, Decision Tree, video tasks, tasks, attendance',
  sales: 'CRM, leads, onboarding clients (incl. the Video brief), sales pipeline',
  workroom: 'Huddle / workroom, attendance and leave only',
};

export default function TeamRolesPage() {
  const { user, role } = useAuth();
  const isAdmin = [role, ...((user as any)?.roles || [])].includes('admin');
  const allowed = isAdmin || (user as any)?.canViewOversight === true;
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const load = useCallback(() => { api.listTeamMembers().then(setRows).catch(() => toast.error('Could not load the team')).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const patch = async (m: Member, p: Partial<{ role: string; teams: string[]; department: string; isActive: boolean }>, ok?: string) => {
    setBusy(m.id);
    try {
      const r = await api.updateTeamMember(m.id, p);
      if (r?.reassigned) {
        const n = r.reassigned.length;
        toast.success(`${m.name} removed${n ? ` — ${n} client stage${n > 1 ? 's' : ''} handed over: ${r.reassigned.map((x: any) => `${x.client} → ${x.to}`).join(', ')}` : ''}`);
      } else if (ok) toast.success(ok);
      load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not save'); }
    finally { setBusy(null); }
  };

  if (!allowed) return <div className="p-10 text-center text-slate-400 text-sm">Team & roles is for admin and managers.</div>;
  const active = rows.filter(r => r.isActive);
  const removed = rows.filter(r => !r.isActive);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-5 overflow-y-auto w-full">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight"><i className="fa-solid fa-people-group text-sky-400 mr-2"></i>Team & roles</h2>
          <p className="text-xs text-slate-400 mt-0.5">Who's working now, their role (what they see in Robin) and their team (what gets auto-assigned to them).</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold"><i className="fa-solid fa-user-plus mr-1.5"></i>Add team member</button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(ROLE_INFO).map(([k, v]) => (
          <div key={k} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="text-xs font-bold text-white capitalize">{k} <span className="text-slate-500 font-normal">· {active.filter(a => a.role === k).length}</span></div>
            <div className="text-[11px] text-slate-400 mt-0.5">{v}</div>
          </div>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr><th className="p-3">Person</th><th className="p-3">Role</th><th className="p-3">Team</th><th className="p-3">Job title</th><th className="p-3">Open stages</th><th className="p-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading…</td></tr> : active.map(m => {
                const locked = m.isAdmin && !isAdmin;
                const self = m.id === user?.id;
                return (
                  <tr key={m.id} className="align-top">
                    <td className="p-3"><div className="font-semibold text-white">{m.name}</div><div className="text-[11px] text-slate-500">{m.email}</div></td>
                    <td className="p-3">
                      <select value={m.role} disabled={locked || self || busy === m.id} onChange={e => patch(m, { role: e.target.value }, `${m.name} is now ${e.target.value}`)}
                        className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-white disabled:opacity-50 [&>option]:bg-slate-900">
                        {['employee', 'sales', 'workroom', ...(isAdmin || m.role === 'admin' ? ['admin'] : [])].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1 max-w-[360px]">
                        {TEAM_OPTIONS.map(t => {
                          const on = m.teams.includes(t.key);
                          return <button key={t.key} disabled={locked || busy === m.id} aria-pressed={on}
                            onClick={() => patch(m, { teams: on ? m.teams.filter(x => x !== t.key) : [...m.teams, t.key] })}
                            className={`px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${on ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700 text-slate-400 hover:text-white'} disabled:opacity-50`}>{t.label}</button>;
                        })}
                      </div>
                    </td>
                    <td className="p-3">
                      <input defaultValue={m.department} disabled={locked} placeholder="e.g. Meta Ads Intern"
                        onBlur={e => e.target.value !== m.department && patch(m, { department: e.target.value }, 'Saved')}
                        className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-white w-40 disabled:opacity-50" />
                    </td>
                    <td className="p-3 tabular-nums">{m.openStages}</td>
                    <td className="p-3 text-right">
                      {!locked && !self && (
                        <button disabled={busy === m.id} onClick={() => window.confirm(`Remove ${m.name} from the team?\n\nTheir login is switched off (nothing is deleted) and their ${m.openStages} open client stage(s) go to a teammate on the same team.`) && patch(m, { isActive: false })}
                          className="text-[11px] text-rose-300 hover:text-rose-200 border border-rose-500/30 rounded-md px-2 py-1">Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {removed.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <button onClick={() => setShowRemoved(v => !v)} className="w-full text-left px-4 py-3 text-xs font-semibold text-slate-300">
            Removed ({removed.length}) <i className={`fa-solid fa-chevron-down ml-1 transition-transform ${showRemoved ? 'rotate-180' : ''}`}></i>
          </button>
          {showRemoved && (
            <ul className="px-4 pb-3 space-y-1.5">
              {removed.map(m => (
                <li key={m.id} className="flex justify-between items-center text-xs text-slate-400">
                  <span>{m.name} <span className="text-slate-600">· {m.email}</span></span>
                  <button disabled={busy === m.id} onClick={() => patch(m, { isActive: true }, `${m.name} is back on the team`)} className="text-[11px] text-emerald-300 border border-emerald-500/30 rounded-md px-2 py-0.5">Bring back</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <AddMemberModal open={addOpen} isAdmin={isAdmin} onClose={() => setAddOpen(false)} onAdded={load} />
    </div>
  );
}
