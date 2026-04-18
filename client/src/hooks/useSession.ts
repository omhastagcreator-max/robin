import { useState, useEffect, useCallback } from 'react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

export interface SessionData {
  _id: string;
  userId: string;
  startTime: string;
  endTime?: string;
  breakTime: number;
  status: 'active' | 'on_break' | 'ended';
  breakEvents: { startedAt: string; endedAt?: string }[];
  createdAt: string;
}

export function useSession() {
  const { user } = useAuth();
  const [activeSession, setActiveSession] = useState<SessionData | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [breakStart, setBreakStart] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActiveSession = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getActiveSession();
      setActiveSession(data);
      setIsOnBreak(data?.status === 'on_break');
    } catch {
      setActiveSession(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchActiveSession(); }, [fetchActiveSession]);

  const startWork = async () => {
    if (activeSession) return;
    const data = await api.startSession();
    setActiveSession(data);
  };

  const startBreak = async () => {
    if (!activeSession || isOnBreak) return;
    await api.startBreak();
    setIsOnBreak(true);
    setBreakStart(new Date());
  };

  const endBreak = async () => {
    if (!isOnBreak) return;
    const updated = await api.endBreak();
    setActiveSession(updated);
    setIsOnBreak(false);
    setBreakStart(null);
  };

  const endWork = async () => {
    if (!activeSession) return;
    if (isOnBreak) await endBreak();
    await api.endSession();
    setActiveSession(null);
    setIsOnBreak(false);
  };

  return { activeSession, isOnBreak, breakStart, loading, startWork, startBreak, endBreak, endWork, refreshSession: fetchActiveSession };
}
