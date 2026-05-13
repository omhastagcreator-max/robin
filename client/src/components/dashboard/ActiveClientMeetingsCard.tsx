import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, ArrowRight, Users as UsersIcon, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * ActiveClientMeetingsCard — small dashboard widget that surfaces every
 * active or scheduled client meeting in the org so any teammate can drop
 * in. Hidden when nothing's running so the dashboard stays clean.
 *
 * Each row:
 *   - "Acme review · Hosted by Om · 2 guests in"
 *   - [Join] navigates to /meet/host/:slug
 *   - [End]  closes the meeting (server allows any teammate in the same org —
 *           useful for cleaning up zombie/forgotten meetings)
 */

interface ActiveMeeting {
  _id: string;
  slug: string;
  clientName?: string;
  hostName: string;
  status: 'scheduled' | 'active';
  guestCount: number;
}

export function ActiveClientMeetingsCard() {
  const [list, setList] = useState<ActiveMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [endingSlug, setEndingSlug] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.clientMeetingsActive();
      setList(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    // Visible-only — pause when tab is hidden.
    const i = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load();
    }, 30_000); // refresh every 30s while visible
    return () => clearInterval(i);
  }, []);

  const handleEnd = async (e: React.MouseEvent, slug: string, clientName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const label = clientName || 'this meeting';
    if (!confirm(`End ${label}? Anyone still on the link will be disconnected.`)) return;
    setEndingSlug(slug);
    try {
      await api.clientMeetingsEnd(slug);
      toast.success('Meeting ended');
      // Optimistic — drop the row immediately, then re-fetch to be sure
      setList(prev => prev.filter(m => m.slug !== slug));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not end meeting');
    } finally {
      setEndingSlug(null);
    }
  };

  if (loading) return null;
  if (list.length === 0) return null;

  return (
    <div className="rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500/10 via-green-500/5 to-transparent p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-green-500/15 flex items-center justify-center">
          <Phone className="h-4 w-4 text-green-600" />
        </div>
        <div>
          <p className="text-[10px] uppercase font-semibold tracking-wide text-green-700">Live client meetings</p>
          <p className="text-[11px] text-muted-foreground">
            {list.length} active · anyone on the team can drop in or end
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {list.map(m => {
          const ending = endingSlug === m.slug;
          return (
            <div
              key={m._id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-colors"
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${m.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
              <Link
                to={`/meet/host/${m.slug}`}
                className="flex-1 min-w-0 group"
                title="Join as host"
              >
                <p className="text-xs font-semibold truncate group-hover:text-primary">{m.clientName || 'Untitled meeting'}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  Hosted by {m.hostName}
                  {m.guestCount > 0 && (
                    <span> · <UsersIcon className="h-2.5 w-2.5 inline -mt-0.5" /> {m.guestCount} guest{m.guestCount === 1 ? '' : 's'} joined</span>
                  )}
                </p>
              </Link>

              {/* Join — primary action */}
              <Link
                to={`/meet/host/${m.slug}`}
                className="shrink-0 h-7 px-2 flex items-center gap-0.5 rounded-md text-[10px] font-semibold text-primary hover:bg-primary/10"
              >
                Join <ArrowRight className="h-3 w-3" />
              </Link>

              {/* End — destructive secondary action */}
              <button
                onClick={(e) => handleEnd(e, m.slug, m.clientName)}
                disabled={ending}
                title="End meeting (everyone on the call will be disconnected)"
                className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                {ending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ActiveClientMeetingsCard;
