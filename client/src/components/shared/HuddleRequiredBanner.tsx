import { Users, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/hooks/useSession';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * HuddleRequiredBanner — sticky red strip that appears whenever a
 * teammate is clocked in (active session) but is NOT currently in the
 * huddle. Mirrors ScreenShareRequiredBanner in pattern + chrome so the
 * two enforcement strips feel like one system, not two.
 *
 * The agency rule (May 2026 owner ask): you are at work when you are
 * in the huddle. Walking away from the desk for "just a minute" was
 * costing the team several minutes per person per day. The banner is
 * the visible side of enforcement; HuddleContext's auto-rejoin and
 * HuddleAutoBreak's shorter timer are the active sides.
 *
 * Rules:
 *   - Hidden for client (external — they're not part of the huddle).
 *   - Hidden when there's no session (clocked out).
 *   - Hidden when on break (the work pause is sanctioned).
 *   - Hidden when ALREADY in the huddle.
 *   - Hidden when currently JOINING (don't nag during the connect spinner).
 *   - One click → join() through the HuddleContext.
 *   - NOT dismissible — the user can only make it go away by joining or
 *     ending their session.
 *
 * Mounted in AppLayout under SessionTopBar so it sits sticky just below
 * the timer strip on every page, exactly like ScreenShareRequiredBanner.
 *
 * Scope decision: applies to ALL roles except 'client'. Earlier patterns
 * (auto-join, ScreenShareRequiredBanner) excluded admins, but the owner
 * asked for huddle attendance to apply to everyone — admins included —
 * so leadership isn't visibly exempt from the same rule the team has.
 */
export function HuddleRequiredBanner() {
  const { role }    = useAuth();
  const { session } = useSession();
  const huddle      = useHuddle();

  // Cheap gates first so we render null quickly on most pages.
  if (role === 'client' || !role) return null;
  if (!session) return null;                    // not clocked in
  if (session.status !== 'active') return null; // break / ended is sanctioned
  if (huddle.joined) return null;                // already in
  if (huddle.joining) return null;               // mid-connect — don't nag

  return (
    <div className="sticky top-[44px] z-30 border-b border-rose-500/40 bg-rose-500/10 backdrop-blur-md">
      <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 flex-wrap">
        <div className="h-7 w-7 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center shrink-0">
          <Users className="h-3.5 w-3.5 text-rose-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-rose-800 leading-tight">
            Huddle required
          </p>
          <p className="text-[11px] text-rose-700/85 leading-snug">
            Kaam ke time team huddle mein hona zaroori hai. Click Join to enter.
          </p>
        </div>
        <button
          onClick={huddle.join}
          disabled={huddle.joining}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 shadow-sm shrink-0 disabled:opacity-60"
        >
          {huddle.joining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
          {huddle.joining ? 'Joining…' : 'Join huddle'}
          {!huddle.joining && <ArrowRight className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

export default HuddleRequiredBanner;
