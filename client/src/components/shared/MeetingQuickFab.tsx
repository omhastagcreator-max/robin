import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Phone, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useClientMeeting } from '@/contexts/ClientMeetingContext';

/**
 * MeetingQuickFab — bottom-right floating button visible on every page for
 * admin/sales. ONE click creates a client meeting and opens the host room.
 *
 * If the user is already in a meeting, the FAB collapses into a small pill
 * that links back to the live meeting room. The ClientMeetingDock already
 * handles the in-meeting mute/end actions across pages — this FAB is the
 * "start a new one" entry point.
 *
 * Hidden on the meeting host page itself (no point of a floating button
 * pointing at the page you're on) and on the public guest meet page.
 */
export function MeetingQuickFab() {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { active, meeting } = useClientMeeting();
  const [busy, setBusy] = useState(false);

  // Only show for internal staff who initiate client meetings.
  if (!user || !['admin', 'sales', 'employee'].includes(role)) return null;
  if (typeof window !== 'undefined') {
    const p = window.location.pathname;
    if (p.startsWith('/meet/host/') || p.startsWith('/meet/')) return null;
  }

  // If already in a meeting → "Back to meeting" pill. The dock already
  // shows mute / end, so this is just a quick-return affordance.
  if (active && meeting?.slug) {
    return (
      <button
        onClick={() => navigate(`/meet/host/${meeting.slug}`)}
        title="Return to your live meeting"
        className="fixed bottom-5 right-5 z-40 h-12 px-4 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 flex items-center gap-2 text-sm font-semibold"
      >
        <span className="h-2 w-2 rounded-full bg-green-300 animate-pulse" />
        <Phone className="h-4 w-4" />
        Back to meeting
      </button>
    );
  }

  const quickStart = async () => {
    setBusy(true);
    try {
      const res = await api.clientMeetingsCreate({ durationMinutes: 120 });
      try { await navigator.clipboard.writeText(res.url); } catch { /* ignore */ }
      toast.success('Meeting ready — link copied. Opening host room…');
      navigate(`/meet/host/${res.slug}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not create meeting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={quickStart}
      disabled={busy}
      title="One-tap client meeting — opens the host room with the link copied"
      className="fixed bottom-5 right-5 z-40 h-14 px-5 rounded-full bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 text-sm font-semibold transition-all hover:scale-105"
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
      <span className="hidden sm:inline">{busy ? 'Creating…' : 'Start meeting'}</span>
    </button>
  );
}

export default MeetingQuickFab;
