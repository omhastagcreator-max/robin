import { useState } from 'react';
import { Copy, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import * as api from '@/api';

export const TEAM_OPTIONS: { key: string; label: string }[] = [
  { key: 'influencer', label: 'Video team (UGC)' }, { key: 'development', label: 'Development / Shopify' },
  { key: 'meta', label: 'Meta Ads' }, { key: 'sales', label: 'Sales' }, { key: 'design', label: 'Design' },
  { key: 'script', label: 'Script' }, { key: 'social', label: 'Social media' }, { key: 'management', label: 'Management' },
];

/** Oct 2026 — Rahul (and admin) can add a new teammate without going through an admin. */
export function AddMemberModal({ open, isAdmin, onClose, onAdded }: { open: boolean; isAdmin: boolean; onClose: () => void; onAdded: () => void }) {
  const blank = { name: '', email: '', phone: '', role: 'employee', teams: [] as string[] };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; email: string; password: string; reactivated: boolean } | null>(null);
  const close = () => { setF(blank); setErr(null); setMade(null); onClose(); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.addTeamMember(f); setMade(r); onAdded(); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Could not add this person'); }
    finally { setBusy(false); }
  };
  const loginText = made ? `Hi ${made.name.split(' ')[0]}, your Robin login:\nrobin.hastagcreator.com/login\nEmail: ${made.email}\nPassword: ${made.password}\nPlease change it from your profile after signing in.` : '';
  const inputCls = 'w-full h-9 rounded-md border border-input bg-background px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring';
  return (
    <Modal open={open} onClose={close} size="md">
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-bold">{made ? (made.reactivated ? 'Teammate re-activated' : 'Teammate added') : 'Add a team member'}</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">{made ? 'Share these login details now — the password is shown only once.' : 'They can sign in to Robin straight away.'}</p>
          </div>
          <button onClick={close} aria-label="Close" className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {made ? (
          <>
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-[12.5px] font-mono">{loginText}</pre>
            <div className="flex justify-end gap-2">
              <button onClick={() => navigator.clipboard.writeText(loginText)} className="h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" /> Copy</button>
              <a href={`https://wa.me/${f.phone.replace(/\D/g, '').length === 10 ? '91' + f.phone.replace(/\D/g, '') : f.phone.replace(/\D/g, '')}?text=${encodeURIComponent(loginText)}`} target="_blank" rel="noreferrer"
                className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-[12.5px] font-semibold inline-flex items-center">Send on WhatsApp</a>
              <button onClick={() => { setF(blank); setMade(null); }} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-[12.5px] font-semibold">Add another</button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-medium sm:col-span-2">Full name<input className={inputCls + ' mt-1'} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Amit Kamble" /></label>
              <label className="text-[12px] font-medium">Email<input type="email" className={inputCls + ' mt-1'} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@hastagcreator.com" /></label>
              <label className="text-[12px] font-medium">WhatsApp number <span className="text-muted-foreground font-normal">(optional)</span><input className={inputCls + ' mt-1'} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="98765 43210" /></label>
              <label className="text-[12px] font-medium sm:col-span-2">Role
                <select className={inputCls + ' mt-1'} value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
                  <option value="employee">Employee — works on clients, tasks, SOPs</option>
                  <option value="sales">Sales — CRM, leads, onboarding clients</option>
                  <option value="workroom">Workroom — huddle / floor only</option>
                  {isAdmin && <option value="admin">Admin — full access</option>}
                </select>
              </label>
            </div>
            <div>
              <div className="text-[12px] font-medium mb-1.5">Team</div>
              <div className="flex flex-wrap gap-1.5">
                {TEAM_OPTIONS.map(t => {
                  const on = f.teams.includes(t.key);
                  return (
                    <button key={t.key} type="button" aria-pressed={on} onClick={() => setF({ ...f, teams: on ? f.teams.filter(x => x !== t.key) : [...f.teams, t.key] })}
                      className={`h-7 px-2.5 rounded-full text-[11.5px] font-semibold border ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted/60'}`}>{t.label}</button>
                  );
                })}
              </div>
              {f.teams.includes('influencer') && <p className="text-[11px] text-muted-foreground mt-1.5">New UGC brands will be auto-assigned to the video team.</p>}
            </div>
            {err && <p className="text-[12.5px] text-rose-600">{err}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={close} className="h-9 px-3 rounded-lg text-[12.5px]">Cancel</button>
              <button disabled={busy || f.name.trim().length < 2 || !f.email.includes('@')} onClick={submit}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[12.5px] font-semibold disabled:opacity-50">{busy ? 'Adding…' : 'Add member'}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
