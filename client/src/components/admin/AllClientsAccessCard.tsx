import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * "Work on all clients" — Nov 2026 (owner: "enable an option where Amit can
 * also work on all the clients and this can be assigned from Rishi or Om").
 *
 * One switch per teammate. ON = they see and can update every client in the
 * CRM (same access Om has), not just the stages assigned to them. Admin,
 * sales (Rishi) and anyone who already has it (Om) can flip it. The server
 * re-checks all of this (oversightController.setAllClientsAccess) and logs
 * every change; the teammate's Robin updates live via a bell notification.
 */
interface Row { id: string; name: string; email: string; role: string; isAdmin: boolean; teams: string[]; department: string; canEditAllClients: boolean }

/** Who may see/flip the switches — mirrors canGrantAllClients() on the server. */
export function canGrantAllClients(user: any, role: string | null | undefined): boolean {
  const r = [role, ...((user?.roles as string[]) || [])];
  return r.includes('admin') || r.includes('sales') || user?.canEditAllClients === true;
}

export function AllClientsAccessCard() {
  const { user, role } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const isAdmin = [role, ...((user as any)?.roles || [])].includes('admin');

  const load = useCallback(() => {
    api.listAllClientsAccess().then(setRows).catch(() => toast.error('Could not load client access')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter(r => !r.isAdmin)
      .filter(r => !s || r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s) || r.department.toLowerCase().includes(s))
      // People who already have it first, then A→Z.
      .sort((a, b) => Number(b.canEditAllClients) - Number(a.canEditAllClients) || a.name.localeCompare(b.name));
  }, [rows, q]);
  const onCount = rows.filter(r => !r.isAdmin && r.canEditAllClients).length;

  const toggle = async (r: Row) => {
    const next = !r.canEditAllClients;
    if (!next && !window.confirm(`Turn off "all clients" for ${r.name}?\n\nThey'll only see the client stages assigned to them.`)) return;
    setBusy(r.id);
    try {
      await api.setAllClientsAccess(r.id, next);
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, canEditAllClients: next } : x));
      toast.success(next ? `${r.name} can now work on all clients` : `${r.name} is back to their own clients`);
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not save'); }
    finally { setBusy(null); }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white"><i className="fa-solid fa-unlock-keyhole text-emerald-400 mr-2"></i>Work on all clients <span className="text-slate-500 font-normal">· {onCount} on</span></h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Switch on to let a teammate open and update every client in the CRM, not only the ones assigned to them. Admin, sales and anyone who already has it can change this.</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search teammate…"
          className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white w-full sm:w-52" />
      </div>
      <ul className="divide-y divide-slate-800/60 max-h-[420px] overflow-y-auto">
        {loading ? <li className="p-5 text-center text-xs text-slate-500">Loading…</li>
          : list.length === 0 ? <li className="p-5 text-center text-xs text-slate-500">No teammates match.</li>
          : list.map(r => {
            const self = r.id === user?.id && !isAdmin;
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{r.name} <span className="text-slate-500 font-normal capitalize">· {r.role}{r.department ? ` · ${r.department}` : ''}</span></div>
                  <div className="text-[11px] text-slate-500 truncate">{r.canEditAllClients ? 'Sees every client' : 'Only their assigned clients'}</div>
                </div>
                <button role="switch" aria-checked={r.canEditAllClients} aria-label={`All clients for ${r.name}`}
                  disabled={busy === r.id || self} title={self ? "You can't change your own access" : undefined}
                  onClick={() => toggle(r)}
                  className={`relative shrink-0 w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${r.canEditAllClients ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${r.canEditAllClients ? 'translate-x-5' : ''}`} />
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
