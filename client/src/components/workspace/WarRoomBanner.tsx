import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Activity, ShieldAlert, Sparkles, User as UserIcon, Flag, Clock, AlertTriangle } from 'lucide-react';

/**
 * WarRoomBanner — mission-control header strip for the brand workspace.
 *
 * Answers the four "in 30 seconds" questions the agency owner spec
 * pinned down:
 *
 *   1. WHAT is happening?         → currentStage + completionPct
 *   2. WHO is responsible?        → owner / next action owner / blocker owner
 *   3. WHAT is delayed?           → healthScore + healthFactors
 *   4. WHAT happens next?         → nextBestAction
 *
 * Three columns. Compact. Always visible above the page hero. Designed
 * to be the FIRST thing a brand-owner sees when opening a workflow,
 * before the existing JourneyStrip and Service cards.
 */

interface Props {
  workflow: any;
  ownerName?: string;
  reviewerName?: string;
  approverName?: string;
  requesterName?: string;
}

const HEALTH_TONE: Record<string, { dot: string; ring: string; text: string; emoji: string; word: string }> = {
  green:  { dot: 'bg-emerald-500', ring: 'border-emerald-500/30', text: 'text-emerald-700', emoji: '🟢', word: 'Healthy' },
  yellow: { dot: 'bg-amber-400',   ring: 'border-amber-500/30',   text: 'text-amber-700',   emoji: '🟡', word: 'Attention' },
  orange: { dot: 'bg-orange-500',  ring: 'border-orange-500/40',  text: 'text-orange-700',  emoji: '🟠', word: 'At risk' },
  red:    { dot: 'bg-rose-500',    ring: 'border-rose-500/50',    text: 'text-rose-700',    emoji: '🔴', word: 'Critical' },
};

export function WarRoomBanner({ workflow, ownerName, reviewerName, approverName, requesterName }: Props) {
  const tone = HEALTH_TONE[workflow.healthLevel || 'green'] || HEALTH_TONE.green;
  const services = (workflow.services || []) as any[];
  const totalCl = services.reduce((s, sv) => s + (sv.checklist?.length || 0), 0);
  const doneCl  = services.reduce((s, sv) => s + (sv.checklist?.filter((c: any) => c.done).length || 0), 0);
  const completionPct = totalCl > 0 ? Math.round((doneCl / totalCl) * 100) : 0;
  const active = services.find(s => s.status === 'in_progress') || services.find(s => s.status !== 'done');

  return (
    <div className={`rounded-xl border ${tone.ring} bg-card overflow-hidden`}>
      {/* Top status strip */}
      <div className="px-4 py-2 border-b border-border/60 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
          <span className={`text-[11px] uppercase tracking-[0.14em] font-bold ${tone.text}`}>
            {tone.word} · {workflow.healthScore || 100}/100
          </span>
        </div>
        <span className="text-muted-foreground/60 text-[11px]">·</span>
        <span className="text-[11.5px] font-semibold">{active?.label || 'Discovery'}</span>
        <span className="text-muted-foreground/60 text-[11px]">·</span>
        <span className="text-[11.5px] tabular-nums text-foreground/80">{completionPct}% done</span>
        {workflow.eta && (
          <>
            <span className="text-muted-foreground/60 text-[11px]">·</span>
            <span className="text-[11.5px] tabular-nums text-foreground/80 inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              ETA {format(typeof workflow.eta === 'string' ? parseISO(workflow.eta) : workflow$Date(workflow.eta), 'MMM d')}
            </span>
          </>
        )}
        {(workflow.healthFactors || []).length > 0 && tone.word !== 'Healthy' && (
          <>
            <span className="text-muted-foreground/60 text-[11px]">·</span>
            <span className={`text-[11px] ${tone.text} truncate`}>
              {(workflow.healthFactors as string[]).slice(0, 2).join(' · ')}
            </span>
          </>
        )}
      </div>

      {/* Three columns: Responsibility · AI insight · Next action */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/60">
        <Section icon={<UserIcon className="h-3 w-3 text-violet-600" />} label="Responsibility">
          <div className="grid grid-cols-2 gap-1.5">
            <Slot label="Owner" name={ownerName} />
            <Slot label="Reviewer" name={reviewerName} />
            <Slot label="Approver" name={approverName} />
            <Slot label="Requester" name={requesterName} />
          </div>
        </Section>

        <Section icon={<Sparkles className="h-3 w-3 text-primary" />} label="AI insight">
          {workflow.delayCause ? (
            <p className="text-[11.5px] leading-snug">
              <ShieldAlert className="h-3 w-3 inline text-rose-600 mr-1" />
              {workflow.delayCause}
            </p>
          ) : (workflow.healthFactors || []).length > 0 ? (
            <ul className="text-[11px] space-y-0.5">
              {(workflow.healthFactors as string[]).slice(0, 3).map((f, i) => (
                <li key={i} className="text-foreground/80">· {f}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-emerald-700">All signals healthy. Stay the course.</p>
          )}
        </Section>

        <Section icon={<Flag className="h-3 w-3 text-amber-600" />} label="Next best action">
          <p className="text-[11.5px] leading-snug text-foreground/90">
            {workflow.nextBestAction || (workflow as any).nextAction || 'No suggested action yet.'}
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Slot({ label, name }: { label: string; name?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-[11.5px] truncate ${name ? 'font-semibold' : 'italic text-muted-foreground/70'}`}>
        {name || 'unassigned'}
      </p>
    </div>
  );
}

// Suppress unused-icon warnings reserved for future expansions.
void Activity; void Link; void AlertTriangle;

/**
 * Tiny shim because `new Date(unknown)` upset the TS strict check
 * upstream in the JSX template literal — we wrap via a function that
 * accepts any input and returns a real Date.
 */
function workflow$Date(v: any): Date { return v instanceof Date ? v : new Date(v); }
