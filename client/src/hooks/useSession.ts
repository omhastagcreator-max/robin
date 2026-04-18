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
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActiveSession = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getActiveSession();
      setSession(data || null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchActiveSession(); }, [fetchActiveSession]);

  const startSession = async () => {
    if (session) return;
    const data = await api.startSession();
    setSession(data);
  };

  const startBreak = async () => {
    if (!session || session.status === 'on_break') return;
    await api.startBreak();
    setSession(prev => prev ? { ...prev, status: 'on_break' } : null);
  };

  const endBreak = async () => {
    if (!session || session.status !== 'on_break') return;
    const updated = await api.endBreak();
    setSession(updated);
  };

  const endSession = async () => {
    if (!session) return;
    if (session.status === 'on_break') await endBreak();
    await api.endSession();
    setSession(null);
  };

  return {
    session,
    loading,
    startSession,
    startBreak,
    endBreak,
    endSession,
    refreshSession: fetchActiveSession,
    // Convenience getters
    isActive:  session?.status === 'active',
    isOnBreak: session?.status === 'on_break',
  };
}
