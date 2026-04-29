import { Headphones, PhoneCall } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * Single-click huddle CTA for placement on dashboards.
 * Talks directly to the persistent global dock — no navigation needed.
 */
export function HuddleQuickPill() {
  const { mode, join, expand, participantCount } = useHuddle();

  if (mode === 'expanded' || mode === 'collapsed') {
    return (
      <button
        onClick={mode === 'collapsed' ? expand : undefined}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-xs text-green-600 font-medium hover:bg-green-500/20 transition-colors"
      >
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        In huddle{participantCount > 0 ? ` · ${participantCount}` : ''}
      </button>
    );
  }

  if (mode === 'joining') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 font-medium">
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
