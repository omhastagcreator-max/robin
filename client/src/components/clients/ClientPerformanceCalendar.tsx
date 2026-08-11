import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, IndianRupee, Target, TrendingUp, X, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import type { ClientPerformanceEntry } from '@/api';

/**
 * ClientPerformanceCalendar — per-client Meta Ads spend / sales achieved /
 * sales target tracker (Aug 2026 owner ask). Three independent tabs —
 * Daily / Weekly / Monthly — each its own calendar. Open to every staff
 * role (route already gates to admin/employee/sales/workroom); nothing
 * here does its own permission check beyond what the API enforces.
 */

type Tab = 'day' | 'week' | 'month';

function pad2(n: number) { return String(n).padStart(2, '0'); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function ymKey(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
/** Standard ISO-8601 week key, e.g. '2026-W32'. Matches the server's isoWeekRange(). */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(weekNo)}`;
}
function fmtINR(n: number) { return `₹${Math.round(n || 0).toLocaleString('en-IN')}`; }

export function ClientPerformanceCalendar({ workflowId }: { workflowId: string }) {
  const [tab, setTab]       = useState<Tab>('day');
  const [cursor, setCursor] = useState(new Date());
  const [entries, setEntries] = useState<ClientPerformanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editKey, setEditKey] = useState<string | null>(null);

  const year = cursor.getFullYear();
  const monthIdx = cursor.getMonth();

  const load = async () => {
    setLoading(true);
    try {
      let from: string, to: string;
      if (tab === 'month') { from = `${year}-01-01`; to = `${year}-12-31`; }
      else {
        const start = new Date(year, monthIdx, 1);
        const end   = new Date(year, monthIdx + 1, 0);
        from = ymd(start); to = ymd(end);
      }
      const rows = await api.cwGetPerformance(workflowId, { periodType: tab, from, to });
      setEntries(Array.isArray(rows) ? rows : []);
    } catch { toast.error('Could not load performance data'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workflowId, tab, year, monthIdx]);

  const byKey = useMemo(() => {
    const m = new Map<string, ClientPerformanceEntry>();
    entries.forEach(e => m.set(e.periodKey, e));
    return m;
  }, [entries]);

  const dayCells = useMemo(() => {
    const first = new Date(year, monthIdx, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-start grid
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const cells: Array<{ date: Date | null; key: string | null }> = [];
    for (let i = 0; i < startOffset; i++) cells.push({ date: null, key: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, monthIdx, d);
      cells.push({ date: dt, key: ymd(dt) });
    }
    return cells;
  }, [year, monthIdx]);

  const weekRows = useMemo(() => {
    const first = new Date(year, monthIdx, 1);
    const last  = new Date(year, monthIdx + 1, 0);
    const seen  = new Set<string>();
    const rows: string[] = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const key = isoWeekKey(d);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(key);
    }
    return rows;
  }, [year, monthIdx]);

  const monthCells = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(year, i, 1);
    return { key: ymKey(dt), label: dt.toLocaleString('en-US', { month: 'short' }) };
  }), [year]);

  const navPrev = () => setCursor(c => tab === 'month' ? new Date(c.getFullYear() - 1, c.getMonth(), 1) : new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const navNext = () => setCursor(c => tab === 'month' ? new Date(c.getFullYear() + 1, c.getMonth(), 1) : new Date(c.getFullYear(), c.getMonth() + 1, 1));

  const totals = useMemo(() => entries.reduce((acc, e) => ({
    spend:    acc.spend    + (e.metaAdsSpend  || 0),
    achieved: acc.achieved + (e.salesAchieved || 0),
    target:   acc.target   + (e.salesTarget   || 0),
  }), { spend: 0, achieved: 0, target: 0 }), [entries]);

  const applySaved = (entry: ClientPerformanceEntry) => {
    setEntries(prev => {
      const idx = prev.findIndex(e => e.periodKey === entry.periodKey);
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [...prev, entry];
    });
    setEditKey(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {(['day', 'week', 'month'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold capitalize transition-all ${tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground/80'}`}>
              {t === 'day' ? 'Daily' : t === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={navPrev} className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="text-[12px] font-semibold tabular-nums min-w-[110px] text-center">
            {tab === 'month' ? year : cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={navNext} className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TotalCard icon={IndianRupee} label="Meta Ads Spend" value={fmtINR(totals.spend)}    tone="text-violet-700 bg-violet-500/10" />
        <TotalCard icon={TrendingUp}  label="Sales Achieved" value={fmtINR(totals.achieved)} tone="text-emerald-700 bg-emerald-500/10" />
        <TotalCard icon={Target}      label="Sales Target"   value={fmtINR(totals.target)}   tone="text-amber-700 bg-amber-500/10" />
      </div>

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : tab === 'day' ? (
        <DayGrid cells={dayCells} byKey={byKey} onPick={setEditKey} />
      ) : tab === 'week' ? (
        <PeriodList rowKeys={weekRows} byKey={byKey} onPick={setEditKey} labelFor={(k) => k} />
      ) : (
        <MonthGrid cells={monthCells} byKey={byKey} onPick={setEditKey} />
      )}

      {editKey && (
        <EntryEditModal
          workflowId={workflowId}
          periodType={tab}
          periodKey={editKey}
          existing={byKey.get(editKey)}
          onClose={() => setEditKey(null)}
          onSaved={applySaved}
        />
      )}
    </div>
  );
}

function TotalCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const [textCls, bgCls] = tone.split(' ');
  return (
    <div className="border border-border rounded-xl px-3 py-2.5 flex items-center gap-2.5">
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${bgCls}`}>
        <Icon className={`h-4 w-4 ${textCls}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground truncate">{label}</p>
        <p className={`text-[13px] font-bold tabular-nums truncate ${textCls}`}>{value}</p>
      </div>
    </div>
  );
}

function cellDot(entry: ClientPerformanceEntry | undefined) {
  if (!entry) return null;
  const hitTarget = entry.salesTarget > 0 && entry.salesAchieved >= entry.salesTarget;
  return (
    <span className={`h-1.5 w-1.5 rounded-full ${hitTarget ? 'bg-emerald-500' : 'bg-amber-500'}`} />
  );
}

function DayGrid({ cells, byKey, onPick }: {
  cells: Array<{ date: Date | null; key: string | null }>;
  byKey: Map<string, ClientPerformanceEntry>;
  onPick: (key: string) => void;
}) {
  const todayKey = ymd(new Date());
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/40 text-[9.5px] uppercase tracking-wider font-semibold text-muted-foreground">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          if (!c.date || !c.key) return <div key={i} className="aspect-square border-t border-r border-border bg-muted/10" />;
          const entry = byKey.get(c.key);
          const isToday = c.key === todayKey;
          return (
            <button
              key={i}
              onClick={() => onPick(c.key!)}
              className={`aspect-square border-t border-r border-border p-1.5 flex flex-col items-start gap-0.5 hover:bg-primary/5 transition-colors text-left ${isToday ? 'bg-primary/5' : ''}`}
            >
              <span className={`text-[10.5px] font-semibold tabular-nums ${isToday ? 'text-primary' : 'text-foreground/80'}`}>{c.date.getDate()}</span>
              {entry ? (
                <div className="flex flex-col gap-0.5 w-full">
                  <span className="inline-flex items-center gap-1 text-[8.5px] text-emerald-700 font-semibold truncate">
                    {cellDot(entry)} {fmtINR(entry.salesAchieved)}
                  </span>
                  <span className="text-[8px] text-muted-foreground truncate">spend {fmtINR(entry.metaAdsSpend)}</span>
                </div>
              ) : (
                <span className="text-[8.5px] text-muted-foreground/50">+ add</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodList({ rowKeys, byKey, onPick, labelFor }: {
  rowKeys: string[];
  byKey: Map<string, ClientPerformanceEntry>;
  onPick: (key: string) => void;
  labelFor: (key: string) => string;
}) {
  if (rowKeys.length === 0) return <p className="text-[12px] text-muted-foreground text-center py-8">No weeks in range.</p>;
  return (
    <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
      {rowKeys.map(key => {
        const entry = byKey.get(key);
        return (
          <button key={key} onClick={() => onPick(key)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 text-left">
            <span className="text-[12px] font-semibold flex items-center gap-2">{cellDot(entry)} {labelFor(key)}</span>
            {entry ? (
              <span className="flex items-center gap-3 text-[11px]">
                <span className="text-violet-700">spend {fmtINR(entry.metaAdsSpend)}</span>
                <span className="text-emerald-700">achieved {fmtINR(entry.salesAchieved)}</span>
                <span className="text-amber-700">target {fmtINR(entry.salesTarget)}</span>
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">+ add entry</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MonthGrid({ cells, byKey, onPick }: {
  cells: Array<{ key: string; label: string }>;
  byKey: Map<string, ClientPerformanceEntry>;
  onPick: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {cells.map(c => {
        const entry = byKey.get(c.key);
        return (
          <button key={c.key} onClick={() => onPick(c.key)}
            className="border border-border rounded-xl p-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors">
            <span className="text-[11.5px] font-bold flex items-center gap-1.5">{cellDot(entry)} {c.label}</span>
            {entry ? (
              <div className="mt-1.5 space-y-0.5">
                <p className="text-[10px] text-violet-700">spend {fmtINR(entry.metaAdsSpend)}</p>
                <p className="text-[10px] text-emerald-700">achieved {fmtINR(entry.salesAchieved)}</p>
                <p className="text-[10px] text-amber-700">target {fmtINR(entry.salesTarget)}</p>
              </div>
            ) : (
              <p className="mt-1.5 text-[10px] text-muted-foreground">+ add entry</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function EntryEditModal({ workflowId, periodType, periodKey, existing, onClose, onSaved }: {
  workflowId: string;
  periodType: Tab;
  periodKey: string;
  existing?: ClientPerformanceEntry;
  onClose: () => void;
  onSaved: (entry: ClientPerformanceEntry) => void;
}) {
  const [spend, setSpend]     = useState(String(existing?.metaAdsSpend ?? ''));
  const [achieved, setAchieved] = useState(String(existing?.salesAchieved ?? ''));
  const [target, setTarget]   = useState(String(existing?.salesTarget ?? ''));
  const [notes, setNotes]     = useState(existing?.notes || '');
  const [saving, setSaving]   = useState(false);

  const periodLabel = periodType === 'day' ? periodKey : periodType === 'week' ? `Week ${periodKey}` : periodKey;

  const save = async () => {
    setSaving(true);
    try {
      const entry = await api.cwUpsertPerformance(workflowId, {
        periodType, periodKey,
        metaAdsSpend:  Number(spend)    || 0,
        salesAchieved: Number(achieved) || 0,
        salesTarget:   Number(target)   || 0,
        notes: notes.trim() || undefined,
      });
      toast.success('Saved');
      onSaved(entry);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-3 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              {periodType === 'day' ? 'Day' : periodType === 'week' ? 'Week' : 'Month'} entry
            </p>
            <h2 className="font-bold text-base">{periodLabel}</h2>
          </div>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold">Meta Ads spend (₹)</span>
          <input type="number" min={0} value={spend} onChange={e => setSpend(e.target.value)}
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold">Sales achieved (₹)</span>
          <input type="number" min={0} value={achieved} onChange={e => setAchieved(e.target.value)}
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold">Sales target (₹)</span>
          <input type="number" min={0} value={target} onChange={e => setTarget(e.target.value)}
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground font-semibold">Notes (optional)</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500}
            className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <button onClick={save} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}
