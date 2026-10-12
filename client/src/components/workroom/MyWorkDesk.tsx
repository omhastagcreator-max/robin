import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Palette, Clapperboard, Briefcase, CheckSquare, Square, CalendarClock, Send, Loader2,
  PackageCheck, Play, Check, Ban, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * MyWorkDesk — Oct 2026 owner ask: "create something for Beant, the
 * creative designer + video editor — their tasks should be easily
 * visible and they need to update accordingly".
 *
 * One card at the top of Workroom Home listing everything assigned to
 * the signed-in person, actionable in place:
 *   • Client stages they own (design / video / any service): tick
 *     checklist items, set the ETA, post a one-line update, and mark the
 *     stage delivered once every item is ticked.
 *   • Their open tasks: Start / Done / Blocked in one click.
 *
 * For anyone on the design or video team it's titled "Creative desk" and
 * creative stages sort first. Everything saves through the same CRM /
 * task endpoints as the rest of Robin, so the CRM, Decision Tree and
 * dashboards update live (server broadcasts data:changed).
 */

const CREATIVE_TYPES = ['graphic_design', 'video_editing'];
const CREATIVE_TEAMS = ['design', 'video'];

interface Svc {
  wid: string; clientName: string; _id: string; label: string; serviceType: string;
  status: string; eta: string | null; returnedReason?: string;
  checklist: { text: string; done: boolean }[];
}
interface Task { _id: string; title: string; status: string; priority?: string; dueDate?: string; clientName?: string; clientWorkflowId?: string }

const toDateInput = (iso: string | null | undefined) => iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '';
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
const isOverdue = (iso?: string | null) => !!iso && new Date(iso).getTime() < Date.now();

export function MyWorkDesk() {
  const { user } = useAuth();
  const [services, setServices] = useState<Svc[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const userTeams = [user?.team, ...(user?.teams || [])].filter(Boolean) as string[];

  const load = useCallback(() => {
    if (!user?.id) return;
    Promise.all([
      api.cwListWorkflows({ mine: '1' }).catch(() => []),
      api.taskInbox().catch(() => null),
    ]).then(([wfs, inbox]: [any[], any]) => {
      const mine: Svc[] = [];
      for (const wf of Array.isArray(wfs) ? wfs : []) {
        for (const s of wf.services || []) {
          if (String(s.assignedTo) !== String(user.id) || s.status === 'done') continue;
          mine.push({
            wid: wf._id, clientName: wf.clientName || 'Client', _id: s._id, label: s.label,
            serviceType: s.serviceType, status: s.status, eta: s.eta || null,
            returnedReason: s.returnedReason, checklist: s.checklist || [],
          });
        }
      }
      setServices(mine);
      setTasks(((inbox?.mine || []) as Task[]).filter(t => t.status !== 'done' && t.status !== 'pending_acceptance'));
    }).finally(() => setLoaded(true));
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const h = () => { if (t) clearTimeout(t); t = setTimeout(load, 800); };
    window.addEventListener('robin:data-changed', h);
    return () => { window.removeEventListener('robin:data-changed', h); if (t) clearTimeout(t); };
  }, [load]);

  const isCreative = userTeams.some(t => CREATIVE_TEAMS.includes(t)) || services.some(s => CREATIVE_TYPES.includes(s.serviceType));
  const sorted = useMemo(() => [...services].sort((a, b) => {
    const ca = CREATIVE_TYPES.includes(a.serviceType) ? 0 : 1;
    const cb = CREATIVE_TYPES.includes(b.serviceType) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const ea = a.eta ? new Date(a.eta).getTime() : Infinity;
    const eb = b.eta ? new Date(b.eta).getTime() : Infinity;
    return ea - eb;
  }), [services]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not save.'); }
    finally { setBusy(null); }
  };

  const tick = (s: Svc, i: number) => run(`${s._id}-${i}`, () =>
    api.cwToggleCheck(s.wid, s._id, { index: i, done: !s.checklist[i].done, comment: s.checklist[i].done ? 'Reopened from my desk' : 'Done — updated from my desk' }));
  const setEta = (s: Svc, v: string) => run(`${s._id}-eta`, () =>
    api.cwSetServiceEta(s.wid, s._id, { eta: v ? new Date(`${v}T23:59:00+05:30`).toISOString() : null, comment: v ? `ETA set to ${v}` : 'ETA cleared' }), v ? 'ETA saved.' : 'ETA cleared.');
  const postNote = (s: Svc) => {
    const detail = (notes[s._id] || '').trim();
    if (!detail) return;
    run(`${s._id}-note`, async () => { await api.cwAddNote(s.wid, { detail, serviceType: s.serviceType }); setNotes(n => ({ ...n, [s._id]: '' })); }, 'Update posted.');
  };
  const deliver = (s: Svc) => run(`${s._id}-done`, () =>
    api.cwCompleteService(s.wid, s._id, { comment: `${s.label} delivered` }), `${s.label} marked delivered.`);
  const setTaskStatus = (t: Task, status: string) => run(`${t._id}-${status}`, () =>
    api.updateTask(t._id, { status }), status === 'done' ? 'Task done.' : undefined);

  if (!loaded) return null;
  if (services.length === 0 && tasks.length === 0) return null;

  const Icon = isCreative ? Palette : Briefcase;
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-[13px] font-semibold">{isCreative ? 'Creative desk — designs & videos' : 'My work desk'}</h2>
        <span className="text-[11px] text-muted-foreground">{services.length} stage{services.length === 1 ? '' : 's'} · {tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
        <span className="ml-auto text-[10.5px] text-muted-foreground hidden sm:inline">Update here — CRM & Decision Tree sync instantly</span>
      </div>

      {sorted.length > 0 && (
        <ul className="divide-y divide-border">
          {sorted.map(s => {
            const done = s.checklist.filter(c => c.done).length;
            const total = s.checklist.length;
            const allTicked = total > 0 && done === total;
            const SIcon = s.serviceType === 'video_editing' ? Clapperboard : s.serviceType === 'graphic_design' ? Palette : Briefcase;
            const blocked = s.status === 'blocked';
            return (
              <li key={s._id} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-semibold text-[13px]">{s.clientName}</span>
                  <span className="text-[12px] text-muted-foreground">· {s.label}</span>
                  {blocked && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-amber-500/12 text-amber-700">Waiting on earlier stage</span>}
                  {s.returnedReason && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-rose-500/12 text-rose-700">Returned: {s.returnedReason}</span>}
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{done}/{total}</span>
                  <Link to={`/clients/pipeline/${s.wid}`} className="text-muted-foreground hover:text-foreground" title="Open client"><ExternalLink className="h-3.5 w-3.5" /></Link>
                </div>

                {total > 0 && (
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary/70 transition-all" style={{ width: `${(done / total) * 100}%` }} />
                  </div>
                )}

                {total > 0 && (
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                    {s.checklist.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={blocked || busy === `${s._id}-${i}`}
                        onClick={() => tick(s, i)}
                        className={`flex items-center gap-1.5 text-left text-[12px] disabled:opacity-50 ${c.done ? 'text-muted-foreground line-through' : 'text-foreground hover:text-primary'}`}
                      >
                        {busy === `${s._id}-${i}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.done ? <CheckSquare className="h-3.5 w-3.5 text-emerald-600" /> : <Square className="h-3.5 w-3.5" />}
                        <span className="truncate">{c.text}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <label className={`inline-flex items-center gap-1.5 text-[11.5px] ${!s.eta ? 'text-amber-700' : isOverdue(s.eta) ? 'text-rose-700' : 'text-muted-foreground'}`}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    {!s.eta ? 'Set ETA' : isOverdue(s.eta) ? 'Overdue' : 'ETA'}
                    <input
                      type="date"
                      defaultValue={toDateInput(s.eta)}
                      onChange={(e) => setEta(s, e.target.value)}
                      className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] text-foreground"
                    />
                  </label>
                  <div className="flex-1 min-w-[12rem] flex items-center gap-1">
                    <input
                      value={notes[s._id] || ''}
                      onChange={(e) => setNotes(n => ({ ...n, [s._id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') postNote(s); }}
                      placeholder="Post an update (e.g. 'draft 2 shared with client')"
                      className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-[11.5px]"
                    />
                    <button type="button" onClick={() => postNote(s)} disabled={busy === `${s._id}-note` || !(notes[s._id] || '').trim()} className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40" title="Post update">
                      {busy === `${s._id}-note` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => deliver(s)}
                    disabled={!allTicked || busy === `${s._id}-done`}
                    title={allTicked ? 'Mark this stage delivered' : 'Tick every item first'}
                    className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-[11.5px] font-medium hover:bg-emerald-500 disabled:opacity-35"
                  >
                    {busy === `${s._id}-done` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />} Delivered
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tasks.length > 0 && (
        <div className="border-t border-border">
          <p className="px-4 pt-2.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">My tasks</p>
          <ul className="divide-y divide-border">
            {tasks.slice(0, 12).map(t => (
              <li key={t._id} className="px-4 py-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className={`h-1.5 w-1.5 rounded-full ${t.status === 'ongoing' ? 'bg-blue-500' : t.status === 'blocked' ? 'bg-rose-500' : 'bg-muted-foreground/40'}`} />
                <span className="font-medium truncate max-w-[22rem]">{t.title}</span>
                {t.clientName && <span className="text-muted-foreground">· {t.clientName}</span>}
                {t.dueDate && <span className={`text-[11px] ${isOverdue(t.dueDate) ? 'text-rose-700' : 'text-muted-foreground'}`}>· due {fmtDate(t.dueDate)}</span>}
                <span className="ml-auto inline-flex items-center gap-1">
                  {t.status !== 'ongoing' && (
                    <button type="button" onClick={() => setTaskStatus(t, 'ongoing')} disabled={!!busy} className="h-6 px-2 inline-flex items-center gap-1 rounded border border-border text-[11px] hover:bg-muted"><Play className="h-3 w-3" />Start</button>
                  )}
                  <button type="button" onClick={() => setTaskStatus(t, 'done')} disabled={!!busy} className="h-6 px-2 inline-flex items-center gap-1 rounded border border-emerald-500/40 text-emerald-700 text-[11px] hover:bg-emerald-500/10"><Check className="h-3 w-3" />Done</button>
                  {t.status !== 'blocked' && (
                    <button type="button" onClick={() => setTaskStatus(t, 'blocked')} disabled={!!busy} className="h-6 px-2 inline-flex items-center gap-1 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted"><Ban className="h-3 w-3" />Blocked</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default MyWorkDesk;
