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
      _socket = io(SOCKET_URL, {
        query: { userId: user.id, userName: user.name, userRole: user.role },
        transports: ['websocket', 'polling'],
        withCredentials: true,
      });
    }
    ref.current = _socket;
    return () => {
      // Don't disconnect on component unmount — keep single shared connection
    };
  }, [user?.id]);

  return ref.current;
}
