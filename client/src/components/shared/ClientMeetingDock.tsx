import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Mic, MicOff, PhoneOff, ArrowRight } from 'lucide-react';
import { useClientMeeting } from '@/contexts/ClientMeetingContext';

/**
 * ClientMeetingDock — slim sticky strip visible on every page while the
 * host is in a client meeting, EXCEPT when they're already on the meeting
 * page itself (would be redundant). Lets the user mute / unmute / end
 * from anywhere, plus a "Back to meeting" link.
 *
 * Pairs with ClientMeetingProvider — the provider keeps the LiveKit room
 * alive across navigation; this dock makes that fact visible.
 */
export function ClientMeetingDock() {
  const { active, joined, audioOn, meeting, toggleMic, endMeeting } = useClientMeeting();
  const location = useLocation();

  if (!active || !joined) return null;
  // Don't render the dock when the user is already on the meeting page —
  // they have the full controls there.
  if (location.pathname.startsWith('/meet/host/')) return null;

  const returnUrl = meeting?.slug ? `/meet/host/${meeting.slug}` : '/';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -8, opacity: 0 }}
        className="sticky top-0 z-40 bg-primary text-primary-foreground border-b border-primary/20 px-4 py-2 flex items-center gap-3 shadow-sm"
      >
        <span className="h-2 w-2 rounded-full bg-green-300 animate-pulse shrink-0" />
        <Phone className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-semibold truncate flex-1">
          In client meeting{meeting?.clientName ? ` · ${meeting.clientName}` : ''}
        </span>
        <button
          onClick={toggleMic}
          title={audioOn ? 'Mute' : 'Unmute'}
          className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
            audioOn ? 'bg-white/15 hover:bg-white/25' : 'bg-red-500/30 hover:bg-red-500/40'
          }`}
        >
          {audioOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        </button>
        <Link to={returnUrl}
          className="h-7 px-2 rounded-md bg-white/15 hover:bg-white/25 text-[11px] font-semibold flex items-center gap-1">
          Back to meeting <ArrowRight className="h-3 w-3" />
        </Link>
        <button onClick={endMeeting}
          title="End meeting"
          className="h-7 w-7 rounded-md bg-red-500/40 hover:bg-red-500/60 flex items-center justify-center">
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

export default ClientMeetingDock;
