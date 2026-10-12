import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, IndianRupee, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * IncentivesStrip — Oct 2026 owner ask: "an incentive section for each
 * employee, visible to everyone — how much is earned by whom — and it
 * should be a subtle section".
 *
 * Collapsed by default to a single quiet line (month total + top
 * earner). Expanding shows every teammate's total for the month with a
 * thin proportional bar, and the individual entries on hover/tap. Month
 * arrows step back through history. Admins get a small inline "add"
 * row and can remove a wrong entry; everyone else is read-only.
 */

interface Person { userId: string; name: string; total: number; count: number }
interface Entry { _id: string; userId: string; name: string; amount: number; reason: string; createdAt: string }
interface Data { month: string; total: number; people: Person[]; entries: Entry[]; staff: { _id: string; name: string }[] }

const OPEN_KEY = 'robin.incentives.open';
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const thisMonth = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function IncentivesStrip() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || ((user as any)?.roles || []).includes('admin');
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ userId: '', amount: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.listIncentives(month).then(setData).catch(() => setData(null));
  }, [month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('robin:data-changed', h);
    return () => window.removeEventListener('robin:data-changed', h);
  }, [load]);

  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem(OPEN_KEY, n ? '1' : '0'); } catch { /* */ } return n; });

  const add = async () => {
    const amount = Number(form.amount);
    if (!form.userId || !(amount > 0)) { toast.error('Pick a teammate and an amount.'); return; }
    setSaving(true);
    try {
      await api.addIncentive({ userId: form.userId, amount, reason: form.reason.trim(), month });
      setForm({ userId: '', amount: '', reason: '' });
      toast.success('Incentive added.');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not add.'); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try { await api.deleteIncentive(id); load(); } catch { toast.error('Could not remove.'); }
  };

  if (!data) return null;
  const top = data.people[0];
  const max = top?.total || 1;

  return (
    <section className="rounded-xl border border-border/60 bg-card/50 text-[12px]">
      {/* Collapsed line — deliberately quiet */}
      <button type="button" onClick={toggle} className="w-full flex items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors">
        <IndianRupee className="h-3.5 w-3.5 text-emerald-600/80 shrink-0" />
        <span className="font-medium text-foreground/80">Incentives</span>
        <span className="text-muted-foreground/70">· {monthLabel(data.month)}</span>
        <span className="ml-1 tabular-nums">{data.total > 0 ? inr(data.total) : 'none yet'}</span>
        {top && <span className="hidden sm:inline text-muted-foreground/70 truncate">· top: {top.name.split(' ')[0]} {inr(top.total)}</span>}
        <ChevronDown className={`h-3.5 w-3.5 ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label="Previous month"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="text-[11px] font-medium w-20 text-center">{monthLabel(month)}</span>
              <button type="button" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth()} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30" aria-label="Next month"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            <span className="text-[10.5px] text-muted-foreground">Visible to the whole team</span>
          </div>

          {data.people.length === 0 ? (
            <p className="text-muted-foreground/80 py-1">No incentives recorded for {monthLabel(month)}.</p>
          ) : (
            <ul className="space-y-1">
              {data.people.map(p => (
                <li key={p.userId}>
                  <button type="button" onClick={() => setExpanded(x => x === p.userId ? null : p.userId)} className="w-full grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 py-0.5 text-left">
                    <span className="truncate text-foreground/85">{p.name}</span>
                    <span className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <span className="block h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.max(4, (p.total / max) * 100)}%` }} />
                    </span>
                    <span className="tabular-nums font-medium text-foreground/85">{inr(p.total)}</span>
                  </button>
                  {expanded === p.userId && (
                    <ul className="ml-2 mt-1 mb-1.5 pl-2 border-l border-border/60 space-y-0.5 text-[11px] text-muted-foreground">
                      {data.entries.filter(e => e.userId === p.userId).map(e => (
                        <li key={e._id} className="flex items-center gap-2">
                          <span className="tabular-nums text-foreground/75">{inr(e.amount)}</span>
                          <span className="truncate">{e.reason || '—'}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground/60">{new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                          {isAdmin && (
                            <button type="button" onClick={() => remove(e._id)} className="p-0.5 rounded hover:text-rose-600" aria-label="Remove entry"><Trash2 className="h-3 w-3" /></button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && data.staff.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
              <select value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] min-w-[8rem]">
                <option value="">Teammate…</option>
                {data.staff.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^\d]/g, '') }))} inputMode="numeric" placeholder="₹ amount" className="h-7 w-24 rounded-md border border-border bg-background px-2 text-[11.5px]" />
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="For what (optional)" maxLength={200} className="h-7 flex-1 min-w-[8rem] rounded-md border border-border bg-background px-2 text-[11.5px]" />
              <button type="button" onClick={add} disabled={saving} className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-[11.5px] font-medium hover:bg-emerald-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default IncentivesStrip;
