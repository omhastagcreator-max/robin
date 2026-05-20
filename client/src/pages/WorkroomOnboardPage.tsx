import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { UserPlus, Copy, Check, Headphones } from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { Button }    from '@/components/ui/Button';
import { useAuth }   from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * WorkroomOnboardPage v2 — rebuilt on design-system primitives.
 *
 * Admin (always) + canManageWorkroom flagged users (e.g. Om) can spin up
 * a role='workroom' teammate. Credentials are shown ONCE — copy or save.
 */
export default function WorkroomOnboardPage() {
  const { user, role } = useAuth();
  const isOm = /^om(\s|$)/i.test(user?.name || '') || /^om(\.|@|[._-])/i.test(user?.email || '');
  const canAccess = role === 'admin' || (user as any)?.canManageWorkroom === true || isOm;
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
      <div className="max-w-xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/12 text-primary flex items-center justify-center shrink-0">
            <Headphones className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold tracking-tight">Onboard a workroom teammate</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              They'll only see a tiny dashboard and the Work Room — no tasks, no clients, no admin pages.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="border border-border rounded-xl bg-card p-5 space-y-3.5">
          <Field label="Email *">
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="teammate@hastagcreator.com"
              className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Name (optional)">
            <input
              value={name} onChange={e => setName(e.target.value)} placeholder="Janvi"
              className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Password" hint="They can change it after first login from their profile.">
            <input
              value={password} onChange={e => setPassword(e.target.value)} placeholder="Robin2024!"
              className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Button type="submit" size="md" intent="primary" loading={saving} disabled={!email.trim()} iconLeft={<UserPlus className="h-3.5 w-3.5" />} full>
            Create teammate
          </Button>
        </form>

        {/* Credentials surface */}
        {created && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
                <Check className="h-3.5 w-3.5" />
              </div>
              <p className="text-[13px] font-semibold">Account created — share these credentials</p>
            </div>
            <div className="font-mono text-[11.5px] bg-background border border-border rounded-lg p-3 space-y-1">
              <CredLine label="Email"     value={created.email} />
              <CredLine label="Password"  value={created.password} />
              <CredLine label="Login at"  value={`${window.location.origin}/login`} />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Button size="xs" intent="secondary" iconLeft={copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />} onClick={copyCreds}>
                {copied ? 'Copied' : 'Copy credentials'}
              </Button>
              <p className="text-[10.5px] text-muted-foreground">
                We won't show this password again.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CredLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span> {value}
    </div>
  );
}
