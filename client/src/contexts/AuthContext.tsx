import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as api from '@/api';

interface RobinUser {
  id: string;
  email: string;
  name: string;
  role: string;
  team?: string;
  avatarUrl?: string;
  organizationId?: string;
  onCallSince?: string | null;
}

interface AuthContextValue {
  user: RobinUser | null;
  role: string;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  loginWithToken: (token: string, u: any) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'robin_token';
const USER_KEY  = 'robin_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<RobinUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  // On mount, verify token is still valid
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLoading(false); return; }

    api.getMe()
      .then(({ user: u }) => {
        const mapped: RobinUser = { id: u._id, email: u.email, name: u.name, role: u.role, team: u.team, avatarUrl: u.avatarUrl, organizationId: u.organizationId };
        setUser(mapped);
        localStorage.setItem(USER_KEY, JSON.stringify(mapped));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      const { token, user: u } = await api.login(email, password);
      localStorage.setItem(TOKEN_KEY, token);
      const mapped: RobinUser = { id: u.id, email: u.email, name: u.name, role: u.role, team: u.team, avatarUrl: u.avatarUrl, organizationId: u.organizationId };
      localStorage.setItem(USER_KEY, JSON.stringify(mapped));
      setUser(mapped);
      return {};
    } catch (err: any) {
      return { error: err.response?.data?.error || 'Login failed' };
    }
  }, []);

  const loginWithToken = (token: string, u: any) => {
    localStorage.setItem(TOKEN_KEY, token);
    const mapped: RobinUser = { id: u.id || u._id, email: u.email, name: u.name, role: u.role, team: u.team, avatarUrl: u.avatarUrl, organizationId: u.organizationId };
    localStorage.setItem(USER_KEY, JSON.stringify(mapped));
    setUser(mapped);
  };

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    window.location.href = '/login';
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const { user: u } = await api.getMe();
      const mapped: RobinUser = { id: u._id, email: u.email, name: u.name, role: u.role, team: u.team, avatarUrl: u.avatarUrl, organizationId: u.organizationId };
      setUser(mapped);
      localStorage.setItem(USER_KEY, JSON.stringify(mapped));
    } catch { /* ignore */ }
  }, []);

  const updatePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await api.changePassword({ currentPassword, newPassword });
      return {};
    } catch (err: any) {
      return { error: err.response?.data?.error || 'Failed to update password' };
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, role: user?.role || 'guest', loading, login, loginWithToken, logout, refreshProfile, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
