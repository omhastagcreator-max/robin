import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Palette, Briefcase, CheckSquare, Square, CalendarClock, Send, Loader2,
  PackageCheck, Play, Check, ChevronRight,
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);

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
  // Tasks: most urgent first; show 5 unless expanded.
  const sortedTasks = [...tasks].sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });
  const visibleTasks = showAllTasks ? sortedTasks : sortedTasks.slice(0, 5);

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden text-[12.5px]">
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-[13px] font-semibold">{isCreative ? 'Creative desk' : 'My work desk'}</h2>
        <span className="text-[11px] text-muted-foreground">{services.length} stage{services.length === 1 ? '' : 's'} · {tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
      </div>

      {sorted.length > 0 && (
        <ul className="divide-y divide-border/70">
          {sorted.map(s => {
            const done = s.checklist.filter(c => c.done).length;
            const total = s.checklist.length;
            const allTicked = total > 0 && done === total;
            const blocked = s.status === 'blocked';
            const isOpen = openId === s._id;
            const remaining = s.checklist.map((c, i) => ({ ...c, i })).filter(c => !c.done);
            // One status chip only — the most important thing about this stage.
            const chip = s.returnedReason ? { t: 'Returned', c: 'bg-rose-500/12 text-rose-600', tip: s.returnedReason }
              : blocked ? { t: 'Waiting', c: 'bg-amber-500/12 text-amber-600', tip: 'Waiting on an earlier stage' }
              : allTicked ? { t: 'Ready to deliver', c: 'bg-emerald-500/12 text-emerald-600', tip: '' }
              : isOverdue(s.eta) ? { t: `Overdue · ${fmtDate(s.eta)}`, c: 'bg-rose-500/12 text-rose-600', tip: '' }
              : !s.eta ? { t: 'No ETA', c: 'bg-amber-500/12 text-amber-600', tip: 'Set an ETA' }
              : { t: `ETA ${fmtDate(s.eta)}`, c: 'bg-muted text-muted-foreground', tip: '' };
            return (
              <li key={s._id}>
                <div className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(isOpen ? null : s._id)}>
                  <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="font-semibold truncate">{s.clientName}</span>
                  <span className="text-muted-foreground truncate hidden sm:inline">{s.label}</span>
                  <span title={chip.tip} className={`shrink-0 text-[10.5px] px-1.5 py-0.5 rounded ${chip.c}`}>{chip.t}</span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {total > 0 && (
                      <span className="hidden sm:block w-16 h-1 rounded-full bg-muted overflow-hidden">
                        <span className="block h-full bg-primary/70" style={{ width: `${(done / total) * 100}%` }} />
                      </span>
                    )}
                    <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{done}/{total}</span>
                    {allTicked && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); deliver(s); }} disabled={busy === `${s._id}-done`} className="h-6 px-2 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-500 disabled:opacity-50">
                        {busy === `${s._id}-done` ? <Loader2 className="h-3 w-3 animate-spin" /> : <PackageCheck className="h-3 w-3" />} Deliver
                      </button>
                    )}
                  </span>
                </div>

                {isOpen && (
                  <div className="px-4 pb-3 pl-10 space-y-2">
                    {s.returnedReason && <p className="text-[11.5px] text-rose-600">Returned: {s.returnedReason}</p>}
                    {remaining.length > 0 ? (
                      <div className="space-y-1">
                        {remaining.map(c => (
                          <button key={c.i} type="button" disabled={blocked || busy === `${s._id}-${c.i}`} onClick={() => tick(s, c.i)} className="flex items-center gap-1.5 text-left hover:text-primary disabled:opacity-50">
                            {busy === `${s._id}-${c.i}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                            <span>{c.text}</span>
                          </button>
                        ))}
                      </div>
                    ) : total > 0 ? <p className="text-muted-foreground">All items ticked.</p> : null}
                    {done > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        <CheckSquare className="inline h-3 w-3 text-emerald-600 mr-1" />{done} done
                        <Link to={`/clients/pipeline/${s.wid}`} className="ml-2 underline underline-offset-2 hover:text-foreground">open client</Link>
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        <input type="date" defaultValue={toDateInput(s.eta)} onChange={(e) => setEta(s, e.target.value)} className="h-6 rounded border border-border bg-background px-1 text-[11px] text-foreground" />
                      </label>
                      <input
                        value={notes[s._id] || ''}
                        onChange={(e) => setNotes(n => ({ ...n, [s._id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') postNote(s); }}
                        placeholder="Post an update…"
                        className="h-6 flex-1 min-w-[10rem] rounded border border-border bg-background px-2 text-[11.5px]"
                      />
                      <button type="button" onClick={() => postNote(s)} disabled={busy === `${s._id}-note` || !(notes[s._id] || '').trim()} className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-muted disabled:opacity-40" title="Post update">
                        {busy === `${s._id}-note` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tasks.length > 0 && (
        <div className="border-t border-border">
          <ul className="divide-y divide-border/70">
            {visibleTasks.map(t => (
              <li key={t._id} className="group px-4 py-1.5 flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${t.status === 'ongoing' ? 'bg-blue-500' : t.status === 'blocked' ? 'bg-rose-500' : 'bg-muted-foreground/40'}`} />
                <span className="truncate">{t.title}</span>
                {t.clientName && <span className="text-muted-foreground truncate hidden md:inline">· {t.clientName}</span>}
                <span className="ml-auto flex items-center gap-1 shrink-0">
                  {t.dueDate && <span className={`text-[11px] mr-1 ${isOverdue(t.dueDate) ? 'text-rose-600' : 'text-muted-foreground'}`}>{fmtDate(t.dueDate)}</span>}
                  {t.status !== 'ongoing' && (
                    <button type="button" title="Start" onClick={() => setTaskStatus(t, 'ongoing')} disabled={!!busy} className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Play className="h-3 w-3" /></button>
                  )}
                  <button type="button" title="Mark done" onClick={() => setTaskStatus(t, 'done')} disabled={!!busy} className="h-6 w-6 inline-flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-500/10"><Check className="h-3.5 w-3.5" /></button>
                </span>
              </li>
            ))}
          </ul>
          {tasks.length > 5 && (
            <button type="button" onClick={() => setShowAllTasks(v => !v)} className="w-full px-4 py-1.5 text-[11px] text-muted-foreground hover:text-foreground text-left border-t border-border/70">
              {showAllTasks ? 'Show fewer' : `Show all ${tasks.length} tasks`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default MyWorkDesk;
