import { Headphones, PhoneCall, PhoneOff, Mic, MicOff, Monitor, MonitorOff, Users, Phone } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useOnCall } from '@/hooks/useOnCall';
import { HuddleMicPiP } from '@/components/shared/HuddleMicPiP';

/**
 * HuddleDashboardCard
 *
 * Two distinct layouts:
 *   - Idle / connecting: single row with icon + title + Call + Join.
 *     Compact, fits in a narrow rail.
 *   - Joined: header row (icon + title + leave) on top, then a SECOND row
 *     of action buttons (mic / screen / pop-out / on-call) so the 5
 *     controls have room to breathe and never overflow.
 *
 * Why two layouts: a 200px-wide right-rail can't fit 5 inline buttons
 * next to a label. Forcing them inline overflows the card. Stacking on
 * two rows is cleaner than hiding controls behind a "..." menu.
 */
export function HuddleDashboardCard() {
  const huddle = useHuddle();
  const { isOnCall, toggle: toggleOnCall } = useOnCall();

  const tone = huddle.joined
    ? 'border-green-500/30 bg-green-500/5'
    : 'border-primary/30 bg-primary/5';

  return (
    <div className={`rounded-2xl border p-3 ${tone} space-y-3`}>
      {/* HEADER ROW — title + minimal action (Join when idle, Leave when joined) */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
          <Headphones className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">
            {huddle.joined
              ? 'In the huddle'
              : huddle.joining
                ? 'Connecting…'
                : 'Huddle'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
            <Users className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {huddle.participantCount > 0
                ? `${huddle.participantCount} ${huddle.participantCount === 1 ? 'person' : 'people'}`
                : 'Voice + screen'}
            </span>
          </p>
        </div>

        {/* Top-right action: Join when idle, Leave when joined */}
        {!huddle.joined && !huddle.joining && (
          <button
            onClick={huddle.join}
            className="h-8 px-3 flex items-center gap-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shrink-0"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            Join
          </button>
        )}
        {huddle.joined && (
          <button
            onClick={huddle.leave}
            className="h-8 px-2.5 flex items-center gap-1 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 shrink-0"
            title="Leave the huddle"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        )}
      </div>

      {/* SECOND ROW — only when joined: full-width action grid that scales
          with the card. Icon-only buttons take ~32px each so 4 controls
          easily fit in a 200px rail. */}
      {huddle.joined && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={huddle.toggleAudio}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              huddle.audioOn
                ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
                : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'
            }`}
            title={huddle.audioOn ? 'Mute' : 'Unmute'}
          >
            {huddle.audioOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={huddle.toggleScreen}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              huddle.screenOn
                ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/25'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
            title={huddle.screenOn ? 'Stop sharing' : 'Share screen'}
          >
            {huddle.screenOn ? <MonitorOff className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
          </button>
          <HuddleMicPiP />
          <button
            onClick={toggleOnCall}
            className={`h-8 w-8 rounded-md flex items-center justify-center border transition-colors ${
              isOnCall
                ? 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
            title={isOnCall ? 'On a call (click to clear)' : 'Mark on a call (DND)'}
          >
            <Phone className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* When idle, On-Call sits on its own slim line so the layout doesn't
          collapse to nothing — and admins (who don't huddle as often) can
          still flip DND mode without joining. */}
      {!huddle.joined && !huddle.joining && (
        <button
          onClick={toggleOnCall}
          className={`w-full h-8 px-3 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            isOnCall
              ? 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25'
              : 'bg-card text-foreground border-border hover:bg-muted'
          }`}
          title={isOnCall ? 'You are marked on a call — click to clear' : 'Mark yourself on a call (do not disturb)'}
        >
          <Phone className="h-3.5 w-3.5" />
          {isOnCall ? 'On call' : 'Mark on a call'}
        </button>
      )}
    </div>
  );
}

export default HuddleDashboardCard;
