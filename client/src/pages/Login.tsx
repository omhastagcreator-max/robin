import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Bird, Loader2, Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardForRole } from '@/components/ProtectedRoute';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import * as api from '@/api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const DEMO_ACCOUNTS = [
  { label: 'Admin',    email: 'admin@robin.app',    password: 'Admin1234!',    color: 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200' },
  { label: 'Employee', email: 'employee@robin.app', password: 'Employee1234!', color: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200' },
  { label: 'Client',   email: 'client@robin.app',   password: 'Client1234!',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200' },
  { label: 'Sales',    email: 'sales@robin.app',     password: 'Sales1234!',    color: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200' },
];

function LoginInner() {
  const { login, user, role, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPw, setShowPw]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [errMsg, setErrMsg]         = useState('');
  const [waking, setWaking]         = useState(false);   // Render cold-start

  useEffect(() => {
    if (user) navigate(dashboardForRole(role), { replace: true });
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setErrMsg('Please enter your email and password'); return; }
    setErrMsg('');
    setLoading(true);
    setWaking(false);

    // If takes > 4s, likely Render is cold-starting — show friendly message
    const wakingTimer = setTimeout(() => setWaking(true), 4000);

    const { error } = await login(email, password);
    clearTimeout(wakingTimer);
    setWaking(false);
    setLoading(false);

    if (error) {
      const isNetwork = error.toLowerCase().includes('network') || error === 'Login failed';
      setErrMsg(isNetwork ? 'Unable to reach server. Please try again in a moment.' : error);
      toast.error(isNetwork ? 'Network error — server may be starting up, try again in 10s' : error);
      return;
    }
    navigate(dashboardForRole(role), { replace: true });
  };

  const handleGoogle = async (credentialResponse: any) => {
    try {
      setLoading(true);
      const data = await api.googleLogin(credentialResponse.credential);
      loginWithToken(data.token, data.user);
      toast.success(`Welcome, ${data.user.name}!`);
      navigate(dashboardForRole(data.user.role), { replace: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (acc: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acc.email);
    setPassword(acc.password);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Soft ambient gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-violet-400/8 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Bird className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Robin</h1>
          <p className="text-muted-foreground text-sm mt-1">Agency Operating System</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-7 shadow-lg shadow-black/5">
          <h2 className="text-lg font-semibold mb-5 text-foreground">Sign in to your workspace</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@robin.app"
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all" />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-md shadow-primary/20">
              {loading
                ? waking
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Server starting up…</>
                  : <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                : 'Sign In'}
            </button>

            {/* Inline error message */}
            {errMsg && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-2.5 text-center">
                {errMsg}
              </motion.div>
            )}
            {waking && (
              <p className="text-center text-[11px] text-amber-600">
                🔄 Server is waking up (free tier). This may take up to 30 seconds on first use.
              </p>
            )}
          </form>

          {/* Google Sign-In */}
          {GOOGLE_CLIENT_ID && (
            <div className="mt-4">
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or continue with</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogle}
                  onError={() => toast.error('Google sign-in failed')}
                  theme="outline"
                  size="large"
                  width="100%"
                  text="signin_with"
                  shape="rectangular"
                />
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">Quick access</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Demo accounts */}
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map(acc => (
              <button key={acc.label} type="button" onClick={() => fillDemo(acc)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${acc.color}`}>
                {acc.label}
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-muted-foreground/70 mt-3">
            Click a role above to auto-fill credentials, then sign in
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default function Login() {
  if (!GOOGLE_CLIENT_ID) return <LoginInner />;
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <LoginInner />
    </GoogleOAuthProvider>
  );
}
