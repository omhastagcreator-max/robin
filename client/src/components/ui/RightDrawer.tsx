import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

/**
 * Robin v2 RightDrawer — the contextual side panel that replaces page
 * navigation for detail views.
 *
 * Click a lead row → drawer slides in with lead details. Click a project
 * row → drawer slides in with the workflow detail. Hitting Esc or clicking
 * the backdrop dismisses. Drawer state is GLOBAL (provider mounted once at
 * the app root) so any component can open the drawer without prop-drilling.
 *
 * Width: 360px standard · 480px wide · 640px x-large.
 *
 * Usage:
 *   const drawer = useDrawer();
 *   drawer.open({
 *     title: 'Lead — Aman Mehta',
 *     content: <LeadDetailPanel id={lead._id} />,
 *     width: 'lg',
 *   });
 */

type Width = 'sm' | 'md' | 'lg' | 'xl';

interface DrawerSpec {
  title?: string;
  subtitle?: string;
  content: ReactNode;
  width?: Width;
  /** Sticky bottom action bar. */
  footer?: ReactNode;
  /** Callback when the drawer closes for any reason. */
  onClose?: () => void;
}

interface DrawerApi {
  open: (spec: DrawerSpec) => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<DrawerApi>({ open: () => {}, close: () => {}, isOpen: false });

const widthMap: Record<Width, string> = {
  sm: 'w-[320px]',
  md: 'w-[420px]',
  lg: 'w-[560px]',
  xl: 'w-[720px]',
};

export function RightDrawerProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<DrawerSpec | null>(null);
  // Keep the spec mounted during exit animation — avoids content flash.
  const exitingSpec = useRef<DrawerSpec | null>(null);
  const visible = !!spec;

  const open = useCallback((s: DrawerSpec) => {
    setSpec(s);
  }, []);

  const close = useCallback(() => {
    if (spec?.onClose) try { spec.onClose(); } catch { /* swallow */ }
    exitingSpec.current = spec;
    setSpec(null);
  }, [spec]);

  // Esc to close.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, close]);

  // Whichever spec is "live" — current OR exiting.
  const renderSpec = spec || exitingSpec.current;
  const width = renderSpec?.width || 'md';

  return (
    <Ctx.Provider value={{ open, close, isOpen: visible }}>
      {children}
      <AnimatePresence>
        {visible && (
          <>
            {/* Backdrop — light, dismissable */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onClick={close}
              className="fixed inset-0 z-[90] bg-black/30 backdrop-blur-[1px]"
            />
            {/* Panel — slides from right */}
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`fixed right-0 top-0 h-screen z-[91] bg-card border-l border-border shadow-[var(--shadow-4)] flex flex-col ${widthMap[width]} max-w-[100vw]`}
            >
              {/* Header */}
              <div className="h-11 px-4 border-b border-border flex items-center gap-3 shrink-0">
                <div className="flex-1 min-w-0 leading-tight">
                  {renderSpec?.title && (
                    <p className="text-[13px] font-bold truncate">{renderSpec.title}</p>
                  )}
                  {renderSpec?.subtitle && (
                    <p className="text-[10.5px] text-muted-foreground truncate">{renderSpec.subtitle}</p>
                  )}
                </div>
                <IconButton onClick={close} size="sm" title="Close (Esc)">
                  <X />
                </IconButton>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto">
                {renderSpec?.content}
              </div>

              {/* Optional footer */}
              {renderSpec?.footer && (
                <div className="border-t border-border bg-muted/30 px-4 py-2 shrink-0">
                  {renderSpec.footer}
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

export function useDrawer(): DrawerApi {
  return useContext(Ctx);
}
