import { useEffect, useState } from 'react';
import { Target, Plus, X, Save, Sparkles } from 'lucide-react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * ExecutiveTargetsSection — monthly performance overview for the team.
 *
 * Admin view: every active employee + their targets for the current
 * month, with set/edit dialog. Sales view: read-only.
 *
 * Compact: per-employee card shows up to 3 target bars; "Edit" opens
 * an inline form to add/remove/change lines.
 *
 * Auto-actuals: target lines with source != 'manual' get their actual
 * value refreshed by the server on every GET (counts completed tasks /
 * services / brand launches for the current month).
 */

interface TargetLine {
  _id?: string;
  label: string;
  target: number;
  unit?: string;
  actual: number;
  source: 'tasks_done' | 'services_done' | 'brands_live' | 'manual';
}
interface TeamRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
  targets: TargetLine[];
  notes: string;
  exists: boolean;
  month: string;
}

export function ExecutiveTargetsSection() {
  const { role } = useAuth();
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    api.getTeamTargets()
      .then((d: TeamRow[]) => setTeam(Array.isArray(d) ? d : []))
      .catch(() => setTeam([]))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-3 text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 animate-pulse" /> Loading targets…
      </div>
    );
  }

  // Limit roster to people who have actually been set up (filters seed
  // accounts). Sort: with targets first, alphabetical within.
  const sorted = team
    .slice()
    .sort((a, b) => {
      if (a.exists !== b.exists) return a.exists ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-violet-600" />
          <p className="text-[12px] font-bold">Team targets</p>
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          {team[0]?.month || ''}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
        {sorted.map(row =>
          editingUserId === row.userId ? (
            <TargetEditor
              key={row.userId}
              row={row}
              onClose={() => setEditingUserId(null)}
              onSaved={() => { setEditingUserId(null); refresh(); }}
            />
          ) : (
            <TargetTile
              key={row.userId}
              row={row}
              canEdit={role === 'admin'}
              onEdit={() => setEditingUserId(row.userId)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function TargetTile({ row, canEdit, onEdit }: { row: TeamRow; canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background px-3 py-2.5 hover:border-violet-500/30 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        {row.avatarUrl
          ? <img src={row.avatarUrl} alt="" className="h-6 w-6 rounded-lg object-cover" />
          : <div className="h-6 w-6 rounded-lg bg-violet-500/12 text-violet-700 flex items-center justify-center text-[10px] font-bold">
              {row.name?.slice(0, 1).toUpperCase()}
            </div>}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold truncate">{row.name || row.email}</p>
          <p className="text-[10.5px] text-muted-foreground capitalize">{row.role}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-[10.5px] text-violet-700 hover:underline"
          >
            {row.exists ? 'Edit' : 'Set'}
          </button>
        )}
      </div>
      {row.targets.length === 0 ? (
        <p className="text-[10.5px] text-muted-foreground italic">No targets set.</p>
      ) : (
        <ul className="space-y-1.5">
          {row.targets.slice(0, 3).map((t, i) => {
            const pct = t.target > 0 ? Math.min(1, t.actual / t.target) : 0;
            const tone =
              pct >= 1   ? 'bg-emerald-500' :
              pct >= 0.7 ? 'bg-blue-500' :
              pct >= 0.4 ? 'bg-amber-500' :
                           'bg-rose-500';
            return (
              <li key={t._id || i}>
                <div className="flex items-baseline justify-between mb-0.5">
                  <span className="text-[10.5px] truncate">{t.label}</span>
                  <span className="text-[10px] tabular-nums font-semibold text-foreground/80">
                    {t.actual} / {t.target}{t.unit ? ' ' + t.unit : ''}
                  </span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${tone}`} style={{ width: `${pct * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TargetEditor({ row, onClose, onSaved }: { row: TeamRow; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<TargetLine[]>(row.targets.length ? row.targets : [{ label: '', target: 0, unit: '', actual: 0, source: 'manual' }]);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<TargetLine>) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines(prev => [...prev, { label: '', target: 0, unit: '', actual: 0, source: 'manual' }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = lines.filter(l => l.label.trim());
      await api.setUserTargets(row.userId, { targets: cleaned });
      onSaved();
    } catch { /* leave the editor open so the admin can retry */ }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-violet-500/40 bg-background px-3 py-2.5 ring-1 ring-violet-500/10">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[12px] font-semibold flex-1 truncate">{row.name}'s targets</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-1.5 mb-2">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_60px_50px_90px_auto] gap-1 items-center">
            <input
              value={l.label}
              onChange={e => update(i, { label: e.target.value })}
              placeholder="e.g. Brand launches"
              className="px-2 h-7 text-[11px] rounded-md border border-input bg-background focus:ring-1 focus:ring-violet-500"
            />
            <input
              type="number"
              min={0}
              value={l.target}
              onChange={e => update(i, { target: Math.max(0, parseInt(e.target.value || '0', 10)) })}
              className="px-2 h-7 text-[11px] rounded-md border border-input bg-background tabular-nums focus:ring-1 focus:ring-violet-500"
            />
            <input
              value={l.unit || ''}
              onChange={e => update(i, { unit: e.target.value })}
              placeholder="unit"
              className="px-2 h-7 text-[11px] rounded-md border border-input bg-background focus:ring-1 focus:ring-violet-500"
            />
            <select
              value={l.source}
              onChange={e => update(i, { source: e.target.value as TargetLine['source'] })}
              className="h-7 text-[11px] rounded-md border border-input bg-background focus:ring-1 focus:ring-violet-500"
            >
              <option value="manual">Manual</option>
              <option value="tasks_done">Tasks done</option>
              <option value="services_done">Services done</option>
              <option value="brands_live">Brands launched</option>
            </select>
            <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-rose-600">
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <button type="button" onClick={addLine} className="text-[10.5px] text-violet-700 inline-flex items-center gap-0.5 hover:underline">
          <Plus className="h-3 w-3" /> Add line
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-7 px-2.5 rounded-md bg-violet-600 text-white text-[10.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 hover:bg-violet-700"
        >
          <Save className="h-3 w-3" /> Save
        </button>
      </div>
    </div>
  );
}
