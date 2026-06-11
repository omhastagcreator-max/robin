import { useEffect, useMemo, useState } from 'react';
import { Calendar, Plus, Save, Shuffle, X, Sparkles, Target as TargetIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * DayPlanEditorSection — admin-only editor for the weekly day-plan
 * surfaced on every employee's Workroom.
 *
 * Mounted on the CommandCenter. Admin:
 *   1. Picks an employee from the dropdown.
 *   2. Sees their current plan (auto-generated if it doesn't exist).
 *   3. Adds clients / tasks / per-day target to any of Mon-Fri.
 *   4. Sets the overall weekly target (one line — "what should be
 *      achieved by the next meeting").
 *   5. Hits Auto-distribute to round-robin every brand the employee
 *      owns across the weekdays (preserves existing tasks unless
 *      Replace is checked).
 *   6. Hits Save.
 *
 * The employee sees the result live (socket-driven refresh).
 */

const DAYS = [
  { idx: 1, label: 'Monday'    },
  { idx: 2, label: 'Tuesday'   },
  { idx: 3, label: 'Wednesday' },
  { idx: 4, label: 'Thursday'  },
  { idx: 5, label: 'Friday'    },
];

interface Entry {
  dayOfWeek: number;
  clients: string[];
  tasks: string[];
  target: string;
}
interface PlanShape {
  entries: Entry[];
  weeklyTarget: string;
  weekKey?: string;
  exists?: boolean;
}
interface UserLite { _id: string; name?: string; email?: string; role?: string }
interface Brand { _id: string; clientName?: string }

export function DayPlanEditorSection() {
  const [team, setTeam] = useState<UserLite[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState<PlanShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [distributing, setDistributing] = useState(false);

  useEffect(() => {
    api.listUsers()
      .then((arr: any[]) => setTeam(Array.isArray(arr) ? arr.filter(u => ['admin', 'sales', 'employee'].includes(u.role)) : []))
      .catch(() => setTeam([]));
    api.cwListWorkflows({})
      .then((arr: any[]) => setBrands(Array.isArray(arr) ? arr : []))
      .catch(() => setBrands([]));
  }, []);

  useEffect(() => {
    if (!userId) { setPlan(null); return; }
    setLoading(true);
    api.getUserDayPlan(userId)
      .then((p: PlanShape) => setPlan({
        entries: ensureFiveDays(p?.entries || []),
        weeklyTarget: p?.weeklyTarget || '',
        weekKey: p?.weekKey,
        exists: p?.exists,
      }))
      .catch(() => setPlan({ entries: ensureFiveDays([]), weeklyTarget: '' }))
      .finally(() => setLoading(false));
  }, [userId]);

  const brandById = useMemo(() => {
    const m = new Map<string, Brand>();
    brands.forEach(b => m.set(b._id, b));
    return m;
  }, [brands]);

  const updateEntry = (dayIdx: number, patch: Partial<Entry>) => {
    if (!plan) return;
    setPlan({
      ...plan,
      entries: plan.entries.map(e => e.dayOfWeek === dayIdx ? { ...e, ...patch } : e),
    });
  };

  const save = async () => {
    if (!userId || !plan) return;
    setSaving(true);
    try {
      await api.setUserDayPlan(userId, {
        entries: plan.entries,
        weeklyTarget: plan.weeklyTarget,
      });
      toast.success('Plan saved.');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not save plan');
    } finally { setSaving(false); }
  };

  const distribute = async (replace: boolean) => {
    if (!userId) return;
    setDistributing(true);
    try {
      const out = await api.autoDistributeDayPlan(userId, replace);
      toast.success(`Distributed ${out?.summary?.brandsDistributed || 0} brands across the week.`);
      setPlan({
        entries: ensureFiveDays(out?.plan?.entries || []),
        weeklyTarget: out?.plan?.weeklyTarget || plan?.weeklyTarget || '',
        weekKey: out?.plan?.weekKey,
        exists: true,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not distribute');
    } finally { setDistributing(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 flex-wrap">
        <Calendar className="h-3.5 w-3.5 text-primary" />
        <p className="text-[12px] font-bold">Day Plan editor</p>
        <span className="text-[10.5px] text-muted-foreground">Set what each teammate works on each day.</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={userId}
            onChange={e => setUserId(e.target.value)}
            className="h-8 px-2 rounded-md border border-input bg-background text-[12px] focus:ring-2 focus:ring-ring focus:outline-none"
          >
            <option value="">— Pick a teammate —</option>
            {team.map(u => (
              <option key={u._id} value={u._id}>{u.name || u.email}{u.role ? ` · ${u.role}` : ''}</option>
            ))}
          </select>
          {userId && (
            <>
              <button
                onClick={() => distribute(false)}
                disabled={distributing}
                title="Round-robin every brand they own across Mon-Fri (preserves existing tasks)"
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-card text-[11.5px] font-semibold hover:bg-muted/40 disabled:opacity-50"
              >
                <Shuffle className="h-3 w-3 text-violet-600" />
                {distributing ? 'Distributing…' : 'Auto-distribute'}
              </button>
              <button
                onClick={save}
                disabled={saving || !plan}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="h-3 w-3" />
                {saving ? 'Saving…' : 'Save plan'}
              </button>
            </>
          )}
        </div>
      </div>

      {!userId ? (
        <p className="p-8 text-center text-[12px] text-muted-foreground italic">Pick a teammate to start editing.</p>
      ) : loading ? (
        <p className="p-8 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
          <Sparkles className="h-3 w-3 animate-pulse" /> Loading…
        </p>
      ) : !plan ? null : (
        <>
          {/* Weekly target */}
          <div className="px-4 py-2.5 border-b border-border bg-violet-500/5">
            <label className="block text-[10.5px] uppercase tracking-wider font-bold text-violet-700 mb-1 inline-flex items-center gap-1">
              <TargetIcon className="h-3 w-3" /> Weekly target (by next meeting)
            </label>
            <input
              value={plan.weeklyTarget}
              onChange={e => setPlan({ ...plan, weeklyTarget: e.target.value })}
              placeholder="e.g. Ship 3 brands' Meta Ads campaigns + 2 reviews"
              className="w-full px-2.5 h-8 rounded-md border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>

          {/* 5-day grid */}
          <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-border/60">
            {DAYS.map(d => {
              const e = plan.entries.find(x => x.dayOfWeek === d.idx) || { dayOfWeek: d.idx, clients: [], tasks: [], target: '' };
              return (
                <div key={d.idx} className="px-3 py-2.5 min-w-0 space-y-2">
                  <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground">{d.label}</p>

                  {/* Clients dropdown picker */}
                  <div>
                    <label className="block text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Brands</label>
                    <select
                      value=""
                      onChange={ev => {
                        if (!ev.target.value) return;
                        if (e.clients.includes(ev.target.value)) return;
                        updateEntry(d.idx, { clients: [...e.clients, ev.target.value] });
                      }}
                      className="w-full h-7 px-1.5 rounded border border-input bg-background text-[11px] focus:ring-1 focus:ring-violet-500"
                    >
                      <option value="">+ Add brand</option>
                      {brands.map(b => (
                        <option key={b._id} value={b._id} disabled={e.clients.includes(b._id)}>
                          {b.clientName || 'Unnamed'}
                        </option>
                      ))}
                    </select>
                    <ul className="mt-1 space-y-0.5">
                      {e.clients.map(id => (
                        <li key={id} className="flex items-center justify-between gap-1 text-[10.5px]">
                          <span className="truncate">{brandById.get(id)?.clientName || 'Brand'}</span>
                          <button
                            type="button"
                            onClick={() => updateEntry(d.idx, { clients: e.clients.filter(x => x !== id) })}
                            className="text-muted-foreground hover:text-rose-600"
                            aria-label="Remove"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Tasks textarea */}
                  <div>
                    <label className="block text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Tasks</label>
                    <textarea
                      value={e.tasks.join('\n')}
                      onChange={ev => updateEntry(d.idx, { tasks: ev.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                      rows={3}
                      placeholder="One per line"
                      className="w-full px-1.5 py-1 text-[10.5px] rounded border border-input bg-background focus:ring-1 focus:ring-violet-500 resize-none"
                    />
                  </div>

                  {/* Day target */}
                  <div>
                    <label className="block text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Target</label>
                    <input
                      value={e.target}
                      onChange={ev => updateEntry(d.idx, { target: ev.target.value })}
                      placeholder="e.g. Send creator brief"
                      className="w-full h-7 px-1.5 rounded border border-input bg-background text-[10.5px] focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ensureFiveDays(entries: Entry[]): Entry[] {
  // Make sure Mon-Fri all exist in the entries array. If admin adds
  // Sat / Sun later, they stay; we just don't auto-add them.
  const out: Entry[] = [];
  for (let d = 1; d <= 5; d++) {
    const e = entries.find(x => x.dayOfWeek === d);
    out.push(e ? { ...e, clients: e.clients || [], tasks: e.tasks || [], target: e.target || '' }
              : { dayOfWeek: d, clients: [], tasks: [], target: '' });
  }
  // Preserve any 6/7 admin added.
  for (const e of entries) if (e.dayOfWeek > 5) out.push(e);
  return out.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

// Silence unused-import lint — kept for future row-action icons.
void Plus; void Trash2;
