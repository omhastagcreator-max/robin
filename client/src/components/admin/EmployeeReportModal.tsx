import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, BarChart2, CheckCircle2, ListTodo, Activity as ActivityIcon, Loader2,
  Calendar, Clock, FileText, FolderKanban, ArrowRight,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import * as api from '@/api';

type Period = 'daily' | 'weekly' | 'monthly';

interface Props {
  open: boolean;
  employee: { _id: string; name?: string; email?: string; team?: string; role?: string } | null;
  onClose: () => void;
}

interface ReportPayload {
  period: Period;
  startDate: string;
  employee: any;
  stats: {
    totalTasksDoneInPeriod: number;
    totalTasksAssignedInPeriod: number;
    totalTasksOngoing: number;
    activityCount: number;
  };
  activities: Array<{
    _id: string;
    action: string;
    entity?: string;
    entityId?: string;
    metadata?: any;
    createdAt: string;
  }>;
  tasks: {
    completed: any[];
    ongoing: any[];
    touched: any[];
  };
}

interface TimelineItem {
  id: string;
  kind: 'activity' | 'task_completed' | 'task_created' | 'task_updated';
  at: Date;
  title: string;
  subtitle?: string;
  meta?: string;
}

const PERIOD_LABEL: Record<Period, string> = { daily: 'Today', weekly: 'This Week', monthly: 'This Month' };

function buildTimeline(report: ReportPayload): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const a of report.activities) {
    items.push({
      id: `a:${a._id}`,
      kind: 'activity',
      at: new Date(a.createdAt),
      title: humanizeAction(a.action),
      subtitle: a.entity ? `on ${a.entity}` : undefined,
      meta: a.metadata?.summary || a.metadata?.title,
    });
  }

  for (const t of report.tasks.completed) {
    if (!t.completedAt) continue;
    items.push({
      id: `tc:${t._id}`,
      kind: 'task_completed',
      at: new Date(t.completedAt),
      title: `Completed: ${t.title}`,
      subtitle: t.projectId?.name ? `in ${t.projectId.name}` : undefined,
      meta: t.priority ? `priority: ${t.priority}` : undefined,
    });
  }

  // Tasks created within the period (use createdAt as the moment)
  const periodStart = new Date(report.startDate);
  for (const t of report.tasks.touched) {
    if (t.createdAt && new Date(t.createdAt) >= periodStart) {
      items.push({
        id: `tn:${t._id}`,
        kind: 'task_created',
        at: new Date(t.createdAt),
        title: `New task assigned: ${t.title}`,
        subtitle: t.projectId?.name ? `in ${t.projectId.name}` : undefined,
        meta: t.priority ? `priority: ${t.priority}` : undefined,
      });
    }
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function humanizeAction(action: string) {
  return action.replace(/[_.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

function TimelineRow({ item, isLast }: { item: TimelineItem; isLast: boolean }) {
  const meta = (() => {
    switch (item.kind) {
      case 'task_completed': return { dot: 'bg-green-500', icon: CheckCircle2,  ring: 'ring-green-500/30' };
      case 'task_created':   return { dot: 'bg-blue-500',  icon: ListTodo,      ring: 'ring-blue-500/30' };
      case 'task_updated':   return { dot: 'bg-amber-500', icon: ListTodo,      ring: 'ring-amber-500/30' };
      default:               return { dot: 'bg-primary',   icon: ActivityIcon,  ring: 'ring-primary/30' };
    }
  })();
  const Icon = meta.icon;

  return (
    <div className="flex gap-4 group relative">
      {/* Rail */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`h-9 w-9 rounded-full bg-card border border-border flex items-center justify-center ring-4 ${meta.ring}`}>
          <Icon className="h-4 w-4" />
        </div>
        {!isLast && <div className="flex-1 w-px bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-5 ${isLast ? '' : ''}`}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-medium">{item.title}</p>
          {item.subtitle && <span className="text-xs text-muted-foreground">{item.subtitle}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{format(item.at, 'h:mm a')}</span>
          <span>·</span>
          <span>{formatDistanceToNow(item.at, { addSuffix: true })}</span>
          {item.meta && <span className="text-muted-foreground/70">· {item.meta}</span>}
        </div>
      </div>
    </div>
  );
}

export function EmployeeReportModal({ open, employee, onClose }: Props) {
  const [period, setPeriod] = useState<Period>('daily');
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Reset state on open/close
  useEffect(() => {
    if (open) { setPeriod('daily'); setReport(null); setError(null); }
  }, [open, employee?._id]);

  // Fetch report when employee/period changes
  useEffect(() => {
    if (!open || !employee?._id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.adminEmployeeReport(employee._id, period)
      .then((data: ReportPayload) => { if (!cancelled) setReport(data); })
      .catch((e: any) => { if (!cancelled) setError(e?.response?.data?.error || e?.message || 'Failed to load report'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, employee?._id, period]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const timeline = report ? buildTimeline(report) : [];

  return (
    <AnimatePresence>
      {open && employee && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />
          {/* Off-canvas panel */}
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 240 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[640px] bg-background border-l border-border z-50 shadow-2xl flex flex-col"
            role="dialog" aria-modal="true" aria-label="Employee report"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center text-primary font-bold shrink-0">
                {(employee.name || employee.email || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-base truncate">{employee.name || 'Unnamed'}</p>
                  {employee.team && (
                    <span className="text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded font-medium text-muted-foreground">
                      {employee.team}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                  <BarChart2 className="h-3 w-3" /> Productivity report · {PERIOD_LABEL[period]}
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Period toggles */}
            <div className="px-5 py-4 border-b border-border">
              <div className="inline-flex bg-muted/40 border border-border rounded-full p-1">
                {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all capitalize ${
                      period === p
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {report && (
                <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  Since {format(new Date(report.startDate), 'EEE, dd MMM yyyy h:mm a')}
                </p>
              )}
            </div>

            {/* Body — scroll */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              {error && !loading && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
                  {error}
                </div>
              )}

              {!loading && !error && report && (
                <>
                  {/* Stats row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard icon={CheckCircle2} label="Tasks Completed"   value={report.stats.totalTasksDoneInPeriod}     color="bg-green-500/15 text-green-500" />
                    <StatCard icon={ListTodo}     label="Tasks Ongoing"     value={report.stats.totalTasksOngoing}          color="bg-blue-500/15 text-blue-500" />
                    <StatCard icon={ArrowRight}   label="Newly Assigned"    value={report.stats.totalTasksAssignedInPeriod} color="bg-amber-500/15 text-amber-500" />
                    <StatCard icon={ActivityIcon} label="Activity Count"    value={report.stats.activityCount}              color="bg-primary/15 text-primary" />
                  </div>

                  {/* Ongoing tasks */}
                  {report.tasks.ongoing.length > 0 && (
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                        <FolderKanban className="h-3.5 w-3.5" /> Ongoing Tasks ({report.tasks.ongoing.length})
                      </h3>
                      <div className="bg-card border border-border rounded-2xl divide-y divide-border/40">
                        {report.tasks.ongoing.slice(0, 8).map((t: any) => (
                          <div key={t._id} className="flex items-center gap-3 px-4 py-3">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${t.status === 'ongoing' ? 'bg-amber-400' : 'bg-muted-foreground/40'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{t.title}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {t.projectId?.name && <>in {t.projectId.name} · </>}
                                {t.dueDate ? `due ${format(new Date(t.dueDate), 'dd MMM')}` : 'no due date'}
                              </p>
                            </div>
                            <span className="text-[10px] uppercase font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{t.status}</span>
                          </div>
                        ))}
                        {report.tasks.ongoing.length > 8 && (
                          <p className="px-4 py-2 text-[11px] text-muted-foreground text-center">+ {report.tasks.ongoing.length - 8} more</p>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Timeline */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Timeline · {PERIOD_LABEL[period]}
                    </h3>
                    {timeline.length === 0 ? (
                      <div className="bg-card border border-border rounded-2xl p-8 text-center">
                        <ActivityIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No activity yet for this period</p>
                      </div>
                    ) : (
                      <div className="bg-card border border-border rounded-2xl p-5">
                        {timeline.map((item, idx) => (
                          <TimelineRow key={item.id} item={item} isLast={idx === timeline.length - 1} />
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default EmployeeReportModal;
