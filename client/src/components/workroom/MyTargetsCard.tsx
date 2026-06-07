import { useEffect, useState } from 'react';
import { Target, Sparkles, Clock, Check, Pencil } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import * as api from '@/api';

/**
 * MyTargetsCard — current-period performance card.
 *
 * Two cadences (May 2026): weekly + monthly. Toggle at the header.
 * Default = monthly. The toggle is local-state-only; we don't persist
 * the choice across reloads (admin's last-set cadence dominates the
 * roster on the executive view).
 *
 * Each target line shows the standard progress bar AND lets the
 * employee inline-set their OWN ETA + a short commitment note.
 * Read-only fields (label, target, source) stay admin-only.
 */

interface TargetLine {
  _id?: string;
  label: string;
  target: number;
  unit?: string;
  actual: number;
  source: string;
  etaDate?: string | null;
  employeeNote?: string;
}

const TONE_FOR_PCT = (pct: number) =>
  pct >= 1   ? 'bg-emerald-500' :
  pct >= 0.7 ? 'bg-blue-500' :
  pct >= 0.4 ? 'bg-amber-500' :
               'bg-rose-500';

export function MyTargetsCard() {
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [data, setData] = useState<{ month: string; targets: TargetLine[]; exists: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api.getMyTargets({ period })
      .then((d: any) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [period]);

  const periodLabel = !data?.month ? '' : period === 'monthly'
    ? new Date(data.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `Week ${data.month.split('-W')[1] || ''}, ${data.month.split('-')[0] || ''}`;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-violet-600" />
          <p className="text-[12px] font-bold">My targets</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-md p-0.5 text-[10.5px]">
            <button
              type="button"
              onClick={() => setPeriod('monthly')}
              className={`px-2 py-0.5 rounded ${period === 'monthly' ? 'bg-background text-foreground font-semibold shadow-sm' : 'text-muted-foreground'}`}
            >Monthly</button>
            <button
              type="button"
              onClick={() => setPeriod('weekly')}
              className={`px-2 py-0.5 rounded ${period === 'weekly' ? 'bg-background text-foreground font-semibold shadow-sm' : 'text-muted-foreground'}`}
            >Weekly</button>
          </div>
          <p className="text-[10.5px] text-muted-foreground">{periodLabel}</p>
        </div>
      </div>
      {loading ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
          <Sparkles className="h-3 w-3 animate-pulse" /> Loading…
        </p>
      ) : !data || data.targets.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted-foreground italic">
          No targets set for this {period === 'monthly' ? 'month' : 'week'} yet.
        </p>
      ) : (
        <ul className="px-4 py-3 space-y-3 max-h-[300px] overflow-y-auto">
          {data.targets.map((t, i) => (
            <TargetLineRow
              key={t._id || i}
              line={t}
              period={period}
              periodKey={data.month}
              onSaved={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TargetLineRow({ line, period, periodKey, onSaved }: {
  line: TargetLine;
  period: 'monthly' | 'weekly';
  periodKey: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(line.etaDate ? line.etaDate.slice(0, 10) : '');
  const [note, setNote] = useState(line.employeeNote || '');
  const [saving, setSaving] = useState(false);

  const pct = line.target > 0 ? Math.min(1.5, line.actual / line.target) : 0;
  const pctVis = Math.min(1, pct);
  const display = `${line.actual} / ${line.target}${line.unit ? ' ' + line.unit : ''}`;

  const save = async () => {
    if (!line._id) return;
    setSaving(true);
    try {
      await api.setMyTargetLineEta(line._id, {
        etaDate: date || null,
        employeeNote: note,
      }, { period, month: periodKey });
      setEditing(false);
      onSaved();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  };

  return (
    <li>
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <span className="text-[11.5px] font-medium truncate">{line.label}</span>
        <span className={`text-[11px] tabular-nums font-bold shrink-0 ${pct >= 1 ? 'text-emerald-600' : 'text-foreground'}`}>
          {display}
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mb-1.5">
        <div className={`h-full rounded-full transition-all ${TONE_FOR_PCT(pct)}`} style={{ width: `${pctVis * 100}%` }} />
      </div>

      {editing ? (
        <div className="space-y-1.5 mt-1">
          <div className="flex items-center gap-1.5 text-[10.5px]">
            <Clock className="h-3 w-3 text-violet-600 shrink-0" />
            <span className="text-muted-foreground">I'll hit this by</span>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="px-1.5 h-6 rounded border border-input bg-background text-[10.5px] focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Short note for admin (optional)"
            maxLength={280}
            className="w-full px-2 h-6 rounded border border-input bg-background text-[10.5px] focus:ring-1 focus:ring-violet-500"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-6 px-2 rounded bg-violet-600 text-white text-[10px] font-semibold inline-flex items-center gap-0.5 disabled:opacity-50 hover:bg-violet-700"
            >
              <Check className="h-2.5 w-2.5" /> Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >Cancel</button>
          </div>
        </div>
      ) : (line.etaDate || line.employeeNote) ? (
        <div className="flex items-center gap-1.5 text-[10.5px]">
          <Clock className="h-3 w-3 text-violet-600" />
          {line.etaDate && <span className="text-foreground/80">by {format(parseISO(line.etaDate), 'MMM d')}</span>}
          {line.employeeNote && <span className="text-muted-foreground truncate">· {line.employeeNote}</span>}
          <button type="button" onClick={() => setEditing(true)} className="text-violet-700 hover:underline">edit</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10.5px] text-muted-foreground hover:text-violet-700 inline-flex items-center gap-1"
        >
          <Pencil className="h-2.5 w-2.5" /> Add your ETA / note
        </button>
      )}
    </li>
  );
}
