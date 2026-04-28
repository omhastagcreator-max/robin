import { useEffect, useState, useMemo } from 'react';
import * as api from '@/api';
import { useSocket } from '@/hooks/useSocket';

export type PresenceStatus = 'active' | 'on_break' | 'off_clock' | 'ended';

export interface TeamMember {
  userId: string;
  name?: string;
  email?: string;
  role?: string;
  team?: string;
  status: PresenceStatus;
}

/**
 * Live "who's clocked in / on break / offline" view across the whole org.
 *
 * Hydrates from /sessions/team-status on mount, then patches the local map
 * in real time as `presence:status` socket events arrive (emitted whenever
 * any teammate clocks in, takes a break, comes back, or ends their day).
 *
 * Used by WorkRoom to show break tags on participant tiles and a banner of
 * "teammates currently on break — please don't ping them".
 */
export function useTeamPresence() {
  const socket = useSocket();
  const [members, setMembers] = useState<Record<string, TeamMember>>({});
  const [loading, setLoading] = useState(true);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    api.getTeamSessionStatus()
      .then((list: TeamMember[]) => {
        if (cancelled) return;
        const map: Record<string, TeamMember> = {};
        for (const m of list) map[m.userId] = m;
        setMembers(map);
      })
      .catch(() => { /* silent — fall back to empty */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Live updates from socket
  useEffect(() => {
    if (!socket) return;
    const handler = ({ userId, name, role, status }: { userId: string; name?: string; role?: string; status: PresenceStatus }) => {
      setMembers(prev => {
        const existing = prev[userId];
        // 'ended' means clocked out → bring it back to off_clock
        const normalised: PresenceStatus = status === 'ended' ? 'off_clock' : status;
        return {
          ...prev,
          [userId]: {
            userId,
            name:  name  || existing?.name,
            role:  role  || existing?.role,
            email: existing?.email,
            team:  existing?.team,
            status: normalised,
          },
        };
      });
    };
    socket.on('presence:status', handler);
    return () => { socket.off('presence:status', handler); };
  }, [socket]);

  const list   = useMemo(() => Object.values(members), [members]);
  const onBreak = useMemo(() => list.filter(m => m.status === 'on_break'), [list]);
  const active  = useMemo(() => list.filter(m => m.status === 'active'),   [list]);
  const off     = useMemo(() => list.filter(m => m.status === 'off_clock'),[list]);

  const statusOf = (userId: string): PresenceStatus =>
    members[userId]?.status || 'off_clock';

  return { loading, members, list, onBreak, active, off, statusOf };
}
