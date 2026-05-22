import { useMemo, useState } from 'react';
import {
  Search, Phone, Calendar, ChevronRight,
  Rows3, AlignJustify, LayoutGrid, Smartphone, Sparkles, Mail,
} from 'lucide-react';
import { format } from 'date-fns';

/**
 * LeadListView — one row per lead, stage as a coloured pill, searchable
 * by name / phone / email / company. Both admin and Rishi use this when
 * they want to answer "where is X right now?" without scanning the kanban.
 *
 * Now offers FOUR layouts so the rep can pick the shape that fits today's
 * work (toggle persists via localStorage):
 *
 *   - Comfortable — the classic 5-column row. Best general view.
 *   - Compact    — single-line dense rows, ~2x leads per fold for scan-
 *                  heavy days.
 *   - Cards      — visual grid with AI score + next action visible per
 *                  card. Best when picking who to call next.
 *   - Phone-first — large tappable phone numbers. Built for call-heavy
 *                   blitz days (think Monday morning follow-ups).
 *
 * Sortable in three flips: by created date, stage, or estimated value.
 */

interface Stage { key: string; label: string; bg?: string; text?: string }

interface Props {
  leads: any[];
  onView: (lead: any) => void;
  onMove: (id: string, stage: string) => void;
  stageMeta: ReadonlyArray<Stage>;
}

type SortKey = 'newest' | 'stage' | 'value';
type LeadViewKey = 'comfy' | 'compact' | 'cards' | 'phone';

const LS_VIEW = 'sales.leadList.view';

const VIEW_OPTIONS: Array<{ key: LeadViewKey; label: string; icon: any; hint: string }> = [
  { key: 'comfy',   label: 'Comfortable', icon: Rows3,         hint: '5-column row, balanced' },
  { key: 'compact', label: 'Compact',     icon: AlignJustify,  hint: 'Single line, dense' },
  { key: 'cards',   label: 'Cards',       icon: LayoutGrid,    hint: 'AI score + next action visible' },
  { key: 'phone',   label: 'Phone-first', icon: Smartphone,    hint: 'Big tappable numbers' },
];

/** Map AI score → soft chip class. */
function aiScoreClass(score?: string): string {
  if (score === 'hot')  return 'bg-rose-500/15 text-rose-700';
  if (score === 'warm') return 'bg-amber-500/15 text-amber-700';
  if (score === 'cold') return 'bg-sky-500/15 text-sky-700';
  return 'bg-muted text-muted-foreground';
}

/** Tiny payment chip — shows on Cards / Phone-first / Compact views so
 *  the rep can see "₹15k of 30k paid" without opening the drawer. */
function PaymentChip({ lead }: { lead: any }) {
  const status: string = lead.paymentStatus || 'none';
  if (status === 'none') return null;
  const paid  = lead.paymentPaid  || 0;
  const total = lead.paymentTotal || lead.estimatedValue || 0;
  const cfg: Record<string, string> =
    status === 'full_paid' ? 'bg-emerald-500/15 text-emerald-700'    as any
    : status === 'refunded' ? 'bg-rose-500/15 text-rose-700'         as any
    :                         'bg-amber-500/15 text-amber-700'       as any;
  const cls = typeof cfg === 'string' ? cfg : 'bg-muted text-muted-foreground';
  const fmt = (n: number) =>
    n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L`
    : n >= 1000   ? `₹${(n / 1000).toFixed(0)}k`
    :               `₹${n}`;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`}>
      {status === 'full_paid' ? 'paid'
        : status === 'refunded' ? 'refunded'
        : total > 0 ? `${fmt(paid)} of ${fmt(total)}`
        :             `${fmt(paid)} part`}
    </span>
  );
}

export function LeadListView({ leads, onView, onMove, stageMeta }: Props) {
  const [q, setQ]             = useState('');
  const [stageFilter, setSF]  = useState<string>('all');
  const [sort, setSort]       = useState<SortKey>('newest');
  const [view, setView_]      = useState<LeadViewKey>(() => {
    try { return (localStorage.getItem(LS_VIEW) as LeadViewKey) || 'comfy'; }
    catch { return 'comfy'; }
  });
  const setView = (v: LeadViewKey) => { setView_(v); try { localStorage.setItem(LS_VIEW, v); } catch { /* private mode */ } };
  const stageMap = useMemo(() => Object.fromEntries(stageMeta.map(s => [s.key, s])), [stageMeta]);

  const filtered = useMemo(() => {
    let out = leads.slice();
    if (stageFilter !== 'all') out = out.filter(l => (l.stage || l.status) === stageFilter);
    if (q.trim()) {
      const term = q.trim().toLowerCase();
      out = out.filter(l =>
        (l.name    || '').toLowerCase().includes(term) ||
        (l.contact || '').toLowerCase().includes(term) ||
        (l.email   || '').toLowerCase().includes(term) ||
        (l.company || '').toLowerCase().includes(term)
      );
    }
    if (sort === 'newest') out.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    if (sort === 'stage')  out.sort((a, b) => (a.stage || a.status || '').localeCompare(b.stage || b.status || ''));
    if (sort === 'value')  out.sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0));
    return out;
  }, [leads, q, stageFilter, sort]);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
        <div className="flex-1 min-w-[180px] flex items-center gap-2 bg-background border border-input rounded-lg px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, phone, email, company…"
            className="flex-1 text-xs bg-transparent outline-none"
          />
        </div>
        <select value={stageFilter} onChange={e => setSF(e.target.value)}
          className="text-xs px-2 py-1.5 bg-background border border-input rounded-lg cursor-pointer">
          <option value="all">All stages ({leads.length})</option>
          {stageMeta.map(s => (
            <option key={s.key} value={s.key}>
              {s.label} ({leads.filter(l => (l.stage || l.status) === s.key).length})
            </option>
          ))}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
          className="text-xs px-2 py-1.5 bg-background border border-input rounded-lg cursor-pointer">
          <option value="newest">Sort: Newest first</option>
          <option value="stage">Sort: Stage</option>
          <option value="value">Sort: Value (high → low)</option>
        </select>

        {/* View toggle — 4 layouts, persists to localStorage */}
        <div className="inline-flex items-center rounded-lg border border-border bg-card overflow-hidden">
          {VIEW_OPTIONS.map(o => {
            const Icon = o.icon;
            const active = view === o.key;
            return (
              <button
                key={o.key}
                onClick={() => setView(o.key)}
                title={`${o.label} — ${o.hint}`}
                className={`h-7 px-2 flex items-center gap-1 text-[11px] font-semibold transition-colors ${
                  active ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{o.label}</span>
              </button>
            );
          })}
        </div>

        <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
          {filtered.length} of {leads.length}
        </span>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-12">
          No leads match. Clear the filters or wait for sheet sync.
        </div>
      )
      // ── COMFORTABLE — the classic row layout ─────────────────────────
      : view === 'comfy' ? (
        <div className="divide-y divide-border max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map(lead => {
            const currentStage = lead.stage || lead.status;
            const stage = stageMap[currentStage] as Stage | undefined;
            const isNew = lead.createdAt && Date.now() - new Date(lead.createdAt).getTime() < 60 * 60 * 1000;
            return (
              <div
                key={lead._id}
                className="grid grid-cols-[1fr_140px_120px_140px_36px] gap-3 items-center px-4 py-2.5 hover:bg-muted/30 transition-colors group"
              >
                <button onClick={() => onView(lead)} className="text-left min-w-0 flex items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                      {lead.name || '—'}
                      {isNew && (
                        <span className="bg-emerald-500 text-white text-[8px] font-black uppercase px-1 py-0 rounded tracking-wider">
                          New
                        </span>
                      )}
                    </p>
                    {lead.company && <p className="text-[10px] text-muted-foreground truncate">{lead.company}</p>}
                  </div>
                </button>
                <div className="min-w-0">
                  {lead.contact ? (
                    <a href={`tel:${lead.contact}`} className="text-[11px] text-primary hover:underline tabular-nums truncate flex items-center gap-1">
                      <Phone className="h-2.5 w-2.5 shrink-0" /> {lead.contact}
                    </a>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/60">no phone</span>
                  )}
                </div>
                <select
                  value={currentStage}
                  onChange={(e) => onMove(lead._id, e.target.value)}
                  className={`text-[10px] px-2 py-1 rounded-md border cursor-pointer font-semibold ${stage?.bg || 'bg-muted'} ${stage?.text || 'text-foreground'}`}
                  title="Change stage"
                >
                  {stageMeta.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5" />
                  {lead.createdAt ? format(new Date(lead.createdAt), 'dd MMM yyyy') : '—'}
                </div>
                <button onClick={() => onView(lead)} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary opacity-50 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )
      // ── COMPACT — single dense line, max scanning speed ──────────────
      : view === 'compact' ? (
        <div className="divide-y divide-border/60 max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map(lead => {
            const currentStage = lead.stage || lead.status;
            const stage = stageMap[currentStage] as Stage | undefined;
            return (
              <div key={lead._id} className="flex items-center gap-3 px-3 h-9 hover:bg-muted/30 transition-colors group">
                <button onClick={() => onView(lead)} className="text-left min-w-0 flex-1 flex items-center gap-2">
                  <p className="text-[12px] font-semibold truncate">{lead.name || '—'}</p>
                  {lead.company && <span className="text-[10.5px] text-muted-foreground truncate">· {lead.company}</span>}
                  {lead.aiScore && (
                    <span className={`text-[9.5px] font-bold uppercase px-1 rounded ${aiScoreClass(lead.aiScore)}`}>{lead.aiScore}</span>
                  )}
                  <PaymentChip lead={lead} />
                </button>
                {lead.contact && (
                  <a href={`tel:${lead.contact}`} className="text-[10.5px] text-primary tabular-nums hover:underline shrink-0">{lead.contact}</a>
                )}
                <span className={`text-[9.5px] px-1.5 rounded font-semibold shrink-0 ${stage?.bg || 'bg-muted'} ${stage?.text || 'text-foreground'}`}>{stage?.label || currentStage}</span>
                {lead.estimatedValue ? (
                  <span className="text-[10.5px] text-muted-foreground tabular-nums shrink-0">₹{(lead.estimatedValue / 1000).toFixed(0)}k</span>
                ) : null}
                <button onClick={() => onView(lead)} className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )
      // ── CARDS — best for "who do I call next?" ───────────────────────
      : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map(lead => {
            const currentStage = lead.stage || lead.status;
            const stage = stageMap[currentStage] as Stage | undefined;
            const isNew = lead.createdAt && Date.now() - new Date(lead.createdAt).getTime() < 60 * 60 * 1000;
            return (
              <div key={lead._id} className="rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => onView(lead)} className="text-left min-w-0 flex-1">
                    <p className="text-[13px] font-bold truncate flex items-center gap-1.5">
                      {lead.name || '—'}
                      {isNew && <span className="bg-emerald-500 text-white text-[8px] font-black uppercase px-1 rounded">NEW</span>}
                    </p>
                    {lead.company && <p className="text-[10.5px] text-muted-foreground truncate">{lead.company}</p>}
                  </button>
                  <span className={`shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded ${stage?.bg || 'bg-muted'} ${stage?.text || 'text-foreground'}`}>
                    {stage?.label || currentStage}
                  </span>
                </div>

                {lead.aiNextAction && (
                  <div className="flex items-start gap-1.5 text-[11px] rounded-md bg-primary/[0.04] border border-primary/15 px-2 py-1.5 leading-snug">
                    <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                    <span className="line-clamp-2"><span className="font-semibold text-primary">Next: </span>{lead.aiNextAction}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap text-[10.5px] text-muted-foreground">
                  {lead.aiScore && (
                    <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${aiScoreClass(lead.aiScore)}`}>{lead.aiScore}</span>
                  )}
                  <PaymentChip lead={lead} />
                  {lead.estimatedValue ? (
                    <span className="font-semibold text-foreground">₹{lead.estimatedValue.toLocaleString('en-IN')}</span>
                  ) : null}
                  {lead.createdAt && <span>· {format(new Date(lead.createdAt), 'dd MMM')}</span>}
                </div>
                {/* Payment-condition note — surfaces the "next condition"
                    sentence so the rep knows what triggers the next part
                    payment without opening the drawer. */}
                {lead.paymentNote && lead.paymentStatus !== 'full_paid' && (
                  <p className="text-[10.5px] text-amber-800/90 leading-snug line-clamp-2 rounded-md bg-amber-500/[0.08] border border-amber-500/25 px-2 py-1">
                    <span className="font-bold">Next payment after: </span>{lead.paymentNote}
                  </p>
                )}

                <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                  {lead.contact ? (
                    <a href={`tel:${lead.contact}`} className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/15">
                      <Phone className="h-3 w-3" /> Call
                    </a>
                  ) : null}
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md border border-border text-foreground/80 text-[11px] font-semibold hover:bg-muted">
                      <Mail className="h-3 w-3" /> Email
                    </a>
                  ) : null}
                  <button onClick={() => onView(lead)} className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )
      // ── PHONE-FIRST — big tappable numbers for call-blitz days ───────
      : (
        <div className="divide-y divide-border max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map(lead => {
            const currentStage = lead.stage || lead.status;
            const stage = stageMap[currentStage] as Stage | undefined;
            return (
              <div key={lead._id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                <button onClick={() => onView(lead)} className="text-left min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13.5px] font-bold truncate">{lead.name || '—'}</p>
                    {lead.aiScore && (
                      <span className={`text-[9.5px] font-bold uppercase px-1 rounded ${aiScoreClass(lead.aiScore)}`}>{lead.aiScore}</span>
                    )}
                    <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${stage?.bg || 'bg-muted'} ${stage?.text || 'text-foreground'}`}>
                      {stage?.label || currentStage}
                    </span>
                    <PaymentChip lead={lead} />
                  </div>
                  {lead.company && <p className="text-[11px] text-muted-foreground truncate">{lead.company}</p>}
                  {lead.aiNextAction && (
                    <p className="text-[11px] text-primary/90 line-clamp-1 mt-0.5 flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" /> {lead.aiNextAction}
                    </p>
                  )}
                </button>
                {lead.contact ? (
                  <a
                    href={`tel:${lead.contact}`}
                    className="inline-flex items-center gap-2 h-12 px-4 rounded-xl bg-primary text-primary-foreground tabular-nums text-[15px] font-bold shadow-sm hover:bg-primary/90"
                    title="Tap to call"
                  >
                    <Phone className="h-4 w-4" /> {lead.contact}
                  </a>
                ) : (
                  <span className="text-[11px] text-muted-foreground italic">no phone</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LeadListView;
