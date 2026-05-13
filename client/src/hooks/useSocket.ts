import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4002';

// Module-level singleton so every component that calls useSocket() gets
// the SAME connection (single TCP socket, single set of presence updates).
// Keyed by userId so a user-change (logout → login as someone else in the
// same tab) builds a fresh socket with the new identity instead of leaking
// the previous user's name/role/org into the chat sidebar.
let _socket: Socket | null = null;
let _socketUserId: string | null = null;

/**
 * Build (or reuse) the singleton socket for the current user. Exported so
 * other hooks (useWebRTC) can share the same connection instead of opening
 * a second one. Returns null if there is no logged-in user.
 */
export function getSharedSocket(user: {
  id?: string; name?: string; email?: string; role?: string;
} | null | undefined): Socket | null {
  const uid = user?.id;
  if (!uid) return null;

  // User changed (different login in the same tab) → tear down the old
  // socket so the server doesn't keep emitting to the previous identity.
  if (_socket && _socketUserId !== uid) {
    try { _socket.removeAllListeners(); _socket.disconnect(); } catch { /* ignore */ }
    _socket = null;
    _socketUserId = null;
  }

  if (!_socket) {
    // Coerce missing name/role to safe strings — otherwise they serialise
    // as the literal "undefined" in the query string and show up as
    // "undefined Undefined" in the chat sidebar.
    //
    // Reconnect tuning for India / mobile data:
    //   - reconnection: yes, infinitely (don't give up if user is on a train)
    //   - reconnectionDelay 500ms → reconnectionDelayMax 30s with jitter
    //   - timeout 20s before giving up on a single connection attempt
    _socket = io(SOCKET_URL, {
      query: {
        userId:   uid,
        userName: user.name || user.email || 'Unknown',
        userRole: user.role || 'employee',
      },
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection:         true,
      reconnectionAttempts: Infinity,
      reconnectionDelay:    500,
      reconnectionDelayMax: 30_000,
      randomizationFactor:  0.5,
      timeout:              20_000,
    });
    _socketUserId = uid;
  }
  return _socket;
}

/** Tear down the shared socket — call on explicit logout. */
export function disconnectSharedSocket(): void {
  if (_socket) {
    try { _socket.removeAllListeners(); _socket.disconnect(); } catch { /* ignore */ }
  }
  _socket = null;
  _socketUserId = null;
}

export function useSocket(): Socket | null {
  const { user } = useAuth();
  // Trigger a re-render when the socket identity changes so components
  // re-bind their listeners to the right instance.
  const [, force] = useState(0);

  useEffect(() => {
    getSharedSocket(user);
    force(n => n + 1);
  }, [user?.id]);

  return getSharedSocket(user);
}
