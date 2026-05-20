import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Calendar, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  Coffee, CheckCircle2, Activity,
} from 'lucide-react';

import { AppLayout }  from '@/components/AppLayout';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar }     from '@/components/shared/Avatar';
import * as api from '@/api';

/**
 * AdminAttendance v2 — rebuilt on design-system primitives.
 *
 * Daily clock-in/out roll-up. Row per teammate; click to expand and see
 * individual sessions + break events. v2: tighter table chrome, semantic
 * tones (emerald/amber/rose instead of green/red).
 */

interface BreakEvent { startedAt: string; endedAt?: string }

interface SessionRow {
  _id: string;
  startTime: string;
  endTime: string | null;
  effectiveEnd: string;
  status: 'active' | 'on_break' | 'ended';
  autoClosedAt: string | null;
  lastHeartbeatAt: string | null;
  breakEvents: BreakEvent[];
  workedMs: number;
  breakMs: number;
  activeMs: number;
}

interface AttendanceRow {
  user: { _id: string; name: string; email: string; role: string; team?: string; avatarUrl?: string };
  firstClockIn: string | null;
  lastClockOut: string | null;
  isStillActive: boolean;
  sessionCount: number;
  totalWorkedMs: number;
  totalActiveMs: number;
  totalBreakMs: number;
  sessions: SessionRow[];
}

interface AttendancePayload { date: string; rows: AttendanceRow[] }

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
};
const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
};
const todayKey = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function AdminAttendance() {
  const [date, setDate]         = useState<string>(todayKey());
  const [data, setData]         = useState<AttendancePayload | null>(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async (d: string) => {
    setLoading(true);
    try { setData(await api.adminAttendance(d)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(date); }, [date]);

  const toggleRow = (uid: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });

  const isToday = date === todayKey();
  const totals = data?.rows.reduce(
    (acc, r) => {
      if (r.firstClockIn) acc.cameIn += 1;
      if (r.isStillActive) acc.stillActive += 1;
      acc.totalWorked += r.totalActiveMs;
      acc.totalBreak  += r.totalBreakMs;
      return acc;
    },
    { cameIn: 0, stillActive: 0, totalWorked: 0, totalBreak: 0 },
  );

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight inline-flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Attendance
          </h1>
          <p className="text-[12px] text-muted-foreground">
            When each teammate clocked in and out (IST).
          </p>
        </div>

        {/* Filter + KPI strip */}
        <div className="border border-border rounded-xl bg-card p-3 flex items-center gap-5 flex-wrap">
          <label className="flex items-center gap-2 text-[12px]">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <input
              type="date"
              value={date}
              max={todayKey()}
              onChange={e => setDate(e.target.value)}
              className="bg-background border border-input rounded-md px-2.5 h-8 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {totals && data && (
            <>
              <Stat value={`${totals.cameIn}/${data.rows.length}`} label="came in" />
              {isToday && <Stat value={totals.stillActive} label="still working" tone="success" />}
              <Stat value={fmtDuration(totals.totalWorked)} label="active total" />
              <Stat value={fmtDuration(totals.totalBreak)}  label="break total" tone="warning" />
            </>
          )}
        </div>

        {/* Table */}
        {loading && !data ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState size="lg" title="No staff configured" />
        ) : (
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 h-9 border-b border-border bg-muted/30 items-center text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              <div className="col-span-4">Employee</div>
              <div className="col-span-2">Clocked in</div>
              <div className="col-span-2">Clocked out</div>
              <div className="col-span-2 text-right">Active</div>
              <div className="col-span-1 text-right">Break</div>
              <div className="col-span-1 text-right">Sessions</div>
            </div>

            {data.rows.map((r, i) => {
              const open = expanded.has(r.user._id);
              return (
                <div key={r.user._id} className={i > 0 ? 'border-t border-border' : ''}>
                  <button
                    onClick={() => toggleRow(r.user._id)}
                    className="w-full grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-left hover:bg-primary/[0.03] transition-colors"
                  >
                    <div className="col-span-4 flex items-center gap-2 min-w-0">
                      {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <Avatar name={r.user.name} email={r.user.email} size="sm" tone="primary" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold truncate">{r.user.name || r.user.email}</p>
                        <p className="text-[10.5px] text-muted-foreground truncate capitalize">
                          {r.user.role}{r.user.team ? ` · ${r.user.team}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="col-span-2 text-[12.5px] tabular-nums">
                      {r.firstClockIn ? fmtTime(r.firstClockIn) : <span className="text-muted-foreground">absent</span>}
                    </div>
                    <div className="col-span-2 text-[12.5px] tabular-nums">
                      {r.isStillActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-[11.5px] font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> still working
                        </span>
                      ) : r.lastClockOut ? fmtTime(r.lastClockOut) : <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="col-span-2 text-right text-[12.5px] tabular-nums font-semibold">
                      {r.totalActiveMs > 0 ? fmtDuration(r.totalActiveMs) : <span className="text-muted-foreground font-normal">—</span>}
                    </div>
                    <div className="col-span-1 text-right text-[12.5px] tabular-nums text-muted-foreground">
                      {r.totalBreakMs > 0 ? fmtDuration(r.totalBreakMs) : '—'}
                    </div>
                    <div className="col-span-1 text-right text-[12.5px] tabular-nums text-muted-foreground">
                      {r.sessionCount || '—'}
                    </div>
                  </button>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden bg-muted/[0.15]"
                      >
                        <div className="px-12 py-3 space-y-2">
                          {r.sessions.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground italic">No sessions on this day.</p>
                          ) : r.sessions.map(s => <SessionDetail key={s._id} session={s} />)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function SessionDetail({ session }: { session: SessionRow }) {
  const isAuto = !!session.autoClosedAt;
  return (
    <div className="border border-border rounded-lg bg-card px-3 py-2 text-[11.5px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold tabular-nums">
          {fmtTime(session.startTime)} → {session.endTime ? fmtTime(session.endTime) : 'still active'}
        </span>
        {session.status === 'ended' && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-muted text-muted-foreground">
            <CheckCircle2 className="h-2.5 w-2.5" /> Ended
          </span>
        )}
        {session.status === 'on_break' && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-amber-500/15 text-amber-700">
            <Coffee className="h-2.5 w-2.5" /> On break
          </span>
        )}
        {session.status === 'active' && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-emerald-500/15 text-emerald-700">
            <Activity className="h-2.5 w-2.5" /> Active
          </span>
        )}
        {isAuto && (
          <span
            className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded text-[9.5px] font-bold bg-amber-500/12 text-amber-700 border border-amber-500/25"
            title="Closed by the end-of-day cron because the user forgot to clock out"
          >
            <AlertTriangle className="h-2.5 w-2.5" /> Auto-closed
          </span>
        )}
        <span className="ml-auto text-muted-foreground tabular-nums">
          worked <strong className="text-foreground">{fmtDuration(session.activeMs)}</strong>
          {session.breakMs > 0 && <> · break <strong className="text-foreground">{fmtDuration(session.breakMs)}</strong></>}
        </span>
      </div>
      {session.breakEvents.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {session.breakEvents.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-1.5 h-[16px] rounded bg-amber-500/10 text-amber-700 text-[10px]">
              <Coffee className="h-2.5 w-2.5" />
              {fmtTime(b.startedAt)} – {b.endedAt ? fmtTime(b.endedAt) : '...'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
