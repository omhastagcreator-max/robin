import { useMemo } from 'react';
import {
  Flame, Ghost, TrendingUp, Sparkles, Phone, ArrowRight, CalendarClock,
} from 'lucide-react';

/**
 * SalesInsightsStrip — a row of "what should I do right now?" chips at
 * the top of the SalesDashboard.
 *
 * Everything is computed from the leads array the page already has — no
 * API call, no Gemini bill, no waiting. The intent is to put the things
 * a sales rep actually needs on screen the moment they open the page:
 *
 *   - hot leads waiting on you
 *   - leads at risk of ghosting (no contact in 5+ days)
 *   - leads added this week
 *   - pipeline value sitting in late-stage (demo_done / hot_follow_up /
 *     cooking) where conversion is most likely
 *   - your next follow-up that's due today
 *
 * Each chip is clickable — the parent passes an `onPick(filter)` callback
 * so a click can flip the All-leads view to a focused subset (the parent
 * is responsible for actually applying the filter — keeps this component
 * decoupled from the page state machine).
 */

interface Lead {
  _id: string;
  name?: string;
  company?: string;
  contact?: string;
  email?: string;
  stage?: string;
  status?: string;
  aiScore?: '' | 'hot' | 'warm' | 'cold';
  aiNextAction?: string;
  estimatedValue?: number;
  nextFollowUp?: string;
  createdAt?: string;
  notes?: Array<{ createdAt?: string }>;
}

export type SalesInsightsFilter =
  | { kind: 'all' }
  | { kind: 'hot' }
  | { kind: 'ghosting' }
  | { kind: 'this-week' }
  | { kind: 'late-stage' }
  | { kind: 'follow-up-today' };

interface Props {
  leads: Lead[];
  onPick: (filter: SalesInsightsFilter) => void;
}

const DAY = 24 * 3600 * 1000;
const isOpen = (l: Lead) => !['won', 'lost'].includes(l.stage || l.status || '');
const lastTouchMs = (l: Lead): number => {
  const dates = (l.notes || []).map(n => n.createdAt ? new Date(n.createdAt).getTime() : 0).filter(Boolean);
  if (dates.length) return Math.max(...dates);
  return l.createdAt ? new Date(l.createdAt).getTime() : 0;
};
const sameLocalDay = (a: number, b: number) => {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

export function SalesInsightsStrip({ leads, onPick }: Props) {
  const stats = useMemo(() => {
    const open = leads.filter(isOpen);
    const now = Date.now();

    // Hot leads — aiScore=hot OR stage in late-funnel still open.
    const hot = open.filter(l => l.aiScore === 'hot' || ['hot_follow_up', 'demo_done', 'demo2_conversion', 'cooking'].includes(l.stage || ''));

    // Ghosting risk — last touch was 5+ days ago, still open, not cold.
    const ghosting = open.filter(l => {
      if (l.aiScore === 'cold') return false;
      const t = lastTouchMs(l);
      if (!t) return false;
      return (now - t) > 5 * DAY;
    });

    // Added this week.
    const weekStart = now - 7 * DAY;
    const thisWeek  = leads.filter(l => l.createdAt && new Date(l.createdAt).getTime() >= weekStart);

    // Late-stage value — deals you're closest to winning.
    const lateStage = open.filter(l => ['demo_done', 'hot_follow_up', 'cooking'].includes(l.stage || ''));
    const lateStageValue = lateStage.reduce((sum, l) => sum + (l.estimatedValue || 0), 0);

    // Follow-up due today — nextFollowUp == today.
    const followUpToday = open.filter(l => {
      if (!l.nextFollowUp) return false;
      const t = new Date(l.nextFollowUp).getTime();
      return sameLocalDay(t, now);
    });

    return { hot, ghosting, thisWeek, lateStage, lateStageValue, followUpToday };
  }, [leads]);

  // Compact rupee formatter — keeps the chip from getting wide on big sums.
  const fmtRupee = (n: number): string => {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
    if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
    if (n >= 1000)       return `₹${(n / 1000).toFixed(0)}k`;
    return `₹${n}`;
  };

  const anyInsight =
    stats.hot.length > 0 || stats.ghosting.length > 0 || stats.thisWeek.length > 0 ||
    stats.lateStage.length > 0 || stats.followUpToday.length > 0;

  if (!anyInsight) return null;

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.04] to-primary/[0.01] p-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-primary">What needs you</p>
        <span className="text-[10.5px] text-muted-foreground">— tap a chip to focus on those leads</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {stats.followUpToday.length > 0 && (
          <InsightChip
            icon={<CalendarClock className="h-3 w-3" />}
            label={`${stats.followUpToday.length} follow-up${stats.followUpToday.length === 1 ? '' : 's'} due today`}
            tone="rose"
            onClick={() => onPick({ kind: 'follow-up-today' })}
          />
        )}
        {stats.hot.length > 0 && (
          <InsightChip
            icon={<Flame className="h-3 w-3" />}
            label={`${stats.hot.length} hot lead${stats.hot.length === 1 ? '' : 's'} open`}
            tone="orange"
            onClick={() => onPick({ kind: 'hot' })}
          />
        )}
        {stats.ghosting.length > 0 && (
          <InsightChip
            icon={<Ghost className="h-3 w-3" />}
            label={`${stats.ghosting.length} going quiet`}
            tone="amber"
            onClick={() => onPick({ kind: 'ghosting' })}
            title="Open leads with no contact in 5+ days — they're slipping away."
          />
        )}
        {stats.lateStageValue > 0 && (
          <InsightChip
            icon={<TrendingUp className="h-3 w-3" />}
            label={`${fmtRupee(stats.lateStageValue)} close to closing`}
            tone="emerald"
            onClick={() => onPick({ kind: 'late-stage' })}
            title="Estimated value of leads in demo-done / hot-follow-up / cooking — your highest-converting stages."
          />
        )}
        {stats.thisWeek.length > 0 && (
          <InsightChip
            icon={<ArrowRight className="h-3 w-3" />}
            label={`${stats.thisWeek.length} new this week`}
            tone="sky"
            onClick={() => onPick({ kind: 'this-week' })}
          />
        )}
      </div>

      {/* Single most-actionable suggestion — the hottest lead with a phone number. */}
      {stats.hot[0]?.contact && (
        <div className="mt-3 pt-3 border-t border-primary/15 flex items-center gap-2 flex-wrap">
          <p className="text-[11.5px] text-muted-foreground">
            One concrete thing: call
          </p>
          <a
            href={`tel:${stats.hot[0].contact}`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-bold hover:bg-primary/90"
          >
            <Phone className="h-3 w-3" /> {stats.hot[0].name || stats.hot[0].company || stats.hot[0].contact}
          </a>
          {stats.hot[0].aiNextAction && (
            <span className="text-[11px] text-foreground/80 italic">— {stats.hot[0].aiNextAction}</span>
          )}
        </div>
      )}
    </div>
  );
}

function InsightChip({ icon, label, tone, onClick, title }: {
  icon: React.ReactNode; label: string;
  tone: 'orange' | 'amber' | 'emerald' | 'sky' | 'rose';
  onClick: () => void;
  title?: string;
}) {
  const cls: Record<typeof tone, string> = {
    orange:  'bg-orange-500/12 text-orange-700 border-orange-500/30 hover:bg-orange-500/20',
    amber:   'bg-amber-500/12 text-amber-700 border-amber-500/30 hover:bg-amber-500/20',
    emerald: 'bg-emerald-500/12 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20',
    sky:     'bg-sky-500/12 text-sky-700 border-sky-500/30 hover:bg-sky-500/20',
    rose:    'bg-rose-500/12 text-rose-700 border-rose-500/30 hover:bg-rose-500/20',
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11.5px] font-semibold transition-colors ${cls[tone]}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
