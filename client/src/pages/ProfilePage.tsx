import { useEffect, useState } from 'react';
import { User, Lock, Save, Loader2, Mail, ImageIcon, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { Button }    from '@/components/ui/Button';
import { Avatar }    from '@/components/shared/Avatar';
import { useAuth }   from '@/contexts/AuthContext';
import { USER_TEAMS, USER_TEAM_LABEL } from '@/lib/enums';
import * as api from '@/api';

/**
 * ProfilePage v2 — rebuilt on design-system primitives.
 *
 * v1 used three large bordered cards stacked, each with a section header
 * row. v2 uses tighter spacing, semantic tokens, and v2 Button. The
 * "phone is initialised to ''" bug fix (the Save would wipe a real phone)
 * stays — that's correctness, not styling.
 */

export default function ProfilePage() {
  const { user, refreshProfile, updatePassword } = useAuth();

  const [name, setName]     = useState(user?.name || '');
  const [phone, setPhone]   = useState((user as any)?.phone || '');
  const [team, setTeam]     = useState(user?.team || '');
  // Profile picture URL — paste any publicly-accessible image link
  // (gravatar, Slack avatar, Google account, S3 bucket, etc.). The
  // shared <Avatar /> primitive already renders it everywhere user
  // identities show — sidebar header, meeting tiles, activity log,
  // service-owner chip on the workspace pages.
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone((user as any).phone || '');
      setTeam(user.team || '');
      setAvatarUrl(user.avatarUrl || '');
    }
  }, [user]);

  const saveAvatar = async (nextUrl: string) => {
    setAvatarSaving(true);
    try {
      await api.updateMe({ avatarUrl: nextUrl || null });
      await refreshProfile();
      toast.success(nextUrl ? 'Profile picture updated' : 'Profile picture removed');
    } catch { toast.error('Failed to update profile picture'); }
    finally { setAvatarSaving(false); }
  };

  const [curPw, setCurPw]   = useState('');
  const [newPw, setNewPw]   = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateMe({ name, phone, team });
      await refreshProfile();
      toast.success('Profile updated');
    } catch { toast.error('Failed to update profile'); }
    finally { setSaving(false); }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setPwSaving(true);
    const { error } = await updatePassword(curPw, newPw);
    setPwSaving(false);
    if (error) { toast.error(error); return; }
    toast.success('Password changed');
    setCurPw(''); setNewPw('');
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Profile</h1>
          <p className="text-[12px] text-muted-foreground">Update your details and password.</p>
        </div>

        {/* Identity card — avatar is editable inline */}
        <div className="border border-border rounded-xl bg-card p-5">
          <div className="flex items-center gap-4">
            <Avatar name={user?.name} email={user?.email} url={avatarUrl || user?.avatarUrl} size="lg" tone="primary" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold truncate">{user?.name || 'Unnamed'}</p>
              <p className="text-[12px] text-muted-foreground flex items-center gap-1.5 truncate">
                <Mail className="h-3 w-3" /> {user?.email}
              </p>
              <span className="inline-flex items-center mt-1.5 text-[10.5px] uppercase tracking-[0.16em] font-bold bg-primary/12 text-primary px-2 h-5 rounded">
                {user?.role}
              </span>
            </div>
          </div>

          {/* Avatar editor */}
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground inline-flex items-center gap-1.5">
              <ImageIcon className="h-3 w-3" /> Profile picture URL
            </label>
            <div className="flex items-center gap-2">
              <input
                value={avatarUrl}
                onChange={e => setAvatarUrl(e.target.value)}
                placeholder="https://your-image.png — Gravatar, Slack avatar, anywhere"
                className="flex-1 min-w-0 px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => { setAvatarUrl(''); void saveAvatar(''); }}
                  disabled={avatarSaving}
                  className="h-9 px-2.5 rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-muted text-[12px] inline-flex items-center gap-1"
                  title="Remove profile picture"
                >
                  <XIcon className="h-3.5 w-3.5" /> Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => saveAvatar(avatarUrl.trim())}
                disabled={avatarSaving || avatarUrl === (user?.avatarUrl || '')}
                className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50 hover:bg-primary/90 inline-flex items-center gap-1.5"
              >
                {avatarSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Paste a link to any image (PNG / JPG). It'll show up in your sidebar,
              activity log, and team panels across Robin. Native upload coming next pass.
            </p>
          </div>
        </div>

        {/* Personal info */}
        <section className="border border-border rounded-xl bg-card overflow-hidden">
          <header className="px-4 h-10 border-b border-border flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-primary" />
            <p className="text-[12.5px] font-semibold">Personal information</p>
          </header>
          <form onSubmit={saveProfile} className="p-4 space-y-3.5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Full name">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <Field label="Phone">
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 …"
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <Field label="Team">
                <select value={team} onChange={e => setTeam(e.target.value)}
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">None</option>
                  {USER_TEAMS.map(t => <option key={t} value={t}>{USER_TEAM_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="Email">
                <input value={user?.email || ''} disabled
                  className="w-full px-3 h-9 bg-muted border border-input rounded-lg text-sm text-muted-foreground cursor-not-allowed" />
              </Field>
            </div>
            <Button type="submit" size="sm" intent="primary" loading={saving} iconLeft={<Save className="h-3.5 w-3.5" />}>
              Save changes
            </Button>
          </form>
        </section>

        {/* Password */}
        <section className="border border-border rounded-xl bg-card overflow-hidden">
          <header className="px-4 h-10 border-b border-border flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <p className="text-[12.5px] font-semibold">Change password</p>
          </header>
          <form onSubmit={savePassword} className="p-4 space-y-3.5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Current password">
                <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="••••••••"
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </Field>
              <Field label="New password">
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 6 characters"
                  className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </Field>
            </div>
            <Button type="submit" size="sm" intent="primary" loading={pwSaving} disabled={!curPw || !newPw} iconLeft={<Lock className="h-3.5 w-3.5" />}>
              Update password
            </Button>
          </form>
        </section>
      </div>
    </AppLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
