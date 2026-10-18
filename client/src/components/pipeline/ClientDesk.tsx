import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { VideoProgressBar } from '@/components/shared/VideoProgress';

/**
 * ClientDesk — Oct 2026. The Decision Tree's one-brand view, rebuilt from
 * Rahul's voice notes:
 *   · wide layout; the 3 things that matter visible without clicking —
 *     current stage, owner, next task — with the checklist one click away
 *   · "Update status": pick where the stage has reached from a dropdown, say
 *     the next task (+ by when), add notes → ONE clean log line
 *   · log reads "Name (Dept) · what changed · when" with notes under it
 *   · records who opened the client and when, even if they changed nothing
 *   · client update can be pushed straight to WhatsApp (and is logged)
 *   · no brand picker here — the brand is chosen in the CRM / pipeline board
 */

interface ChecklistItem { text: string; done: boolean; doneAt?: string; doneBy?: string }
export interface DeskService {
  _id: string; serviceType: string; label: string;
  status: 'blocked' | 'pending' | 'in_progress' | 'done';
  checklist: ChecklistItem[]; assignedTo?: string; assignee?: { name?: string } | null;
  returnedReason?: string; eta?: string | null;
  nextTask?: string; nextTaskDue?: string | null;
}
export interface DeskWorkflow {
  _id: string; clientName: string; clientPhone?: string; services: DeskService[];
  health?: string; eta?: string | null;
}
interface LogRow { at: string; name: string; department: string; stage: string; what: string; notes: string; nextTask: string; nextTaskDue: string | null; action: string }
interface OpenRow { at: string; name: string; department: string }

const STATUS_TXT: Record<string, string> = { done: 'Complete', in_progress: 'In progress', pending: 'Not started', blocked: 'Waiting on earlier stage' };
const STATUS_CLS: Record<string, string> = {
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  in_progress: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  pending: 'bg-slate-800 text-slate-300 border-slate-700',
  blocked: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const dateOnly = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '';
/**
 * Rahul's journey (voice note 1: "Discovery, Development, Video, Meta, Launch,
 * Scaling — that's how ours was"). Derived from the client's services:
 *   Discovery   onboarded (always done once the client is in Robin)
 *   Development Shopify / website stage
 *   Video       UGC videos stage (+ Video SOP)
 *   Meta        Meta Ads account set-up
 *   Launch      awareness campaigns live (Meta Ads item 2)
 *   Scaling     conversion / sales campaigns live (Meta Ads item 3)
 * A phase the client didn't buy shows as "not in plan".
 */
type PhaseState = 'done' | 'active' | 'pending' | 'none';
function journey(services: DeskService[]): { label: string; state: PhaseState; who?: string }[] {
  const by = (t: string) => services.find(s => s.serviceType === t);
  const svcState = (s?: DeskService): PhaseState => !s ? 'none' : s.status === 'done' ? 'done' : s.status === 'in_progress' ? 'active' : 'pending';
  const item = (s: DeskService | undefined, i: number) => !!s?.checklist?.[i]?.done;
  const dev = by('shopify') || by('misc');
  const video = by('influencer') || by('video_editing');
  const meta = by('meta_ads');
  const metaState: PhaseState = !meta ? 'none' : item(meta, 0) ? 'done' : meta.status === 'blocked' ? 'pending' : 'active';
  const launch: PhaseState = !meta ? 'none' : item(meta, 1) ? 'done' : item(meta, 0) ? 'active' : 'pending';
  const scaling: PhaseState = !meta ? 'none' : item(meta, 2) || meta.status === 'done' ? 'done' : item(meta, 1) ? 'active' : 'pending';
  return [
    { label: 'Discovery', state: 'done' },
    { label: 'Development', state: svcState(dev), who: dev?.assignee?.name },
    { label: 'Video', state: svcState(video), who: video?.assignee?.name },
    { label: 'Meta', state: metaState, who: meta?.assignee?.name },
    { label: 'Launch', state: launch, who: meta?.assignee?.name },
    { label: 'Scaling', state: scaling, who: meta?.assignee?.name },
  ];
}
const PHASE_CLS: Record<PhaseState, string> = {
  done: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  active: 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500/40',
  pending: 'bg-slate-900 border-slate-700 text-slate-400',
  none: 'bg-transparent border-dashed border-slate-800 text-slate-600',
};

const lastDoneIdx = (s: DeskService) => (s.checklist || []).reduce((m, it, i) => it.done ? i : m, -1);

export function ClientDesk({ workflow, onBack, onChanged }: { workflow: DeskWorkflow; onBack: () => void; onChanged: (wf: any) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEditAny = user?.role === 'admin' || (user as any)?.roles?.includes('admin') || !!user?.canEditAllClients;
  const services = workflow.services || [];
  const active = services.find(s => s.status === 'in_progress') || services.find(s => s.status === 'pending') || services.find(s => s.status === 'blocked') || null;
  const [stageId, setStageId] = useState<string>(active?._id || services[0]?._id || '');
  const stage = services.find(s => s._id === stageId) || active;
  const canEdit = !!stage && stage.status !== 'done' && (stage.assignedTo === user?.id || canEditAny);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [opens, setOpens] = useState<OpenRow[] | null>(null);
  const [showOpens, setShowOpens] = useState(false);
  const [sop, setSop] = useState<any>(null);

  // Update form
  const [reached, setReached] = useState<number>(stage ? lastDoneIdx(stage) : -1);
  const [nextTask, setNextTask] = useState(stage?.nextTask || '');
  const [nextDue, setNextDue] = useState(stage?.nextTaskDue ? new Date(new Date(stage.nextTaskDue).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Client update
  const [extra, setExtra] = useState('');

  useEffect(() => {
    if (!stage) return;
    setReached(lastDoneIdx(stage));
    setNextTask(stage.nextTask || '');
    setNextDue(stage.nextTaskDue ? new Date(new Date(stage.nextTaskDue).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId, workflow]);

  const loadLog = () => { api.cwCleanLog(workflow._id).then(setLog).catch(() => setLog([])); };
  useEffect(() => {
    // "Who opened it, when" — recorded every time the brand is opened here.
    api.cwRecordOpen(workflow._id).finally(() => api.cwOpens(workflow._id).then(setOpens).catch(() => setOpens([])));
    loadLog();
    if (services.some(s => s.serviceType === 'influencer')) api.videoSopByWorkflow(workflow._id).then(setSop).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow._id]);

  const stageFrom = stage ? lastDoneIdx(stage) : -1;
  const nextItem = stage ? (stage.checklist || []).find(i => !i.done)?.text : '';

  const saveUpdate = async () => {
    if (!stage) return;
    const moved = reached !== stageFrom;
    if (!moved && !nextTask.trim() && note.trim().length < 3) { toast.error('Move the stage, set a next task, or write a note.'); return; }
    setSaving(true);
    try {
      const wf = await api.cwUpdateProgress(workflow._id, stage._id, {
        reachedIndex: reached, nextTask: nextTask.trim(),
        nextTaskDue: nextDue ? new Date(`${nextDue}T23:59:00+05:30`).toISOString() : null,
        note: note.trim(),
      });
      toast.success('Saved and logged.');
      setNote('');
      onChanged(wf);
      loadLog();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  const completeStage = async () => {
    if (!stage) return;
    const c = window.prompt(`Mark "${stage.label}" complete — one line for the log:`, 'Stage verified and complete.');
    if (c === null) return;
    try { onChanged(await api.cwCompleteService(workflow._id, stage._id, { comment: c || 'Stage complete.' })); toast.success('Stage complete.'); loadLog(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not complete this stage.'); }
  };

  const toggleItem = async (svc: DeskService, index: number, item: ChecklistItem) => {
    const comment = window.prompt(`${item.done ? 'Un-tick' : 'Tick'} "${item.text}" — short note for the log:`, item.done ? 'Reverted for rework' : 'Done');
    if (comment === null) return;
    try { onChanged(await api.cwToggleCheck(workflow._id, svc._id, { index, done: !item.done, comment: comment || 'Updated' })); loadLog(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not update.'); }
  };

  const message = useMemo(() => {
    const lines = [`Hi ${workflow.clientName} team, quick update from Hashtag Creator:`];
    for (const s of services) {
      const done = (s.checklist || []).filter(i => i.done).length;
      const tot = (s.checklist || []).length;
      const last = (s.checklist || []).filter(i => i.done).slice(-1)[0]?.text;
      lines.push(`• ${s.label}: ${s.status === 'done' ? 'completed ✅' : `${STATUS_TXT[s.status]}${tot ? ` (${done}/${tot})` : ''}${last ? ` — latest: ${last}` : ''}`}`);
    }
    if (stage?.nextTask) lines.push(`Next: ${stage.nextTask}${stage.nextTaskDue ? ` by ${dateOnly(stage.nextTaskDue)}` : ''}`);
    else if (nextItem) lines.push(`Next: ${nextItem}`);
    if (extra.trim()) lines.push(extra.trim());
    return lines.join('\n');
  }, [workflow, services, stage, nextItem, extra]);

  const pushWhatsApp = () => {
    const phone = (workflow.clientPhone || '').replace(/\D/g, '');
    const num = phone.length === 10 ? `91${phone}` : phone;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
    api.cwLogClientUpdate(workflow._id, message, 'whatsapp').then(loadLog).catch(() => {});
    if (!phone) toast.message('No phone saved for this client — pick the chat in WhatsApp.');
  };
  const copyMsg = () => {
    navigator.clipboard.writeText(message).then(() => { toast.success('Copied.'); api.cwLogClientUpdate(workflow._id, message, 'copy').then(loadLog).catch(() => {}); })
      .catch(() => toast.error('Could not copy.'));
  };

  const lastOpen = opens?.[0];
  const sopCur = sop?.steps?.find((s: any) => s.key === sop.currentStep);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-4 animate-in fade-in duration-300">
      {/* Header — brand name, no brand dropdown */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="text-xs text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-lg"><i className="fa-solid fa-arrow-left mr-1.5"></i>Whole pipeline</button>
          <h2 className="text-xl font-bold text-white truncate">{workflow.clientName}</h2>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-slate-400">
          {lastOpen && <span>Last opened by <b className="text-slate-200">{lastOpen.name}</b> · {when(lastOpen.at)}</span>}
          <button onClick={() => navigate(`/clients/pipeline/${workflow._id}`)} className="text-blue-400 hover:text-blue-300 underline underline-offset-2">Full workspace</button>
        </div>
      </div>

      {/* Rahul's journey: Discovery → Development → Video → Meta → Launch → Scaling */}
      <ol className="grid grid-cols-3 md:grid-cols-6 gap-1.5" aria-label="Client journey">
        {journey(services).map((ph, i) => (
          <li key={ph.label} className={`rounded-lg border px-2.5 py-2 ${PHASE_CLS[ph.state]}`}>
            <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">{i + 1}. {ph.label}</div>
            <div className="text-[11px] mt-0.5">
              {ph.state === 'done' ? '✓ Done' : ph.state === 'active' ? 'In progress' : ph.state === 'pending' ? 'Not started' : 'Not in plan'}
              {ph.who && ph.state !== 'none' && ph.state !== 'done' ? <span className="opacity-70"> · {ph.who}</span> : null}
            </div>
          </li>
        ))}
      </ol>

      {/* The 3 things — visible without clicking */}
      {services.length === 0 ? <p className="text-sm text-slate-500">No stages on this client yet.</p> : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Current stage</div>
            <div className="mt-1 text-base font-bold text-white">{active ? active.label : 'All stages complete'}</div>
            {active && <span className={`mt-1.5 inline-block px-2 py-0.5 rounded border text-[10.5px] font-semibold ${STATUS_CLS[active.status]}`}>{STATUS_TXT[active.status]}{active.checklist?.length ? ` · ${active.checklist.filter(i => i.done).length}/${active.checklist.length}` : ''}</span>}
            {active?.returnedReason && <div className="mt-1 text-[11px] text-rose-400">Returned: {active.returnedReason}</div>}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Owner</div>
            <div className="mt-1 text-base font-bold text-white">{active?.assignee?.name || <span className="text-amber-400">Unassigned</span>}</div>
            {active?.eta && <div className="mt-1 text-[11.5px] text-slate-400">ETA {dateOnly(active.eta)}{new Date(active.eta).getTime() < Date.now() ? <span className="text-rose-400"> · overdue</span> : ''}</div>}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Next task</div>
            <div className="mt-1 text-base font-bold text-white">{active?.nextTask || nextItem || '—'}</div>
            {active?.nextTaskDue && <div className={`mt-1 text-[11.5px] ${new Date(active.nextTaskDue).getTime() < Date.now() ? 'text-rose-400' : 'text-slate-400'}`}>by {dateOnly(active.nextTaskDue)}</div>}
          </div>
        </div>
      )}

      {/* Details — one click away */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl">
        <button onClick={() => setDetailsOpen(o => !o)} aria-expanded={detailsOpen} className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-300">
          <span className="flex items-center gap-2 flex-wrap">
            <i className="fa-solid fa-list-check text-slate-500"></i> All stages & checklist
            {services.map(s => <span key={s._id} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${STATUS_CLS[s.status]}`}>{s.status === 'done' && <i className="fa-solid fa-check mr-1"></i>}{s.label}</span>)}
          </span>
          <i className={`fa-solid fa-chevron-down transition-transform ${detailsOpen ? 'rotate-180' : ''}`}></i>
        </button>
        {detailsOpen && (
          <div className="px-4 pb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {services.map(s => {
              const mine = s.assignedTo === user?.id || canEditAny;
              return (
                <div key={s._id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">{s.label}</span>
                    <span className="text-slate-500">{s.assignee?.name || 'Unassigned'}</span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {(s.checklist || []).map((it, i) => (
                      <li key={i}>
                        <button disabled={!mine || s.status === 'done'} onClick={() => toggleItem(s, i, it)}
                          className={`flex items-start gap-1.5 text-left text-[11.5px] w-full ${it.done ? 'text-emerald-400' : 'text-slate-300'} ${mine && s.status !== 'done' ? 'hover:text-white' : 'cursor-default'}`}>
                          <i className={`mt-0.5 ${it.done ? 'fa-solid fa-square-check' : 'fa-regular fa-square'}`}></i>{it.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Update status */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white"><i className="fa-solid fa-pen-to-square text-blue-400 mr-2"></i>Update status</h3>
            {services.filter(s => s.status !== 'done').length > 1 && (
              <select value={stageId} onChange={e => setStageId(e.target.value)} aria-label="Stage" className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-white [&>option]:bg-slate-900">
                {services.filter(s => s.status !== 'done').map(s => <option key={s._id} value={s._id}>{s.label}</option>)}
              </select>
            )}
          </div>
          {!stage ? <p className="text-xs text-slate-500">Every stage is complete.</p> : !canEdit ? (
            <p className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"><i className="fa-solid fa-eye mr-1.5"></i>View only — {stage.assignee?.name || 'the stage owner'} updates {stage.label}.</p>
          ) : (
            <>
              <label className="block text-[11px] text-slate-400">Where has {stage.label} reached?
                <select value={reached} onChange={e => setReached(Number(e.target.value))} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white [&>option]:bg-slate-900">
                  <option value={-1} disabled={stageFrom > -1}>Not started</option>
                  {(stage.checklist || []).map((it, i) => <option key={i} value={i} disabled={i < stageFrom}>{i <= stageFrom ? '✓ ' : ''}{it.text}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="block text-[11px] text-slate-400">Next task
                  <input value={nextTask} onChange={e => setNextTask(e.target.value)} placeholder="What happens next (e.g. Collect logo files from client)"
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
                </label>
                <label className="block text-[11px] text-slate-400">By
                  <input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} className="mt-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white [color-scheme:dark]" />
                </label>
              </div>
              <label className="block text-[11px] text-slate-400">Notes
                <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Last call done, client approved the hooks"
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
              </label>
              <div className="flex justify-between items-center gap-2">
                <button onClick={completeStage} disabled={(stage.checklist || []).some(i => !i.done)}
                  title="Every checklist item must be done first" className="text-xs text-emerald-300 hover:text-emerald-200 disabled:text-slate-600 disabled:cursor-not-allowed">
                  <i className="fa-solid fa-circle-check mr-1"></i>Mark {stage.label} complete
                </button>
                <button onClick={saveUpdate} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold">Save update</button>
              </div>
            </>
          )}
        </div>

        {/* Push update to client */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-white"><i className="fa-brands fa-whatsapp text-emerald-400 mr-2"></i>Update the client</h3>
          <pre className="whitespace-pre-wrap text-[11.5px] text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto font-sans">{message}</pre>
          <textarea rows={2} value={extra} onChange={e => setExtra(e.target.value)} placeholder="Add anything extra for the client (optional)"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
          <div className="flex justify-end gap-2">
            <button onClick={copyMsg} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-xs font-semibold"><i className="fa-regular fa-copy mr-1.5"></i>Copy</button>
            <button onClick={pushWhatsApp} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-semibold"><i className="fa-brands fa-whatsapp mr-1.5"></i>Send on WhatsApp</button>
          </div>
        </div>
      </div>

      {sop && (
        <div className="bg-slate-900 border border-rose-500/20 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-white"><i className="fa-solid fa-clapperboard text-rose-400 mr-2"></i>UGC Video SOP · {sop.doneCount}/{sop.total} steps{sop.status === 'active' ? ` · Day ${sop.dayNumber} of 7` : ` · ${sop.status}`}</div>
            <div className="mt-1.5 flex gap-1 w-64 max-w-full">{sop.steps.map((s: any) => <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.state === 'done' ? 'bg-emerald-500' : s.state === 'done_late' ? 'bg-amber-400' : s.state === 'missed' ? 'bg-rose-500' : s.state === 'overdue' ? 'bg-orange-500' : 'bg-slate-700'}`} />)}</div>
            <div className="mt-2 w-72 max-w-full"><VideoProgressBar p={sop.progress} compact /></div>
            {sopCur && <div className="mt-1 text-[11px] text-slate-400">Now: <span className="text-slate-200">{sop.currentTitle || sopCur.key}</span> · due {when(sopCur.dueAt)}</div>}
          </div>
          <button onClick={() => navigate(`/video-sop?run=${sop._id}`)} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg">Open Video SOP</button>
        </div>
      )}

      {/* Clean log */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-3"><i className="fa-solid fa-clock-rotate-left text-slate-400 mr-2"></i>Log</h3>
          {log === null ? <p className="text-xs text-slate-500">Loading…</p> : log.length === 0 ? <p className="text-xs text-slate-500">No changes logged yet.</p> : (
            <ul className="divide-y divide-slate-800/70">
              {log.map((r, i) => (
                <li key={i} className="py-2.5">
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs">
                    <span className="text-slate-300"><b className="text-white">{r.name}</b>{r.department && <span className="text-slate-500"> ({r.department})</span>} {r.what}{r.stage && !r.what.includes(r.stage) ? <span className="text-slate-500"> · {r.stage}</span> : ''}</span>
                    <span className="text-slate-500 whitespace-nowrap">{when(r.at)}</span>
                  </div>
                  {r.nextTask && <div className="text-[11.5px] text-blue-300 mt-0.5">Next: {r.nextTask}{r.nextTaskDue ? ` · by ${dateOnly(r.nextTaskDue)}` : ''}</div>}
                  {r.notes && r.action !== 'item_checked' && <div className="text-[11.5px] text-slate-400 mt-0.5 whitespace-pre-line">{r.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 self-start">
          <h3 className="text-sm font-bold text-white mb-2"><i className="fa-regular fa-eye text-slate-400 mr-2"></i>Who opened it</h3>
          {opens === null ? <p className="text-xs text-slate-500">Loading…</p> : opens.length === 0 ? <p className="text-xs text-slate-500">Nobody yet.</p> : (
            <ul className="space-y-1.5">
              {(showOpens ? opens : opens.slice(0, 5)).map((o, i) => (
                <li key={i} className="flex justify-between gap-2 text-[11.5px]">
                  <span className="text-slate-200">{o.name}{o.department && <span className="text-slate-500"> ({o.department})</span>}</span>
                  <span className="text-slate-500 whitespace-nowrap">{when(o.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {opens && opens.length > 5 && <button onClick={() => setShowOpens(v => !v)} className="mt-2 text-[11px] text-blue-400">{showOpens ? 'Show less' : `Show all ${opens.length}`}</button>}
        </div>
      </div>
    </div>
  );
}
