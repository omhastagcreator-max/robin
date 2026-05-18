import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Video, ArrowRight, Headphones } from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';

/**
 * WorkroomHome — landing page for the 'workroom' role.
 *
 * This is the dead-simple dashboard for staff who ONLY use the agency
 * huddle (e.g. floor support, on-call agents, junior teammates who don't
 * own tasks). They land here on login and see two big actions:
 *
 *   1. Open Workroom   — full presence + screen-share grid
 *   2. Join huddle     — one tap into the agency audio room
 *
 * They never see tasks, projects, clients, leaves, ads, vault, etc. The
 * sidebar (AppLayout) is also reduced to just these two entries for them.
 */
export default function WorkroomHome() {
  const { user } = useAuth();
  const huddle = useHuddle();

  const joinHuddle = () => {
    // HuddleContext.join() opens the agency huddle (mic-only) and parks
    // a floating dock on screen. If join throws (rare — usually env not
    // configured), fall through to /workroom where the full controls live.
    try { huddle.join(); }
    catch { window.location.href = '/workroom'; }
  };

  const firstName = (user?.name || user?.email || '').split(' ')[0];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-2xl font-bold">Hi {firstName || 'there'} 👋</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your workroom is ready. Hop into the huddle when you're set to start.
          </p>
        </div>

        {/* Two big action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Open Workroom */}
          <Link to="/workroom"
            className="group rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all p-5 flex flex-col gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Video className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold">Open Workroom</p>
              <p className="text-xs text-muted-foreground mt-1">
                See who's around, share your screen, and join group calls.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-2 transition-all">
              Enter the room <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          {/* Join huddle */}
          <button onClick={joinHuddle}
            className="group rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all p-5 flex flex-col gap-3 text-left">
            <div className="h-12 w-12 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
              <Headphones className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold">Join the huddle</p>
              <p className="text-xs text-muted-foreground mt-1">
                Drop into the agency-wide voice channel — mic-only, no camera.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:gap-2 transition-all">
              Join now <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>

        {/* Quiet footer — reminds them this is their only home, no clutter */}
        <p className="text-[11px] text-muted-foreground text-center pt-2">
          You're on the Workroom-only role. Need access to tasks or other tools? Ask your admin.
        </p>
      </div>
    </AppLayout>
  );
}
