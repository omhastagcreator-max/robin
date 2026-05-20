import { Link } from 'react-router-dom';
import { Video, ArrowRight, Headphones } from 'lucide-react';
import { AppLayout }  from '@/components/AppLayout';
import { useAuth }    from '@/contexts/AuthContext';
import { useHuddle }  from '@/contexts/HuddleContext';

/**
 * WorkroomHome v2 — landing page for the 'workroom' role.
 *
 * Two big action tiles: Open Workroom + Join huddle. The role lands here
 * after login and sees nothing else (no tasks, projects, vault, ads).
 *
 * v2 changes: tighter card chrome, no shadow-on-hover noise, hero block
 * uses the same Rani Pink → Saffron gradient as the Login hero so the two
 * landing surfaces feel like one identity.
 */
export default function WorkroomHome() {
  const { user }  = useAuth();
  const huddle    = useHuddle();
  const firstName = (user?.name || user?.email || '').split(' ')[0];

  const joinHuddle = () => {
    try { huddle.join(); }
    catch { window.location.href = '/workroom'; }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Hero — gradient strip matching the Login brand panel */}
        <div
          className="relative overflow-hidden rounded-2xl p-6 sm:p-8 text-white"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
        >
          <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="relative space-y-1">
            <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-white/70">Workroom</p>
            <h1 className="text-[26px] sm:text-[30px] font-black tracking-tight">
              Hi {firstName || 'there'}.
            </h1>
            <p className="text-[13px] text-white/85 max-w-md">
              Your workroom is ready. Hop into the huddle when you're set to start.
            </p>
          </div>
        </div>

        {/* Two action tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            to="/workroom"
            className="group rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-primary/40 transition-all"
          >
            <div className="h-11 w-11 rounded-lg bg-primary/12 text-primary flex items-center justify-center">
              <Video className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-bold">Open Workroom</p>
              <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                See who's around, share your screen, and join group calls.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary group-hover:gap-2 transition-all">
              Enter the room <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          <button
            onClick={joinHuddle}
            className="group rounded-xl border border-border bg-card p-5 flex flex-col gap-3 text-left hover:border-emerald-500/40 transition-all"
          >
            <div className="h-11 w-11 rounded-lg bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
              <Headphones className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-bold">Join the huddle</p>
              <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                Drop into the agency-wide voice channel — mic-only, no camera.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 group-hover:gap-2 transition-all">
              Join now <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          You're on the Workroom-only role. Need access to tasks or other tools? Ask your admin.
        </p>
      </div>
    </AppLayout>
  );
}
