import { Mic, MicOff, Sparkles, Loader2, Volume2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useJarvisMode } from '@/hooks/useJarvisMode';

/**
 * RobinOrb — floating bottom-right orb that turns Robin into a Jarvis-
 * style hands-free assistant. Click once to enable continuous listening;
 * say "Hey Robin <whatever>" and Robin runs the command + speaks back.
 *
 * Visual states:
 *   - off / idle  → muted icon (MicOff)
 *   - listening   → soft green pulse (background listening)
 *   - armed       → big primary glow + bigger pulse (heard the wake word)
 *   - thinking    → spinning loader
 *   - speaking    → volume icon + slower pulse
 *
 * Mounted once at the AppLayout level. Client role doesn't see it (no
 * Copilot access). Firefox + browsers without SpeechRecognition see a
 * disabled state with a tooltip explaining why.
 */
export function RobinOrb() {
  const { role } = useAuth();
  const j = useJarvisMode();

  // Hidden for external clients.
  if (role === 'client') return null;

  // ── Visual config per state ───────────────────────────────────────
  const cfg = !j.enabled
    ? { icon: MicOff,   bg: 'bg-card border-2 border-border', ring: '', label: 'Off — click to enable hands-free' }
    : j.state === 'thinking'
      ? { icon: Loader2,  bg: 'bg-primary text-primary-foreground', ring: 'ring-4 ring-primary/20', label: 'Sochna ho raha hai…' }
      : j.state === 'speaking'
        ? { icon: Volume2, bg: 'bg-primary text-primary-foreground', ring: 'ring-4 ring-primary/30 animate-pulse', label: 'Robin bol raha hai…' }
        : j.state === 'armed'
          ? { icon: Sparkles, bg: 'bg-rose-500 text-white', ring: 'ring-4 ring-rose-500/40 animate-pulse', label: 'Sun raha hoon — bol!' }
          : { icon: Mic,    bg: 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/40', ring: '', label: 'Ready — say "Hey Robin"' };
  const Icon = cfg.icon;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 pointer-events-none">
      {/* Live transcript bubble — only while armed / thinking / speaking */}
      {j.enabled && (j.state === 'armed' || j.state === 'thinking' || j.state === 'speaking') && (
        <div className="pointer-events-auto max-w-xs rounded-2xl bg-card border border-border shadow-lg px-3 py-2 text-[12px] leading-snug">
          {j.state === 'speaking' && j.lastReply ? (
            <p className="text-foreground">{j.lastReply}</p>
          ) : j.state === 'thinking' ? (
            <p className="text-muted-foreground italic">Robin soch raha hai…</p>
          ) : (
            <p className="text-muted-foreground">{j.transcript || 'Sun raha hoon…'}</p>
          )}
        </div>
      )}

      <button
        onClick={j.toggle}
        disabled={!j.supported}
        title={j.supported ? cfg.label : 'Voice not supported in this browser. Try Chrome or Edge.'}
        className={`pointer-events-auto h-14 w-14 rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed ${cfg.bg} ${cfg.ring}`}
        aria-label={cfg.label}
      >
        <Icon className={`h-6 w-6 ${j.state === 'thinking' ? 'animate-spin' : ''}`} />
      </button>

      {/* Error chip — only when there's an actual error worth showing. */}
      {j.error && j.error !== 'no-speech' && j.error !== 'aborted' && (
        <p className="pointer-events-auto max-w-[200px] text-[10.5px] text-rose-600 bg-rose-500/10 border border-rose-500/30 rounded-md px-2 py-1">
          Voice: {j.error}
        </p>
      )}
    </div>
  );
}

export default RobinOrb;
