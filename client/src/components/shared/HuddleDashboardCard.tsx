import { Headphones, PhoneCall, PhoneOff, Mic, MicOff, Monitor, MonitorOff, Users } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { HuddleMicPiP } from '@/components/shared/HuddleMicPiP';

/**
 * HuddleDashboardCard
 *
 * Beefier "join the huddle" card for the dashboards. Replaces the small
 * HuddleQuickPill in the page header — same actions, more presence.
 *
 * States:
 *   - off       → "Join huddle" CTA + count of teammates currently in
 *   - joining   → connecting indicator
 *   - joined    → Mic/Screen toggles + Leave, with live participant count
 *
 * Why we want this on the dashboard:
 *   The huddle is the heart of the agency's day. Burying it behind /workroom
 *   means employees forget to use it. Card on the dashboard = one click to
 *   talk to anyone, every time you open the app.
 */
export function HuddleDashboardCard() {
  const huddle = useHuddle();

  const tone = huddle.joined
    ? 'border-green-500/30 bg-green-500/5'
    : 'border-primary/30 bg-primary/5';

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
          <Headphones className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">
            {huddle.joined
              ? 'You are in the huddle'
              : huddle.joining
                ? 'Connecting…'
                : 'Agency huddle'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Users className="h-3 w-3" />
            {huddle.participantCount > 0
              ? `${huddle.participantCount} ${huddle.participantCount === 1 ? 'person' : 'people'} online`
              : 'Be the first to join'}
            <span className="mx-1">·</span>
            <span>mic + screen, no camera</span>
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!huddle.joined && !huddle.joining && (
            <button
              onClick={huddle.join}
              className="h-9 px-3.5 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm transition-colors"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Join
            </button>
          )}

          {huddle.joined && (
            <>
              <button
                onClick={huddle.toggleAudio}
                className={`h-9 w-9 rounded-lg flex items-center justify-center text-xs font-semibold transition-colors border ${
                  huddle.audioOn
                    ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25'
                    : 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'
                }`}
                title={huddle.audioOn ? 'Mute' : 'Unmute'}
              >
                {huddle.audioOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
              <button
                onClick={huddle.toggleScreen}
                className={`h-9 w-9 rounded-lg flex items-center justify-center text-xs font-semibold transition-colors border ${
                  huddle.screenOn
                    ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/25'
                    : 'bg-card text-muted-foreground border-border hover:bg-muted'
                }`}
                title={huddle.screenOn ? 'Stop sharing' : 'Share screen'}
              >
                {huddle.screenOn ? <MonitorOff className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              </button>
              <HuddleMicPiP />
              <button
                onClick={huddle.leave}
                className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 shadow-sm transition-colors"
                title="Leave the huddle"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                Leave
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default HuddleDashboardCard;
