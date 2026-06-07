import { useEffect, useState } from 'react';
import { Sun, Moon, Calendar, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import * as api from '@/api';

/**
 * BriefStrip — compact morning / evening brief banner.
 *
 * Why a strip and not a card: it has to fit on the WorkroomHome above
 * the priority-clients grid WITHOUT pushing useful content off the
 * fold. A single-row collapsed state shows the one-line summary +
 * an expand chevron; expanded reveals up to 4 mini-sections (open
 * tasks, overdue, meetings, priority brands) in a tight grid.
 *
 * Auto-picks 'morning' before 17:00 IST and 'evening' after.
 */

interface BriefRow {
  id?: string;
  title: string;
  subtitle?: string;
}
interface Brief {
  kind: 'morning' | 'evening';
  summary: string;
  openTasks: any[];
  overdueTasks: any[];
  todaysMeetings: any[];
  priorityBrands: any[];
  accomplishments: any[];
}

export function BriefStrip() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyBrief()
      .then((b: Brief) => setBrief(b))
      .catch(() => setBrief(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !brief) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-[12px] text-muted-foreground">
        {loading ? 'Loading your brief…' : 'No brief available yet.'}
      </div>
    );
  }

  const isMorning = brief.kind === 'morning';
  const Icon = isMorning ? Sun : Moon;
  const accent = isMorning ? 'text-amber-600 bg-amber-500/12' : 'text-indigo-600 bg-indigo-500/12';

  // Collapse if nothing notable to show — keeps the page clean on a quiet day.
  const hasContent = brief.openTasks.length > 0
    || brief.overdueTasks.length > 0
    || brief.todaysMeetings.length > 0
    || brief.priorityBrands.length > 0
    || brief.accomplishments.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => hasContent && setExpanded(v => !v)}
        className={`w-full px-4 py-2.5 flex items-center gap-3 text-left ${hasContent ? 'hover:bg-muted/40' : ''}`}
        disabled={!hasContent}
      >
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
            {isMorning ? 'Morning brief' : 'End of day'}
          </p>
          <p className="text-[12.5px] font-semibold text-foreground truncate">{brief.summary}</p>
        </div>
        {hasContent && (expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />)}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3 border-t border-border bg-muted/20">
          <BriefMini
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Overdue"
            tone="rose"
            rows={brief.overdueTasks.map(t => ({ id: t.id, title: t.title, subtitle: `${t.daysLate}d late` }))}
            empty="Nothing overdue"
          />
          <BriefMini
            icon={<Sun className="h-3 w-3" />}
            label={isMorning ? 'Open tasks' : 'Still open'}
            tone="amber"
            rows={brief.openTasks.map(t => ({ id: t.id, title: t.title, subtitle: t.clientName || t.priority }))}
            empty="No open tasks"
          />
          <BriefMini
            icon={<Calendar className="h-3 w-3" />}
            label="Today's meetings"
            tone="blue"
            rows={brief.todaysMeetings.map((m, i) => ({
              id: m.id || `m${i}`,
              title: m.title,
              subtitle: formatDistanceToNowStrict(typeof m.startTime === 'string' ? parseISO(m.startTime) : m.startTime, { addSuffix: true }),
            }))}
            empty="No meetings"
          />
          {isMorning ? (
            <BriefMini
              icon={<AlertTriangle className="h-3 w-3" />}
              label="Watch list"
              tone="indigo"
              rows={brief.priorityBrands.map(b => ({ id: b.id, title: b.name, subtitle: b.reason }))}
              empty="All clear"
            />
          ) : (
            <BriefMini
              icon={<Sun className="h-3 w-3" />}
              label="You finished"
              tone="emerald"
              rows={brief.accomplishments.map(t => ({ id: t.id, title: t.title, subtitle: t.clientName || '' }))}
              empty="Nothing closed today"
            />
          )}
        </div>
      )}
    </div>
  );
}

function BriefMini({ icon, label, tone, rows, empty }: {
  icon: React.ReactNode;
  label: string;
  tone: 'rose' | 'amber' | 'blue' | 'indigo' | 'emerald';
  rows: BriefRow[];
  empty: string;
}) {
  const toneCls = {
    rose: 'text-rose-600 bg-rose-500/12',
    amber: 'text-amber-600 bg-amber-500/12',
    blue: 'text-blue-600 bg-blue-500/12',
    indigo: 'text-indigo-600 bg-indigo-500/12',
    emerald: 'text-emerald-600 bg-emerald-500/12',
  }[tone];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`h-4 w-4 rounded inline-flex items-center justify-center ${toneCls}`}>{icon}</span>
        <span className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground">{label}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground/80">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 3).map(r => (
            <li key={r.id} className="text-[11.5px] truncate">
              <span className="font-medium text-foreground">{r.title}</span>
              {r.subtitle && <span className="text-muted-foreground"> · {r.subtitle}</span>}
            </li>
          ))}
          {rows.length > 3 && (
            <li className="text-[10.5px] text-muted-foreground italic">+ {rows.length - 3} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
