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
    session, startSession, startBreak, endBreak, endSession,
    workedMs, currentBreakMs, totalBreakMs,
  } = useSession();
  const { isOnCall, toggle: toggleOnCall } = useOnCall();

  // Internal staff (admin/employee/sales) all clock in. Clients don't.
  if (!['admin', 'employee', 'sales'].includes(role)) return null;

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
  const tone = !session
    ? 'bg-muted/50 border-border/60'
    : isActive
      ? 'bg-green-500/10 border-green-500/30'
      : breakOverLimit
        ? 'bg-red-500/15 border-red-500/40'
        : 'bg-amber-500/10 border-amber-500/30';

  const dotColor = !session
    ? 'bg-muted-foreground/40'
    : isActive
      ? 'bg-green-500 animate-pulse'
      : breakOverLimit
        ? 'bg-red-500 animate-pulse'
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
              <Coffee className="h-3.5 w-3.5 text-amber-600" />
              <span className={`font-mono font-bold tabular-nums text-sm sm:text-base ${breakOverLimit ? 'text-red-500' : 'text-amber-600'}`}>
                {fmtMS(currentBreakMs)}
              </span>
              <span className="text-[10px] text-muted-foreground hidden md:inline tabular-nums">
                today: {fmtMS(totalBreakMs)}
              </span>
              {breakOverLimit && (
                <span className="text-[10px] text-red-500 flex items-center gap-1 hidden md:flex">
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

        {/* Action buttons (right-aligned) */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {!session && (
            <button
              onClick={handleStart}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Log in
            </button>
          )}

          {/* Calmer action row — icon-only buttons, no border outline,
              the tone (amber/red/green) is conveyed by a subtle bg tint
              that only appears on hover. Was pretty noisy before. */}
          {isActive && (
            <>
              <IconBtn onClick={handleOnCall} active={isOnCall}
                title={isOnCall ? 'On a call — click to clear' : 'Mark yourself on a call'}>
                {isOnCall ? <PhoneOff className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
              </IconBtn>
              <IconBtn onClick={handleBreak} hoverTone="amber" title="Take a break">
                <Pause className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn onClick={handleEnd} hoverTone="red" title="Log out for the day">
                <StopCircle className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}

          {isOnBreak && (
            <>
              <IconBtn onClick={handleResume} hoverTone="green" title="Resume work">
                <Play className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn onClick={handleEnd} hoverTone="red" title="Log out for the day">
                <StopCircle className="h-3.5 w-3.5" />
              </IconBtn>
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
  const hover =
    hoverTone === 'amber' ? 'hover:bg-amber-500/15 hover:text-amber-700' :
    hoverTone === 'red'   ? 'hover:bg-red-500/15   hover:text-red-600'   :
    hoverTone === 'green' ? 'hover:bg-green-500/15 hover:text-green-700' :
                            'hover:bg-primary/10 hover:text-primary';
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
