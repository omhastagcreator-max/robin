import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { User, Lock, Camera, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

export default function ProfilePage() {
  const { user, refreshProfile, updatePassword } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState('');
  const [team, setTeam] = useState(user?.team || '');
  const [saving, setSaving] = useState(false);

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateMe({ name, phone, team });
      await refreshProfile();
      toast.success('Profile updated!');
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
    toast.success('Password changed!');
    setCurPw(''); setNewPw('');
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6 page-transition-enter">
        <h1 className="text-2xl font-bold">Profile</h1>

        {/* Avatar */}
        <div className="bg-card border border-border rounded-2xl p-6 flex items-center gap-5">
          <div className="relative">
            <div className="h-16 w-16 rounded-2xl bg-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
              {(user?.name || user?.email || '?')[0].toUpperCase()}
            </div>
          </div>
          <div>
            <p className="font-semibold">{user?.name}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
            <span className="inline-block mt-1 text-[11px] bg-primary/15 text-primary px-2 py-0.5 rounded-full capitalize">{user?.role}</span>
          </div>
        </div>

        {/* Profile Form */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Personal Information</h2>
          </div>
          <form onSubmit={saveProfile} className="p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { label: 'Full Name', value: name, setter: setName, placeholder: 'Your name' },
                { label: 'Phone', value: phone, setter: setPhone, placeholder: '+91 ...' },
              ].map(f => (
                <div key={f.label} className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                    className="w-full px-3 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all" />
                </div>
              ))}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Team</label>
                <select value={team} onChange={e => setTeam(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">None</option>
                  {['web', 'marketing', 'content', 'sales', 'design', 'admin'].map(t => (
                    <option key={t} value={t} className="capitalize">{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input value={user?.email} disabled
                  className="w-full px-3 py-2.5 bg-muted border border-input rounded-xl text-sm text-muted-foreground cursor-not-allowed" />
              </div>
            </div>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </form>
        </div>

        {/* Password Form */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Change Password</h2>
          </div>
          <form onSubmit={savePassword} className="p-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Current Password</label>
                <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="••••••••"
                  className="w-full px-3 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">New Password</label>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 6 characters"
                  className="w-full px-3 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <button type="submit" disabled={pwSaving || !curPw || !newPw}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all">
              {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Update Password
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
