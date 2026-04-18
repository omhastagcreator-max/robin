import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Bird, Loader2, Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardForRole } from '@/components/ProtectedRoute';

const DEMO_ACCOUNTS = [
  { label: 'Admin',    email: 'admin@robin.app',    password: 'Admin1234!',    color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  { label: 'Employee', email: 'employee@robin.app', password: 'Employee1234!', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { label: 'Client',   email: 'client@robin.app',   password: 'Client1234!',   color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { label: 'Sales',    email: 'sales@robin.app',     password: 'Sales1234!',    color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
];

export default function Login() {
  const { login, user, role } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  if (user) { navigate(dashboardForRole(role), { replace: true }); return null; }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    const { error } = await login(email, password);
    setLoading(false);
    if (error) { toast.error(error); return; }
    navigate(dashboardForRole(role), { replace: true });
  };

  const fillDemo = (acc: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acc.email);
    setPassword(acc.password);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/20 border border-primary/30 mb-4 relative">
            <Bird className="h-8 w-8 text-primary" />
            <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-pulse" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Robin</h1>
          <p className="text-muted-foreground text-sm mt-1">Agency Operating System</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-7 shadow-2xl shadow-black/40">
          <h2 className="text-lg font-semibold mb-5">Sign in to your workspace</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder="you@robin.app"
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-input rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-all" />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 bg-background border border-input rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-all" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</> : 'Sign In'}
            </button>
          </form>

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
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all hover:scale-105 active:scale-95 ${acc.color}`}>
                {acc.label}
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-muted-foreground/60 mt-3">Click a role above to auto-fill credentials, then sign in</p>
        </div>
      </motion.div>
    </div>
  );
}
