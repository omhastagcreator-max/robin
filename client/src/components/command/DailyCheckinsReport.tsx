import { useEffect, useState, useCallback } from 'react';
import { Sunrise, CloudSun, Moon, CheckCircle2, Circle, Clock, AlertCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import * as api from '@/api';

/**
 * DailyCheckinsReport — admin/sales view of who has + hasn't done the
 * morning / midday / evening pulses today, plus the diff between
 * "morning promised" and "evening delivered" per teammate.
 *
 * Lives on the Command Center under TodayActivityTable. Live-updates
 * via the same robin:data-changed event the checkin controllers fire.
 */

interface Row {
  userId: string;
  name: string;
  email: string;
  role: string;
  team: string;
  morningDone: boolean;
  middayDone:  boolean;
  eveningDone: boolean;
  morningTasks: number;
  doneTasks: number;
  leftTasks: number;
  blockers: string;
  tomorrowPlan: string;
  tasks: Array<{
    title: string;
    priority: string;
    middayStatus: string;
    eveningStatus: string;
    eveningReason: string;
  }>;
  brands: Array<{ clientName: string; metaStatus: string; note: string }>;
}

export function DailyCheckinsReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getAdminCheckinToday();
      if (r?.ok) setRows((r.rows || []) as Row[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live refresh on any checkin mutation. The orchestrator pages each
  // emit data:changed with entity='checkin'.
  useEffect(() => {
    const onData = (e: any) => { if (e?.detail?.entity === 'checkin') void load(); };
    window.addEventListener('robin:data-changed', onData);
    return () => window.removeEventListener('robin:data-changed', onData);
  }, [load]);

  const totals = {
    people:   rows.length,
    morning:  rows.filter(r => r.morningDone).length,
    midday:   rows.filter(r => r.middayDone).length,
    evening:  rows.filter(r => r.eveningDone).length,
    tasksPlanned: rows.reduce((s, r) => s + r.morningTasks, 0),
    tasksDone:    rows.reduce((s, r) => s + r.doneTasks, 0),
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-bold leading-tight">Daily check-ins</p>
          <p className="text-[12px] text-muted-foreground">
            Three pulses a day per teammate. Updates live.
          </p>
        </div>
        <button onClick={load} title="Refresh" className="h-7 w-7 rounded-md inline-flex items-center justify-center hover:bg-muted/60">
          <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
        </button>
      </div>

      {/* Totals strip */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Pill icon={<Sunrise className="h-3 w-3 text-amber-700" />}>
          Morning · {totals.morning}/{totals.people}
        </Pill>
        <Pill icon={<CloudSun className="h-3 w-3 text-sky-700" />}>
          Midday · {totals.midday}/{totals.people}
        </Pill>
        <Pill icon={<Moon className="h-3 w-3 text-indigo-700" />}>
          Evening · {totals.evening}/{totals.people}
        </Pill>
        <Pill>
          Tasks today · {totals.tasksDone}/{totals.tasksPlanned}
        </Pill>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[12.5px]">
          <thead className="text-[10.5px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr className="text-left">
              <th className="px-1 py-1.5 font-semibold w-6"></th>
              <th className="px-1 py-1.5 font-semibold min-w-[140px]">Person</th>
              <th className="px-1 py-1.5 font-semibold text-center">M</th>
              <th className="px-1 py-1.5 font-semibold text-center">D</th>
              <th className="px-1 py-1.5 font-semibold text-center">E</th>
              <th className="px-1 py-1.5 font-semibold text-center">Tasks</th>
              <th className="px-1 py-1.5 font-semibold">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="py-6 text-center text-muted-foreground italic">No teammates active in this org.</td></tr>
            )}
            {rows.map(r => {
              const open = !!expanded[r.userId];
              return (
                <>
                  <tr key={r.userId} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                    <td className="px-1 py-1.5">
                      <button onClick={() => setExpanded(p => ({ ...p, [r.userId]: !p[r.userId] }))} className="h-5 w-5 rounded hover:bg-muted/60 flex items-center justify-center">
                        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                    </td>
                    <td className="px-1 py-1.5">
                      <span className="font-semibold">{r.name}</span>
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">{r.role}</span>
                    </td>
                    <td className="px-1 py-1.5 text-center"><Dot done={r.morningDone} /></td>
                    <td className="px-1 py-1.5 text-center"><Dot done={r.middayDone} /></td>
                    <td className="px-1 py-1.5 text-center"><Dot done={r.eveningDone} /></td>
                    <td className="px-1 py-1.5 text-center">
                      <span className={r.leftTasks > 0 ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                        {r.doneTasks}/{r.morningTasks}
                      </span>
                    </td>
                    <td className="px-1 py-1.5 text-muted-foreground truncate max-w-[220px]">
                      {r.blockers ? r.blockers : (r.leftTasks > 0 ? '—' : '')}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-muted/20 border-b border-border/60">
                      <td colSpan={7} className="px-3 py-3">
                        <ExpandedDetail row={r} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pill({ children, icon }: { children: any; icon?: any }) {
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10.5px] font-semibold bg-muted/50 border border-border">
      {icon}
      {children}
    </span>
  );
}

function Dot({ done }: { done: boolean }) {
  return done
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />
    : <Circle className="h-3.5 w-3.5 text-muted-foreground inline" />;
}

function ExpandedDetail({ row }: { row: Row }) {
  return (
    <div className="space-y-3 text-[12px]">
      {row.brands.length > 0 && (
        <div>
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Brand pulse</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {row.brands.map((b, i) => (
              <span key={i} className={
                'h-5 px-2 rounded text-[10.5px] font-semibold inline-flex items-center gap-1 ' +
                (b.metaStatus === 'running' ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30' :
                 b.metaStatus === 'paused'  ? 'bg-amber-500/15 text-amber-700 border border-amber-500/30' :
                 b.metaStatus === 'off'     ? 'bg-rose-500/15 text-rose-700 border border-rose-500/30' :
                 b.metaStatus === 'pending' ? 'bg-blue-500/15 text-blue-700 border border-blue-500/30' :
                                              'bg-muted/40 text-muted-foreground border border-border')
              }>
                {b.clientName} · {b.metaStatus}
                {b.note && <span className="opacity-70">— {b.note}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {row.tasks.length > 0 && (
        <div>
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Today's tasks</p>
          <div className="space-y-1">
            {row.tasks.map((t, i) => (
              <div key={i} className="flex items-start gap-2 bg-background border border-border rounded px-2 py-1.5">
                <TaskStatusIcon status={t.eveningStatus || t.middayStatus} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{t.title}</p>
                  {t.eveningReason && <p className="text-rose-700/90 text-[11px] italic">↳ {t.eveningReason}</p>}
                </div>
                <span className={
                  'h-4 px-1.5 rounded text-[9.5px] uppercase font-bold ' +
                  (t.priority === 'urgent' ? 'bg-rose-500 text-white' :
                   t.priority === 'high'   ? 'bg-orange-500 text-white' :
                   t.priority === 'medium' ? 'bg-blue-500 text-white' :
                                             'bg-muted text-muted-foreground')
                }>{t.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {row.blockers && (
        <div>
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Blockers</p>
          <p className="bg-rose-500/5 border border-rose-500/20 rounded p-2 text-rose-800">{row.blockers}</p>
        </div>
      )}
      {row.tomorrowPlan && (
        <div>
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Tomorrow plan</p>
          <p className="bg-indigo-500/5 border border-indigo-500/20 rounded p-2 text-indigo-800 whitespace-pre-wrap">{row.tomorrowPlan}</p>
        </div>
      )}
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />;
  if (status === 'blocked' || status === 'dropped') return <AlertCircle className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />;
  if (status === 'in_progress' || status === 'rolled_over') return <Clock className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />;
}

export default DailyCheckinsReport;
