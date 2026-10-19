import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Activity logs — Oct 2026 (owner: "logs to be maintained"). Every permanent
 * record in Robin in one searchable timeline: sign-ins, clock-in/out & breaks,
 * client work, Video SOP, team changes, leave, deletions (with snapshots) and
 * vault access. Admin + managers (Rahul). Nothing is ever trimmed; download
 * any range as CSV.
 */
interface Row { at: string; type: string; who: string; whoId: string; client: string; what: string; detail: string }
const IST = 330 * 60_000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + IST - n * 86_400_000).toISOString().slice(0, 10);
const TYPES: { k: string; label: string; cls: string }[] = [
  { k: 'all', label: 'Everything', cls: '' },
  { k: 'login', label: 'Sign-ins', cls: 'text-sky-300' },
  { k: 'attendance', label: 'Clock in / breaks', cls: 'text-emerald-300' },
  { k: 'client', label: 'Client work', cls: 'text-blue-300' },
  { k: 'video', label: 'Video tasks', cls: 'text-rose-300' },
  { k: 'team', label: 'Team changes', cls: 'text-violet-300' },
  { k: 'leave', label: 'Leave', cls: 'text-cyan-300' },
  { k: 'deletion', label: 'Deletions', cls: 'text-red-400' },
  { k: 'vault', label: 'Vault', cls: 'text-amber-300' },
  { k: 'reminder', label: 'Robin reminders', cls: 'text-slate-400' },
];
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function ActivityLogsPage() {
  const { user, role } = useAuth();
  const allowed = [role, ...((user as any)?.roles || [])].includes('admin') || (user as any)?.canViewOversight === true;
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [type, setType] = useState('all');
  const [who, setWho] = useState('');
  const [client, setClient] = useState('');
  const [q, setQ] = useState('');
  const [team, setTeam] = useState<{ _id: string; name: string }[]>([]);
  const [data, setData] = useState<{ total: number; counts: Record<string, number>; rows: Row[]; nextBefore: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const params = () => ({ from, to, type, ...(who ? { userId: who } : {}), ...(client ? { client } : {}), ...(q ? { q } : {}) });

  useEffect(() => { if (allowed) api.listTeamMembers().then((m: any[]) => setTeam(m.map(x => ({ _id: x.id, name: x.name + (x.isActive ? '' : ' (removed)') })))).catch(() => {}); }, [allowed]);
  const load = (more = false) => {
    setLoading(true);
    api.activityLogs({ ...params(), ...(more && data?.nextBefore ? { before: data.nextBefore } : {}) })
      .then((d: any) => setData(prev => more && prev ? { ...d, rows: [...prev.rows, ...d.rows] } : d))
      .catch((e: any) => toast.error(e?.response?.data?.error || 'Could not load logs')).finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) { const t = setTimeout(() => load(), 300); return () => clearTimeout(t); } }, [from, to, type, who, client, q, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    try {
      const blob = await api.activityLogsCsv(params());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `robin-logs-${from}_to_${to}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { toast.error('Could not download'); }
  };

  if (!allowed) return <div className="p-10 text-center text-slate-400 text-sm">Activity logs are for admin and managers.</div>;
  const ctl = 'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white [color-scheme:dark] [&>option]:bg-slate-900';
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-4 overflow-y-auto w-full">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight"><i className="fa-solid fa-clock-rotate-left text-sky-400 mr-2"></i>Activity logs</h2>
          <p className="text-xs text-slate-400 mt-0.5">Everything that happened in Robin — who, what, which client, when. Kept permanently; deletions are logged with a snapshot.</p>
        </div>
        <button onClick={download} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold"><i className="fa-solid fa-download mr-1.5"></i>Download CSV</button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-400">From<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className={ctl + ' block mt-0.5'} /></label>
        <label className="text-[11px] text-slate-400">To<input type="date" value={to} min={from} max={today()} onChange={e => setTo(e.target.value)} className={ctl + ' block mt-0.5'} /></label>
        <label className="text-[11px] text-slate-400">Person
          <select value={who} onChange={e => setWho(e.target.value)} className={ctl + ' block mt-0.5'}><option value="">Everyone</option>{team.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
        </label>
        <label className="text-[11px] text-slate-400">Client<input value={client} onChange={e => setClient(e.target.value)} placeholder="Any client" className={ctl + ' block mt-0.5 w-36'} /></label>
        <label className="text-[11px] text-slate-400">Search<input value={q} onChange={e => setQ(e.target.value)} placeholder="Any word" className={ctl + ' block mt-0.5 w-44'} /></label>
        <div className="flex gap-1">
          {[['Today', 0], ['7 days', 6], ['30 days', 29]].map(([l, n]) => <button key={l as string} onClick={() => { setFrom(daysAgo(n as number)); setTo(today()); }} className="text-[11px] border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 hover:text-white">{l}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map(t => (
          <button key={t.k} onClick={() => setType(t.k)} aria-pressed={type === t.k}
            className={`px-2.5 py-1 rounded-full border text-[11.5px] font-semibold ${type === t.k ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700 text-slate-300 hover:text-white'}`}>
            {t.label}{t.k !== 'all' && data?.counts?.[t.k] ? <span className="opacity-70"> {data.counts[t.k]}</span> : t.k === 'all' && data ? <span className="opacity-70"> {Object.values(data.counts || {}).reduce((a, b) => a + b, 0)}</span> : null}
          </button>
        ))}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr><th className="p-3 w-32">When</th><th className="p-3">Who</th><th className="p-3">Client</th><th className="p-3">What</th><th className="p-3">Detail</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {!data && loading ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">Loading…</td></tr>
                : data && data.rows.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">Nothing logged for these filters.</td></tr>
                : data?.rows.map((r, i) => {
                  const t = TYPES.find(x => x.k === r.type);
                  return (
                    <tr key={i} className="align-top">
                      <td className="p-3 whitespace-nowrap text-slate-400 tabular-nums">{when(r.at)}</td>
                      <td className="p-3 whitespace-nowrap text-white">{r.who}</td>
                      <td className="p-3 whitespace-nowrap">{r.client || '—'}</td>
                      <td className={`p-3 ${t?.cls || ''}`}>{r.what}</td>
                      <td className="p-3 text-slate-400 max-w-[460px] break-words">{r.detail}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {data?.nextBefore && <div className="p-3 border-t border-slate-800 text-center"><button disabled={loading} onClick={() => load(true)} className="text-xs text-blue-400 hover:text-blue-300">Load more ({data.total - data.rows.length} older)</button></div>}
      </div>
    </div>
  );
}
