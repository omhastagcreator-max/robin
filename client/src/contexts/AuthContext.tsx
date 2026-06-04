import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as api from '@/api';
import { disconnectSharedSocket } from '@/hooks/useSocket';

interface RobinUser {
  id: string;
  email: string;
  name: string;
  /** Primary role */
  role: string;
  /** Additional roles (multi-role support — admin can grant secondary roles) */
  roles?: string[];
  /** Primary team */
  team?: string;
  /** Additional teams (admin can assign someone to ads/meta/etc. on top of their primary) */
  teams?: string[];
  avatarUrl?: string;
  organizationId?: string;
  onCallSince?: string | null;
  /** Delegated permission to create workroom-only teammates (admin can grant). */
  canManageWorkroom?: boolean;
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
      .then(({ user: u, refreshedToken }: any) => {
        // Sliding session: server returned a fresh JWT because the current
        // one was getting old. Swap it transparently — the user never sees
        // a logout as long as they open Robin at least every few weeks.
        if (refreshedToken) {
          localStorage.setItem(TOKEN_KEY, refreshedToken);
        }
        const mapped: RobinUser = { id: u._id, email: u.email, name: u.name, role: u.role, roles: u.roles || [], team: u.team, teams: u.teams || [], avatarUrl: u.avatarUrl, organizationId: u.organizationId, canManageWorkroom: u.canManageWorkroom === true };
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
      const mapped: RobinUser = { id: u.id, email: u.email, name: u.name, role: u.role, roles: u.roles || [], team: u.team, teams: u.teams || [], avatarUrl: u.avatarUrl, organizationId: u.organizationId, canManageWorkroom: u.canManageWorkroom === true };
      localStorage.setItem(USER_KEY, JSON.stringify(mapped));
      setUser(mapped);
      // Auto-clock-in. Owner ask (May 2026): "when I log in then start
      // the timer". Internal staff get an automatic session START here
      // so they don't have to click a separate "Start day" button. The
      // huddle auto-join is handled separately by HuddleContext.
      //   - Clients: skipped (they don't have work sessions).
      //   - Existing active session: server's getActiveSession check is
      //     skipped — startSession is idempotent server-side (returns
      //     the existing session if one is already open).
      //   - Per-tab latch so a refresh on the same tab doesn't try to
      //     start a second time. Cleared on logout above.
      try {
        const isStaff = ['admin', 'employee', 'sales', 'workroom'].includes(mapped.role);
        if (isStaff && sessionStorage.getItem('robin.session.autoStartedThisTab') !== '1') {
          await api.startSession().catch(() => { /* silent — UI will surface if needed */ });
          try { sessionStorage.setItem('robin.session.autoStartedThisTab', '1'); } catch { /* private mode */ }
        }
      } catch { /* never block login on a session-start hiccup */ }
      return {};
    } catch (err: any) {
      return { error: err.response?.data?.error || 'Login failed' };
    }
  }, []);

  const loginWithToken = (token: string, u: any) => {
    localStorage.setItem(TOKEN_KEY, token);
    const mapped: RobinUser = { id: u.id || u._id, email: u.email, name: u.name, role: u.role, roles: u.roles || [], team: u.team, teams: u.teams || [], avatarUrl: u.avatarUrl, organizationId: u.organizationId, canManageWorkroom: u.canManageWorkroom === true };
    localStorage.setItem(USER_KEY, JSON.stringify(mapped));
    setUser(mapped);
  };

  const logout = useCallback(() => {
    // Auto-clock-out. Owner ask (May 2026): "when I log out then stop
    // the timer". Fire endSession BEFORE we clear the token so the
    // request is still authenticated. Fire-and-forget — we never want
    // a session-end network failure to leave the user stuck logged
    // in. Server-side endSession is idempotent (no-op if no session
    // is open). Best-effort huddle-left fires from HuddleProvider's
    // pagehide listener when the redirect to /login unloads this tab.
    try { void api.endSession().catch(() => { /* silent */ }); } catch { /* never block logout */ }

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // Reset the 401-strike counter (see axios.ts) — otherwise a strike
    // earned by the previous user can fire a false-bounce on user B's
    // very first request after logging in. Audit finding MED-6.
    try { delete (window as any).__robin401Strike; } catch { /* ignore */ }
    // Clear the auto-start latch so the NEXT user who logs in (or the
    // same user logging back in) gets a fresh auto-clock-in. Without
    // this, the sessionStorage flag set by the previous user's auto-
    // start would suppress the next user's.
    try { sessionStorage.removeItem('robin.session.autoStartedThisTab'); } catch { /* ignore */ }
    // Same for the huddle-absence auto-break flag — if user A left it
    // set (e.g. crashed while on auto-break), user B logging in shouldn't
    // be treated as resuming someone else's break.
    try { localStorage.removeItem('robin.session.autoBrokenByHuddle'); } catch { /* ignore */ }
    // Auto-join disable latch — if the user explicitly turned auto-join
    // off and then logged out, that preference shouldn't bleed across
    // logins. Clearing here means next login defaults to auto-join again.
    try { localStorage.removeItem('robin.huddle.autoJoinDisabled'); } catch { /* ignore */ }
    // Tear down the shared socket so the next login doesn't inherit the
    // previous user's identity in chat/presence.
    try { disconnectSharedSocket(); } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const { user: u } = await api.getMe();
      const mapped: RobinUser = { id: u._id, email: u.email, name: u.name, role: u.role, roles: u.roles || [], team: u.team, teams: u.teams || [], avatarUrl: u.avatarUrl, organizationId: u.organizationId };
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
    <AuthContext.Provider value={{
      user,
      // Default to 'employee' (matches server-side authMiddleware fallback)
      // when an authenticated user somehow has no primary role. Avoids
      // ProtectedRoute redirect loops the moment they touch any route.
      role: user ? (user.role || 'employee') : '',
      loading, login, loginWithToken, logout, refreshProfile, updatePassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
