import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Clean up clients — Oct 2026 (owner: "give me options for each client that
 * is currently in Robin, I'll select the active ones, keep only those").
 * Unticked clients are ARCHIVED — hidden from the CRM, Decision Tree board,
 * client pills and Video SOP — never deleted; tick them again to restore.
 */
interface Row { _id: string; clientName: string; archived: boolean; status: string; services: { label: string; status: string }[]; lastActivityAt: string; onboardedAt: string; totalAmount: number }

export default function ClientsCleanupPage() {
  const { user, role } = useAuth();
  const allowed = [role, ...((user as any)?.roles || [])].includes('admin') || (user as any)?.canViewOversight === true;
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = () => api.clientsCleanupList().then((r: Row[]) => { setRows(r); setActive(new Set(r.filter(x => !x.archived).map(x => x._id))); })
    .catch(() => toast.error('Could not load clients')).finally(() => setLoading(false));
  useEffect(() => { if (allowed) load(); }, [allowed]);

  const shown = useMemo(() => rows.filter(r => r.clientName.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const toArchive = rows.filter(r => !r.archived && !active.has(r._id));
  const toRestore = rows.filter(r => r.archived && active.has(r._id));
  const ago = (iso: string) => { if (!iso) return 'never'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); return d === 0 ? 'today' : `${d}d ago`; };

  const save = async () => {
    if (!toArchive.length && !toRestore.length) { toast.message('Nothing changed.'); return; }
    const msg = `${toArchive.length ? `Archive ${toArchive.length} client${toArchive.length > 1 ? 's' : ''}: ${toArchive.slice(0, 12).map(r => r.clientName).join(', ')}${toArchive.length > 12 ? '…' : ''}\n` : ''}${toRestore.length ? `Restore ${toRestore.length}: ${toRestore.map(r => r.clientName).join(', ')}\n` : ''}\nArchived clients are hidden, not deleted — you can restore them here.`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      const r = await api.clientsCleanupApply(toRestore.map(x => x._id), toArchive.map(x => x._id));
      toast.success(`${r.archived} archived, ${r.restored} restored.`);
      load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (!allowed) return <div className="p-10 text-center text-slate-400 text-sm">Client clean-up is for admin and managers.</div>;
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-4 overflow-y-auto w-full">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight"><i className="fa-solid fa-broom text-amber-400 mr-2"></i>Clean up clients</h2>
          <p className="text-xs text-slate-400 mt-0.5">Tick every client that is <b>active right now</b>. Unticked ones are archived — hidden everywhere, never deleted.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{active.size} active · {rows.length - active.size} archived</span>
          <button disabled={saving} onClick={save} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold">
            Save{toArchive.length || toRestore.length ? ` (${toArchive.length} to archive, ${toRestore.length} to restore)` : ''}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client" aria-label="Search client" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white w-60" />
        <button onClick={() => setActive(new Set(rows.map(r => r._id)))} className="text-xs text-slate-300 border border-slate-700 rounded-lg px-2.5 py-1.5">Tick all</button>
        <button onClick={() => setActive(new Set())} className="text-xs text-slate-300 border border-slate-700 rounded-lg px-2.5 py-1.5">Untick all</button>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? <p className="p-6 text-center text-xs text-slate-500">Loading…</p> : (
          <ul className="divide-y divide-slate-800/70">
            {shown.map(r => {
              const on = active.has(r._id);
              return (
                <li key={r._id}>
                  <label className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-800/40 ${on ? '' : 'opacity-60'}`}>
                    <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={on}
                      onChange={() => setActive(s => { const n = new Set(s); n.has(r._id) ? n.delete(r._id) : n.add(r._id); return n; })} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white">{r.clientName}{r.archived && <span className="ml-2 text-[10px] text-slate-500 font-normal">archived</span>}</div>
                      <div className="text-[11px] text-slate-500 truncate">{r.services.map(s => `${s.label}${s.status === 'done' ? ' ✓' : ''}`).join(' · ') || 'No services'} · last activity {ago(r.lastActivityAt)}</div>
                    </div>
                    <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${on ? 'text-emerald-300 border-emerald-500/30' : 'text-slate-400 border-slate-700'}`}>{on ? 'Active' : 'Archive'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
