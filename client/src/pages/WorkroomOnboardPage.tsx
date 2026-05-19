import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { UserPlus, Loader2, Copy, Check, Headphones } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * WorkroomOnboardPage — quick form that admin (always) and any user with
 * canManageWorkroom=true (e.g. Om the developer, once admin flips it on)
 * can use to spin up a new role='workroom' teammate.
 *
 * The new teammate gets:
 *   - role='workroom' (hard-locked by the server — caller can't elevate)
 *   - The default password 'Robin2024!' or one specified by the creator
 *
 * After creation, the credentials are shown ONCE so the creator can paste
 * them to the new teammate.
 */
export default function WorkroomOnboardPage() {
  const { user, role } = useAuth();
  // Hardcoded fallback for Om — owner ask: "let him use this now, even
  // before admin flips the toggle." Mirrors the server-side bypass.
  const isOm =
    /^om(\s|$)/i.test(user?.name || '') ||
    /^om(\.|@|[._-])/i.test(user?.email || '');
  const canAccess = role === 'admin' || user?.canManageWorkroom === true || isOm;

  // Bounced to the right dashboard if they shouldn't see this page.
  if (!canAccess) return <Navigate to="/" replace />;

  const [email, setEmail]       = useState('');
  const [name, setName]         = useState('');
  const [password, setPassword] = useState('Robin2024!');
  const [saving, setSaving]     = useState(false);
  const [created, setCreated]   = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied]     = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    try {
      const res = await api.onboardWorkroomUser({
        email: email.trim(),
        name:  name.trim() || undefined,
        password: password.trim() || undefined,
      });
      setCreated(res.credentials);
      setEmail(''); setName(''); setPassword('Robin2024!');
      toast.success('Workroom teammate created');
    } catch { /* interceptor toasts */ }
    finally { setSaving(false); }
  };

  const copyCreds = async () => {
    if (!created) return;
    const text = `Email: ${created.email}\nPassword: ${created.password}\nLogin at: ${window.location.origin}/login`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error('Could not copy — select and copy manually'); }
  };

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto p-4 sm:p-8 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Headphones className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Onboard a workroom teammate</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              They'll only see a tiny dashboard and the Work Room — no tasks, no clients, no admin pages.
              Perfect for floor/support staff who just join the huddle.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teammate@hastagcreator.com"
              className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Name (optional)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Janvi"
              className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Password</label>
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Robin2024!"
              className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              They can change it after first login from their profile.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving || !email.trim()}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {saving ? 'Creating…' : 'Create teammate'}
          </button>
        </form>

        {/* Credentials surface — shown once after creation */}
        {created && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
                <Check className="h-4 w-4" />
              </div>
              <p className="text-sm font-semibold">Account created — share these credentials</p>
            </div>
            <div className="font-mono text-xs bg-background border border-border rounded-lg p-3 space-y-1">
              <div><span className="text-muted-foreground">Email:</span> {created.email}</div>
              <div><span className="text-muted-foreground">Password:</span> {created.password}</div>
              <div><span className="text-muted-foreground">Login at:</span> {window.location.origin}/login</div>
            </div>
            <button onClick={copyCreds}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-semibold hover:bg-muted transition-colors">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy credentials'}
            </button>
            <p className="text-[11px] text-muted-foreground">
              We won't show this password again. Save it now or use the Reset Password action from Admin → Employees later.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
