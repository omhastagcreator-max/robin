import { Clock, Coffee, Pause, Play, StopCircle, AlertTriangle, Sparkles, Phone, PhoneOff } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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
    session, startSession, startBreak, endBreak, endSession, toggleOnCall,
    workedMs, currentBreakMs, totalBreakMs, isOnCall,
  } = useSession();

  // Only employees and sales clock in/out — admin/client see nothing.
  if (!['employee', 'sales'].includes(role)) return null;

  const isActive  = session?.status === 'active';
  const isOnBreak = session?.status === 'on_break';
  const breakOverLimit = currentBreakMs > SINGLE_BREAK_WARN_MS || totalBreakMs > TOTAL_BREAK_WARN_MS;

  // Toast wrappers so users get instant confirmation when the network
  // lag would otherwise leave them wondering if their click registered.
  const handleStart = async () => {
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
    if (!confirm('End your day? You can clock back in tomorrow.')) return;
    try { await endSession(); toast.success("Day wrapped. See you tomorrow."); }
    catch (e: any) { toast.error(e?.response?.data?.error || "Couldn't end session"); }
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
    ? 'Off the clock'
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
              Start your timer to clock in for the day.
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
              Start your day
            </button>
          )}

          {isActive && (
            <>
              <button
                onClick={handleOnCall}
                className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isOnCall
                    ? 'bg-violet-500/20 text-violet-700 border-violet-500/40 hover:bg-violet-500/30'
                    : 'bg-card text-foreground border-border hover:bg-muted'
                }`}
                title={isOnCall ? 'You are marked as on a call — click to clear' : 'Mark yourself on a call (do not disturb)'}
              >
                {isOnCall ? <PhoneOff className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{isOnCall ? 'On call' : 'Call'}</span>
              </button>
              <button
                onClick={handleBreak}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-amber-500/15 text-amber-700 border border-amber-500/30 text-xs font-semibold hover:bg-amber-500/25 transition-colors"
                title="Take a break"
              >
                <Pause className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Break</span>
              </button>
              <button
                onClick={handleEnd}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-red-500/15 text-red-600 border border-red-500/30 text-xs font-semibold hover:bg-red-500/25 transition-colors"
                title="End your day"
              >
                <StopCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">End</span>
              </button>
            </>
          )}

          {isOnBreak && (
            <>
              <button
                onClick={handleResume}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-green-500/15 text-green-700 border border-green-500/30 text-xs font-semibold hover:bg-green-500/25 transition-colors"
                title="Resume work"
              >
                <Play className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Resume</span>
              </button>
              <button
                onClick={handleEnd}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-red-500/15 text-red-600 border border-red-500/30 text-xs font-semibold hover:bg-red-500/25 transition-colors"
                title="End your day"
              >
                <StopCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">End</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SessionTopBar;
