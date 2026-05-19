import { Headphones, PhoneCall } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * Single-click huddle CTA for placement on dashboards.
 * Talks directly to the persistent global dock — no navigation needed.
 *
 * Color tones align with StatusPill's `in_huddle` state (primary/Rani
 * Pink) and `lurking`/joining state (amber). Previously hardcoded
 * green-500 which conflicted with the rest of the app's huddle badges.
 */
export function HuddleQuickPill() {
  const { mode, join, expand, participantCount } = useHuddle();

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
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/12 border border-amber-500/20 text-xs text-amber-700 font-medium">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        Connecting…
      </span>
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
