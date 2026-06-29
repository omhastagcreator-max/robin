import { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock, Circle, ChevronRight, Users, PieChart as PieChartIcon } from 'lucide-react';

/**
 * BrandPipelinePie — at-a-glance "what's done vs. what's remaining" view
 * for a single brand's pipeline, with click-through drilldown.
 *
 * Owner ask (June 2026):
 *   "For client project pipeline, a pie chart with Meta in Meta color,
 *    Shopify in Shopify color, Video in a unique color so someone can
 *    easily see what's done and what's remaining. Click individual
 *    parts to know more. Or design an intelligent view with employee-
 *    level entry."
 *
 * Three things in one card:
 *
 *   1. Pie  — each service is a slice sized by total checklist weight.
 *             Each slice is rendered in two arcs: the bright "done"
 *             portion + a muted "remaining" portion in the same hue.
 *             Brand-true colors:
 *               • Shopify    → #95BF47  (Shopify green)
 *               • Meta Ads   → #1877F2  (Meta blue)
 *               • Influencer → #A855F7  (vivid purple — distinct from
 *                              the two brand colors above)
 *
 *   2. Click a slice (or its legend chip) → drilldown panel below
 *      lists every checklist item with done/not state, assignee, and
 *      stage status. Click the same slice again to collapse.
 *
 *   3. View toggle — switch to "By teammate" to see who's responsible
 *      for what across the whole brand. Each teammate's row shows
 *      their service(s) + open vs. done counts. Clicking a teammate
 *      filters drilldown to their work only.
 *
 * Pure SVG pie — no chart library. Tiny, fast, fully styleable.
 */

export interface BrandPipelineService {
  _id?: string;
  serviceType: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: Array<{ _id?: string; text?: string; title?: string; done: boolean; doneBy?: string }>;
  assignedTo?: string;
}

export interface BrandPipelineUser { _id: string; name?: string }

const COLORS: Record<string, { base: string; dim: string; label: string }> = {
  meta_ads:   { base: '#1877F2', dim: '#1877F230', label: 'Meta Ads' },
  shopify:    { base: '#95BF47', dim: '#95BF4730', label: 'Shopify' },
  influencer: { base: '#A855F7', dim: '#A855F730', label: 'Video / Influencer' },
};
const FALLBACK = { base: '#64748B', dim: '#64748B30', label: 'Service' };

function colorFor(serviceType: string) {
  return COLORS[serviceType] || FALLBACK;
}

interface SliceData {
  service: BrandPipelineService;
  total: number;
  done: number;
  pct: number;          // 0..1 done fraction
  share: number;        // share of the WHOLE pie (size of slice)
  startAngle: number;   // radians
  endAngle: number;
  color: { base: string; dim: string; label: string };
}

export function BrandPipelinePie({
  services,
  users = [],
  onLeaveIds = [],
}: {
  services: BrandPipelineService[];
  users?: BrandPipelineUser[];
  onLeaveIds?: string[];
}) {
  const [activeSliceIdx, setActiveSliceIdx] = useState<number | null>(null);
  const [view, setView] = useState<'pie' | 'employees'>('pie');
  const [activeEmployee, setActiveEmployee] = useState<string | null>(null);

  const usersById = useMemo(
    () => new Map(users.map(u => [String(u._id), u])),
    [users],
  );

  /* ─────────────── Slice geometry + per-service totals ─────────────── */
  const slices = useMemo<SliceData[]>(() => {
    // First pass: compute totals so we can size each slice by checklist
    // count. Brands with no checklists fall back to 1 each so the pie
    // still renders meaningful slices (vs. zero-area math errors).
    const raw = services.map(svc => {
      const total = svc.checklist?.length || 0;
      const done  = (svc.checklist || []).filter(c => c.done).length;
      return { service: svc, total: Math.max(total, 1), done };
    });
    const grandTotal = raw.reduce((s, r) => s + r.total, 0) || 1;

    let angle = -Math.PI / 2;     // 12 o'clock
    return raw.map(({ service, total, done }) => {
      const share = total / grandTotal;
      const sweep = share * Math.PI * 2;
      const startAngle = angle;
      const endAngle   = angle + sweep;
      angle = endAngle;
      return {
        service,
        total,
        done,
        pct: total === 0 ? 0 : done / total,
        share,
        startAngle,
        endAngle,
        color: colorFor(service.serviceType),
      };
    });
  }, [services]);

  const grand = useMemo(() => {
    const total = slices.reduce((s, x) => s + x.total, 0);
    const done  = slices.reduce((s, x) => s + x.done,  0);
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [slices]);

  /* ─────────────── Employee rollup ─────────────── */
  const employeeRows = useMemo(() => {
    const map = new Map<string, {
      userId: string;
      name: string;
      services: BrandPipelineService[];
      total: number;
      done: number;
    }>();
    for (const svc of services) {
      const uid = String(svc.assignedTo || '');
      if (!uid) continue;
      const name = usersById.get(uid)?.name || 'Unknown';
      const total = svc.checklist?.length || 0;
      const done  = (svc.checklist || []).filter(c => c.done).length;
      const cur = map.get(uid) || { userId: uid, name, services: [], total: 0, done: 0 };
      cur.services.push(svc);
      cur.total += total;
      cur.done  += done;
      map.set(uid, cur);
    }
    return Array.from(map.values()).sort((a, b) => (b.total - b.done) - (a.total - a.done));
  }, [services, usersById]);

  /* ─────────────── Drilldown selection ─────────────── */
  const activeSlice = activeSliceIdx == null ? null : slices[activeSliceIdx];
  const activeEmpRow = activeEmployee ? employeeRows.find(e => e.userId === activeEmployee) : null;

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* Header + view toggle */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight flex items-center gap-1.5">
            <PieChartIcon className="h-3.5 w-3.5" />
            Project pipeline · {grand.pct}% done
          </p>
          <p className="text-[11.5px] text-muted-foreground">
            {grand.done} of {grand.total} checklist items complete · click a slice to drill in
          </p>
        </div>
        <div className="inline-flex p-0.5 rounded-lg bg-muted/50 border border-border text-[11px] font-semibold">
          <button
            onClick={() => { setView('pie'); setActiveEmployee(null); }}
            className={'h-7 px-2.5 rounded-md inline-flex items-center gap-1 ' + (view === 'pie' ? 'bg-card shadow-sm' : 'text-muted-foreground')}
          >
            <PieChartIcon className="h-3 w-3" /> Services
          </button>
          <button
            onClick={() => { setView('employees'); setActiveSliceIdx(null); }}
            className={'h-7 px-2.5 rounded-md inline-flex items-center gap-1 ' + (view === 'employees' ? 'bg-card shadow-sm' : 'text-muted-foreground')}
          >
            <Users className="h-3 w-3" /> By teammate
          </button>
        </div>
      </div>

      {/* Body */}
      {view === 'pie' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
          <Pie
            slices={slices}
            grandPct={grand.pct}
            activeIdx={activeSliceIdx}
            onSelect={(i) => setActiveSliceIdx(prev => prev === i ? null : i)}
          />
          <Legend
            slices={slices}
            activeIdx={activeSliceIdx}
            onSelect={(i) => setActiveSliceIdx(prev => prev === i ? null : i)}
          />
        </div>
      )}

      {view === 'employees' && (
        <div className="p-4">
          {employeeRows.length === 0 && (
            <p className="text-[12px] text-muted-foreground italic">Nobody assigned yet — assign services to teammates to see their lanes.</p>
          )}
          <div className="space-y-1.5">
            {employeeRows.map(row => {
              const pct = row.total ? Math.round((row.done / row.total) * 100) : 0;
              const onLeave = onLeaveIds.includes(row.userId);
              const active  = activeEmployee === row.userId;
              return (
                <button
                  key={row.userId}
                  onClick={() => setActiveEmployee(prev => prev === row.userId ? null : row.userId)}
                  className={
                    'relative w-full text-left rounded-lg border px-3 py-2 transition-colors ' +
                    (active ? 'bg-muted/40 border-foreground/20' : 'bg-background border-border hover:bg-muted/30')
                  }
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                      {(row.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-[13px] font-semibold">{row.name}</span>
                    {onLeave && <span className="text-[10px] uppercase tracking-wider font-bold bg-amber-500/15 text-amber-700 px-1.5 py-0.5 rounded">on leave</span>}
                    <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
                      {row.done}/{row.total} · {pct}%
                    </span>
                  </div>
                  {/* Stacked service bars */}
                  <div className="h-2 rounded-full overflow-hidden bg-muted/40 flex">
                    {row.services.map((svc, i) => {
                      const c = colorFor(svc.serviceType);
                      const total = svc.checklist?.length || 1;
                      const done  = (svc.checklist || []).filter(x => x.done).length;
                      const flex  = total;
                      return (
                        <div key={i} className="relative" style={{ flex }}>
                          <div className="absolute inset-0" style={{ background: c.dim }} />
                          <div className="absolute inset-y-0 left-0" style={{ width: `${(done / total) * 100}%`, background: c.base }} />
                        </div>
                      );
                    })}
                  </div>
                  <ChevronRight className={'h-3 w-3 text-muted-foreground absolute right-2 top-2 transition-transform ' + (active ? 'rotate-90' : '')} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Drilldown */}
      {(activeSlice || activeEmpRow) && (
        <div className="border-t border-border bg-muted/20 p-4">
          {activeSlice && (
            <DrilldownService slice={activeSlice} usersById={usersById} onClose={() => setActiveSliceIdx(null)} />
          )}
          {activeEmpRow && !activeSlice && (
            <DrilldownEmployee row={activeEmpRow} onClose={() => setActiveEmployee(null)} />
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────── Pie SVG ───────────────────────────────── */

function Pie({
  slices, grandPct, activeIdx, onSelect,
}: {
  slices: SliceData[];
  grandPct: number;
  activeIdx: number | null;
  onSelect: (i: number) => void;
}) {
  const R_OUTER = 90;
  const R_INNER = 50;            // donut hole — keeps center label readable
  const CX = 110, CY = 110;
  const VB = 220;

  if (slices.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-[12px] text-muted-foreground italic">
        No services on this brand yet.
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center">
      <svg viewBox={`0 0 ${VB} ${VB}`} className="w-full max-w-[260px] aspect-square">
        {slices.map((s, i) => {
          const active = activeIdx === i;
          const r = active ? R_OUTER + 4 : R_OUTER;
          // The slice is two arcs:
          //   (a) "remaining" arc — muted dim color, full sweep
          //   (b) "done"      arc — bright base color, only pct sweep
          // Both share the same start angle; the done arc ends earlier
          // so the user sees the unfilled portion of every slice in the
          // service's own hue (vs. one global grey blob).
          const sweep = s.endAngle - s.startAngle;
          const doneEnd = s.startAngle + sweep * s.pct;

          return (
            <g key={i} onClick={() => onSelect(i)} style={{ cursor: 'pointer' }}>
              {/* Remaining (dim) */}
              <path
                d={arcPath(CX, CY, r, R_INNER, s.startAngle, s.endAngle)}
                fill={s.color.dim}
                stroke="hsl(var(--background))"
                strokeWidth={1}
                opacity={active ? 1 : 0.95}
              />
              {/* Done (bright) — drawn on top */}
              {s.pct > 0 && (
                <path
                  d={arcPath(CX, CY, r, R_INNER, s.startAngle, doneEnd)}
                  fill={s.color.base}
                  stroke="hsl(var(--background))"
                  strokeWidth={1}
                />
              )}
            </g>
          );
        })}

        {/* Center label */}
        <text x={CX} y={CY - 4} textAnchor="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 800 }}>
          {grandPct}%
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
          {activeIdx == null ? 'OVERALL' : slices[activeIdx]?.color.label}
        </text>
      </svg>
    </div>
  );
}

function Legend({ slices, activeIdx, onSelect }: {
  slices: SliceData[];
  activeIdx: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="space-y-1.5 flex flex-col justify-center">
      {slices.length === 0 && (
        <p className="text-[12px] text-muted-foreground italic">No services yet.</p>
      )}
      {slices.map((s, i) => {
        const active = activeIdx === i;
        const pct = Math.round(s.pct * 100);
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={
              'w-full text-left rounded-lg border px-3 py-2 transition-all ' +
              (active ? 'bg-muted/40 border-foreground/20 scale-[1.01]' : 'bg-background border-border hover:bg-muted/30')
            }
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color.base }} />
              <span className="text-[12.5px] font-bold">{s.color.label}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{s.done}/{s.total}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: s.color.dim }}>
              <div className="h-full" style={{ background: s.color.base, width: `${pct}%` }} />
            </div>
            <p className="text-[10.5px] text-muted-foreground mt-1 flex items-center gap-1">
              <StatusDot status={s.service.status} /> {labelForStatus(s.service.status)} · {pct}% done
            </p>
          </button>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'done'        ? 'bg-emerald-500' :
    status === 'blocked'     ? 'bg-rose-500'    :
    status === 'in_progress' ? 'bg-blue-500'    :
                               'bg-muted-foreground';
  return <span className={'h-1.5 w-1.5 rounded-full ' + cls} />;
}

function labelForStatus(status: string) {
  if (status === 'done')        return 'Done';
  if (status === 'blocked')     return 'Blocked';
  if (status === 'in_progress') return 'In progress';
  return 'Pending';
}

/* ─────────────────────────────── Drilldowns ─────────────────────────────── */

function DrilldownService({
  slice, usersById, onClose,
}: {
  slice: SliceData;
  usersById: Map<string, BrandPipelineUser>;
  onClose: () => void;
}) {
  const { service, color, done, total, pct } = slice;
  const assignee = service.assignedTo ? usersById.get(String(service.assignedTo))?.name : null;
  const items = service.checklist || [];
  const open = items.filter(c => !c.done);
  const closed = items.filter(c => c.done);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: color.base }} />
          <p className="text-sm font-bold truncate">{color.label}</p>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] font-semibold">{Math.round(pct * 100)}% done</span>
        </div>
        <button onClick={onClose} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Close ✕</button>
      </div>
      <div className="flex items-center gap-2 mb-2 text-[11px]">
        {assignee
          ? <span className="bg-card border border-border rounded-full px-2 py-0.5 font-semibold">Owner · {assignee}</span>
          : <span className="bg-rose-500/10 border border-rose-500/30 text-rose-700 rounded-full px-2 py-0.5 font-semibold">No owner assigned</span>}
        <span className="bg-card border border-border rounded-full px-2 py-0.5 font-semibold">
          {done}/{total} items
        </span>
        <span className="bg-card border border-border rounded-full px-2 py-0.5 font-semibold inline-flex items-center gap-1">
          <StatusDot status={service.status} /> {labelForStatus(service.status)}
        </span>
      </div>

      {items.length === 0 && (
        <p className="text-[12px] text-muted-foreground italic">No checklist items on this service yet.</p>
      )}
      {open.length > 0 && (
        <div className="mb-2">
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Remaining · {open.length}</p>
          <ul className="space-y-1">
            {open.map((c, i) => (
              <li key={i} className="flex items-start gap-2 bg-background border border-border rounded px-2 py-1.5 text-[12px]">
                <Circle className="h-3 w-3 mt-0.5 text-muted-foreground" />
                <span className="min-w-0">{c.text || c.title || 'Untitled item'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {closed.length > 0 && (
        <div>
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-emerald-700/80 mb-1">Done · {closed.length}</p>
          <ul className="space-y-1">
            {closed.map((c, i) => (
              <li key={i} className="flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-1.5 text-[12px]">
                <CheckCircle2 className="h-3 w-3 mt-0.5 text-emerald-600" />
                <span className="min-w-0 line-through text-muted-foreground">{c.text || c.title || 'Untitled item'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DrilldownEmployee({ row, onClose }: {
  row: { userId: string; name: string; services: BrandPipelineService[]; total: number; done: number };
  onClose: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-bold">{row.name}'s lanes ({row.done}/{row.total})</p>
        <button onClick={onClose} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Close ✕</button>
      </div>
      <div className="space-y-2">
        {row.services.map((svc, i) => {
          const c = colorFor(svc.serviceType);
          const total = svc.checklist?.length || 0;
          const done  = (svc.checklist || []).filter(x => x.done).length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <div key={i} className="bg-background border border-border rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.base }} />
                <p className="text-[12.5px] font-bold">{c.label}</p>
                <span className="ml-auto text-[11px] font-semibold">{done}/{total} · {pct}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: c.dim }}>
                <div className="h-full" style={{ background: c.base, width: `${pct}%` }} />
              </div>
              {svc.status === 'blocked' && (
                <p className="mt-1 text-[11px] text-rose-700 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Blocked</p>
              )}
              {svc.status === 'in_progress' && (
                <p className="mt-1 text-[11px] text-blue-700 flex items-center gap-1"><Clock className="h-3 w-3" /> In progress</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Geometry ───────────────────────────────── */

/**
 * SVG path for a donut slice between two angles (in radians, 0 = right,
 * −π/2 = top). Builds outer arc, line to inner radius, inner arc back,
 * close. Works for sweeps from very small up to a full circle, with the
 * `large-arc` flag automatically set for sweeps > π.
 */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const TAU = Math.PI * 2;
  const sweep = Math.max(0, Math.min(TAU, a1 - a0));
  if (sweep <= 0.001) return '';
  // If it's a full circle, SVG arcs need to be split into two halves.
  if (Math.abs(sweep - TAU) < 0.001) {
    const x1 = cx + rOuter, y1 = cy;
    const x2 = cx - rOuter, y2 = cy;
    const xi1 = cx + rInner, yi1 = cy;
    const xi2 = cx - rInner, yi2 = cy;
    return [
      `M ${x1} ${y1}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${x2} ${y2}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${x1} ${y1}`,
      `M ${xi1} ${yi1}`,
      `A ${rInner} ${rInner} 0 1 0 ${xi2} ${yi2}`,
      `A ${rInner} ${rInner} 0 1 0 ${xi1} ${yi1}`,
      'Z',
    ].join(' ');
  }
  const large = sweep > Math.PI ? 1 : 0;
  const sx = cx + rOuter * Math.cos(a0);
  const sy = cy + rOuter * Math.sin(a0);
  const ex = cx + rOuter * Math.cos(a1);
  const ey = cy + rOuter * Math.sin(a1);
  const isx = cx + rInner * Math.cos(a1);
  const isy = cy + rInner * Math.sin(a1);
  const iex = cx + rInner * Math.cos(a0);
  const iey = cy + rInner * Math.sin(a0);
  return [
    `M ${sx} ${sy}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${ex} ${ey}`,
    `L ${isx} ${isy}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${iex} ${iey}`,
    'Z',
  ].join(' ');
}

export default BrandPipelinePie;
