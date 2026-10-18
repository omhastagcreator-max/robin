import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * My attendance — Oct 2026 (owner: "each employee should get a calendar
 * view to see his login and logout time, working hrs and everything").
 * Everyone sees their own month; admin / Rahul can switch to any teammate.
 * Numbers come from /api/my-attendance — same math as the live timer,
 * Attendance and Team Oversight.
 */
interface Day {
  date: string; status: string; isSunday: boolean; firstSeen: string | null; clockIn: string | null; clockOut: string | null;
  workedMs: number; activeMs: number; breakMs: number; huddleMs: number; breakCount: number; late: boolean; overBreak: boolean;
  breaks: { start: string; end: string | null; ms: number }[];
  sessions: { start: string; end: string | null; open: boolean; autoClosed: boolean; activeMs: number; breakMs: number; huddleMs: number }[];
  leave: { status: string; dayType: string; reason: string } | null;
  logins: { at: string; kind: string }[];
}
interface Payload { month: string; user: { id: string; name: string; department: string }; days: Day[]; totals: Record<string, number> }

const IST = 330 * 60_000;
const thisMonth = () => new Date(Date.now() + IST).toISOString().slice(0, 7);
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const t = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const dur = (ms: number) => { const m = Math.round(ms / 60000); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const STATUS: Record<string, { label: string; cls: string }> = {
  present: { label: 'Full day',     cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' },
  working: { label: 'Working now',  cls: 'bg-blue-500/15 border-blue-500/40 text-blue-200' },
  partial: { label: 'Short day',    cls: 'bg-amber-500/15 border-amber-500/40 text-amber-200' },
  absent:  { label: 'Absent',       cls: 'bg-rose-500/15 border-rose-500/40 text-rose-200' },
  leave:   { label: 'Leave',        cls: 'bg-sky-500/15 border-sky-500/40 text-sky-200' },
  off:     { label: 'Sunday',       cls: 'bg-slate-800/60 border-slate-800 text-slate-500' },
  not_yet: { label: 'Not in yet',   cls: 'bg-slate-800/60 border-slate-700 text-slate-400' },
  not_joined: { label: 'Not joined yet', cls: 'bg-slate-900/40 border-slate-900 text-slate-600' },
  future:  { label: '',             cls: 'bg-slate-900/40 border-slate-900 text-slate-600' },
};

export default function MyAttendancePage() {
  const { user, role } = useAuth();
  const isManager = [role, ...((user as any)?.roles || [])].includes('admin') || (user as any)?.canViewOversight === true;
  const [month, setMonth] = useState(thisMonth());
  const [who, setWho] = useState<string>('');
  const [team, setTeam] = useState<{ _id: string; name: string }[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => { if (isManager) api.videoSopTeam().then(setTeam).catch(() => {}); }, [isManager]);
  useEffect(() => {
    setLoading(true);
    api.myAttendance(month, who || undefined).then((d: Payload) => {
      setData(d);
      const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
      setSel(d.days.find(x => x.date === today)?.date || d.days.filter(x => x.status !== 'future').slice(-1)[0]?.date || null);
    }).catch((e: any) => toast.error(e?.response?.data?.error || 'Could not load attendance')).finally(() => setLoading(false));
  }, [month, who]);

  const lead = useMemo(() => {
    if (!data?.days.length) return 0;
    const [y, m] = data.days[0].date.split('-').map(Number);
    return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday-first grid
  }, [data]);
  const day = data?.days.find(d => d.date === sel) || null;
  const T = data?.totals;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-5 overflow-y-auto w-full">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight"><i className="fa-solid fa-calendar-days text-emerald-400 mr-2"></i>{who && data ? `${data.user.name}'s attendance` : 'My attendance'}</h2>
          <p className="text-xs text-slate-400 mt-0.5">Every day: when you signed in and clocked in/out, hours worked, breaks and leave (IST). Click a day for the full detail.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isManager && (
            <select value={who} onChange={e => setWho(e.target.value)} aria-label="Teammate" className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white [&>option]:bg-slate-900">
              <option value="">Me</option>
              {team.filter(u => u._id !== user?.id).map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          )}
          <div className="inline-flex items-center bg-slate-900 border border-slate-800 rounded-lg">
            <button aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))} className="px-2.5 py-1.5 text-slate-300 hover:text-white"><i className="fa-solid fa-chevron-left text-xs"></i></button>
            <span className="px-2 text-xs font-semibold text-white min-w-[96px] text-center">{new Date(month + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
            <button aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth(m => shiftMonth(m, 1))} className="px-2.5 py-1.5 text-slate-300 hover:text-white disabled:opacity-30"><i className="fa-solid fa-chevron-right text-xs"></i></button>
          </div>
        </div>
      </div>

      {T && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[['Full days', T.present, 'text-emerald-400'], ['Short days', T.partial, 'text-amber-400'], ['Absent', T.absent, 'text-rose-400'], ['Leave', T.leave, 'text-sky-400'],
            ['Late (after 9:30)', T.late, T.late ? 'text-amber-400' : 'text-white'], ['Hours worked', dur(T.activeMs), 'text-white'], ['Avg per day', dur(T.avgActiveMs), 'text-white']].map(([l, v, c]) => (
            <div key={l as string} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] font-semibold text-slate-400 uppercase">{l}</div>
              <div className={`text-xl font-bold tabular-nums ${c}`}>{v as any}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="grid grid-cols-7 gap-1.5 text-[10px] font-semibold uppercase text-slate-500 mb-1.5">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="text-center">{d}</div>)}
          </div>
          {loading && !data ? <p className="p-8 text-center text-xs text-slate-500">Loading…</p> : (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: lead }).map((_, i) => <div key={'p' + i} />)}
              {data?.days.map(d => {
                const st = STATUS[d.status] || STATUS.future;
                return (
                  <button key={d.date} disabled={d.status === 'future' || d.status === 'not_joined'} onClick={() => setSel(d.date)}
                    className={`min-h-[78px] text-left rounded-lg border p-1.5 transition ${st.cls} ${sel === d.date ? 'ring-2 ring-blue-500' : ''}`}>
                    <div className="flex justify-between items-start">
                      <span className="text-[11px] font-bold text-white/90">{Number(d.date.slice(8))}</span>
                      {d.late && <span title="Late" className="text-[9px] font-bold text-amber-300">LATE</span>}
                    </div>
                    {d.clockIn && <div className="text-[10px] tabular-nums mt-0.5">{t(d.clockIn)}–{d.clockOut ? t(d.clockOut) : (d.status === 'working' ? 'now' : '?')}</div>}
                    {d.activeMs > 0 && <div className="text-[11px] font-semibold tabular-nums">{dur(d.activeMs)}</div>}
                    {!d.clockIn && st.label && <div className="text-[10px] mt-1">{st.label}</div>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-3 text-[10.5px] text-slate-400">
            {['present', 'partial', 'absent', 'leave', 'off'].map(k => <span key={k} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm border ${STATUS[k].cls}`} />{STATUS[k].label}</span>)}
            <span>· Full day = 6h+ worked (8h is the target)</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 self-start">
          {!day ? <p className="text-xs text-slate-500">Pick a day.</p> : (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-start">
                <h3 className="text-sm font-bold text-white">{new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</h3>
                <span className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold ${(STATUS[day.status] || STATUS.future).cls}`}>{(STATUS[day.status] || STATUS.future).label || '—'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[['First seen', t(day.firstSeen)], ['Clocked in', t(day.clockIn)], ['Clocked out', day.clockOut ? t(day.clockOut) : (day.status === 'working' ? 'Still working' : '—')],
                  ['Worked (minus breaks)', day.activeMs ? dur(day.activeMs) : '—'], ['Breaks', day.breakCount ? `${dur(day.breakMs)} · ${day.breakCount}` : '—'], ['In huddle', day.huddleMs ? dur(day.huddleMs) : '—']].map(([l, v]) => (
                  <div key={l} className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="text-[10px] text-slate-500">{l}</div><div className="text-white font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              {day.late && <p className="text-amber-300">Clocked in after 9:30 AM.</p>}
              {day.overBreak && <p className="text-rose-300">Breaks went over the 1-hour limit.</p>}
              {day.leave && <p className="text-sky-300">Leave ({day.leave.status}{day.leave.dayType !== 'full' ? `, ${day.leave.dayType.replace('_', ' ')}` : ''}){day.leave.reason ? ` — ${day.leave.reason}` : ''}</p>}
              {day.sessions.length > 0 && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase text-slate-500 mb-1">Sessions</div>
                  <ul className="space-y-1">
                    {day.sessions.map((s, i) => <li key={i} className="flex justify-between text-slate-300"><span>{t(s.start)} → {s.end ? t(s.end) : 'still on'}{s.autoClosed ? ' (auto-closed)' : ''}</span><span className="text-slate-500">{dur(s.activeMs)}</span></li>)}
                  </ul>
                </div>
              )}
              {day.breaks.length > 0 && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase text-slate-500 mb-1">Breaks</div>
                  <ul className="space-y-1">
                    {day.breaks.map((b, i) => <li key={i} className="flex justify-between text-slate-300"><span>{t(b.start)} → {b.end ? t(b.end) : 'on break'}</span><span className={b.ms > 30 * 60_000 ? 'text-rose-300' : 'text-slate-500'}>{dur(b.ms)}</span></li>)}
                  </ul>
                </div>
              )}
              {day.logins.length > 0 && (
                <div className="text-slate-400">Robin opened at {day.logins.map(l => t(l.at)).join(', ')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
