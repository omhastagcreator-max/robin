import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { VideoProgressEditor, VideoProgressBar, type Progress } from '@/components/shared/VideoProgress';

/**
 * VideoSopDailyGate — Oct 2026 (owner: "day need to update for each step…
 * Robin will drive the team to work and complete it, it should not
 * suggest them"). For anyone who owns a brand in the Video SOP:
 *
 *   · a sticky "DO NOW" bar on every page — each brand, the exact step,
 *     what's left on it and the deadline (instructions, not suggestions)
 *   · a must-answer popup when an update is required — the current step is
 *     overdue/missed with nothing posted today, or it's 5 PM+ and a brand has
 *     no update today. Clears only by posting the day's update for each
 *     brand (or completing the step on the Video SOP page).
 *
 * The rules live server-side (videoSopEngine.updateRequired); this just
 * renders them. Hidden on /video-tasks itself, where the work is done.
 */
interface Item {
  runId: string; clientName: string; dayNumber: number; stepKey: string; stepTitle: string;
  dueAt: string | null; graceUntil: string | null; state: string; todo: string[];
  updatedToday: boolean; required: boolean; why: string;
  role?: 'owner' | 'helper'; needsProgress?: boolean; progress?: Progress;
}
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const late = (s: string) => s === 'overdue' || s === 'missed';

export function VideoSopDailyGate() {
  const { user, role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { text: string; blocker: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const staff = !!user && ['admin', 'employee', 'sales', 'workroom'].includes(role);

  const load = useCallback(() => {
    if (!staff) return;
    api.videoSopMyToday().then((d: any) => setItems(d?.items || [])).catch(() => {});
  }, [staff]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    const on = () => load();
    window.addEventListener('robin:data-changed', on);
    return () => { clearInterval(t); window.removeEventListener('robin:data-changed', on); };
  }, [load]);
  useEffect(() => { load(); }, [location.pathname, load]);

  if (!staff || items.length === 0) return null;
  const onSopPage = location.pathname.startsWith('/video-tasks');
  const required = items.filter(i => i.required);
  // "Tomorrow when they log in, ask them to update the total status of the brands."
  const needProgress = items.filter(i => i.needsProgress);
  const saveProgress = async (it: Item, v: any) => {
    setBusy('p' + it.runId);
    try { await api.videoSopProgress(it.runId, v); toast.success(`${it.clientName}: video status saved.`); load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not save.'); }
    finally { setBusy(null); }
  };

  const submit = async (it: Item) => {
    const d = drafts[it.runId] || { text: '', blocker: '' };
    if (d.text.trim().length < 15) { toast.error('Write what you actually did today on this step — a full sentence.'); return; }
    setBusy(it.runId);
    try {
      await api.videoSopDailyUpdate(it.runId, d.text.trim(), d.blocker.trim());
      toast.success(`Update posted for ${it.clientName}.`);
      setDrafts(x => ({ ...x, [it.runId]: { text: '', blocker: '' } }));
      load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not post the update.'); }
    finally { setBusy(null); }
  };

  return (
    <>
      {/* Sticky DO-NOW bar */}
      {!onSopPage && (
        <div className="sticky top-0 z-20 bg-rose-950/60 border-b border-rose-500/30 px-4 py-2 flex items-center gap-3 overflow-x-auto">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-rose-300"><i className="fa-solid fa-clapperboard mr-1.5"></i>Robin · do now</span>
          {items.map(it => (
            <button key={it.runId} onClick={() => navigate(`/video-tasks?run=${it.runId}`)}
              className={`shrink-0 text-left text-[11.5px] px-2.5 py-1 rounded-lg border ${late(it.state) ? 'border-rose-500/60 bg-rose-500/15 text-rose-100' : 'border-slate-700 bg-slate-900/80 text-slate-200'} hover:border-white/40`}>
              <b>{it.clientName}</b> → {it.stepTitle}{it.todo[0] ? `: ${it.todo[0]}` : ''} · {late(it.state) ? <span className="font-bold text-rose-300">{it.state === 'missed' ? 'MISSED' : 'OVERDUE'}</span> : <>by {when(it.dueAt)}</>}
              {!it.updatedToday && <span className="ml-1.5 text-amber-300">· update due</span>}
            </button>
          ))}
        </div>
      )}

      {/* Must-answer popup */}
      {needProgress.length > 0 && !onSopPage && (
        <div className="fixed inset-0 z-[91] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sop-progress-title">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div>
              <h2 id="sop-progress-title" className="text-white font-bold text-base"><i className="fa-solid fa-film text-emerald-400 mr-2"></i>Update the video status of your brands</h2>
              <p className="text-xs text-slate-400 mt-1">For each brand: how many videos in total, and how many are in script, with the creator, in editing and delivered. Rahul sees this on his board.</p>
            </div>
            {needProgress.map(it => (
              <div key={it.runId} className="rounded-xl border border-slate-700 bg-slate-950/50 p-3.5 space-y-2">
                <div className="text-sm font-bold text-white">{it.clientName} <span className="text-slate-400 font-normal">· now at {it.stepTitle || 'final steps'}</span></div>
                {it.progress?.total ? <VideoProgressBar p={it.progress} compact /> : null}
                <VideoProgressEditor initial={it.progress} busy={busy === 'p' + it.runId} onSave={v => saveProgress(it, v)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {required.length > 0 && !onSopPage && needProgress.length === 0 && (
        <div className="fixed inset-0 z-[90] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sop-gate-title">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div>
              <h2 id="sop-gate-title" className="text-white font-bold text-base"><i className="fa-solid fa-clapperboard text-rose-400 mr-2"></i>Robin — today's update is required</h2>
              <p className="text-xs text-slate-400 mt-1">For each brand below: write what you did today on the current step, or go and finish the step now. This stays until every brand is updated.</p>
            </div>
            {required.map(it => {
              const d = drafts[it.runId] || { text: '', blocker: '' };
              const setD = (p: Partial<typeof d>) => setDrafts(x => ({ ...x, [it.runId]: { ...d, ...p } }));
              return (
                <div key={it.runId} className={`rounded-xl border p-3.5 space-y-2 ${late(it.state) ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-700 bg-slate-950/50'}`}>
                  <div className="flex justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-white">{it.clientName} <span className="text-slate-400 font-normal">· Day {it.dayNumber} of 7</span></div>
                      <div className="text-xs text-slate-300">Step: <b>{it.stepTitle}</b> · {late(it.state) ? <span className="text-rose-300 font-bold">{it.state === 'missed' ? 'MISSED' : 'OVERDUE'} — was due {when(it.dueAt)}</span> : <>due {when(it.dueAt)}</>}</div>
                    </div>
                    <button onClick={() => navigate(`/video-tasks?run=${it.runId}`)} className="shrink-0 self-start text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-semibold">Finish step now</button>
                  </div>
                  {it.todo.length > 0 && (
                    <ul className="text-[11.5px] text-slate-300 list-disc pl-5">
                      {it.todo.slice(0, 5).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  )}
                  <textarea rows={2} value={d.text} onChange={e => setD({ text: e.target.value })} aria-label={`Today's update for ${it.clientName}`}
                    placeholder="What did you do today on this step? (e.g. Sent Draft 1 to client at 3 PM, waiting for their changes)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
                  <input value={d.blocker} onChange={e => setD({ blocker: e.target.value })} aria-label="Blocker"
                    placeholder="Blocked on something? Say what (goes straight to Rahul & admin) — optional"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
                  <div className="flex justify-end">
                    <button disabled={busy === it.runId} onClick={() => submit(it)} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">Post today's update</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
