import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Bird, Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function UpdatePassword() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setSaving(true);
    const { error } = await updatePassword('', newPw);
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success('Password updated! Please log in.');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-primary/20 border border-primary/30 items-center justify-center mb-3">
            <Bird className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Set New Password</h1>
          <p className="text-sm text-muted-foreground mt-1">Robin — Agency OS</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={6} placeholder="Min. 6 characters"
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <button type="submit" disabled={saving}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update Password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
