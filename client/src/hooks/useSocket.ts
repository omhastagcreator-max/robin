import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';

let _socket: Socket | null = null;

export function useSocket(): Socket | null {
  const { user } = useAuth();
  const ref = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    if (!_socket || !_socket.connected) {
      const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4002';
      // Coerce missing name/role to safe strings — otherwise they get serialised
      // as the literal "undefined" in the query string and show up as
      // "undefined Undefined" in the chat sidebar.
      //
      // Reconnect tuning for India / mobile data:
      //   - reconnection: yes, infinitely (don't give up if user is on a train)
      //   - reconnectionDelay 500ms → reconnectionDelayMax 30s with random jitter
      //   - timeout 20s before giving up on a single connection attempt
      // The exponential backoff keeps us from hammering the server during an
      // outage while still recovering quickly once the network returns.
      _socket = io(SOCKET_URL, {
        query: {
          userId:   user.id,
          userName: user.name || user.email || 'Unknown',
          userRole: user.role || 'employee',
        },
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection:           true,
        reconnectionAttempts:   Infinity,
        reconnectionDelay:      500,
        reconnectionDelayMax:   30_000,
        randomizationFactor:    0.5,
        timeout:                20_000,
      });
    }
    ref.current = _socket;
    return () => {
      // Don't disconnect on component unmount — keep single shared connection
    };
  }, [user?.id]);

  return ref.current;
}
