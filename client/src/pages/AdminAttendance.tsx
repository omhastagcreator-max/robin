import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import {
  Clock, Calendar, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  Coffee, CheckCircle2, XCircle, Activity, MoreVertical,
} from 'lucide-react';
import { format } from 'date-fns';
import * as api from '@/api';

/**
 * AdminAttendance — daily clock-in / clock-out report.
 *
 * One row per internal staff member showing their first clock-in time,
 * last clock-out time, total worked, total break, and a status pill.
 * Click a row to expand and see every individual session for that day,
 * including any break events and whether the session was auto-closed
 * (distinct from a clean clock-out).
 *
 * Date picker defaults to today; admin can navigate to any past day.
 */

interface BreakEvent { startedAt: string; endedAt?: string; }

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

interface AttendancePayload {
  date: string;
  rows: AttendanceRow[];
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
function todayKey(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

export default function AdminAttendance() {
  const [date, setDate] = useState<string>(todayKey());
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async (d: string) => {
    setLoading(true);
    try {
      const res = await api.adminAttendance(d);
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(date); }, [date]);

  const toggleRow = (uid: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
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
    { cameIn: 0, stillActive: 0, totalWorked: 0, totalBreak: 0 }
  );

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" /> Daily Attendance
          </h1>
          <p className="text-sm text-muted-foreground">
            When each teammate clocked in and out (IST). Pick a date to view past days.
          </p>
        </div>

        {/* Date picker + KPIs */}
        <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayKey()}
              className="bg-background border border-input rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {totals && (
            <>
              <Stat label="Came in"      value={totals.cameIn} sub={`/ ${data?.rows.length || 0}`} />
              {isToday && <Stat label="Still active" value={totals.stillActive} accent="green" />}
              <Stat label="Total active" value={fmtDuration(totals.totalWorked)} />
              <Stat label="Total break"  value={fmtDuration(totals.totalBreak)} />
            </>
          )}
        </div>

        {/* Table */}
        {loading && !data ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !data || data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 bg-card border border-border rounded-2xl">
            No staff configured.
          </p>
        ) : (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground font-semibold bg-muted/30">
              <div className="col-span-4">Employee</div>
              <div className="col-span-2">Clocked in</div>
              <div className="col-span-2">Clocked out</div>
              <div className="col-span-2 text-right">Active</div>
              <div className="col-span-1 text-right">Break</div>
              <div className="col-span-1 text-right">Sessions</div>
            </div>

            {data.rows.map(r => {
              const open = expanded.has(r.user._id);
              return (
                <div key={r.user._id} className="border-b border-border/40 last:border-b-0">
                  <button
                    onClick={() => toggleRow(r.user._id)}
                    className="w-full grid grid-cols-12 gap-2 px-4 py-3 items-center text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                      {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                        {(r.user.name || r.user.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{r.user.name || r.user.email}</p>
                        <p className="text-[10px] text-muted-foreground truncate capitalize">{r.user.role} {r.user.team ? `· ${r.user.team}` : ''}</p>
                      </div>
                    </div>
                    <div className="col-span-2 text-sm tabular-nums">
                      {r.firstClockIn ? fmtTime(r.firstClockIn) : <span className="text-muted-foreground">absent</span>}
                    </div>
                    <div className="col-span-2 text-sm tabular-nums">
                      {r.isStillActive ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> still working
                        </span>
                      ) : r.lastClockOut ? (
                        fmtTime(r.lastClockOut)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="col-span-2 text-sm tabular-nums text-right font-semibold">
                      {r.totalActiveMs > 0 ? fmtDuration(r.totalActiveMs) : <span className="text-muted-foreground font-normal">—</span>}
                    </div>
                    <div className="col-span-1 text-sm tabular-nums text-right text-muted-foreground">
                      {r.totalBreakMs > 0 ? fmtDuration(r.totalBreakMs) : '—'}
                    </div>
                    <div className="col-span-1 text-sm tabular-nums text-right text-muted-foreground">
                      {r.sessionCount || '—'}
                    </div>
                  </button>

                  {open && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      className="px-12 py-3 bg-muted/15 space-y-2"
                    >
                      {r.sessions.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No sessions on this day.</p>
                      ) : r.sessions.map(s => <SessionDetail key={s._id} session={s} />)}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: any; sub?: string; accent?: 'green' }) {
  return (
    <div className="flex flex-col">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className={`text-base font-bold tabular-nums leading-none mt-0.5 ${accent === 'green' ? 'text-green-600' : ''}`}>
        {value}{sub && <span className="text-[10px] font-normal text-muted-foreground ml-0.5">{sub}</span>}
      </p>
    </div>
  );
}

function SessionDetail({ session }: { session: SessionRow }) {
  const isAuto = !!session.autoClosedAt;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold tabular-nums">
          {fmtTime(session.startTime)} → {session.endTime ? fmtTime(session.endTime) : 'still active'}
        </span>
        {session.status === 'ended' ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground">
            <CheckCircle2 className="h-2.5 w-2.5" /> Ended
          </span>
        ) : session.status === 'on_break' ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-700">
            <Coffee className="h-2.5 w-2.5" /> On break
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/20 text-green-700">
            <Activity className="h-2.5 w-2.5" /> Active
          </span>
        )}
        {isAuto && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-700 border border-amber-500/30"
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
            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 text-[10px]">
              <Coffee className="h-2.5 w-2.5" />
              {fmtTime(b.startedAt)} – {b.endedAt ? fmtTime(b.endedAt) : '...'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
