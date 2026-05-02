import { Coffee, Play, StopCircle, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/hooks/useSession';
import { toast } from 'sonner';

const SINGLE_BREAK_WARN_MS = 30 * 60 * 1000;
const TOTAL_BREAK_WARN_MS  = 60 * 60 * 1000;

/**
 * Full-screen "freeze" overlay shown while the user is on break.
 *
 * Disables interaction with the underlying app and surfaces a big
 * live timer + Resume / End-day controls. Keeps the user honest
 * about break length — once they cross the soft limit, the timer
 * goes red.
 */
export function BreakOverlay() {
  const { session, currentBreakMs, totalBreakMs, endBreak, endSession } = useSession();
  const onBreak = session?.status === 'on_break';

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const fmtTotal = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const overLimit = currentBreakMs > SINGLE_BREAK_WARN_MS || totalBreakMs > TOTAL_BREAK_WARN_MS;

  const handleResume = async () => {
    try { await endBreak(); toast.success('Welcome back'); }
    catch { toast.error('Could not resume'); }
  };
  const handleEndDay = async () => {
    if (!confirm('End your day now? You can clock back in tomorrow.')) return;
    try { await endSession(); toast.success('Have a good evening'); }
    catch { toast.error('Could not end your day'); }
  };

  return (
    <AnimatePresence>
      {onBreak && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          // Top-most overlay, blocks all interaction with the app underneath.
          className="fixed inset-0 z-[80] backdrop-blur-md bg-black/60 flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22 }}
            className={`w-full max-w-md rounded-3xl border-2 ${
              overLimit
                ? 'border-red-500/60 bg-gradient-to-br from-red-500/10 via-card to-red-500/5'
                : 'border-amber-500/60 bg-gradient-to-br from-amber-500/10 via-card to-amber-500/5'
            } p-8 shadow-2xl text-center`}
          >
            {/* Icon */}
            <div className={`mx-auto h-16 w-16 rounded-2xl flex items-center justify-center mb-4 ${
              overLimit ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'
            }`}>
              <Coffee className="h-8 w-8" />
            </div>

            {/* Heading */}
            <p className={`text-xs uppercase tracking-widest font-bold mb-1 ${
              overLimit ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'
            }`}>
              You're on a break
            </p>
            <h1 className="text-2xl font-bold mb-1">Take a breath</h1>
            <p className="text-xs text-muted-foreground mb-6">
              Click resume when you're ready to get back to it.
            </p>

            {/* Big live timer */}
            <div className="my-6">
              <p className={`text-7xl font-black tabular-nums tracking-tight leading-none ${
                overLimit ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'
              }`}>
                {fmt(currentBreakMs)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-2">
                today total: <span className="font-mono font-semibold">{fmtTotal(totalBreakMs)}</span>
              </p>
            </div>

            {/* Soft-limit warning */}
            {overLimit && (
              <div className="mb-4 mx-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/15 text-red-500 text-[11px] font-semibold">
                <AlertTriangle className="h-3 w-3" />
                Long break — wrap up soon to keep your hours on track
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleResume}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-colors shadow-lg shadow-green-500/20"
              >
                <Play className="h-4 w-4" /> Resume work
              </button>
              <button
                onClick={handleEndDay}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <StopCircle className="h-3.5 w-3.5" /> End day instead
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default BreakOverlay;
