import { createContext, useContext, ReactNode } from 'react';
import { useWebRTCSender } from '@/hooks/useWebRTC';
import { useAuth } from '@/contexts/AuthContext';

interface ScreenShareContextValue {
  isSharing: boolean;
  startSharing: () => Promise<void>;
  stopSharing: () => Promise<void>;
}

const ScreenShareContext = createContext<ScreenShareContextValue | null>(null);

export function ScreenShareProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // We invoke the sender hook globally so the stream and socket persist across routing
  const { isSharing, startSharing, stopSharing } = useWebRTCSender(user?.id || '');

  return (
    <ScreenShareContext.Provider value={{ isSharing, startSharing, stopSharing }}>
      {children}
    </ScreenShareContext.Provider>
  );
}

export function useScreenShare() {
  const ctx = useContext(ScreenShareContext);
  if (!ctx) throw new Error('useScreenShare must be used within ScreenShareProvider');
  return ctx;
}
