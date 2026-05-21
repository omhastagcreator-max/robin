import { Headphones, PhoneCall, X, AlertCircle } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * Single-click huddle CTA for placement on dashboards.
 * Talks directly to the persistent global dock — no navigation needed.
 *
 * Four states, four visual treatments:
 *   - 'expanded' / 'collapsed' → "In huddle · N" pill (primary tone)
 *   - 'joining'                → "Connecting…" pill WITH a Cancel × button
 *                                so a stuck connect can be aborted (used to
 *                                spin forever if LiveKit Cloud 429'd us)
 *   - meeting.error present    → red "Couldn't join · retry" button; the
 *                                error itself sits on the pill title
 *   - default                  → green "Join huddle"
 */
export function HuddleQuickPill() {
  const { mode, join, leave, expand, participantCount, meetingError } = useHuddle();

  if (mode === 'expanded' || mode === 'collapsed') {
    return (
      <button
        onClick={mode === 'collapsed' ? expand : undefined}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/12 border border-primary/20 text-xs text-primary font-medium hover:bg-primary/20 transition-colors"
        title={mode === 'collapsed' ? 'Reopen the huddle dock' : 'Currently in the huddle'}
      >
        <Headphones className="h-3.5 w-3.5" />
        In huddle{participantCount > 0 ? ` · ${participantCount}` : ''}
      </button>
    );
  }

  if (mode === 'joining') {
    return (
      <span className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-amber-500/12 border border-amber-500/20 text-xs text-amber-700 font-medium">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        Connecting…
        <button
          onClick={leave}
          title="Cancel — stuck connects let LiveKit Cloud rate-limit us; better to abort"
          className="ml-1 h-5 w-5 rounded-full flex items-center justify-center text-amber-700/70 hover:text-amber-800 hover:bg-amber-500/20 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  // If a prior attempt errored, show a red retry pill so the user knows the
  // last attempt failed. Hover/title surfaces the actual message.
  if (meetingError) {
    return (
      <button
        onClick={join}
        title={`Last attempt failed: ${meetingError}\nClick to retry.`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/12 border border-rose-500/25 text-xs text-rose-700 font-semibold hover:bg-rose-500/20 transition-colors"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Retry join
      </button>
    );
  }

  return (
    <button
      onClick={join}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm"
      title="Join the agency huddle (one click)"
    >
      <PhoneCall className="h-3.5 w-3.5" />
      Join huddle
    </button>
  );
}

export default HuddleQuickPill;
