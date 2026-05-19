import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Loader2 } from 'lucide-react';

/**
 * CommentRequiredModal — replaces the janky `window.prompt()` we were
 * using everywhere to capture the mandatory audit-log comment on
 * pipeline actions (tick / untick / mark service done).
 *
 * Usage:
 *   const [modal, setModal] = useState<...>(null);
 *   setModal({
 *     title: 'Mark "Shopify store" done?',
 *     placeholder: 'What was completed?',
 *     primaryLabel: 'Mark done',
 *     onSubmit: async (comment) => { await api.cwCompleteService(...); },
 *   });
 *   {modal && <CommentRequiredModal {...modal} onClose={() => setModal(null)} />}
 *
 * Enforces:
 *  - 3+ char minimum (matches server validation)
 *  - 600 char max
 *  - Esc to cancel, Cmd-Enter / Ctrl-Enter to submit
 *  - Autofocus the textarea
 *  - Loading state on submit; button disabled while submitting
 */
export interface CommentRequiredModalProps {
  title: string;
  description?: string;
  placeholder?: string;
  primaryLabel?: string;
  tone?: 'primary' | 'success' | 'danger';
  onSubmit: (comment: string) => Promise<void> | void;
  onClose: () => void;
}

export function CommentRequiredModal({
  title,
  description,
  placeholder = 'Add a short note for the audit log (visible to admin)…',
  primaryLabel = 'Save',
  tone = 'primary',
  onSubmit,
  onClose,
}: CommentRequiredModalProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  // Esc to cancel — but only if we aren't already submitting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const trimmed = comment.trim();
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 600 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // Caller's responsibility to surface errors via toast — we just
      // un-spin and let the user retry.
    } finally {
      setSubmitting(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd-Enter / Ctrl-Enter shortcut to submit.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const toneClasses =
    tone === 'success' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' :
    tone === 'danger'  ? 'bg-rose-600 hover:bg-rose-700 text-white' :
                         'bg-primary hover:bg-primary/90 text-primary-foreground';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm font-semibold truncate">{title}</p>
            </div>
            <button onClick={onClose} disabled={submitting} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5 space-y-3">
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            )}
            <textarea
              ref={taRef}
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={handleKey}
              maxLength={600}
              placeholder={placeholder}
              rows={4}
              className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{trimmed.length < 3 ? `${3 - trimmed.length} more character${3 - trimmed.length === 1 ? '' : 's'} needed` : 'Looks good'}</span>
              <span className="tabular-nums">{comment.length} / 600</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={submitting}
                className="px-3 h-9 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={!canSubmit}
                className={`px-4 h-9 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 transition-colors ${toneClasses}`}>
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? 'Saving…' : primaryLabel}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
