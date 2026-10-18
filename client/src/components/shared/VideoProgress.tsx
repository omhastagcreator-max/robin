import { useState } from 'react';

/**
 * Video progress — Oct 2026 (owner: "one progress option per client that
 * shows X videos: Y delivered, 3 in editing…"). Bar = read-only view used on
 * the SOP board, Decision Tree and Rahul's board; Editor = what Priyanka /
 * Amit fill in (also inside the login popup).
 */
export interface Progress {
  total: number; scripting: number; shooting: number; editing: number; delivered: number; notStarted: number;
  note?: string; updatedAt?: string | null; label: string; confirmed: boolean;
}
const SEG = [
  { k: 'delivered', label: 'Delivered', cls: 'bg-emerald-500' },
  { k: 'editing', label: 'Editing', cls: 'bg-blue-500' },
  { k: 'shooting', label: 'With creator', cls: 'bg-violet-500' },
  { k: 'scripting', label: 'Script', cls: 'bg-amber-400' },
  { k: 'notStarted', label: 'Not started', cls: 'bg-slate-700' },
] as const;

export function VideoProgressBar({ p, compact = false }: { p?: Progress | null; compact?: boolean }) {
  if (!p || !p.total) return <span className="text-[10.5px] text-amber-300">Video count not set yet</span>;
  return (
    <div className="min-w-0" title={p.label}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800" role="img" aria-label={p.label}>
        {SEG.map(s => { const v = (p as any)[s.k] || 0; return v ? <div key={s.k} className={s.cls} style={{ width: `${(v / p.total) * 100}%` }} /> : null; })}
      </div>
      <div className={`mt-1 ${compact ? 'text-[10.5px]' : 'text-[11.5px]'} text-slate-300`}>
        <b className="text-white">{p.delivered}/{p.total} delivered</b>
        {p.editing ? ` · ${p.editing} editing` : ''}{p.shooting ? ` · ${p.shooting} with creator` : ''}{p.scripting ? ` · ${p.scripting} script` : ''}{p.notStarted ? ` · ${p.notStarted} not started` : ''}
        {!p.confirmed && <span className="text-amber-300"> · not confirmed</span>}
      </div>
    </div>
  );
}

export function VideoProgressEditor({ initial, onSave, busy }: { initial?: Progress | null; onSave: (v: { total: number; scripting: number; shooting: number; editing: number; delivered: number; note: string }) => void; busy?: boolean }) {
  const [v, setV] = useState({
    total: initial?.total || 0, scripting: initial?.scripting || 0, shooting: initial?.shooting || 0,
    editing: initial?.editing || 0, delivered: initial?.delivered || 0, note: '',
  });
  const used = v.scripting + v.shooting + v.editing + v.delivered;
  const over = used > v.total;
  const num = (k: keyof typeof v, label: string) => (
    <label className="text-[11px] text-slate-400">{label}
      <input type="number" min={0} value={(v as any)[k]} onChange={e => setV({ ...v, [k]: Math.max(0, Number(e.target.value) || 0) })}
        className="mt-0.5 w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-white tabular-nums" />
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-2">
        {num('total', 'Total videos')}{num('scripting', 'In script')}{num('shooting', 'With creator')}{num('editing', 'In editing')}{num('delivered', 'Delivered')}
      </div>
      <div className={`text-[11px] ${over ? 'text-rose-400' : 'text-slate-400'}`}>
        {over ? `These add up to ${used} — more than ${v.total} total.` : `${Math.max(0, v.total - used)} not started yet.`}
      </div>
      <div className="flex gap-2">
        <input value={v.note} onChange={e => setV({ ...v, note: e.target.value })} placeholder="Note (optional) — e.g. 2 videos waiting on client feedback"
          className="flex-1 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-slate-600" />
        <button disabled={busy || over || v.total < 1} onClick={() => onSave(v)} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Save video status</button>
      </div>
    </div>
  );
}
