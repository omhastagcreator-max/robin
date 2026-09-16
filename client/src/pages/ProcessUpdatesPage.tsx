import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import {
  BookMarked, Plus, Search, Check, CheckCircle2, Loader2, X, Users,
  Pencil, History, Archive, Trash2, ShieldAlert,
} from 'lucide-react';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * ProcessUpdatesPage — the SOP library (Sep 2026 Robin OS module).
 *
 * Reading side (everyone): browse by department, open a process, hit
 * "I've read this" — which records an acknowledgement against the
 * CURRENT version.
 *
 * Publishing side (admin): write a process, and publish updates to it.
 * Editing the body cuts a new version and clears every acknowledgement,
 * so the team is asked to re-read — that's deliberate, and the UI says
 * so before you save.
 */

const DEPARTMENTS = [
  { key: 'general',    label: 'General',        tone: 'bg-slate-500/10 text-slate-300' },
  { key: 'sales',      label: 'Sales',          tone: 'bg-emerald-500/10 text-emerald-400' },
  { key: 'meta',       label: 'Meta Ads',       tone: 'bg-blue-500/10 text-blue-400' },
  { key: 'development',label: 'Development',    tone: 'bg-cyan-500/10 text-cyan-400' },
  { key: 'influencer', label: 'UGC / Influencer', tone: 'bg-purple-500/10 text-purple-400' },
  { key: 'qa',         label: 'QA',             tone: 'bg-amber-500/10 text-amber-400' },
];
const deptMeta = (k: string) => DEPARTMENTS.find(d => d.key === k) || DEPARTMENTS[0];

interface Doc {
  _id: string;
  title: string;
  department: string;
  summary?: string;
  body?: string;
  version: number;
  versions?: Array<{ version: number; body: string; changeNote: string; publishedAt: string }>;
  acks?: Array<{ userId: string; userName: string; version: number; at: string }>;
  ackCount?: number;
  acknowledged?: boolean;
  archived?: boolean;
  publishedAt?: string;
  updatedAt?: string;
}

const EMPTY_FORM = { title: '', department: 'general', summary: '', body: '', changeNote: '' };

export default function ProcessUpdatesPage() {
  const { user, role } = useAuth();
  const isAdmin = role === 'admin' || ((user as any)?.roles || []).includes('admin');

  const [docs, setDocs]       = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState('');
  const [dept, setDept]       = useState<string>('');

  const [open, setOpen]       = useState<Doc | null>(null);   // reading pane
  const [openBusy, setOpenBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [editing, setEditing] = useState<Doc | null | 'new'>(null);
  const [form, setForm]       = useState({ ...EMPTY_FORM });
  const [saving, setSaving]   = useState(false);

  const load = () => {
    setLoading(true);
    api.listProcessDocs()
      .then((d: any) => setDocs(Array.isArray(d) ? d : []))
      .catch(() => toast.error('Could not load processes'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter(d =>
      (!dept || d.department === dept) &&
      (!needle ||
        d.title.toLowerCase().includes(needle) ||
        (d.summary || '').toLowerCase().includes(needle)));
  }, [docs, q, dept]);

  const unreadCount = docs.filter(d => !d.acknowledged).length;

  const openDoc = async (d: Doc) => {
    setOpenBusy(true);
    setShowHistory(false);
    try {
      const full = await api.getProcessDoc(d._id);
      setOpen(full);
    } catch { toast.error('Could not open that process'); }
    finally { setOpenBusy(false); }
  };

  const acknowledge = async () => {
    if (!open) return;
    try {
      const res = await api.ackProcessDoc(open._id);
      setOpen(o => o ? { ...o, acknowledged: true, ackCount: res.ackCount } : o);
      setDocs(list => list.map(d => d._id === open._id
        ? { ...d, acknowledged: true, ackCount: res.ackCount } : d));
      toast.success('Marked as read');
    } catch { toast.error('Could not record that'); }
  };

  const startNew = () => { setForm({ ...EMPTY_FORM }); setEditing('new'); };
  const startEdit = (d: Doc) => {
    setForm({
      title: d.title, department: d.department, summary: d.summary || '',
      body: d.body || '', changeNote: '',
    });
    setEditing(d);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Give the process a title'); return; }
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.createProcessDoc({
          title: form.title, department: form.department,
          summary: form.summary, body: form.body,
        });
        toast.success('Process published');
      } else if (editing) {
        const res = await api.updateProcessDoc(editing._id, {
          title: form.title, department: form.department, summary: form.summary,
          body: form.body, changeNote: form.changeNote,
        });
        toast.success(res?.versionBumped
          ? `Published v${res.version} — the team will be asked to re-read it`
          : 'Process updated');
      }
      setEditing(null);
      setOpen(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  const archive = async (d: Doc) => {
    if (!confirm(`Archive "${d.title}"? It stays readable but drops out of the list.`)) return;
    try { await api.updateProcessDoc(d._id, { archived: true }); toast.success('Archived'); setOpen(null); load(); }
    catch { toast.error('Could not archive'); }
  };
  const remove = async (d: Doc) => {
    if (!confirm(`Permanently delete "${d.title}" and its read history? This can't be undone.`)) return;
    try { await api.deleteProcessDoc(d._id); toast.success('Deleted'); setOpen(null); load(); }
    catch { toast.error('Could not delete'); }
  };

  const ago = (d?: string) => {
    if (!d) return '';
    try { return formatDistanceToNowStrict(new Date(d), { addSuffix: true }); } catch { return ''; }
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-transition-enter">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-border/80">
          <div>
            <h2 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <BookMarked className="h-5 w-5 text-purple-400" /> Process Updates & SOPs
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              How we work, written down and versioned. {unreadCount > 0
                ? <span className="text-amber-400 font-semibold">{unreadCount} need{unreadCount === 1 ? 's' : ''} your read.</span>
                : 'You’re up to date on all of them.'}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={startNew}
              className="bg-primary hover:bg-primary/85 text-primary-foreground px-3.5 py-2 rounded-lg text-xs font-semibold transition shadow-md shadow-primary/20 flex items-center gap-2 self-start"
            >
              <Plus className="h-3.5 w-3.5" /> New process
            </button>
          )}
        </div>

        {/* Search + department filter */}
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-muted-foreground">
              <Search className="h-4 w-4" />
            </span>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search processes by title or summary…"
              className="w-full bg-card border border-border rounded-xl pl-11 pr-4 py-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setDept('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                !dept ? 'bg-primary text-primary-foreground shadow' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}
            >
              All departments
            </button>
            {DEPARTMENTS.map(d => (
              <button
                key={d.key}
                onClick={() => setDept(dept === d.key ? '' : d.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  dept === d.key ? 'bg-primary text-primary-foreground shadow' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <BookMarked className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">No processes here yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isAdmin ? 'Write the first one — start with whatever gets explained in chat most often.'
                       : 'Nothing has been published for this filter.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map(d => {
              const dm = deptMeta(d.department);
              return (
                <button
                  key={d._id}
                  onClick={() => openDoc(d)}
                  className="bg-card border border-border hover:border-primary/50 rounded-xl p-4 text-left transition group"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${dm.tone}`}>
                      {dm.label}
                    </span>
                    {d.acknowledged ? (
                      <span className="text-[10px] text-emerald-400 font-semibold inline-flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> Read
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-400 font-semibold inline-flex items-center gap-1 shrink-0">
                        <ShieldAlert className="h-3 w-3" /> Needs your read
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-foreground group-hover:text-primary transition line-clamp-1">{d.title}</p>
                  {d.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.summary}</p>}
                  <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                    <span className="font-mono">v{d.version}</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {d.ackCount || 0} read</span>
                    <span>{ago(d.publishedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Reading pane ─────────────────────────────────────────────── */}
        {(open || openBusy) && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl">
              {openBusy || !open ? (
                <div className="p-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
              ) : (
                <>
                  <div className="p-5 border-b border-border flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${deptMeta(open.department).tone}`}>
                          {deptMeta(open.department).label}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">v{open.version}</span>
                      </div>
                      <h3 className="text-base font-bold text-foreground">{open.title}</h3>
                      {open.summary && <p className="text-xs text-muted-foreground mt-1">{open.summary}</p>}
                    </div>
                    <button onClick={() => setOpen(null)} className="text-muted-foreground hover:text-foreground p-1.5 shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5">
                    {showHistory ? (
                      <div className="space-y-3">
                        {(open.versions || []).slice().reverse().map(v => (
                          <div key={v.version} className="bg-background border border-border rounded-xl p-3">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-mono font-bold text-foreground">v{v.version}</span>
                              <span className="text-muted-foreground">{v.publishedAt ? format(new Date(v.publishedAt), 'dd MMM yyyy') : ''}</span>
                            </div>
                            <p className="text-[11px] text-primary font-semibold mb-1.5">{v.changeNote}</p>
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{v.body}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                        {open.body || 'This process has no content yet.'}
                      </p>
                    )}
                  </div>

                  <div className="p-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowHistory(h => !h)}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-2 py-1.5"
                      >
                        <History className="h-3.5 w-3.5" /> {showHistory ? 'Current version' : `History (${(open.versions || []).length})`}
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => startEdit(open)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-2 py-1.5">
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button onClick={() => archive(open)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-2 py-1.5">
                            <Archive className="h-3.5 w-3.5" /> Archive
                          </button>
                          <button onClick={() => remove(open)} className="text-xs text-muted-foreground hover:text-rose-400 inline-flex items-center gap-1.5 px-2 py-1.5">
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </>
                      )}
                    </div>
                    {open.acknowledged ? (
                      <span className="text-xs text-emerald-400 font-semibold inline-flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" /> You've read v{open.version}
                      </span>
                    ) : (
                      <button
                        onClick={acknowledge}
                        className="bg-primary hover:bg-primary/85 text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold transition shadow inline-flex items-center gap-2"
                      >
                        <Check className="h-3.5 w-3.5" /> I've read this
                      </button>
                    )}
                  </div>

                  {isAdmin && (open.acks || []).length > 0 && (
                    <div className="px-5 pb-4 -mt-1">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
                        Read by ({(open.acks || []).filter(a => a.version === open.version).length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(open.acks || []).filter(a => a.version === open.version).map(a => (
                          <span key={a.userId} className="text-[10px] bg-background border border-border rounded px-2 py-0.5 text-muted-foreground">
                            {a.userName || 'Teammate'} · {ago(a.at)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Editor (admin) ───────────────────────────────────────────── */}
        {editing && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <form onSubmit={save} className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h3 className="text-base font-bold text-foreground">
                  {editing === 'new' ? 'New process' : `Edit — ${editing.title}`}
                </h3>
                <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground p-1.5">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Process title *"
                  required
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:border-primary"
                />
                <div className="grid sm:grid-cols-2 gap-3">
                  <select
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    className="px-3 py-2 bg-background border border-input rounded-xl text-xs focus:outline-none focus:border-primary"
                  >
                    {DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                  <input
                    value={form.summary}
                    onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
                    placeholder="One-line summary"
                    className="px-3 py-2 bg-background border border-input rounded-xl text-xs focus:outline-none focus:border-primary"
                  />
                </div>
                <textarea
                  value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="The process itself — steps, rules, who does what…"
                  rows={12}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:border-primary font-mono leading-relaxed"
                />
                {editing !== 'new' && (
                  <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 space-y-2">
                    <p className="text-[11px] text-amber-400 font-semibold">
                      Changing the text publishes v{(editing.version || 1) + 1} and clears all {editing.ackCount || 0} read receipts — the team gets asked to read it again.
                    </p>
                    <input
                      value={form.changeNote}
                      onChange={e => setForm(f => ({ ...f, changeNote: e.target.value }))}
                      placeholder="What changed and why (shown in history)"
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-3">
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-primary hover:bg-primary/85 text-primary-foreground px-5 py-2 rounded-lg text-xs font-semibold transition shadow inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {editing === 'new' ? 'Publish process' : 'Publish update'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
