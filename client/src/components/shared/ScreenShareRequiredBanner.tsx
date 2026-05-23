import { Monitor, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/hooks/useSession';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * ScreenShareRequiredBanner — sticky red strip that appears whenever an
 * internal teammate is clocked in (active session) but is NOT currently
 * sharing their screen.
 *
 * Why a banner instead of a toast: toasts auto-dismiss and the message
 * stops being seen. Screen sharing is now treated as mandatory by the
 * agency — non-compliance has to be visible at all times until fixed.
 *
 * Rules:
 *   - Hidden for admin (observer by default — owner ask) and client.
 *   - Hidden when there's no session (clocked out — nothing to enforce).
 *   - Hidden when share IS active.
 *   - Hidden when on break (the work pause is sanctioned).
 *   - One click → starts the LiveKit screen share. The picker opens; if
 *     the user cancels, the banner just stays until they pick.
 *
 * Mounted in AppLayout under SessionTopBar so it sits sticky just below
 * the timer strip on every page.
 */
export function ScreenShareRequiredBanner() {
  const { role }    = useAuth();
  const { session } = useSession();
  const huddle      = useHuddle();

  // ── Hide conditions ────────────────────────────────────────────────
  // Order matters: cheapest gates first so we render null fast.
  if (role === 'admin' || role === 'client') return null;
  if (!role || !['employee', 'sales', 'workroom'].includes(role)) return null;
  if (!session) return null;                            // not clocked in
  if (session.status !== 'active') return null;          // break is sanctioned
  if (huddle.screenOn) return null;                      // already sharing
  if (!huddle.joined) return null;                       // huddle hasn't connected yet

  return (
    <div className="sticky top-[44px] z-30 border-b border-rose-500/40 bg-rose-500/10 backdrop-blur-md">
      <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 flex-wrap">
        <div className="h-7 w-7 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center shrink-0">
          <Monitor className="h-3.5 w-3.5 text-rose-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-rose-800 leading-tight">
            Screen share required
          </p>
          <p className="text-[11px] text-rose-700/85 leading-snug">
            Bhai, kaam ke time screen share zaroori hai. Pick "Entire screen" jab Chrome poochhe.
          </p>
        </div>
        <button
          onClick={huddle.toggleScreen}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 shadow-sm shrink-0"
        >
          <Monitor className="h-3 w-3" /> Start sharing
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export default ScreenShareRequiredBanner;
