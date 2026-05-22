import { useState } from 'react';
import { Clock, Coffee, Pause, Play, StopCircle, AlertTriangle, Sparkles, Phone, PhoneOff } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { useOnCall } from '@/hooks/useOnCall';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import * as api from '@/api';
import { WorkingDespiteLeaveDialog } from '@/components/shared/WorkingDespiteLeaveDialog';

/**
 * SessionTopBar
 *
 * Sticky bar that lives at the top of every page for employees / sales.
 * One-glance status: are you on the clock, on break, or off duty? One click
 * to start, break, resume, or end. Replaces the sidebar mini-widget so the
 * controls stay reachable on every screen size — including mobile, where
 * the sidebar is hidden behind a menu button.
 *
 * Visual rules:
 *   - off-clock  → muted background, "Start your day" CTA on the right
 *   - active     → green accent + live HH:MM:SS, Break + End buttons
 *   - on_break   → amber (or red after limits trip) + live break counter,
 *                  Resume + End buttons
 *
 * Tone notes I've baked into the copy:
 *   - "Start your day" feels human; "Clock in" feels industrial
 *   - "End the day" instead of "Stop" so people clock out cleanly
 *   - Limit warning shown in-line, not as a popup, so it doesn't nag
 */

const SINGLE_BREAK_WARN_MS = 30 * 60 * 1000; // soft 30-min single-break warning
const TOTAL_BREAK_WARN_MS  = 60 * 60 * 1000; // soft 1-hour cumulative warning

const fmtHMS = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const fmtMS = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function SessionTopBar() {
  const { role } = useAuth();
  const {
    session, loading, startSession, startBreak, endBreak, endSession,
    workedMs, currentBreakMs, totalBreakMs,
  } = useSession();
  const { isOnCall, toggle: toggleOnCall } = useOnCall();

  // Internal staff (admin/employee/sales/workroom) all clock in + can take
  // breaks. Clients don't. Workroom users get the same break controls as
  // a regular employee — owner ask: "let Janvi take a break like normal."
  //
  // Defensive: an empty/missing role would have hidden the topbar entirely
  // and looked like a broken timer. Anyone with a non-client role gets the
  // bar; the only explicit exclusion is `client`. Catches the case where a
  // freshly-onboarded employee's role hasn't synced from server yet.
  if (role === 'client') return null;
  if (role && !['admin', 'employee', 'sales', 'workroom'].includes(role)) return null;

  // Loading guard (timer audit, May 2026). While fetchActiveSession is in
  // flight, `session` is null — without this guard the bar flashed
  // "Logged out / Log in" for a beat, even for users who already had an
  // active session on the server. Some reported "the timer's broken" on
  // slow networks where the flash lasted a full second. Now we render an
  // invisible-but-spaced placeholder strip until the first fetch lands.
  if (loading) {
    return <div className="sticky top-0 z-30 border-b border-border/30 h-[44px]" aria-hidden="true" />;
  }

  const isActive  = session?.status === 'active';
  const isOnBreak = session?.status === 'on_break';
  const breakOverLimit = currentBreakMs > SINGLE_BREAK_WARN_MS || totalBreakMs > TOTAL_BREAK_WARN_MS;

  // Today's leave (set when user clicks Log In and we detect an approved leave).
  // Triggers the WorkingDespiteLeaveDialog so they can confirm what's actually happening.
  const [pendingLeave, setPendingLeave] = useState<{ reason?: string } | null>(null);

  // Toast wrappers so users get instant confirmation when the network
  // lag would otherwise leave them wondering if their click registered.
  const handleStart = async () => {
    // Before starting the session, check if the user has an approved leave
    // for today. If yes, show the "Are you working?" dialog and let them
    // pick. The dialog itself starts the session via the onChose callback.
    try {
      const { leave } = await api.myLeaveToday();
      if (leave) {
        setPendingLeave({ reason: leave.reason });
        return;
      }
    } catch { /* non-fatal — fall through to normal start */ }
    try { await startSession(); toast.success("You're on the clock — have a great day!"); }
    catch (e: any) { toast.error(e?.response?.data?.error || "Couldn't start session"); }
  };
  const handleBreak = async () => {
    try { await startBreak(); toast("On break — timer's running"); }
    catch (e: any) { toast.error(e?.response?.data?.error || "Couldn't start break"); }
  };
  const handleResume = async () => {
    try { await endBreak(); toast.success("Back to work."); }
    catch (e: any) { toast.error(e?.response?.data?.error || "Couldn't end break"); }
  };
  const handleEnd = async () => {
    if (!confirm('Log out for the day? You can log back in tomorrow.')) return;
    try { await endSession(); toast.success("Logged out. See you tomorrow."); }
    catch (e: any) { toast.error(e?.response?.data?.error || "Couldn't log out"); }
  };
  const handleOnCall = async () => {
    try {
      await toggleOnCall();
      toast(isOnCall ? "Off the call" : "On a call — teammates will see your DND badge");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Couldn't update on-call status");
    }
  };

  // ── Visual state ────────────────────────────────────────────────────────
  // Tints match the StatusPill tone map (emerald=working, amber=on_break,
  // rose=danger/over-limit). Was using generic green-500 / red-500 which
  // drifted ~5% in hue from every other badge in the app.
  const tone = !session
    ? 'bg-muted/50 border-border/60'
    : isActive
      ? 'bg-emerald-500/10 border-emerald-500/30'
      : breakOverLimit
        ? 'bg-rose-500/15 border-rose-500/40'
        : 'bg-amber-500/10 border-amber-500/30';

  const dotColor = !session
    ? 'bg-muted-foreground/40'
    : isActive
      ? 'bg-emerald-500 animate-pulse'
      : breakOverLimit
        ? 'bg-rose-500 animate-pulse'
        : 'bg-amber-500';

  const statusLabel = !session
    ? 'Logged out'
    : isActive
      ? 'Working'
      : 'On break';

  return (
    <div className={`sticky top-0 z-30 border-b ${tone} backdrop-blur-md`}>
      <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3">
        {/* Status + timer block */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
          <Clock className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
          <span className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground hidden sm:inline">
            {statusLabel}
          </span>

          {isActive && (
            <span className="font-mono font-bold tabular-nums text-sm sm:text-base text-foreground ml-1">
              {fmtHMS(workedMs)}
            </span>
          )}

          {isOnBreak && (
            <span className="flex items-center gap-1.5 ml-1">
              <Coffee className="h-3.5 w-3.5 text-amber-700" />
              <span className={`font-mono font-bold tabular-nums text-sm sm:text-base ${breakOverLimit ? 'text-rose-600' : 'text-amber-700'}`}>
                {fmtMS(currentBreakMs)}
              </span>
              <span className="text-[10px] text-muted-foreground hidden md:inline tabular-nums">
                today: {fmtMS(totalBreakMs)}
              </span>
              {breakOverLimit && (
                <span className="text-[10px] text-rose-600 flex items-center gap-1 hidden md:flex">
                  <AlertTriangle className="h-3 w-3" /> long break
                </span>
              )}
            </span>
          )}

          {!session && (
            <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">
              Log in to start tracking your day.
            </span>
          )}
        </div>

        {/* Action buttons (right-aligned) — two-button model, owner ask:
            explicit Log In / Log Out labels (not icon-only). Break and
            On-call stay as icons since they're auxiliary controls. */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {!session && (
            <button
              onClick={handleStart}
              className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 shadow-sm transition-colors"
              title="Start your work session"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Log in
            </button>
          )}

          {isActive && (
            <>
              <IconBtn onClick={handleOnCall} active={isOnCall}
                title={isOnCall ? 'On a call — click to clear' : 'Mark yourself on a call'}>
                {isOnCall ? <PhoneOff className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
              </IconBtn>
              <IconBtn onClick={handleBreak} hoverTone="amber" title="Take a break">
                <Pause className="h-3.5 w-3.5" />
              </IconBtn>
              {/* Explicit labelled Log out button — the previous icon-only
                  version was too easy to miss; team members reported
                  ending the day without clocking out. */}
              <button
                onClick={handleEnd}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-rose-500/15 text-rose-700 border border-rose-500/30 text-xs font-bold hover:bg-rose-500 hover:text-white shadow-sm transition-colors"
                title="End your work session"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Log out
              </button>
            </>
          )}

          {isOnBreak && (
            <>
              <IconBtn onClick={handleResume} hoverTone="green" title="Resume work">
                <Play className="h-3.5 w-3.5" />
              </IconBtn>
              <button
                onClick={handleEnd}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-rose-500/15 text-rose-700 border border-rose-500/30 text-xs font-bold hover:bg-rose-500 hover:text-white shadow-sm transition-colors"
                title="End your work session"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Log out
              </button>
            </>
          )}
        </div>
      </div>

      {/* "Are you working today?" dialog — shows when user clicks Log In
          but has an approved leave covering today */}
      {pendingLeave && (
        <WorkingDespiteLeaveDialog
          reason={pendingLeave.reason}
          onChose={async () => {
            // After user picks an option, the dialog has already updated the
            // leave server-side (or skipped it for "still_off"). Now actually
            // start the session.
            try { await startSession(); toast.success("You're on the clock — have a great day!"); }
            catch (e: any) { toast.error(e?.response?.data?.error || "Couldn't start session"); }
          }}
          onClose={() => setPendingLeave(null)}
        />
      )}
    </div>
  );
}

/**
 * IconBtn — calmer top-bar action button. Just an icon with a tint that
 * only kicks in on hover, plus a tooltip. Was previously a full
 * bordered/coloured pill for every state, which made the top bar feel
 * busy on every single page.
 */
function IconBtn({
  onClick, title, children, active = false, hoverTone,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
  hoverTone?: 'amber' | 'red' | 'green';
}) {
  // Hover tones aligned to the StatusPill palette (emerald/amber/rose).
  const hover =
    hoverTone === 'amber' ? 'hover:bg-amber-500/15   hover:text-amber-700'   :
    hoverTone === 'red'   ? 'hover:bg-rose-500/15    hover:text-rose-600'    :
    hoverTone === 'green' ? 'hover:bg-emerald-500/15 hover:text-emerald-700' :
                            'hover:bg-primary/10     hover:text-primary';
  const tone = active
    ? 'bg-primary/15 text-primary'
    : `text-muted-foreground ${hover}`;
  return (
    <button onClick={onClick} title={title}
      className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${tone}`}>
      {children}
    </button>
  );
}

export default SessionTopBar;
