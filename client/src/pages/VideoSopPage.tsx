import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { VideoProgressBar, VideoProgressEditor, type Progress } from '@/components/shared/VideoProgress';

/**
 * UGC Video SOP — Oct 2026 (owner: "for the UGC team I need this to be
 * strictly followed for every new brand… every step is to be marked by the
 * assigned person from the video team"). Rules live server-side in
 * server/src/lib/videoSop.ts; this page is the board + the per-brand
 * checklist. The server enforces order, assignee-only marking and the
 * late-reason rule — the UI just mirrors it so nobody hits a dead end.
 */

type StepState = 'done' | 'done_late' | 'locked' | 'open' | 'due_soon' | 'overdue' | 'missed';
interface StepDef { key: string; phase: number; title: string; hint: string; dueHours: number; graceHours: number; after?: string[]; items: { text: string; important?: boolean }[]; linkLabel?: string; noteLabel?: string; briefFields?: boolean }
interface Meta { steps: StepDef[]; briefFields: { key: string; label: string; required: boolean; placeholder: string }[]; lateReasons: { key: string; label: string }[] }
interface RunStep { key: string; dueAt: string; graceUntil: string; items: { done: boolean; doneAt?: string }[]; link: string; note: string; doneAt: string | null; doneBy: string; doneByName: string; late: boolean; afterGrace: boolean; lateReason: string; lateNote: string; state: StepState; unlocked: boolean }
interface Run {
  _id: string; workflowId: string; serviceId: string; clientName: string; assignedTo: string; assigneeName: string;
  startedAt: string; status: string; completedAt: string | null; brief: Record<string, string>;
  log: { at: string; actorName: string; action: string; detail: string }[];
  dailyUpdates?: { dateIST: string; at: string; byName: string; stepKey: string; text: string; blocker: string }[];
  salesBrief?: Record<string, any> | null;
  progress?: Progress;
  helpers?: { id: string; name: string }[];
  updatedToday?: boolean;
  steps: RunStep[]; doneCount: number; total: number; missed: number; overdue: number; lateDone: number;
  health: 'on_track' | 'due_soon' | 'overdue' | 'missed' | 'completed'; currentStep: string | null; currentDueAt: string | null; dayNumber: number;
}
interface ListPayload { runs: Run[]; notStarted: { workflowId: string; serviceId: string; clientName: string }[]; canManage: boolean; me: string }

const STATE_STYLE: Record<StepState, { dot: string; chip: string; label: string }> = {
  done:      { dot: 'bg-emerald-500', chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', label: 'Done on time' },
  done_late: { dot: 'bg-amber-400',   chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30',     label: 'Done late' },
  locked:    { dot: 'bg-slate-700',   chip: 'bg-slate-800 text-slate-400 border-slate-700',          label: 'Waiting on earlier step' },
  open:      { dot: 'bg-blue-500',    chip: 'bg-blue-500/10 text-blue-300 border-blue-500/30',       label: 'Open' },
  due_soon:  { dot: 'bg-yellow-400',  chip: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30', label: 'Due soon' },
  overdue:   { dot: 'bg-orange-500 animate-pulse', chip: 'bg-orange-500/10 text-orange-300 border-orange-500/40', label: 'Overdue — in grace' },
  missed:    { dot: 'bg-rose-500 animate-pulse',   chip: 'bg-rose-500/10 text-rose-300 border-rose-500/40',     label: 'MISSED' },
};
const HEALTH: Record<Run['health'], { label: string; cls: string }> = {
  on_track:  { label: 'On track',  cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  due_soon:  { label: 'Due soon',  cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' },
  overdue:   { label: 'Overdue',   cls: 'bg-orange-500/10 text-orange-300 border-orange-500/40' },
  missed:    { label: 'Missed',    cls: 'bg-rose-500/10 text-rose-300 border-rose-500/40' },
  completed: { label: 'Completed', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
};
const PHASES: Record<number, string> = { 1: 'Step 1 · Day 1 · Meeting with client', 2: 'Step 2 · Day 1–3 · Research & creator', 3: 'Step 3 · Day 2–3 · Scripting & shipping', 4: 'Step 4 · Day 3–7 · Video' };

const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
function countdown(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  const a = Math.abs(ms); const h = Math.floor(a / 3_600_000); const m = Math.floor((a % 3_600_000) / 60_000);
  const t = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
  return ms >= 0 ? `in ${t}` : `${t} ago`;
}

export default function VideoSopPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [data, setData] = useState<ListPayload | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mine' | 'late'>('all');
  const [startOpen, setStartOpen] = useState(false);
  const selectedId = params.get('run');

  const load = useCallback(() => {
    api.videoSopList(tab).then(setData).catch(() => toast.error('Could not load Video SOP')).finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { api.videoSopMeta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const on = () => load();
    window.addEventListener('robin:data-changed', on);
    const t = setInterval(load, 60_000);
    return () => { window.removeEventListener('robin:data-changed', on); clearInterval(t); };
  }, [load]);
  // Deep link from the Decision Tree: ?workflow=<id>
  useEffect(() => {
    const wf = params.get('workflow');
    if (wf && data) {
      const r = data.runs.find(x => x.workflowId === wf);
      if (r) setParams({ run: r._id }, { replace: true });
    }
  }, [params, data, setParams]);

  const runs = useMemo(() => {
    const all = data?.runs || [];
    const rank: Record<string, number> = { missed: 0, overdue: 1, due_soon: 2, on_track: 3, completed: 4 };
    return all
      .filter(r => filter === 'all' || (filter === 'mine' ? r.assignedTo === data?.me : r.missed + r.overdue > 0))
      .sort((a, b) => rank[a.health] - rank[b.health] || String(a.currentDueAt).localeCompare(String(b.currentDueAt)));
  }, [data, filter]);
  const counts = useMemo(() => {
    const all = data?.runs || [];
    return { total: all.length, mine: all.filter(r => r.assignedTo === data?.me).length, late: all.filter(r => r.missed + r.overdue > 0).length,
      onTrack: all.filter(r => r.health === 'on_track').length, soon: all.filter(r => r.health === 'due_soon').length,
      overdue: all.filter(r => r.health === 'overdue').length, missed: all.filter(r => r.health === 'missed').length };
  }, [data]);

  const selected = data?.runs.find(r => r._id === selectedId) || null;
  const replaceRun = (r: Run) => setData(d => d ? { ...d, runs: d.runs.map(x => x._id === r._id ? { ...x, ...r } : x) } : d);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 p-6 space-y-5 overflow-y-auto w-full">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <i className="fa-solid fa-clapperboard text-rose-400"></i> UGC Video SOP
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Every new brand goes through these steps in order, Day 1 → Day 6. Only the assigned video-team person can mark a step; late steps need a reason.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
            {(['active', 'completed'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setParams({}); }} className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize ${tab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{t}</button>
            ))}
          </div>
          {data?.canManage && (data.notStarted.length > 0) && (
            <button onClick={() => setStartOpen(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
              <i className="fa-solid fa-play mr-1.5"></i> Start SOP for a brand ({data.notStarted.length})
            </button>
          )}
        </div>
      </div>

      {tab === 'active' && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Count label="Brands in SOP" value={counts.total} cls="text-white" />
          <Count label="On track" value={counts.onTrack} cls="text-emerald-400" />
          <Count label="Due in 6h" value={counts.soon} cls="text-yellow-300" />
          <Count label="Overdue (grace)" value={counts.overdue} cls="text-orange-400" />
          <Count label="Missed" value={counts.missed} cls="text-rose-400" />
        </div>
      )}

      <div className={`grid gap-5 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]' : ''}`}>
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden self-start">
          <div className="flex items-center gap-2 p-3 border-b border-slate-800">
            {([['all', `All · ${counts.total}`], ['mine', `Mine · ${counts.mine}`], ['late', `Late · ${counts.late}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === k ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          {loading ? <p className="p-6 text-center text-slate-500 text-xs">Loading…</p>
            : runs.length === 0 ? <p className="p-8 text-center text-slate-500 text-xs">{tab === 'active' ? 'No brand is in the Video SOP right now. New brands with UGC Videos start automatically.' : 'No completed SOPs yet.'}</p>
            : (
              <ul className="divide-y divide-slate-800/70">
                {runs.map(r => {
                  const cur = r.steps.find(s => s.key === r.currentStep);
                  const curDef = meta?.steps.find(s => s.key === r.currentStep);
                  return (
                    <li key={r._id}>
                      <button onClick={() => setParams({ run: r._id })} className={`w-full text-left px-4 py-3 hover:bg-slate-800/40 transition ${selectedId === r._id ? 'bg-blue-600/10' : ''}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{r.clientName}</div>
                            <div className="text-[11px] text-slate-400">{r.assigneeName || <span className="text-rose-400 font-semibold">No video person assigned</span>}{r.status === 'active' ? ` · Day ${Math.min(r.dayNumber, 99)} of 7` : ''}</div>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded border text-[10.5px] font-semibold ${HEALTH[r.health].cls}`}>{HEALTH[r.health].label}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-1" aria-label={`${r.doneCount} of ${r.total} steps done`}>
                          {r.steps.map(s => <span key={s.key} title={`${meta?.steps.find(d => d.key === s.key)?.title || s.key} — ${STATE_STYLE[s.state].label}`} className={`h-2 flex-1 rounded-full ${STATE_STYLE[s.state].dot}`} />)}
                          <span className="ml-2 text-[10.5px] text-slate-400 tabular-nums">{r.doneCount}/{r.total}</span>
                        </div>
                        <div className="mt-2"><VideoProgressBar p={r.progress} compact /></div>
                        {cur && curDef && (
                          <div className="mt-1.5 text-[11px] text-slate-400">
                            Now: <span className="text-slate-200">{curDef.title}</span> · due {fmtWhen(cur.dueAt)} <span className={cur.state === 'missed' || cur.state === 'overdue' ? 'text-rose-400 font-semibold' : ''}>({countdown(cur.dueAt)})</span>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>

        {selected && meta && (
          <RunDetail key={selected._id} run={selected} meta={meta} me={data!.me} canManage={data!.canManage}
            onChange={replaceRun} onClose={() => setParams({})} reload={load} />
        )}
      </div>

      <RulesCard />
      {startOpen && data && meta && <StartModal options={data.notStarted} steps={meta.steps} onClose={() => setStartOpen(false)} onStarted={() => { setStartOpen(false); load(); }} />}
    </div>
  );
}

function Count({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function RunDetail({ run, meta, me, canManage, onChange, onClose, reload }: { run: Run; meta: Meta; me: string; canManage: boolean; onChange: (r: Run) => void; onClose: () => void; reload: () => void }) {
  const navigate = useNavigate();
  const isOwner = (run.assignedTo === me || (run.helpers || []).some(h => h.id === me)) && run.status === 'active';
  const isHelper = run.assignedTo !== me && (run.helpers || []).some(h => h.id === me);
  const [busy, setBusy] = useState<string | null>(null);
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [users, setUsers] = useState<{ _id: string; name: string; videoTeam?: boolean }[]>([]);
  const [daily, setDaily] = useState({ text: '', blocker: '' });
  const [drafts, setDrafts] = useState<Record<string, { link: string; note: string }>>({});
  const [brief, setBrief] = useState<Record<string, string>>(run.brief || {});
  useEffect(() => { if (canManage) api.videoSopTeam().then(setUsers).catch(() => {}); }, [canManage]);
  const postDaily = () => {
    if (daily.text.trim().length < 15) { toast.error('Write what you actually did today on this step — a full sentence.'); return; }
    act('daily', async () => { const r = await api.videoSopDailyUpdate(run._id, daily.text.trim(), daily.blocker.trim()); setDaily({ text: '', blocker: '' }); toast.success('Today\'s update posted.'); return r; });
  };

  const act = async (key: string, fn: () => Promise<Run>) => {
    setBusy(key);
    try { onChange(await fn()); }
    catch (e: any) {
      if (e?.response?.data?.needsReason) setLateFor(key);
      toast.error(e?.response?.data?.error || 'Could not save');
    } finally { setBusy(null); }
  };
  const complete = (key: string, extra: { lateReason?: string; lateNote?: string } = {}) => {
    const d = drafts[key] || { link: '', note: '' };
    const step = run.steps.find(s => s.key === key)!;
    if (new Date(step.dueAt).getTime() < Date.now() && !extra.lateReason) { setLateFor(key); return; }
    act(key, async () => {
      const r = await api.videoSopComplete(run._id, key, { link: d.link || step.link, note: d.note || step.note, ...extra });
      toast.success('Step marked done and logged to the CRM.');
      setLateFor(null);
      return r;
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden self-start">
      <div className="p-4 border-b border-slate-800 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white">{run.clientName}</h3>
          <p className="text-[11.5px] text-slate-400">Started {fmtWhen(run.startedAt)} · {run.status === 'active' ? `Day ${run.dayNumber} of 7` : run.status}{run.lateDone ? ` · ${run.lateDone} step${run.lateDone > 1 ? 's' : ''} done late` : ''}</p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-slate-400">Video person:</span>
            {canManage ? (
              <select value={run.assignedTo || ''} onChange={e => e.target.value && act('assign', () => api.videoSopAssign(run._id, e.target.value))}
                className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-white [&>option]:bg-slate-900">
                <option value="">— assign —</option>
                {users.map(u => <option key={u._id} value={u._id}>{u.name}{u.videoTeam ? ' (video team)' : ''}</option>)}
              </select>
            ) : <span className="text-white font-semibold">{run.assigneeName || 'Not assigned'}</span>}
            {isOwner && <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10.5px] font-semibold">{isHelper ? 'You help on this SOP' : 'You own this SOP'}</span>}
          </div>
          {(run.helpers || []).length > 0 && <div className="mt-1 text-[11px] text-slate-400">Working with: {(run.helpers || []).map(h => h.name).join(', ')}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/command-center', { state: { clientId: run.workflowId } })} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg"><i className="fa-solid fa-diagram-project mr-1"></i> DT</button>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white px-2 py-1"><i className="fa-solid fa-xmark"></i></button>
        </div>
      </div>

      {!isOwner && run.status === 'active' && (
        <p className="mx-4 mt-3 text-[11.5px] text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
          <i className="fa-solid fa-eye mr-1.5"></i>View only — {run.assigneeName ? `${run.assigneeName} marks these steps.` : 'assign a video-team person so the steps can be marked.'}
        </p>
      )}

      <div className="p-4 space-y-5 max-h-[calc(100vh-260px)] overflow-y-auto">
        <section className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
          <h4 className="text-xs font-bold text-white mb-2"><i className="fa-solid fa-film mr-1.5 text-rose-400"></i>Video status{run.progress?.updatedAt ? <span className="text-slate-500 font-normal"> · updated {fmtWhen(run.progress.updatedAt)}</span> : ''}</h4>
          <VideoProgressBar p={run.progress} />
          {isOwner && (
            <div className="mt-3">
              <VideoProgressEditor key={run.progress?.updatedAt || 'new'} initial={run.progress} busy={busy === 'progress'}
                onSave={v => act('progress', async () => { const r = await api.videoSopProgress(run._id, v); toast.success('Video status saved.'); return r; })} />
            </div>
          )}
        </section>
        {run.salesBrief && (
          <section className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-[11.5px] text-slate-300">
            <h4 className="text-xs font-bold text-white mb-1.5"><i className="fa-solid fa-handshake mr-1.5 text-emerald-400"></i>From sales at onboarding</h4>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              <div><span className="text-slate-500">Videos:</span> <b className="text-white">{run.salesBrief.videos}</b></div>
              <div><span className="text-slate-500">Product:</span> {run.salesBrief.product}</div>
              <div><span className="text-slate-500">Price / offer:</span> {run.salesBrief.price}{run.salesBrief.offer ? ` · ${run.salesBrief.offer}` : ''}</div>
              {run.salesBrief.contactName && <div><span className="text-slate-500">Contact:</span> {run.salesBrief.contactName} {run.salesBrief.contactPhone}</div>}
              <div className="sm:col-span-2"><span className="text-slate-500">Requirements:</span> {run.salesBrief.requirements}</div>
              {run.salesBrief.competitors && <div className="sm:col-span-2"><span className="text-slate-500">Competitors:</span> {run.salesBrief.competitors} {run.salesBrief.competitorLinks}</div>}
            </div>
          </section>
        )}
        {run.status === 'active' && (
          <section className={`rounded-lg border p-3 ${run.updatedToday ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-white">Today's update {run.updatedToday ? <span className="text-emerald-300 font-semibold">· done ✓</span> : <span className="text-amber-300 font-semibold">· required every day</span>}</h4>
              {run.dailyUpdates?.[0] && <span className="text-[10.5px] text-slate-500">last: {fmtWhen(run.dailyUpdates[0].at)}</span>}
            </div>
            {isOwner && (
              <div className="mt-2 space-y-2">
                <textarea rows={2} value={daily.text} onChange={e => setDaily(d => ({ ...d, text: e.target.value }))} placeholder="What did you do today on the current step?"
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-slate-600" />
                <div className="flex gap-2">
                  <input value={daily.blocker} onChange={e => setDaily(d => ({ ...d, blocker: e.target.value }))} placeholder="Blocker (optional — alerts Rahul & admin)"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-slate-600" />
                  <button disabled={busy === 'daily'} onClick={postDaily} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Post update</button>
                </div>
              </div>
            )}
            {(run.dailyUpdates || []).length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {(run.dailyUpdates || []).slice(0, 5).map((u, i) => (
                  <li key={i} className="text-[11.5px] text-slate-300">
                    <span className="text-slate-500">{fmtWhen(u.at)} · {u.byName}:</span> {u.text}
                    {u.blocker && <span className="block text-rose-300">Blocker: {u.blocker}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {[1, 2, 3, 4].map(phase => (
          <section key={phase}>
            <h4 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-2">{PHASES[phase]}</h4>
            <div className="space-y-2">
              {meta.steps.filter(d => d.phase === phase).map(def => {
                const s = run.steps.find(x => x.key === def.key);
                if (!s) return null;
                const st = STATE_STYLE[s.state];
                const isCurrent = run.currentStep === def.key;
                const editable = isOwner && !s.doneAt && s.unlocked;
                const d = drafts[def.key] || { link: s.link || '', note: s.note || '' };
                const setD = (p: Partial<typeof d>) => setDrafts(x => ({ ...x, [def.key]: { ...d, ...p } }));
                return (
                  <div key={def.key} className={`rounded-lg border p-3 ${isCurrent ? 'border-blue-500/50 bg-blue-600/5' : 'border-slate-800 bg-slate-950/40'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-white flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />{def.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{def.hint}</div>
                      </div>
                      <div className="ml-auto text-right">
                        <span className={`inline-block px-2 py-0.5 rounded border text-[10.5px] font-semibold ${st.chip}`}>{st.label}</span>
                        {!s.doneAt && <div className="text-[10.5px] text-slate-400 mt-1">Due {fmtWhen(s.dueAt)} · {countdown(s.dueAt)}{def.graceHours ? ` · grace till ${fmtWhen(s.graceUntil)}` : ' · hard deadline'}</div>}
                      </div>
                    </div>

                    {s.doneAt && (
                      <div className="mt-2 text-[11.5px] text-slate-300">
                        <i className="fa-solid fa-check text-emerald-400 mr-1"></i>
                        {s.doneByName || 'Someone'} · {fmtWhen(s.doneAt)}
                        {s.late && <span className="text-amber-300"> · late{s.afterGrace ? ' (after grace)' : ''}: {meta.lateReasons.find(r => r.key === s.lateReason)?.label}{s.lateNote ? ` — ${s.lateNote}` : ''}</span>}
                        {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="ml-2 text-blue-400 underline underline-offset-2">open link</a>}
                        {s.note && <div className="text-slate-400 mt-0.5">{def.noteLabel || 'Note'}: {s.note}</div>}
                        {canManage && <button onClick={() => { const reason = window.prompt('Why reopen this step? (it also reopens every step after it)'); if (reason) act(def.key, () => api.videoSopReopen(run._id, def.key, reason)); }} className="ml-2 text-[10.5px] text-slate-500 hover:text-rose-300 underline">reopen</button>}
                      </div>
                    )}

                    {!s.doneAt && (def.briefFields || def.items.length > 0 || def.linkLabel || def.noteLabel) && (s.unlocked || isCurrent) && (
                      <div className="mt-3 space-y-2">
                        {def.briefFields && meta.briefFields.map(f => (
                          <label key={f.key} className="block">
                            <span className="text-[11px] text-slate-400">{f.label}{f.required ? ' *' : ''}</span>
                            <textarea rows={f.key === 'competitorLinks' ? 2 : 1} disabled={!editable} value={brief[f.key] || ''} placeholder={f.placeholder}
                              onChange={e => setBrief(b => ({ ...b, [f.key]: e.target.value }))}
                              className="mt-0.5 w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-slate-600 disabled:opacity-60 focus:outline-none focus:border-blue-500" />
                          </label>
                        ))}
                        {def.briefFields && editable && (
                          <button disabled={busy === 'brief'} onClick={() => act('brief', () => api.videoSopSaveBrief(run._id, brief).then((r: Run) => { toast.success('Brief saved.'); return r; }))} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg">Save brief</button>
                        )}
                        {def.items.map((it, i) => (
                          <label key={i} className={`flex items-center gap-2 text-[12.5px] ${editable ? 'cursor-pointer' : ''} ${it.important ? 'text-amber-200' : 'text-slate-200'}`}>
                            <input type="checkbox" className="accent-blue-500 h-4 w-4" disabled={!editable || busy === def.key} checked={!!s.items[i]?.done}
                              onChange={e => act(def.key, () => api.videoSopToggleItem(run._id, def.key, i, e.target.checked))} />
                            <span className={s.items[i]?.done ? 'line-through decoration-emerald-500/60 text-slate-400' : ''}>{it.text}</span>
                            {it.important && <span className="text-[9.5px] font-bold uppercase text-amber-400">important</span>}
                          </label>
                        ))}
                        {def.linkLabel && (
                          <input disabled={!editable} value={d.link} onChange={e => setD({ link: e.target.value })} placeholder={`${def.linkLabel} (required) — https://…`}
                            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-slate-600 disabled:opacity-60 focus:outline-none focus:border-blue-500" />
                        )}
                        {def.noteLabel && (
                          <input disabled={!editable} value={d.note} onChange={e => setD({ note: e.target.value })} placeholder={def.noteLabel}
                            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-slate-600 disabled:opacity-60 focus:outline-none focus:border-blue-500" />
                        )}
                        {editable && (
                          <div className="flex justify-end pt-1">
                            <button disabled={busy === def.key} onClick={() => def.briefFields
                              ? api.videoSopSaveBrief(run._id, brief).then(() => complete(def.key)).catch((e: any) => toast.error(e?.response?.data?.error || 'Could not save brief'))
                              : complete(def.key)}
                              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">
                              <i className="fa-solid fa-check mr-1.5"></i> Mark step done
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {!s.doneAt && !s.unlocked && (
                      <p className="mt-1.5 text-[10.5px] text-slate-500"><i className="fa-solid fa-lock mr-1"></i>Unlocks when {(def.after || []).filter(k => !run.steps.find(x => x.key === k)?.doneAt).map(k => `"${meta.steps.find(d => d.key === k)?.title || k}"`).join(' and ') || 'the step before it'} {((def.after || []).length > 1) ? 'are' : 'is'} done.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <section>
          <h4 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-2">SOP log</h4>
          <ul className="bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800/70 text-[11.5px]">
            {run.log.length === 0 && <li className="p-3 text-slate-500">Nothing yet.</li>}
            {run.log.map((l, i) => (
              <li key={i} className="px-3 py-2 flex justify-between gap-3">
                <span className="text-slate-300"><b className="text-white">{l.actorName || 'Robin'}</b> — {l.detail || l.action.replace(/_/g, ' ')}</span>
                <span className="text-slate-500 whitespace-nowrap">{fmtWhen(l.at)}</span>
              </li>
            ))}
          </ul>
          {canManage && run.status === 'active' && (
            <button onClick={() => { const reason = window.prompt('Cancel this brand\'s Video SOP? Give a reason (e.g. client paused UGC).'); if (reason) api.videoSopCancel(run._id, reason).then(() => { toast.success('SOP cancelled.'); onClose(); reload(); }).catch((e: any) => toast.error(e?.response?.data?.error || 'Could not cancel')); }}
              className="mt-2 text-[11px] text-slate-500 hover:text-rose-300 underline">Cancel this SOP</button>
          )}
        </section>
      </div>

      {lateFor && <LateReasonModal title={meta.steps.find(d => d.key === lateFor)?.title || ''} reasons={meta.lateReasons}
        onCancel={() => setLateFor(null)} onSubmit={(lateReason, lateNote) => complete(lateFor, { lateReason, lateNote })} />}
    </div>
  );
}

function LateReasonModal({ title, reasons, onCancel, onSubmit }: { title: string; reasons: { key: string; label: string }[]; onCancel: () => void; onSubmit: (r: string, n: string) => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const ok = reason && (reason !== 'other' || note.trim().length >= 5);
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-5 space-y-4">
        <div>
          <h4 className="text-white font-bold text-sm"><i className="fa-solid fa-clock text-amber-400 mr-2"></i>"{title}" is past its deadline</h4>
          <p className="text-xs text-slate-400 mt-1">Pick why it's late. This goes on the brand's log and to Rahul / admin.</p>
        </div>
        <select value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white [&>option]:bg-slate-900">
          <option value="">Select a reason…</option>
          {reasons.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
          placeholder={reason === 'other' ? 'Write the reason (required)' : 'Any detail (optional) — e.g. expected launch date'}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white">Cancel</button>
          <button disabled={!ok} onClick={() => onSubmit(reason, note)} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">Mark done (late)</button>
        </div>
      </div>
    </div>
  );
}

function StartModal({ options, steps, onClose, onStarted }: { options: { workflowId: string; serviceId: string; clientName: string }[]; steps: StepDef[]; onClose: () => void; onStarted: () => void }) {
  const [currentStep, setCurrentStep] = useState(steps[0]?.key || '');
  const [owner, setOwner] = useState('');
  const [team, setTeam] = useState<{ _id: string; name: string; videoTeam?: boolean }[]>([]);
  useEffect(() => { api.videoSopTeam().then(setTeam).catch(() => {}); }, []);
  const [pick, setPick] = useState(options[0] ? `${options[0].workflowId}|${options[0].serviceId}` : '');
  const [date, setDate] = useState(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const [w, s] = pick.split('|');
    setBusy(true);
    try { await api.videoSopStart(w, s, new Date(`${date}:00+05:30`).toISOString(), { currentStep, assignTo: owner || undefined }); toast.success('Video SOP started.'); onStarted(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not start'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4">
        <div>
          <h4 className="text-white font-bold text-sm">Start the Video SOP for an existing brand</h4>
          <p className="text-xs text-slate-400 mt-1">New brands start automatically when they're onboarded with UGC Videos. Use this for live brands added before 12 Oct: pick where the brand is now and when its Day 1 was. If it's already behind, pick today as Day 1 to give the team fresh deadlines from the current step.</p>
        </div>
        <select value={pick} onChange={e => setPick(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white [&>option]:bg-slate-900">
          {options.map(o => <option key={o.serviceId} value={`${o.workflowId}|${o.serviceId}`}>{o.clientName}</option>)}
        </select>
        <label className="block text-xs text-slate-400">Where is this brand right now?
          <select value={currentStep} onChange={e => setCurrentStep(e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white [&>option]:bg-slate-900">
            {steps.map((st, i) => <option key={st.key} value={st.key}>{i === 0 ? 'Not started — at ' : 'At '}{st.title}{i > 0 ? ' (earlier steps already done)' : ''}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-400">Video person
          <select value={owner} onChange={e => setOwner(e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white [&>option]:bg-slate-900">
            <option value="">Keep the current UGC owner</option>
            {team.map(u => <option key={u._id} value={u._id}>{u.name}{u.videoTeam ? ' (video team)' : ''}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-400">Day 1 started (IST) — deadlines count from here
          <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white [color-scheme:dark]" />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white">Cancel</button>
          <button disabled={!pick || busy} onClick={go} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">Start SOP</button>
        </div>
      </div>
    </div>
  );
}

function RulesCard() {
  // Oct 19 2026 — owner: "not just to mention — it has to be followed for
  // every client and Robin should drive the employees". So this card says
  // what Robin DOES, not what people should do.
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-300">
        <span><i className="fa-solid fa-shield-halved mr-2 text-rose-400"></i>Enforced by Robin on every UGC brand (SOP · 12 Oct 2026)</span>
        <i className={`fa-solid fa-chevron-down transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && (
        <ul className="px-5 pb-4 text-[12px] text-slate-400 space-y-1 list-disc">
          <li>Every live brand with UGC Videos is in the SOP automatically — new or old. No owner? Robin assigns the video team member with the fewest brands; Amit joins as helper.</li>
          <li>A brand can't be onboarded with UGC until sales fills the number of videos, product, price and requirements. Day 1 starts at onboarding; everything closes by Day 7.</li>
          <li>Steps unlock only in order (Day 1 meeting + research → Day 2 creator & Draft 1 → Day 3 final script, script sent, product shipped → videos → edits → final delivery by Day 6). Only the owner or helper can tick them.</li>
          <li>Every page shows the owner a "Do now" bar with the exact step, what's left and the deadline.</li>
          <li>A late or missed step, or no update by 5 PM, brings up a popup they must answer before carrying on.</li>
          <li>A step finished late can't be closed without a reason from the list. Grace is the last option.</li>
          <li>Reminders escalate: due in 6h → overdue every 2h → missed, hourly to the owner + admin + Rahul. Rahul gets a 7:30 PM list of brands with no update.</li>
        </ul>
      )}
    </div>
  );
}
