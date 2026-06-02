import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Filter, Flame, AlertTriangle, CheckCircle2, Sparkles, X,
  ChevronDown, ChevronUp, Save, Trash2, Bookmark, Layers, ListChecks,
  LayoutGrid, Rows3, Loader2, Send, ShieldCheck, MessagesSquare,
  Workflow, ArrowRight, LayoutDashboard, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * PipelineRevamp — the new chrome around the Project Pipeline page.
 *
 * Three exports:
 *
 *   1. <PipelineToolbar />
 *      View toggle (Kanban / Focus / Table), filter chips (health, team,
 *      priority, blocker), saved-views menu, mine-only toggle, and the
 *      bulk-action bar that appears when items are selected.
 *
 *   2. <PipelineFocusView />
 *      Auto-grouped-by-health rendering. Order:
 *        Blocked (rose) → At-risk (amber) → On-track (sky) → Done (slate)
 *      Each group is collapsible. Reuses the consumer's <CardRenderer />
 *      so card visuals stay consistent with the kanban.
 *
 *   3. <PipelineTableView />
 *      Compact one-row-per-project view for "I need to scan 40 projects
 *      and find one" workflows.
 *
 * State convention — view + filters + saved-views are persisted to
 * localStorage so an admin who lives on this page doesn't have to
 * re-configure on every reload.
 */

export type PipelineView = 'focused' | 'executive' | 'kanban' | 'focus' | 'table' | 'flow';

export interface PipelineFilters {
  health:   '' | 'on_track' | 'at_risk' | 'blocked' | 'done';
  team:     '' | 'sales' | 'development' | 'meta' | 'influencer' | 'qa';
  priority: '' | 'urgent' | 'high' | 'medium' | 'low';
  blocker:  '' | 'any' | 'none' | 'waiting_client_input' | 'waiting_internal_approval' | 'dependency' | 'technical' | 'budget';
}

export const EMPTY_FILTERS: PipelineFilters = {
  health: '', team: '', priority: '', blocker: '',
};

export interface SavedView {
  id:       string;
  name:     string;
  view:     PipelineView;
  filters:  PipelineFilters;
  mineOnly: boolean;
}

const LS_VIEW         = 'pipeline.view';
const LS_FILTERS      = 'pipeline.filters';
const LS_SAVED_VIEWS  = 'pipeline.savedViews';
const LS_GROUP_OPEN   = 'pipeline.groupOpen';

// ── Read / write localStorage with safe defaults ─────────────────────
function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
function writeLS<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* private mode */ }
}

// Hook for view-state persistence — used by ClientPipelinePage so the
// view, filter combo, and saved-views all survive refresh.
export function usePipelineState() {
  const [view, setView_]       = useState<PipelineView>(() => readLS<PipelineView>(LS_VIEW, 'focused'));
  const [filters, setFilters_] = useState<PipelineFilters>(() => readLS<PipelineFilters>(LS_FILTERS, EMPTY_FILTERS));
  const [savedViews, setSavedViews_] = useState<SavedView[]>(() => readLS<SavedView[]>(LS_SAVED_VIEWS, []));

  const setView      = (v: PipelineView)      => { setView_(v); writeLS(LS_VIEW, v); };
  const setFilters   = (f: PipelineFilters)   => { setFilters_(f); writeLS(LS_FILTERS, f); };
  const setSavedViews = (a: SavedView[])      => { setSavedViews_(a); writeLS(LS_SAVED_VIEWS, a); };

  return { view, setView, filters, setFilters, savedViews, setSavedViews };
}

/** Apply filters to a list of workflows. Pure — used by every view. */
export function applyFilters<T extends {
  health?: string; blockerType?: string; priority?: string;
  currentOwnerTeam?: string; services?: Array<{ status?: string }>;
}>(list: T[], filters: PipelineFilters): T[] {
  return list.filter(w => {
    if (filters.health) {
      const allDone = (w.services || []).length > 0 && (w.services || []).every(s => s.status === 'done');
      if (filters.health === 'done') {
        if (!allDone) return false;
      } else {
        if (allDone) return false;
        if ((w.health || '') !== filters.health) return false;
      }
    }
    if (filters.team) {
      if ((w.currentOwnerTeam || '') !== filters.team) return false;
    }
    if (filters.priority) {
      if ((w.priority || 'medium') !== filters.priority) return false;
    }
    if (filters.blocker) {
      const has = !!w.blockerType;
      if (filters.blocker === 'any'  && !has) return false;
      if (filters.blocker === 'none' &&  has) return false;
      if (filters.blocker !== 'any' && filters.blocker !== 'none' && (w.blockerType || '') !== filters.blocker) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────
// PipelineToolbar
// ─────────────────────────────────────────────────────────────────────
export function PipelineToolbar({
  view, onView,
  filters, onFilters,
  savedViews, onSavedViews,
  mineOnly, onMineOnly,
  selectedIds, onClearSelected, onBulk,
  totalCount, filteredCount, role,
}: {
  view: PipelineView; onView: (v: PipelineView) => void;
  filters: PipelineFilters; onFilters: (f: PipelineFilters) => void;
  savedViews: SavedView[]; onSavedViews: (a: SavedView[]) => void;
  mineOnly: boolean; onMineOnly: (b: boolean) => void;
  selectedIds: string[]; onClearSelected: () => void;
  onBulk: (action: 'priority'|'note'|'mark-on-track', payload?: any) => Promise<void>;
  totalCount: number; filteredCount: number; role: string;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [saveOpen, setSaveOpen]     = useState(false);
  const [saveName, setSaveName]     = useState('');

  const filterCount =
    (filters.health   ? 1 : 0) +
    (filters.team     ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.blocker  ? 1 : 0);

  const clearFilters = () => onFilters(EMPTY_FILTERS);

  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) { toast.error('Name the view first.'); return; }
    const next: SavedView = {
      id:       String(Date.now()),
      name,
      view,
      filters,
      mineOnly,
    };
    onSavedViews([next, ...savedViews]);
    setSaveName(''); setSaveOpen(false);
    toast.success(`Saved "${name}".`);
  };

  const loadView = (s: SavedView) => {
    onView(s.view);
    onFilters(s.filters);
    onMineOnly(s.mineOnly);
  };

  const deleteView = (id: string) => {
    onSavedViews(savedViews.filter(s => s.id !== id));
  };

  // Owner ask (May 2026, v2): "Multiple options = multiple confusion."
  // 'focused' is the default search-first view; the multi-brand views
  // (Dashboard / Board / Flow / Needs attention / List) live behind a
  // small "Advanced views" disclosure so the default screen is calm.
  // When the user picks one of the advanced views, the toggle stays
  // open — flipping back to 'focused' re-collapses it.
  const [advancedOpen, setAdvancedOpen] = useState(view !== 'focused');
  useEffect(() => {
    if (view !== 'focused') setAdvancedOpen(true);
  }, [view]);

  return (
    <div className="space-y-2">
      {/* Row 1 — view toggle + saved views + filter button + mine */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Focused view is always pinned — it's the canonical resting
            state. Advanced views are revealed inline when the user
            opens the disclosure or has previously picked one. */}
        <div className="inline-flex items-center rounded-lg border border-border bg-card overflow-hidden">
          <button
            onClick={() => onView('focused')}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
              view === 'focused' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Search className="h-3 w-3" /> Focused
          </button>
          {advancedOpen && [
            { key: 'executive' as const, label: 'Dashboard',        icon: LayoutDashboard },
            { key: 'kanban'    as const, label: 'Board',            icon: LayoutGrid },
            { key: 'flow'      as const, label: 'Flow',             icon: Workflow },
            { key: 'focus'     as const, label: 'Needs attention',  icon: Flame },
            { key: 'table'     as const, label: 'List',             icon: Rows3 },
          ].map(o => {
            const Icon = o.icon;
            const active = view === o.key;
            return (
              <button
                key={o.key}
                onClick={() => onView(o.key)}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors border-l border-border ${
                  active ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" /> {o.label}
              </button>
            );
          })}
          {!advancedOpen && (
            <button
              onClick={() => setAdvancedOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] text-muted-foreground hover:text-foreground border-l border-border"
              title="Show Dashboard / Board / Flow / List views"
            >
              <ChevronDown className="h-3 w-3" /> Advanced
            </button>
          )}
        </div>

        {/* Filter button */}
        <button
          onClick={() => setFilterOpen(o => !o)}
          className={`inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg border text-[11.5px] font-semibold transition-colors ${
            filterCount > 0
              ? 'bg-primary/10 border-primary/40 text-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <Filter className="h-3 w-3" />
          Filter
          {filterCount > 0 && (
            <span className="ml-0.5 px-1 h-[16px] rounded bg-primary text-primary-foreground text-[10px] tabular-nums">{filterCount}</span>
          )}
        </button>

        {/* Saved views */}
        {savedViews.length > 0 && (
          <SavedViewsMenu views={savedViews} onLoad={loadView} onDelete={deleteView} />
        )}

        {/* Mine-only — promoted from the search row */}
        <label className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg border border-border bg-card text-[11.5px] font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={e => onMineOnly(e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          <span className={mineOnly ? 'text-primary' : 'text-muted-foreground'}>Just mine</span>
        </label>

        {/* Counts on the right */}
        <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {filterCount > 0 || mineOnly
            ? <>{filteredCount} of {totalCount} shown</>
            : <>{totalCount} projects</>}
        </div>

        {/* Save current */}
        <button
          onClick={() => setSaveOpen(o => !o)}
          className="inline-flex items-center gap-1 h-[30px] px-2 rounded-lg border border-dashed border-border bg-card text-[11px] text-muted-foreground hover:text-foreground"
          title="Save these filters for later"
        >
          <Save className="h-3 w-3" /> Save these filters
        </button>
      </div>

      {/* Save panel */}
      <AnimatePresence>
        {saveOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 flex items-center gap-2">
              <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="e.g. At-risk Meta projects"
                className="flex-1 px-2 py-1 bg-background border border-input rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={e => { if (e.key === 'Enter') saveCurrent(); }}
              />
              <button onClick={saveCurrent}
                className="px-2.5 h-7 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold">Save</button>
              <button onClick={() => setSaveOpen(false)}
                className="px-2 h-7 rounded-md text-muted-foreground hover:bg-muted text-[11.5px]">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter panel */}
      <AnimatePresence>
        {filterOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border bg-card px-3 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11.5px]">
              <FilterSelect label="Status" value={filters.health} onChange={v => onFilters({ ...filters, health: v as any })}
                options={[
                  ['', 'Any status'],
                  ['blocked',  'Stuck'],
                  ['at_risk',  'Needs attention'],
                  ['on_track', 'Going well'],
                  ['done',     'Done'],
                ]} />
              <FilterSelect label="Team" value={filters.team} onChange={v => onFilters({ ...filters, team: v as any })}
                options={[
                  ['', 'Any team'],
                  ['sales',       'Sales'],
                  ['development', 'Development'],
                  ['meta',        'Meta ads'],
                  ['influencer',  'Influencer'],
                  ['qa',          'QA'],
                ]} />
              <FilterSelect label="Priority" value={filters.priority} onChange={v => onFilters({ ...filters, priority: v as any })}
                options={[
                  ['', 'Any priority'],
                  ['urgent', 'Urgent'],
                  ['high',   'High'],
                  ['medium', 'Medium'],
                  ['low',    'Low'],
                ]} />
              <FilterSelect label="Stuck on" value={filters.blocker} onChange={v => onFilters({ ...filters, blocker: v as any })}
                options={[
                  ['', 'Any'],
                  ['any',  'Stuck (any reason)'],
                  ['none', 'Not stuck'],
                  ['waiting_client_input',      'Waiting on client'],
                  ['waiting_internal_approval', 'Waiting on our team'],
                  ['dependency', 'Waiting on someone else'],
                  ['technical',  'Tech issue'],
                  ['budget',     'Budget / scope'],
                ]} />
              {filterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="col-span-2 sm:col-span-4 justify-self-start inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11.5px] text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3 w-3" /> Clear all filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <BulkBar
              selectedIds={selectedIds}
              onClear={onClearSelected}
              onBulk={onBulk}
              role={role}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2 py-1.5 bg-background border border-input rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function SavedViewsMenu({ views, onLoad, onDelete }: {
  views: SavedView[]; onLoad: (s: SavedView) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg border border-border bg-card text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <Bookmark className="h-3 w-3" /> Saved
        <span className="px-1 rounded bg-muted text-[10px] tabular-nums">{views.length}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-30 top-full mt-1 right-0 w-64 rounded-xl border border-border bg-card shadow-xl overflow-hidden"
          >
            {views.map(v => (
              <div key={v.id} className="px-3 py-2 flex items-center gap-2 hover:bg-muted/50 group">
                <button onClick={() => { onLoad(v); setOpen(false); }} className="flex-1 text-left">
                  <p className="text-[12.5px] font-semibold truncate">{v.name}</p>
                  <p className="text-[10.5px] text-muted-foreground capitalize">
                    {v.view} · {Object.values(v.filters).filter(Boolean).length || 0} filter{Object.values(v.filters).filter(Boolean).length === 1 ? '' : 's'}
                    {v.mineOnly && ' · mine'}
                  </p>
                </button>
                <button onClick={() => onDelete(v.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 h-6 w-6 rounded flex items-center justify-center transition-opacity">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bulk action bar
// ─────────────────────────────────────────────────────────────────────
function BulkBar({ selectedIds, onClear, onBulk, role }: {
  selectedIds: string[]; onClear: () => void;
  onBulk: (action: 'priority'|'note'|'mark-on-track', payload?: any) => Promise<void>;
  role: string;
}) {
  const [busy, setBusy]       = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote]       = useState('');
  const canEdit = role === 'admin' || role === 'sales';

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[11.5px] font-semibold text-primary px-1.5 py-0.5 rounded bg-primary/15">
        {selectedIds.length} selected
      </span>
      <span className="text-[11px] text-muted-foreground">Update all at once:</span>

      {/* Priority bump — admin / sales only */}
      {canEdit && (
        <div className="relative">
          <details className="relative">
            <summary className="list-none cursor-pointer inline-flex items-center gap-1 h-7 px-2 rounded-md bg-card border border-border text-[11.5px] font-semibold hover:border-primary/30">
              <Flame className="h-3 w-3 text-orange-600" /> Priority
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </summary>
            <div className="absolute z-20 top-full left-0 mt-1 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
              {(['urgent','high','medium','low'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => run(() => onBulk('priority', { value: p }))}
                  className="w-32 text-left px-3 py-1.5 text-[12px] capitalize hover:bg-muted"
                >{p}</button>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Post a note to all */}
      <button
        onClick={() => setNoteOpen(o => !o)}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-card border border-border text-[11.5px] font-semibold hover:border-primary/30"
      >
        <MessagesSquare className="h-3 w-3 text-sky-600" /> Post note
      </button>

      {/* Mark all going-well — admin / sales only */}
      {canEdit && (
        <button
          onClick={() => run(() => onBulk('mark-on-track'))}
          disabled={busy}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-card border border-border text-[11.5px] font-semibold hover:border-primary/30 disabled:opacity-50"
        >
          <ShieldCheck className="h-3 w-3 text-emerald-600" /> Mark going well
        </button>
      )}

      <button
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-muted-foreground hover:bg-muted"
      >
        <X className="h-3 w-3" /> Clear selection
      </button>

      {/* Note inline editor */}
      <AnimatePresence>
        {noteOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full overflow-hidden"
          >
            <div className="pt-2 flex items-center gap-2">
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Note to post on every selected project…"
                className="flex-1 px-2.5 py-1.5 bg-background border border-input rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={e => { if (e.key === 'Enter' && note.trim().length >= 3) {
                  run(() => onBulk('note', { detail: note.trim() }).then(() => { setNote(''); setNoteOpen(false); }));
                }}}
              />
              <button
                disabled={busy || note.trim().length < 3}
                onClick={() => run(() => onBulk('note', { detail: note.trim() }).then(() => { setNote(''); setNoteOpen(false); }))}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Post
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PipelineFocusView — auto-grouping by health
// ─────────────────────────────────────────────────────────────────────
const FOCUS_GROUPS = [
  { key: 'blocked',  label: 'Stuck',           icon: ShieldCheck,   hint: 'Cannot move forward right now',  accent: 'border-rose-500/30  bg-rose-500/[0.06]  text-rose-700',  pill: 'bg-rose-500/15 text-rose-700'   },
  { key: 'at_risk',  label: 'Needs attention', icon: AlertTriangle, hint: 'Slipping or quiet for too long',  accent: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-700', pill: 'bg-amber-500/15 text-amber-700' },
  { key: 'on_track', label: 'Going well',      icon: Sparkles,      hint: 'Healthy and moving',              accent: 'border-sky-500/30   bg-sky-500/[0.06]   text-sky-700',   pill: 'bg-sky-500/15 text-sky-700'     },
  { key: 'done',     label: 'Done',            icon: CheckCircle2,  hint: 'Everything ticked',               accent: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700', pill: 'bg-emerald-500/15 text-emerald-700' },
] as const;
type FocusKey = typeof FOCUS_GROUPS[number]['key'];

function bucketFor(wf: any): FocusKey {
  const allDone = (wf.services || []).length > 0 && wf.services.every((s: any) => s.status === 'done');
  if (allDone)              return 'done';
  if (wf.blockerType)       return 'blocked';
  if ((wf.riskScore ?? 0) >= 50) return 'at_risk';
  if (wf.health === 'at_risk' || wf.health === 'blocked') return wf.health === 'blocked' ? 'blocked' : 'at_risk';
  return 'on_track';
}

export function PipelineFocusView<T extends { _id: string }>({
  list, renderCard, selectedIds, onToggleSelect,
}: {
  list: T[];
  renderCard: (wf: T) => React.ReactNode;
  /** Optional selection wiring — when provided, each card gets a small
   *  checkbox overlay so users can multi-pick for the bulk toolbar. */
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}) {
  const selSet = new Set(selectedIds || []);
  const grouped = useMemo(() => {
    const out: Record<FocusKey, T[]> = { blocked: [], at_risk: [], on_track: [], done: [] };
    for (const w of list) out[bucketFor(w)].push(w);
    return out;
  }, [list]);

  // Persist which groups are collapsed. Default: Done collapsed, others open.
  const [open, setOpen] = useState<Record<FocusKey, boolean>>(() =>
    readLS<Record<FocusKey, boolean>>(LS_GROUP_OPEN, { blocked: true, at_risk: true, on_track: true, done: false })
  );
  const toggle = (k: FocusKey) => {
    const next = { ...open, [k]: !open[k] };
    setOpen(next);
    writeLS(LS_GROUP_OPEN, next);
  };

  return (
    <div className="space-y-3">
      {FOCUS_GROUPS.map(g => {
        const items = grouped[g.key];
        const Icon = g.icon;
        return (
          <section key={g.key} className={`rounded-2xl border ${g.accent.split(' ').filter(c => c.startsWith('border')).join(' ')} bg-card overflow-hidden`}>
            <button
              onClick={() => toggle(g.key)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            >
              <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${g.pill}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-[12.5px] font-bold ${g.accent.split(' ').filter(c => c.startsWith('text')).join(' ')}`}>
                  {g.label}
                  <span className="ml-2 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                    {items.length}
                  </span>
                </p>
                <p className="text-[10.5px] text-muted-foreground">{g.hint}</p>
              </div>
              {open[g.key] ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            <AnimatePresence initial={false}>
              {open[g.key] && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-muted/10">
                    {items.length === 0 ? (
                      <div className="col-span-full h-24 rounded-xl border border-dashed border-border flex items-center justify-center text-[11.5px] text-muted-foreground">
                        Nothing in {g.label.toLowerCase()} right now.
                      </div>
                    ) : items.map(w => (
                      <div key={w._id} className="relative group">
                        {onToggleSelect && (
                          <label
                            className={`absolute z-10 top-2 left-2 h-5 w-5 rounded-md border bg-card shadow-sm flex items-center justify-center cursor-pointer transition-opacity ${
                              selSet.has(w._id) ? 'opacity-100 border-primary bg-primary/15' : 'opacity-0 group-hover:opacity-100 border-border'
                            }`}
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={selSet.has(w._id)}
                              onChange={() => onToggleSelect(w._id)}
                            />
                            {selSet.has(w._id) && <CheckCircle2 className="h-3 w-3 text-primary" />}
                          </label>
                        )}
                        {renderCard(w)}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PipelineTableView — one row per project, compact scanning
// ─────────────────────────────────────────────────────────────────────
export function PipelineTableView<T extends {
  _id: string; clientName?: string; clientPhone?: string;
  health?: string; priority?: string; blockerType?: string;
  eta?: string | null; riskScore?: number;
  nextBestAction?: string;
  services?: Array<{ status?: string; serviceType?: string; assignedTo?: string }>;
}>({
  list, onOpen, selectedIds, onToggleSelect,
}: {
  list: T[];
  onOpen: (id: string, name?: string) => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
}) {
  const selSet = new Set(selectedIds);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border">
            <th className="w-8 px-3 py-2"></th>
            <th className="text-left px-3 py-2">Client</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Priority</th>
            <th className="text-left px-3 py-2">Worry</th>
            <th className="text-left px-3 py-2">Due</th>
            <th className="text-left px-3 py-2">Next step</th>
          </tr>
        </thead>
        <tbody>
          {list.map(wf => {
            const blocked = !!wf.blockerType;
            const sel     = selSet.has(wf._id);
            return (
              <tr
                key={wf._id}
                className={`border-b border-border/60 hover:bg-muted/30 ${sel ? 'bg-primary/[0.04]' : ''}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => onToggleSelect(wf._id)}
                    className="h-3.5 w-3.5 accent-primary"
                    aria-label="Select project"
                  />
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => onOpen(wf._id, wf.clientName)} className="text-left hover:text-primary">
                    <p className="font-semibold truncate max-w-[200px]">{wf.clientName || 'Unnamed'}</p>
                    {wf.clientPhone && (
                      <p className="text-[10.5px] text-muted-foreground tabular-nums">{wf.clientPhone}</p>
                    )}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${
                    blocked              ? 'bg-rose-500/15 text-rose-700' :
                    wf.health === 'at_risk'  ? 'bg-amber-500/15 text-amber-700' :
                    wf.health === 'done'     ? 'bg-emerald-500/15 text-emerald-700' :
                                              'bg-sky-500/15 text-sky-700'
                  }`}>
                    {blocked ? 'Stuck'
                      : wf.health === 'at_risk' ? 'Needs attention'
                      : wf.health === 'done'    ? 'Done'
                                                : 'Going well'}
                  </span>
                </td>
                <td className="px-3 py-2 capitalize">
                  <span className={`text-[11px] font-semibold ${
                    wf.priority === 'urgent' ? 'text-rose-700' :
                    wf.priority === 'high'   ? 'text-orange-700' :
                                              'text-muted-foreground'
                  }`}>{wf.priority || 'medium'}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  <span className={`font-semibold ${
                    (wf.riskScore ?? 0) >= 70 ? 'text-rose-700' :
                    (wf.riskScore ?? 0) >= 40 ? 'text-amber-700' :
                                                'text-muted-foreground'
                  }`}>{wf.riskScore ?? 0}</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums">
                  {wf.eta ? new Date(wf.eta).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                </td>
                <td className="px-3 py-2 max-w-[300px]">
                  <p className="text-[11px] truncate" title={wf.nextBestAction || ''}>{wf.nextBestAction || '—'}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length === 0 && (
        <div className="py-10 text-center text-[12px] text-muted-foreground">
          Nothing matches your current filters.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PipelineFlowView — stage-by-stage flow diagram
// ─────────────────────────────────────────────────────────────────────
//
// Same data as the Kanban (one bucket per stage), laid out as a left-to-
// right flow chart with labelled transition arrows between stages. Built
// from pure SVG + Tailwind so it inherits the rest of Robin's design
// system — no React Flow, no extra deps.
//
// The consumer (ClientPipelinePage) supplies:
//   - `stages`    — the column definitions (key, label, accent, tone)
//   - `byStage`   — workflows already bucketed by stage key
//   - `renderCard` — function the consumer uses to render each row, so
//     ClientCard visuals stay consistent across all four views.
//
// We deliberately don't import ClientCard / Workflow here — this file is
// supposed to be presentation-only for the pipeline page chrome. Keeping
// it data-shape-agnostic also means a future "Sales pipeline" page could
// reuse the same component with different stage labels.

export interface FlowStage {
  /** Stable key — matches the column key consumers already use. */
  key:   string;
  /** Human label, e.g. "Website Work". */
  label: string;
  /** Pill label on the arrow leaving this stage (e.g. "Website done"). */
  exitLabel?: string;
  /** Tone token. Maps to the same four column keys the existing Kanban
   *  Column uses, then lightens each accent for the flow shapes — same
   *  brand palette (emerald / blue / amber / slate), softer fill. */
  tone:  'shopify' | 'meta' | 'influencer' | 'done';
  /** Geometric shape for this stage's flow node. The reference design
   *  varies shapes across the row so the eye moves naturally from one
   *  stage to the next instead of scanning a uniform grid. */
  shape: 'rounded-rect' | 'circle' | 'square';
}

// Resolve a tone to:
//   - fill        — Tailwind class for the pastel shape fill (Robin's
//                   accent at the 100 stop)
//   - fillHex     — same color but as a hex, for the SVG <path>/<rect>
//                   fill attribute (Tailwind classes don't reach into
//                   raw SVG fills the way they do for HTML backgrounds)
//   - textHex     — darker stop from the same ramp for legible label
//                   text on the pastel fill (-800 / -700)
//   - dotClass    — Tailwind class for the small swatch dot we render
//                   alongside non-flow elements (legend, drilldown)
function flowTone(tone: FlowStage['tone']) {
  switch (tone) {
    case 'shopify':    return { fillHex: '#d1fae5', textHex: '#065f46', dotClass: 'bg-emerald-500' };  // emerald-100 / emerald-800
    case 'meta':       return { fillHex: '#dbeafe', textHex: '#1e40af', dotClass: 'bg-blue-500'    };  // blue-100 / blue-800
    case 'influencer': return { fillHex: '#fef3c7', textHex: '#92400e', dotClass: 'bg-amber-500'   };  // amber-100 / amber-800
    case 'done':
    default:           return { fillHex: '#f1f5f9', textHex: '#334155', dotClass: 'bg-slate-500'   };  // slate-100 / slate-700
  }
}

// ── Geometry constants for the SVG flow diagram ─────────────────────
// Drawn on a 1100×320 viewBox so it scales fluidly inside whatever
// container width the consumer gives us. Shapes sit on the y=160
// horizontal axis. X positions are evenly spaced for four stages; if
// future stages are added the same maths still applies because we
// derive each centre from its index.
const FLOW_VB_W = 1100;
const FLOW_VB_H = 320;
const FLOW_AXIS_Y = 160;

function shapeGeometry(shape: FlowStage['shape'], cx: number) {
  // Each shape is sized to feel visually equivalent — circles have an
  // r of 72, rounded rects are 160×120, squares are 140×140 — so no
  // one stage dominates by accident.
  switch (shape) {
    case 'circle':       return { kind: 'circle' as const, cx, cy: FLOW_AXIS_Y, r: 72 };
    case 'square':       return { kind: 'rect'   as const, x: cx - 70,  y: FLOW_AXIS_Y - 70,  w: 140, h: 140, rx: 16 };
    case 'rounded-rect':
    default:             return { kind: 'rect'   as const, x: cx - 80,  y: FLOW_AXIS_Y - 60,  w: 160, h: 120, rx: 24 };
  }
}

// Find the left/right anchor points of a shape so connector arrows
// land cleanly on the edge rather than crossing into the fill.
function shapeAnchors(g: ReturnType<typeof shapeGeometry>) {
  if (g.kind === 'circle') {
    return { left: { x: g.cx - g.r, y: g.cy }, right: { x: g.cx + g.r, y: g.cy } };
  }
  return {
    left:  { x: g.x,         y: g.y + g.h / 2 },
    right: { x: g.x + g.w,   y: g.y + g.h / 2 },
  };
}

export function PipelineFlowView<T extends { _id: string }>({
  stages, byStage, totalCount, renderCard,
}: {
  stages:      FlowStage[];
  byStage:     Record<string, T[]>;
  totalCount:  number;
  renderCard:  (item: T) => React.ReactNode;
}) {
  // The drilldown strip shows cards for whichever stage is currently
  // selected. We default to the first stage that has items (so a fresh
  // load doesn't open with an empty card grid) and fall back to the
  // first stage when everything is empty.
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    const firstNonEmpty = stages.find(s => (byStage[s.key]?.length || 0) > 0);
    return (firstNonEmpty || stages[0])?.key || '';
  });
  // If the selection is invalidated by a filter change, fall back
  // automatically — otherwise the drilldown could "vanish" from the
  // user's POV when the only stage that had items just emptied out.
  useEffect(() => {
    if (!stages.find(s => s.key === selectedKey)) {
      const fallback = stages.find(s => (byStage[s.key]?.length || 0) > 0) || stages[0];
      if (fallback) setSelectedKey(fallback.key);
    }
  }, [stages, byStage, selectedKey]);

  const selectedStage = stages.find(s => s.key === selectedKey) || stages[0];
  const selectedItems = selectedStage ? (byStage[selectedStage.key] || []) : [];

  // Compute x-centres for each stage shape. Equal spacing across the
  // viewBox with a margin so the leftmost / rightmost shapes don't
  // touch the SVG edges.
  const PAD = 100;
  const stride = stages.length > 1 ? (FLOW_VB_W - PAD * 2) / (stages.length - 1) : 0;
  const centres = stages.map((_, i) => PAD + i * stride);

  return (
    <div className="space-y-4">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Client CRM · Flow
          </p>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {totalCount} {totalCount === 1 ? 'client' : 'clients'} moving through {stages.length} stages
          </p>
        </div>
      </div>

      {/* ── Flow diagram ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <svg
          viewBox={`0 0 ${FLOW_VB_W} ${FLOW_VB_H}`}
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto"
          style={{ maxHeight: 380 }}
        >
          <defs>
            <marker
              id="flow-arrowhead"
              viewBox="0 0 10 10"
              refX="9" refY="5"
              markerWidth="6" markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          {/* Connectors — render BEFORE shapes so the arrowheads
              terminate cleanly at the shape edge. */}
          {stages.slice(0, -1).map((stage, i) => {
            const fromG = shapeGeometry(stages[i].shape,     centres[i]);
            const toG   = shapeGeometry(stages[i + 1].shape, centres[i + 1]);
            const a = shapeAnchors(fromG).right;
            const b = shapeAnchors(toG).left;
            // Gentle cubic Bezier — control points pulled toward the
            // axis to give a subtle "swoop" without the line dipping
            // far below the shapes.
            const midX = (a.x + b.x) / 2;
            const d = `M ${a.x + 6} ${a.y} C ${midX} ${a.y - 8}, ${midX} ${b.y + 8}, ${b.x - 6} ${b.y}`;
            // Pill sits at midpoint of the curve.
            const pillW = (stage.exitLabel?.length || 4) * 6 + 18;
            const pillH = 22;
            return (
              <g key={`conn-${stage.key}`}>
                <path d={d} fill="none" strokeWidth={1.6} className="stroke-muted-foreground/60" strokeLinecap="round" markerEnd="url(#flow-arrowhead)" />
                {stage.exitLabel && (
                  <g>
                    <rect
                      x={midX - pillW / 2}
                      y={FLOW_AXIS_Y - pillH / 2}
                      width={pillW}
                      height={pillH}
                      rx={pillH / 2}
                      className="fill-card stroke-border"
                      strokeWidth={1}
                    />
                    <text
                      x={midX}
                      y={FLOW_AXIS_Y + 3.5}
                      textAnchor="middle"
                      className="fill-muted-foreground"
                      style={{ fontSize: 10, fontWeight: 500 }}
                    >
                      {stage.exitLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Shapes — varied geometry per stage, pastel fills from
              Robin's accent ramps lightened to the -100 stop. */}
          {stages.map((stage, i) => {
            const g = shapeGeometry(stage.shape, centres[i]);
            const tone = flowTone(stage.tone);
            const count = byStage[stage.key]?.length || 0;
            const isSelected = selectedKey === stage.key;
            const baseStroke = isSelected ? tone.textHex : 'transparent';
            const strokeWidth = isSelected ? 3 : 0;

            return (
              <g
                key={stage.key}
                onClick={() => setSelectedKey(stage.key)}
                style={{ cursor: 'pointer' }}
              >
                {g.kind === 'circle' ? (
                  <circle
                    cx={g.cx} cy={g.cy} r={g.r}
                    fill={tone.fillHex}
                    stroke={baseStroke}
                    strokeWidth={strokeWidth}
                  />
                ) : (
                  <rect
                    x={g.x} y={g.y} width={g.w} height={g.h} rx={g.rx}
                    fill={tone.fillHex}
                    stroke={baseStroke}
                    strokeWidth={strokeWidth}
                  />
                )}
                {/* Label */}
                <text
                  x={g.kind === 'circle' ? g.cx : g.x + g.w / 2}
                  y={FLOW_AXIS_Y - 14}
                  textAnchor="middle"
                  fill={tone.textHex}
                  style={{ fontSize: 13, fontWeight: 600 }}
                >
                  {stage.label}
                </text>
                {/* Big count */}
                <text
                  x={g.kind === 'circle' ? g.cx : g.x + g.w / 2}
                  y={FLOW_AXIS_Y + 22}
                  textAnchor="middle"
                  fill={tone.textHex}
                  style={{ fontSize: 30, fontWeight: 700 }}
                >
                  {count}
                </text>
                <text
                  x={g.kind === 'circle' ? g.cx : g.x + g.w / 2}
                  y={FLOW_AXIS_Y + 40}
                  textAnchor="middle"
                  fill={tone.textHex}
                  style={{ fontSize: 10, fontWeight: 500, opacity: 0.75 }}
                >
                  {count === 1 ? 'project' : 'projects'}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hint strip under the diagram so first-time users know the
            shapes are interactive. Mirrors the Robin convention of
            small muted helper text under data viz. */}
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          Click any stage to see the clients currently in it.
        </p>
      </div>

      {/* ── Drilldown — cards for the selected stage ─────────────── */}
      {selectedStage && (
        <div className="rounded-2xl border border-border bg-card p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: flowTone(selectedStage.tone).textHex }}
              />
              <p className="text-[10px] uppercase tracking-[0.14em] font-bold" style={{ color: flowTone(selectedStage.tone).textHex }}>
                {selectedStage.label}
              </p>
              <span className="px-1.5 h-5 inline-flex items-center rounded text-[10px] font-bold tabular-nums bg-muted text-muted-foreground">
                {selectedItems.length}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {selectedItems.length === 1 ? 'project' : 'projects'}
              </p>
            </div>
          </div>
          {selectedItems.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              No clients in this stage right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {selectedItems.map(item => (
                <div key={item._id}>{renderCard(item)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
