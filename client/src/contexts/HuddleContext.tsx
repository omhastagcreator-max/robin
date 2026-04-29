import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

type HuddleMode = 'idle' | 'joining' | 'expanded' | 'collapsed';

interface HuddleApi {
  mode: HuddleMode;
  participantCount: number;
  /** Open + join the huddle in one click. */
  join: () => void;
  /** Leave entirely (closes Jitsi). */
  leave: () => void;
  /** Hide the panel but keep the call alive. */
  collapse: () => void;
  /** Show the panel again. */
  expand: () => void;
  setParticipantCount: (n: number) => void;
  /** Internal — HuddleDock flips to 'expanded' once Jitsi reports ready. */
  markJoined: () => void;
}

const HuddleContext = createContext<HuddleApi | null>(null);

/**
 * Global huddle state. Lives at the top of the React tree so the actual
 * Jitsi iframe (rendered in <HuddleDock/>) survives every page navigation.
 */
export function HuddleProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<HuddleMode>('idle');
  const [participantCount, setParticipantCount] = useState(0);

  const join     = useCallback(() => setMode(m => (m === 'idle' ? 'joining' : m)), []);
  const leave    = useCallback(() => { setMode('idle'); setParticipantCount(0); }, []);
  const collapse = useCallback(() => setMode(m => (m === 'expanded' ? 'collapsed' : m)), []);
  const expand   = useCallback(() => setMode(m => (m === 'collapsed' || m === 'joining' ? 'expanded' : m)), []);
  const markJoined = useCallback(() => setMode(m => (m === 'joining' ? 'expanded' : m)), []);

  const value = useMemo<HuddleApi>(() => ({
    mode, participantCount, join, leave, collapse, expand, setParticipantCount, markJoined,
  }), [mode, participantCount, join, leave, collapse, expand, markJoined]);

  return <HuddleContext.Provider value={value}>{children}</HuddleContext.Provider>;
}

export function useHuddle(): HuddleApi {
  const ctx = useContext(HuddleContext);
  if (!ctx) throw new Error('useHuddle must be used inside HuddleProvider');
  return ctx;
}
