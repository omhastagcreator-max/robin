import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, ArrowRight, Users as UsersIcon } from 'lucide-react';
import * as api from '@/api';

/**
 * ActiveClientMeetingsCard — small dashboard widget that surfaces every
 * active or scheduled client meeting in the org so any teammate can drop
 * in. Hidden when nothing's running so the dashboard stays clean.
 *
 * Each row:
 *   - "Acme review · Hosted by Om · 2 guests in"
 *   - [Join as host] button → /meet/host/:slug
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

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.clientMeetingsActive();
        setList(Array.isArray(data) ? data : []);
      } finally { setLoading(false); }
    };
    load();
    const i = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(i);
  }, []);

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
            {list.length} active · anyone on the team can drop in
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {list.map(m => (
          <Link
            key={m._id}
            to={`/meet/host/${m.slug}`}
            className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-colors"
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${m.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{m.clientName || 'Untitled meeting'}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                Hosted by {m.hostName}
                {m.guestCount > 0 && (
                  <span> · <UsersIcon className="h-2.5 w-2.5 inline -mt-0.5" /> {m.guestCount} guest{m.guestCount === 1 ? '' : 's'} joined</span>
                )}
              </p>
            </div>
            <span className="text-[10px] font-semibold text-primary flex items-center gap-0.5">
              Join <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default ActiveClientMeetingsCard;
