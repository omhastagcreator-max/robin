import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from './Button';

/**
 * Robin v2 modal shell.
 *
 * Replaces the bespoke modal chrome scattered across CommentRequiredModal,
 * CreateWorkflowModal, etc. Same animation tokens, same Esc-to-close
 * behavior, same focus-trap-friendly structure.
 *
 * Slot anatomy:
 *   <Modal open={...} onClose={...}>
 *     <Modal.Header title="Mark service done" />
 *     <Modal.Body>...content...</Modal.Body>
 *     <Modal.Footer>
 *       <Modal.Cancel onClose={...} />
 *       <Button intent="success">Save</Button>
 *     </Modal.Footer>
 *   </Modal>
 *
 * Sizes: sm (380px) · md (520px — default) · lg (720px)
 */

type Size = 'sm' | 'md' | 'lg';

interface Props {
  open: boolean;
  onClose: () => void;
  size?: Size;
  /** Don't close on backdrop click. Use for "are you sure?" modals. */
  preventBackdropClose?: boolean;
  children: ReactNode;
}

const widthMap: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ open, onClose, size = 'md', preventBackdropClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => !preventBackdropClose && onClose()}
          className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{    opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className={`w-full ${widthMap[size]} bg-card border border-border rounded-xl shadow-[var(--shadow-4)] overflow-hidden`}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

Modal.Header = function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose?: () => void }) {
  return (
    <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[14px] font-bold truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {onClose && (
        <button onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors -mt-0.5">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

Modal.Body = function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 space-y-3 ${className}`}>{children}</div>;
};

Modal.Footer = function ModalFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-muted/30 ${className}`}>
      {children}
    </div>
  );
};

Modal.Cancel = function ModalCancel({ onClose, label = 'Cancel' }: { onClose: () => void; label?: string }) {
  return <Button intent="ghost" size="sm" onClick={onClose}>{label}</Button>;
};
