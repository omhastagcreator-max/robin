import { useState, useEffect, useCallback, useMemo } from 'react';
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

/**
 * Live session hook. Adds a 1-second ticker while a session is active so the
 * UI can show breaks in real time:
 *
 *   - currentBreakMs  : elapsed time of the in-progress break (0 otherwise)
 *   - totalBreakMs    : cumulative break time today, including the in-progress
 *                       break, in milliseconds
 *
 * The hook also patches local breakEvents on startBreak/endBreak so timers
 * tick correctly without waiting on a refetch round-trip.
 */
export function useSession() {
  const { user } = useAuth();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

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

  // Per-second tick while we have a live session — drives all timer UIs.
  useEffect(() => {
    if (!session || session.status === 'ended') return;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [session?.status, session?._id]);

  const startSession = async () => {
    if (session) return;
    const data = await api.startSession();
    setSession(data);
  };

  const startBreak = async () => {
    if (!session || session.status === 'on_break') return;
    await api.startBreak();
    // Patch local state synchronously so the timer starts immediately rather
    // than waiting for a refetch.
    setSession(prev => {
      if (!prev) return prev;
      const events = [...(prev.breakEvents || []), { startedAt: new Date().toISOString() }];
      return { ...prev, status: 'on_break', breakEvents: events };
    });
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

  // ── Derived live timers ──────────────────────────────────────────────────
  const currentBreakMs = useMemo(() => {
    if (!session || session.status !== 'on_break') return 0;
    const last = session.breakEvents?.[session.breakEvents.length - 1];
    if (!last?.startedAt || last.endedAt) return 0;
    return Math.max(0, now - new Date(last.startedAt).getTime());
  }, [session, now]);

  const totalBreakMs = useMemo(() => {
    if (!session) return 0;
    return (session.breakEvents || []).reduce((sum, b) => {
      if (!b.startedAt) return sum;
      const start = new Date(b.startedAt).getTime();
      const end = b.endedAt
        ? new Date(b.endedAt).getTime()
        : (session.status === 'on_break' ? now : start);
      return sum + Math.max(0, end - start);
    }, 0);
  }, [session, now]);

  const workedMs = useMemo(() => {
    if (!session) return 0;
    const start = new Date(session.startTime).getTime();
    return Math.max(0, now - start);
  }, [session, now]);

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
    // Live timers
    currentBreakMs,
    totalBreakMs,
    workedMs,
  };
}
