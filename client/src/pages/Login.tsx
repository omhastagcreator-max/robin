import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bird, Loader2, Eye, EyeOff, Mail, Lock, ArrowRight,
  Workflow, Headphones, Sparkles, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';

import { useAuth } from '@/contexts/AuthContext';
import { dashboardForRole } from '@/components/ProtectedRoute';
import { Button } from '@/components/ui/Button';
import * as api from '@/api';

/**
 * Login v2 — full visual rebuild.
 *
 * Layout: split panel (Linear / Vercel / Notion / Arc pattern).
 *   • Left (lg+):  brand hero in Rani Pink → Saffron gradient. Big logo,
 *                  tagline, three feature pills, ambient blobs.
 *   • Right:       clean form, no nested card chrome, the sign-in button
 *                  is the v2 Button primitive.
 *   • Mobile:      stacks vertically — brand strip on top, form below.
 *
 * Demo accounts strip: replaced the 6-different-colors bespoke grid with
 * a clean uniform list — same chip for everyone, no private design system.
 *
 * This file is the first thing every prospect, client, and teammate sees.
 * The transformation needs to feel deliberate, not "same SaaS, new pink".
 */

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const DEMO_ACCOUNTS: Array<{ name: string; role: string; email: string; password: string }> = [
  { name: 'Rahul',    role: 'Admin / Manager',  email: 'rahul@hastag.in',    password: 'Rahul@1234'    },
  { name: 'Rishi',    role: 'Sales',            email: 'rishi@hastag.in',    password: 'Rishi@1234'    },
  { name: 'Sakshi',   role: 'Meta Ads',         email: 'sakshi@hastag.in',   password: 'Sakshi@1234'   },
  { name: 'Priyanka', role: 'Influencer Mktg',  email: 'priyanka@hastag.in', password: 'Priyanka@1234' },
  { name: 'Om',       role: 'Web Dev',          email: 'om@hastag.in',       password: 'Om@1234'       },
  { name: 'Client',   role: 'Demo client',      email: 'client@robin.app',   password: 'Client1234!'   },
];

function LoginInner() {
  const { login, user, role, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [errMsg, setErrMsg]     = useState('');
  const [waking, setWaking]     = useState(false);

  useEffect(() => {
    if (user) navigate(dashboardForRole(role), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setErrMsg('Please enter your email and password'); return; }
    setErrMsg('');
    setLoading(true);
    setWaking(false);

    const wakingTimer = setTimeout(() => setWaking(true), 4000);
    const { error } = await login(email, password);
    clearTimeout(wakingTimer);
    setWaking(false);
    setLoading(false);

    if (error) {
      const safe = String(error || '');
      const isNetwork = safe.toLowerCase().includes('network') || safe === 'Login failed';
      setErrMsg(isNetwork ? 'Unable to reach server. Please try again in a moment.' : safe);
      toast.error(isNetwork ? 'Network error — server may be starting up, try again in 10s' : safe);
      return;
    }
    navigate(dashboardForRole(role), { replace: true });
  };

  const handleGoogle = async (cred: any) => {
    try {
      setLoading(true);
      const data = await api.googleLogin(cred.credential);
      loginWithToken(data.token, data.user);
      toast.success(`Welcome, ${data.user.name}`);
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
    <div className="min-h-screen w-full bg-background flex flex-col lg:flex-row">
      {/* ── LEFT — Brand hero ─────────────────────────────────────── */}
      <aside
        className="relative overflow-hidden flex-shrink-0 lg:w-[44%] xl:w-[42%] min-h-[280px] lg:min-h-screen text-white"
        style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
      >
        {/* Ambient blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-black/10 blur-3xl" />
          {/* Subtle grid texture */}
          <svg className="absolute inset-0 h-full w-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#g)" />
          </svg>
        </div>

        <div className="relative h-full flex flex-col p-8 lg:p-12">
          {/* Logo lockup */}
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center ring-1 ring-white/30">
              <Bird className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[18px] font-black tracking-tight leading-none">Robin</p>
              <p className="text-[10.5px] uppercase tracking-[0.18em] text-white/70 leading-none mt-1">
                by Hastag Creator
              </p>
            </div>
          </div>

          {/* Hero copy */}
          <div className="flex-1 flex flex-col justify-center max-w-md py-10 lg:py-0">
            <motion.h1
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
              className="text-[34px] lg:text-[44px] font-black tracking-tight leading-[1.05]"
            >
              The operating system for your agency.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05 }}
              className="text-[14px] text-white/85 mt-4 leading-relaxed"
            >
              Every client, every project, every meeting — one place. No more
              chasing status updates across WhatsApp, Sheets, and three Slack
              channels.
            </motion.p>

            {/* Feature pills */}
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
              className="mt-7 space-y-2.5"
            >
              <FeaturePill icon={<Workflow className="h-3.5 w-3.5" />} text="Project pipeline with live SOP checklists" />
              <FeaturePill icon={<Headphones className="h-3.5 w-3.5" />} text="One-click huddle — screen share + audio, no Zoom link needed" />
              <FeaturePill icon={<Sparkles className="h-3.5 w-3.5" />} text="AI status snapshots and morning briefs" />
            </motion.div>
          </div>

          {/* Footer mark */}
          <div className="flex items-center gap-1.5 text-[11px] text-white/60">
            <ShieldCheck className="h-3 w-3" />
            <span>End-to-end encrypted vault · Role-based access</span>
          </div>
        </div>
      </aside>

      {/* ── RIGHT — Form ──────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
            className="w-full max-w-sm"
          >
            <div className="space-y-1 mb-7">
              <h2 className="text-[22px] font-bold tracking-tight">Sign in</h2>
              <p className="text-[13px] text-muted-foreground">
                Welcome back. Pick your account or use a teammate shortcut below.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <FieldGroup label="Email">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@hastag.in"
                  autoComplete="email"
                  className="w-full pl-9 pr-3 h-10 bg-background border border-input rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                />
              </FieldGroup>

              <FieldGroup label="Password">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full pl-9 pr-10 h-10 bg-background border border-input rounded-lg text-[13.5px] focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </FieldGroup>

              <Button
                type="submit"
                size="lg"
                intent="primary"
                loading={loading}
                iconRight={!loading ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
                full
              >
                {loading ? (waking ? 'Server starting up…' : 'Signing in…') : 'Sign in'}
              </Button>

              {errMsg && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="text-[12px] text-rose-600 bg-rose-500/[0.08] border border-rose-500/20 rounded-lg px-3 py-2"
                >
                  {errMsg}
                </motion.p>
              )}
              {waking && (
                <p className="text-[11.5px] text-amber-700 bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin mt-0.5 shrink-0" />
                  <span>Server is waking up (Render free tier). This can take 20–30 s on first hit.</span>
                </p>
              )}
            </form>

            {GOOGLE_CLIENT_ID && (
              <>
                <Divider label="or continue with" />
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
              </>
            )}

            <Divider label="Team shortcuts" />

            <div className="space-y-1">
              {DEMO_ACCOUNTS.map(acc => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => fillDemo(acc)}
                  className="w-full flex items-center gap-3 px-2.5 h-10 rounded-md text-left hover:bg-primary/[0.04] transition-colors group"
                >
                  <div className="h-7 w-7 rounded-md bg-primary/12 text-primary text-[11.5px] font-bold flex items-center justify-center shrink-0">
                    {acc.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0 leading-tight">
                    <p className="text-[12.5px] font-semibold truncate">{acc.name}</p>
                    <p className="text-[10.5px] text-muted-foreground truncate">{acc.role} · {acc.email}</p>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                    Auto-fill
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>

        <footer className="p-6 sm:p-8 text-center text-[10.5px] text-muted-foreground">
          © {new Date().getFullYear()} Hastag Creator · Robin
        </footer>
      </main>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</label>
      <div className="relative">{children}</div>
    </div>
  );
}

function FeaturePill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 px-3 h-8 rounded-full bg-white/12 backdrop-blur-md ring-1 ring-white/20 text-[12px] text-white/95">
      <span className="text-white/90">{icon}</span>
      <span className="font-medium">{text}</span>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Outer wrapper ────────────────────────────────────────────────────────
export default function Login() {
  if (!GOOGLE_CLIENT_ID) return <LoginInner />;
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <LoginInner />
    </GoogleOAuthProvider>
  );
}
