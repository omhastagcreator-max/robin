import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Sunset, Briefcase, Coffee, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * WorkingDespiteLeaveDialog
 *
 * Mounted by SessionTopBar when the user clicks "Log in" but has an
 * approved leave for today. Asks them what they're actually doing so the
 * leave record matches reality. Four options:
 *
 *   1. Working full day  → cancel today's leave + start session
 *   2. Working morning   → leave becomes "afternoon off" + start session
 *   3. Working afternoon → leave becomes "morning off"   + start session
 *   4. Just checking in  → don't change leave, start session anyway
 *      (e.g. quick reply to a message during personal day)
 *
 * Why this exists: people forget to update Robin when their plans change.
 * A quick prompt at clock-in saves admin from chasing them later for
 * accurate attendance.
 */

interface Props {
  reason?: string;                                 // shown for context
  onChose: (workingType: 'full' | 'first_half' | 'second_half' | 'still_off') => Promise<void>;
  onClose: () => void;
}

export function WorkingDespiteLeaveDialog({ reason, onChose, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (kind: 'full' | 'first_half' | 'second_half' | 'still_off') => {
    setBusy(kind);
    try {
      if (kind !== 'still_off') {
        await api.setWorkingDespiteLeave(kind);
      }
      await onChose(kind);
      if (kind === 'full')        toast.success('Leave cancelled — clocked in for the full day');
      if (kind === 'first_half')  toast.success('Half-day applied — you\'re off this afternoon');
      if (kind === 'second_half') toast.success('Half-day applied — you\'re off this morning');
      if (kind === 'still_off')   toast('Logged in briefly — you\'re still on leave today');
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not update leave');
      setBusy(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-amber-600">You're on leave today</p>
          <h3 className="text-lg font-bold mt-1">Are you actually working?</h3>
          {reason && <p className="text-xs text-muted-foreground mt-1">Your leave reason: <span className="italic">"{reason}"</span></p>}
          <p className="text-xs text-muted-foreground mt-2">
            Pick what's true so your time + leave records stay accurate. Admin doesn't need to chase you later.
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => pick('full')}
            disabled={!!busy}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-background hover:bg-primary/10 hover:border-primary/40 text-left disabled:opacity-50 transition-colors"
          >
            <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              {busy === 'full' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Briefcase className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Working a full day</p>
              <p className="text-[11px] text-muted-foreground">Cancel today's leave and clock in normally</p>
            </div>
          </button>

          <button
            onClick={() => pick('first_half')}
            disabled={!!busy}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-background hover:bg-amber-500/10 hover:border-amber-500/40 text-left disabled:opacity-50 transition-colors"
          >
            <div className="h-9 w-9 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
              {busy === 'first_half' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sun className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Working morning, off afternoon</p>
              <p className="text-[11px] text-muted-foreground">Convert leave to half-day (afternoon off)</p>
            </div>
          </button>

          <button
            onClick={() => pick('second_half')}
            disabled={!!busy}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-background hover:bg-purple-500/10 hover:border-purple-500/40 text-left disabled:opacity-50 transition-colors"
          >
            <div className="h-9 w-9 rounded-lg bg-purple-500/15 text-purple-600 flex items-center justify-center shrink-0">
              {busy === 'second_half' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sunset className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Off morning, working afternoon</p>
              <p className="text-[11px] text-muted-foreground">Convert leave to half-day (morning off)</p>
            </div>
          </button>

          <button
            onClick={() => pick('still_off')}
            disabled={!!busy}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-border bg-muted/20 hover:bg-muted/40 text-left disabled:opacity-50 transition-colors"
          >
            <div className="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
              {busy === 'still_off' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coffee className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Just checking in</p>
              <p className="text-[11px] text-muted-foreground">Log in briefly but stay on leave</p>
            </div>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default WorkingDespiteLeaveDialog;
