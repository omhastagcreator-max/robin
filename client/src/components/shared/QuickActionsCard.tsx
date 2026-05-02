import { useNavigate } from 'react-router-dom';
import {
  PhoneCall, Coffee, Play, ListTodo, KeyRound, CalendarOff,
  MessageSquare, Headphones, Zap, StopCircle,
} from 'lucide-react';
import { useHuddle } from '@/contexts/HuddleContext';
import { useSession } from '@/hooks/useSession';
import { toast } from 'sonner';

/**
 * Single-card "start your day in one place" panel for the dashboard.
 *
 * Surfaces every action a user reaches for first thing — clock in / out,
 * take or end a break, jump into the huddle, hop to tasks / vault / chat /
 * leave — so they don't have to navigate. Each tile is a single click.
 */
export function QuickActionsCard() {
  const navigate = useNavigate();
  const huddle = useHuddle();
  const { session, startSession, startBreak, endBreak, endSession } = useSession();

  const isClocked = !!session;
  const isOnBreak = session?.status === 'on_break';

  const tile = (
    icon: any, label: string, sub: string, onClick: () => void, tone: string,
  ) => (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-start gap-1 p-3 rounded-xl border transition-all hover:scale-[1.02] active:scale-[0.99] text-left ${tone}`}
    >
      <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-white/30 backdrop-blur-sm">
        {icon}
      </div>
      <p className="text-sm font-semibold leading-tight">{label}</p>
      <p className="text-[10px] opacity-80 leading-tight">{sub}</p>
    </button>
  );

  const Icon = (C: any, cn = 'h-4 w-4') => <C className={cn} />;

  // Primary tile changes based on session state — single most useful action
  const primaryTile = !isClocked
    ? tile(
        Icon(Play, 'h-4 w-4 text-white'),
        'Start day',
        'Clock in to begin',
        async () => {
          try { await startSession(); toast.success('You are clocked in'); }
          catch { toast.error('Could not start your day'); }
        },
        'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-primary/40 shadow-md',
      )
    : isOnBreak
      ? tile(
          Icon(Play, 'h-4 w-4 text-white'),
          'Resume work',
          'End your break',
          async () => {
            try { await endBreak(); toast.success('Welcome back'); }
            catch { toast.error('Could not resume'); }
          },
          'bg-gradient-to-br from-green-500 to-green-600 text-white border-green-500/40 shadow-md',
        )
      : tile(
          Icon(Coffee, 'h-4 w-4 text-amber-700 dark:text-amber-300'),
          'Take a break',
          'Pause your shift',
          async () => {
            try { await startBreak(); toast.success('Break started'); }
            catch { toast.error('Could not start break'); }
          },
          'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
        );

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Quick actions</h2>
        <span className="ml-auto text-[10px] text-muted-foreground">everything to start your day</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {primaryTile}

        {tile(
          Icon(PhoneCall, 'h-4 w-4 text-primary'),
          huddle.mode === 'idle' ? 'Join huddle' : huddle.mode === 'collapsed' ? 'Show huddle' : 'In huddle',
          huddle.mode === 'idle' ? 'Mic + screen share' : `${huddle.participantCount} live`,
          () => {
            if (huddle.mode === 'idle') huddle.join();
            else if (huddle.mode === 'collapsed') huddle.expand();
            else navigate('/workroom');
          },
          huddle.mode !== 'idle'
            ? 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30'
            : 'bg-primary/10 text-primary border-primary/20',
        )}

        {tile(
          Icon(ListTodo, 'h-4 w-4 text-blue-600 dark:text-blue-400'),
          'My tasks',
          'See & assign',
          () => navigate('/tasks'),
          'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
        )}

        {tile(
          Icon(KeyRound, 'h-4 w-4 text-violet-600 dark:text-violet-400'),
          'Client vault',
          'Logins & links',
          () => navigate('/vault'),
          'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
        )}

        {tile(
          Icon(CalendarOff, 'h-4 w-4 text-purple-600 dark:text-purple-400'),
          'Apply leave',
          'Pick days off',
          () => navigate('/leaves'),
          'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
        )}

        {tile(
          Icon(MessageSquare, 'h-4 w-4 text-pink-600 dark:text-pink-400'),
          'Group chat',
          'Team updates',
          () => navigate('/chat'),
          'bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20',
        )}
      </div>

      {isClocked && (
        <button
          onClick={async () => {
            if (!confirm('End your day? You can clock back in later.')) return;
            try { await endSession(); toast.success('Have a good evening'); }
            catch { toast.error('Could not end your day'); }
          }}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-red-500 py-1.5 rounded-lg hover:bg-red-500/5 transition-colors"
        >
          <StopCircle className="h-3 w-3" /> End day
        </button>
      )}
    </div>
  );
}

export default QuickActionsCard;
