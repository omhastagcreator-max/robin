import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, AlertTriangle, Eye, Plus, X, Search,
  UserPlus, CheckCircle2, Loader2, Trash2, MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * Focus This Week — sales rep's personal urgency / priority list for the
 * current week. The rep:
 *   1. Picks a lead or client (search across both).
 *   2. Sets an urgency (Watch / High / Critical).
 *   3. Optionally writes a note ("Needs creative review before EOW").
 *   4. Assigns one or more teammates → they get a notification.
 *
 * One FocusList document per (rep, week). Persisted server-side, see
 * server/src/controllers/focusListController.ts.
 *
 * NB: sub-modals (AddPicker / AssignEditor) live at module scope, not
 * inside the parent component, so their useState() values aren't reset
 * every time the parent re-renders (e.g. when the lists state updates).
 */

const URGENCY = [
  { key: 'critical', label: 'On fire',     icon: Flame,          bg: 'bg-rose-500/15',    text: 'text-rose-700',    ring: 'ring-rose-400'    },
  { key: 'high',     label: 'Important',   icon: AlertTriangle,  bg: 'bg-amber-500/15',   text: 'text-amber-700',   ring: 'ring-amber-400'   },
  { key: 'watch',    label: 'Keep an eye', icon: Eye,            bg: 'bg-sky-500/15',     text: 'text-sky-700',     ring: 'ring-sky-400'     },
] as const;
type Urgency = typeof URGENCY[number]['key'];

interface FocusItem {
  _id: string;
  leadId?: string;
  clientUserId?: string;
  label: string;
  subLabel?: string;
  urgency: Urgency;
  note?: string;
  assignedTo: string[];
  doneAt?: string | null;
  createdAt: string;
}
interface FocusList {
  _id: string;
  ownerId: string;
  weekStart: string;
  items: FocusItem[];
}

interface Props {
  /** All leads from SalesDashboard (already loaded — saves a fetch). */
  leads: any[];
  /** All client users from SalesDashboard. */
  clients: any[];
  /** Current user id — so we can identify which FocusList is "mine". */
  currentUserId: string;
}

// ── AddPicker (module-scope) ────────────────────────────────────────────
interface AddPickerProps {
  leads: any[];
  clients: any[];
  staff: any[];
  onClose: () => void;
  onSubmit: (payload: {
    leadId?: string;
    clientUserId?: string;
    label: string;
    subLabel?: string;
    urgency: Urgency;
    note: string;
    assignedTo: string[];
  }) => Promise<void>;
}
function AddPicker({ leads, clients, staff, onClose, onSubmit }: AddPickerProps) {
  const [q, setQ]               = useState('');
  const [target, setTarget]     = useState<any | null>(null);
  const [urgency, setUrgency]   = useState<Urgency>('high');
  const [note, setNote]         = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const leadHits = (leads || []).filter(l =>
      (l.name || '').toLowerCase().includes(needle) ||
      (l.company || '').toLowerCase().includes(needle) ||
      (l.email   || '').toLowerCase().includes(needle)
    ).slice(0, 6).map(l => ({
      _kind: 'lead' as const,
      _id: l._id,
      label: l.name,
      subLabel: [
        l.company,
        l.stage || l.status,
        l.estimatedValue ? `₹${Number(l.estimatedValue).toLocaleString('en-IN')}` : null,
      ].filter(Boolean).join(' · '),
    }));
    const clientHits = (clients || []).filter(c =>
      (c.name || '').toLowerCase().includes(needle) ||
      (c.email || '').toLowerCase().includes(needle) ||
      (c.company || '').toLowerCase().includes(needle)
    ).slice(0, 6).map(c => ({
      _kind: 'client' as const,
      _id: c._id,
      label: c.name || c.email,
      subLabel: [c.company, 'client'].filter(Boolean).join(' · '),
    }));
    return [...leadHits, ...clientHits];
  }, [q, leads, clients]);

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      await onSubmit({
        leadId:       target._kind === 'lead'   ? target._id : undefined,
        clientUserId: target._kind === 'client' ? target._id : undefined,
        label:        target.label,
        subLabel:     target.subLabel,
        urgency,
        note,
        assignedTo:   assignees,
      });
    } finally { setSubmitting(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl my-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-lg">Add to this week's focus</h2>
            <p className="text-xs text-muted-foreground">Find a lead or client, mark how urgent, pick teammates to help</p>
          </div>
          <button type="button" onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>

        {!target ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border border-border rounded-xl">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                placeholder="Search by name, company, email…"
                value={q}
                onChange={e => setQ(e.target.value)}
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            {q && matches.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No matching leads or clients.</p>
            )}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {matches.map(m => (
                <button
                  key={`${m._kind}-${m._id}`}
                  onClick={() => setTarget(m)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/40 flex items-center gap-2"
                >
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    m._kind === 'lead' ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-700'
                  }`}>{m._kind}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.subLabel}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{target.label}</p>
                <p className="text-xs text-muted-foreground truncate">{target.subLabel}</p>
              </div>
              <button onClick={() => setTarget(null)} className="text-xs text-muted-foreground hover:text-foreground underline">change</button>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Urgency</p>
              <div className="grid grid-cols-3 gap-2">
                {URGENCY.map(u => {
                  const Icon = u.icon;
                  const active = urgency === u.key;
                  return (
                    <button key={u.key} type="button" onClick={() => setUrgency(u.key)}
                      className={`flex items-center gap-1.5 justify-center px-2 py-2 rounded-xl border text-xs font-semibold transition-all ${
                        active
                          ? `${u.bg} ${u.text} border-transparent ring-2 ${u.ring}`
                          : 'bg-muted/20 border-border text-foreground/70 hover:bg-muted/40'
                      }`}>
                      <Icon className="h-3.5 w-3.5" /> {u.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Note (optional)</p>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder="Why this needs focus — e.g. demo follow-up promised by Friday"
                className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
                Assign teammates <span className="text-muted-foreground/60 normal-case font-normal">(they'll be notified)</span>
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-muted/20 border border-border rounded-xl">
                {staff.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">Loading team…</p>
                )}
                {staff.map(s => {
                  const picked = assignees.includes(s._id);
                  return (
                    <button
                      key={s._id} type="button"
                      onClick={() => setAssignees(prev => picked
                        ? prev.filter(x => x !== s._id)
                        : [...prev, s._id])}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        picked
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border text-foreground/70 hover:bg-muted/40'
                      }`}
                    >
                      <span className="h-4 w-4 rounded-full bg-background/30 flex items-center justify-center text-[9px] font-bold">
                        {(s.name || s.email || '?')[0]?.toUpperCase()}
                      </span>
                      {s.name || s.email}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 py-2 text-muted-foreground font-medium text-sm">Cancel</button>
              <button type="button" onClick={submit} disabled={submitting}
                className="flex-2 flex-grow flex items-center justify-center gap-2 py-2 px-4 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add to focus
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── AssignEditor (module-scope) ─────────────────────────────────────────
interface AssignEditorProps {
  item: FocusItem;
  staff: any[];
  onClose: () => void;
  onSave: (assignedTo: string[]) => Promise<void>;
}
function AssignEditor({ item, staff, onClose, onSave }: AssignEditorProps) {
  const [picked, setPicked] = useState<string[]>(item.assignedTo || []);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await onSave(picked); }
    finally { setSaving(false); }
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="bg-card border border-border rounded-2xl w-full max-w-md p-6 space-y-3 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-base">Assign teammates</h2>
            <p className="text-xs text-muted-foreground truncate max-w-[24rem]">{item.label}</p>
          </div>
          <button type="button" onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto p-2 bg-muted/20 border border-border rounded-xl">
          {staff.map(s => {
            const on = picked.includes(s._id);
            return (
              <button key={s._id} type="button"
                onClick={() => setPicked(prev => on ? prev.filter(x => x !== s._id) : [...prev, s._id])}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                  on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground/70 hover:bg-muted/40'
                }`}>
                {s.name || s.email}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Newly added teammates receive an in-app notification. Removing someone doesn't send a notification.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 text-muted-foreground text-sm font-medium">Cancel</button>
          <button type="button" disabled={saving} onClick={save}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── FocusCard (module-scope) ────────────────────────────────────────────
interface FocusCardProps {
  item: FocusItem;
  ownList: FocusList;
  staff: any[];
  mine: boolean;
  onAssign: (item: FocusItem) => void;
  onToggleDone: (item: FocusItem) => Promise<void>;
  onRemove: (item: FocusItem) => Promise<void>;
}
function FocusCard({ item, staff, mine, onAssign, onToggleDone, onRemove }: FocusCardProps) {
  const u = URGENCY.find(x => x.key === item.urgency) || URGENCY[1];
  const Icon = u.icon;
  const isDone = !!item.doneAt;
  const assignees = item.assignedTo.map(id => staff.find(s => s._id === id)).filter(Boolean) as any[];
  return (
    <div className={`relative rounded-xl border bg-card p-3 space-y-2 ${isDone ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase ${u.bg} ${u.text} shrink-0`}>
          <Icon className="h-3 w-3" /> {u.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${isDone ? 'line-through' : ''}`}>{item.label}</p>
          {item.subLabel && <p className="text-[11px] text-muted-foreground truncate">{item.subLabel}</p>}
        </div>
      </div>
      {item.note && (
        <div className="flex items-start gap-1.5 text-[11px] text-foreground/75 bg-muted/30 rounded-md px-2 py-1.5">
          <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 opacity-60" />
          <span className="leading-snug">{item.note}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {assignees.length === 0 ? (
            <span className="text-[10px] text-muted-foreground italic">No assignees</span>
          ) : assignees.slice(0, 5).map(a => (
            <span key={a._id} title={a.name || a.email}
              className="h-6 w-6 rounded-full bg-primary/15 text-primary border-2 border-card flex items-center justify-center text-[10px] font-bold">
              {(a.name || a.email || '?')[0].toUpperCase()}
            </span>
          ))}
          {assignees.length > 5 && (
            <span className="h-6 w-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[9px] font-bold">
              +{assignees.length - 5}
            </span>
          )}
        </div>
        {mine && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAssign(item)}
              className="h-6 px-2 text-[10px] rounded-md bg-muted/40 hover:bg-muted text-foreground/80 inline-flex items-center gap-1"
              title="Assign / change teammates"
            >
              <UserPlus className="h-3 w-3" /> Assign
            </button>
            <button
              onClick={() => onToggleDone(item)}
              className={`h-6 px-2 text-[10px] rounded-md inline-flex items-center gap-1 ${
                isDone ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted/40 hover:bg-muted text-foreground/80'
              }`}
              title={isDone ? 'Mark not done' : 'Mark done'}
            >
              <CheckCircle2 className="h-3 w-3" /> {isDone ? 'Done' : 'Mark done'}
            </button>
            <button
              onClick={() => onRemove(item)}
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 flex items-center justify-center"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────
export function FocusThisWeek({ leads, clients, currentUserId }: Props) {
  const [staff, setStaff]               = useState<any[]>([]);
  const [lists, setLists]               = useState<FocusList[]>([]);
  const [myList, setMyList]             = useState<FocusList | null>(null);
  const [loading, setLoading]           = useState(true);
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [assignFor, setAssignFor]       = useState<FocusItem | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const mine = await api.getOrCreateFocusList();
      setMyList(mine);
      const all = await api.listFocusLists({});
      setLists(Array.isArray(all) ? all : []);
    } catch (err: any) {
      console.warn('[focus-this-week] load failed', err?.message);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    api.listUsers({}).then((u: any[]) => {
      const filtered = (u || []).filter(x =>
        ['admin', 'employee', 'sales', 'workroom'].includes(x.role)
      );
      setStaff(filtered);
    }).catch(() => {/* silent */});
  }, []);

  const isMine = (list: FocusList) => String(list.ownerId) === String(currentUserId);

  // Mutators bound to the parent state so subcomponents stay dumb.
  const onAddSubmit = async (payload: {
    leadId?: string; clientUserId?: string;
    label: string; subLabel?: string;
    urgency: Urgency; note: string; assignedTo: string[];
  }) => {
    if (!myList) return;
    try {
      const updated = await api.addFocusItem(myList._id, payload);
      setMyList(updated);
      setLists(prev => prev.some(p => p._id === updated._id)
        ? prev.map(p => p._id === updated._id ? updated : p)
        : [...prev, updated]);
      toast.success(payload.assignedTo.length
        ? `Added · notified ${payload.assignedTo.length} teammate${payload.assignedTo.length === 1 ? '' : 's'}`
        : 'Added to your focus list');
      setPickerOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not add focus item');
      throw err;
    }
  };

  const onAssignSave = async (assignedTo: string[]) => {
    if (!myList || !assignFor) return;
    try {
      const updated = await api.assignFocusItem(myList._id, assignFor._id, assignedTo);
      setMyList(updated);
      setLists(prev => prev.map(p => p._id === updated._id ? updated : p));
      toast.success('Assignment updated');
      setAssignFor(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not update assignment');
      throw err;
    }
  };

  const onToggleDone = async (item: FocusItem) => {
    if (!myList) return;
    try {
      const updated = await api.updateFocusItem(myList._id, item._id, {
        doneAt: item.doneAt ? null : new Date().toISOString(),
      });
      setMyList(updated);
      setLists(prev => prev.map(p => p._id === updated._id ? updated : p));
    } catch { toast.error('Could not update'); }
  };

  const onRemove = async (item: FocusItem) => {
    if (!myList) return;
    if (!confirm(`Remove "${item.label}" from this week's focus?`)) return;
    try {
      const updated = await api.removeFocusItem(myList._id, item._id);
      setMyList(updated);
      setLists(prev => prev.map(p => p._id === updated._id ? updated : p));
    } catch { toast.error('Could not remove'); }
  };

  // Sort: open items first, then by urgency, then most recent first.
  const urgencyRank: Record<Urgency, number> = { critical: 0, high: 1, watch: 2 };
  const sortItems = (items: FocusItem[]) => [...items].sort((a, b) => {
    const ad = a.doneAt ? 1 : 0, bd = b.doneAt ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const au = urgencyRank[a.urgency] ?? 9, bu = urgencyRank[b.urgency] ?? 9;
    if (au !== bu) return au - bu;
    return (new Date(b.createdAt).getTime() || 0) - (new Date(a.createdAt).getTime() || 0);
  });

  const myItems = myList ? sortItems(myList.items) : [];
  const teammateLists = lists.filter(l => !isMine(l) && l.items.length > 0);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* My list */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="font-semibold text-sm text-foreground inline-flex items-center gap-2">
              <Flame className="h-4 w-4 text-rose-500" />
              My Focus This Week
            </p>
            <p className="text-xs text-muted-foreground">
              Week of {myList?.weekStart} · {myItems.filter(i => !i.doneAt).length} open · {myItems.filter(i => i.doneAt).length} done
            </p>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Add focus item
          </button>
        </div>
        {myItems.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <Flame className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nothing on your focus list yet.</p>
            <button
              onClick={() => setPickerOpen(true)}
              className="text-xs text-primary underline hover:no-underline"
            >+ Pick a lead or client that needs your attention</button>
          </div>
        ) : (
          <div className="p-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {myList && myItems.map(it => (
              <FocusCard
                key={it._id}
                item={it}
                ownList={myList}
                staff={staff}
                mine
                onAssign={setAssignFor}
                onToggleDone={onToggleDone}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Teammate lists (read-only) */}
      {teammateLists.length > 0 && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="font-semibold text-sm text-foreground">Team Focus · This Week</p>
            <p className="text-xs text-muted-foreground">What other sales people are watching closely</p>
          </div>
          <div className="p-3 space-y-3">
            {teammateLists.map(list => {
              const owner = staff.find(s => String(s._id) === String(list.ownerId));
              const open = list.items.filter(i => !i.doneAt);
              return (
                <div key={list._id} className="rounded-xl border border-border bg-muted/10 p-3">
                  <p className="text-xs font-semibold text-foreground/80 mb-2">
                    {owner?.name || owner?.email || 'Teammate'} · {open.length} open
                  </p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {sortItems(list.items).map(it => (
                      <FocusCard
                        key={it._id}
                        item={it}
                        ownList={list}
                        staff={staff}
                        mine={false}
                        onAssign={() => {/* not mine */}}
                        onToggleDone={async () => {/* not mine */}}
                        onRemove={async () => {/* not mine */}}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AnimatePresence>
        {pickerOpen && (
          <AddPicker
            leads={leads}
            clients={clients}
            staff={staff}
            onClose={() => setPickerOpen(false)}
            onSubmit={onAddSubmit}
          />
        )}
        {assignFor && (
          <AssignEditor
            item={assignFor}
            staff={staff}
            onClose={() => setAssignFor(null)}
            onSave={onAssignSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default FocusThisWeek;
