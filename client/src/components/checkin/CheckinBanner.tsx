import { Sunrise, CloudSun, Moon, ArrowRight } from 'lucide-react';
import type { CheckinKind } from '@/contexts/CheckinContext';

/**
 * CheckinBanner — sticky strip under the SessionTopBar, shown only when
 * a checkin is overdue. Mirrors the visual pattern of HuddleRequiredBanner
 * + ScreenShareRequiredBanner so all three "you must do this now"
 * surfaces feel like one system.
 *
 * Priority:
 *   - If session is active + morning NOT done → morning banner (block-tone)
 *   - Else if morning done + midday past 1pm IST not done → midday banner
 *   - Else nothing.
 *
 * Evening is intentionally NOT shown as a banner because it's enforced
 * via the logout flow — surfacing it in-line would just nag during work.
 */
export function CheckinBanner({
  morningDone, middayDone, eveningDone, onOpen, hasMorningSession, sessionActive,
}: {
  morningDone: boolean;
  middayDone:  boolean;
  eveningDone: boolean;
  onOpen: (k: CheckinKind) => void;
  hasMorningSession: boolean;
  sessionActive: boolean;
}) {
  // Avoid lint warning on unused `eveningDone` — it's intentional that
  // the evening banner doesn't render; keep the prop for future use.
  void eveningDone;

  // Morning blocker: only when the user is clocked in.
  if (sessionActive && !morningDone) {
    return (
      <div className="sticky top-[44px] z-30 border-b border-amber-500/40 bg-amber-500/10 backdrop-blur-md">
        <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 flex-wrap">
          <div className="h-7 w-7 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
            <Sunrise className="h-3.5 w-3.5 text-amber-700" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-amber-800 leading-tight">
              Morning check-in pending
            </p>
            <p className="text-[11px] text-amber-700/85 leading-snug">
              Quick brand pulse + today's tasks. ~30 seconds. Then huddle opens up.
            </p>
          </div>
          <button
            onClick={() => onOpen('morning')}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 shadow-sm shrink-0"
          >
            <Sunrise className="h-3 w-3" /> Start check-in <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  // Midday banner — only after 1pm IST and morning done.
  if (hasMorningSession && morningDone && !middayDone) {
    const ist = new Date(Date.now() + 330 * 60_000);
    const hour = ist.getUTCHours();
    if (hour >= 13) {
      return (
        <div className="sticky top-[44px] z-30 border-b border-sky-500/40 bg-sky-500/10 backdrop-blur-md">
          <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 flex-wrap">
            <div className="h-7 w-7 rounded-full bg-sky-500/15 border border-sky-500/40 flex items-center justify-center shrink-0">
              <CloudSun className="h-3.5 w-3.5 text-sky-700" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-sky-800 leading-tight">
                Halfway pulse pending
              </p>
              <p className="text-[11px] text-sky-700/85 leading-snug">
                Tap a status for each task. ~15 seconds.
              </p>
            </div>
            <button
              onClick={() => onOpen('midday')}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 shadow-sm shrink-0"
            >
              <CloudSun className="h-3 w-3" /> Midday check-in
            </button>
          </div>
        </div>
      );
    }
  }

  // Evening hint — only late in the day, only when morning done. Doesn't
  // block, just reminds. The hard gate is the logout flow.
  if (hasMorningSession && morningDone) {
    const ist = new Date(Date.now() + 330 * 60_000);
    const hour = ist.getUTCHours();
    if (hour >= 18) {
      return (
        <div className="sticky top-[44px] z-30 border-b border-indigo-500/40 bg-indigo-500/10 backdrop-blur-md">
          <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 flex-wrap">
            <div className="h-7 w-7 rounded-full bg-indigo-500/15 border border-indigo-500/40 flex items-center justify-center shrink-0">
              <Moon className="h-3.5 w-3.5 text-indigo-700" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-indigo-800 leading-tight">
                Don't forget to wrap the day
              </p>
              <p className="text-[11px] text-indigo-700/85 leading-snug">
                ~20 seconds: where each task landed + tomorrow's plan. Required before logout.
              </p>
            </div>
            <button
              onClick={() => onOpen('evening')}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-500 text-white text-xs font-semibold hover:bg-indigo-600 shadow-sm shrink-0"
            >
              <Moon className="h-3 w-3" /> Wrap day
            </button>
          </div>
        </div>
      );
    }
  }

  return null;
}

export default CheckinBanner;
