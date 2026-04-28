import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound, Search, Plus, Globe, Megaphone, Mail, Code, Server,
  BarChart3, Hash, Pencil, Trash2, Copy, Check, ExternalLink,
  Building2, Loader2, X, Save, Eye, EyeOff,
} from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';

type CredType = 'website' | 'social' | 'ad' | 'email' | 'api' | 'hosting' | 'analytics' | 'other';

interface Credential {
  _id: string;
  title: string;
  type: CredType;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  clientId?: { _id: string; name?: string; email?: string } | string | null;
  projectId?: { _id: string; name?: string } | string | null;
  updatedAt?: string;
}

interface ClientLite { _id: string; name?: string; email?: string }

const TYPE_META: Record<CredType, { label: string; icon: any; color: string }> = {
  website:   { label: 'Website',   icon: Globe,      color: 'bg-blue-500/15 text-blue-500' },
  social:    { label: 'Social',    icon: Hash,       color: 'bg-pink-500/15 text-pink-500' },
  ad:        { label: 'Ads',       icon: Megaphone,  color: 'bg-amber-500/15 text-amber-500' },
  email:     { label: 'Email',     icon: Mail,       color: 'bg-violet-500/15 text-violet-500' },
  api:       { label: 'API',       icon: Code,       color: 'bg-emerald-500/15 text-emerald-500' },
  hosting:   { label: 'Hosting',   icon: Server,     color: 'bg-slate-500/15 text-slate-500' },
  analytics: { label: 'Analytics', icon: BarChart3,  color: 'bg-orange-500/15 text-orange-500' },
  other:     { label: 'Other',     icon: KeyRound,   color: 'bg-primary/15 text-primary' },
};

const TYPE_ORDER: CredType[] = ['website', 'social', 'ad', 'email', 'analytics', 'hosting', 'api', 'other'];

function clientNameOf(c: Credential): string {
  if (!c.clientId) return 'Unassigned';
  if (typeof c.clientId === 'string') return 'Unassigned';
  return c.clientId.name || c.clientId.email || 'Unassigned';
}

function clientIdOf(c: Credential): string | null {
  if (!c.clientId) return null;
  if (typeof c.clientId === 'string') return c.clientId;
  return c.clientId._id;
}

async function copyToClipboard(text: string, label = 'Copied') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}`, { duration: 1500 });
  } catch {
    toast.error('Could not access clipboard');
  }
}

export default function ClientVault() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CredType>('all');
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.listCredentials();
      setCredentials(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    reload();
    api.adminClients().then((d: any) => setClients(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Filter as you type — no submit button, no extra clicks.
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return credentials.filter(c => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (!term) return true;
      const haystack = [
        c.title, c.url, c.username, c.notes,
        clientNameOf(c),
        typeof c.projectId === 'object' && c.projectId ? c.projectId.name : '',
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [credentials, q, typeFilter]);

  // Group by client
  const grouped = useMemo(() => {
    const m = new Map<string, { name: string; items: Credential[] }>();
    for (const c of filtered) {
      const key = clientIdOf(c) || '__unassigned';
      const name = clientNameOf(c);
      const bucket = m.get(key) || { name, items: [] };
      bucket.items.push(c);
      m.set(key, bucket);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [filtered]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-primary" /> Client Vault
            </h1>
            <p className="text-sm text-muted-foreground">
              All client logins, accounts and links in one place. Click any field to copy.
            </p>
          </div>
          <button onClick={() => setAdding(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 shadow-sm">
            <Plus className="h-4 w-4" /> Add credential
          </button>
        </div>

        {/* Inline create form */}
        <AnimatePresence>
          {adding && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <CreateForm
                clients={clients}
                onCancel={() => setAdding(false)}
                onSaved={(c) => { setCredentials(prev => [c, ...prev]); setAdding(false); }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search + type filter */}
        <div className="bg-card border border-border rounded-2xl p-3 flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[220px] flex items-center gap-2 px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by client, title, URL, username, notes…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
            {q && (
              <button onClick={() => setQ('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Type chips */}
          <div className="flex items-center gap-1 flex-wrap">
            <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All</FilterChip>
            {TYPE_ORDER.map(t => (
              <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
                {TYPE_META[t].label}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          credentials.length === 0
            ? <EmptyState icon={KeyRound} title="No credentials yet" description="Add your first client credential above." />
            : <EmptyState icon={Search} title="No matches" description="Try a different search or filter." />
        ) : (
          <div className="space-y-5">
            {grouped.map(([key, group]) => (
              <section key={key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</h3>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{group.items.length}</span>
                </div>
                <div className="bg-card border border-border rounded-2xl divide-y divide-border/40 overflow-hidden">
                  {group.items.map(c => (
                    <CredentialRow
                      key={c._id}
                      cred={c}
                      clients={clients}
                      onChanged={(updated) => setCredentials(prev => prev.map(p => p._id === updated._id ? updated : p))}
                      onDeleted={() => setCredentials(prev => prev.filter(p => p._id !== c._id))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ───────────────────────────── helpers ─────────────────────────────

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function CopyChip({ value, label, mono = false }: { value?: string; label: string; mono?: boolean }) {
  const [hit, setHit] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={async () => { await copyToClipboard(value, `${label} copied`); setHit(true); setTimeout(() => setHit(false), 1200); }}
      className="group inline-flex items-center gap-1.5 max-w-full text-left text-xs px-2 py-1 rounded-lg bg-muted/30 hover:bg-muted border border-transparent hover:border-border transition-colors"
      title={`Click to copy ${label.toLowerCase()}`}
    >
      <span className={`text-muted-foreground text-[10px] uppercase tracking-wide font-medium`}>{label}</span>
      <span className={`truncate text-foreground ${mono ? 'font-mono' : ''}`}>{value}</span>
      {hit
        ? <Check className="h-3 w-3 text-green-500 shrink-0" />
        : <Copy className="h-3 w-3 text-muted-foreground/60 group-hover:text-foreground shrink-0" />}
    </button>
  );
}

function CredentialRow({
  cred, clients, onChanged, onDeleted,
}: {
  cred: Credential;
  clients: ClientLite[];
  onChanged: (c: Credential) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const Meta = TYPE_META[cred.type] || TYPE_META.other;

  const handleDelete = async () => {
    if (!confirm(`Delete "${cred.title}"? This cannot be undone.`)) return;
    try { await api.deleteCredential(cred._id); toast.success('Deleted'); onDeleted(); }
    catch { toast.error('Delete failed'); }
  };

  if (editing) {
    return (
      <EditForm
        cred={cred}
        clients={clients}
        onCancel={() => setEditing(false)}
        onSaved={(updated) => { onChanged(updated); setEditing(false); }}
      />
    );
  }

  return (
    <div className="px-4 py-3 hover:bg-muted/10 transition-colors">
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${Meta.color}`}>
          <Meta.icon className="h-4 w-4" />
        </div>

        {/* Title + chips */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{cred.title}</p>
            <span className="text-[10px] uppercase font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{Meta.label}</span>
            {typeof cred.projectId === 'object' && cred.projectId?.name && (
              <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">{cred.projectId.name}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {cred.url && (
              <>
                <CopyChip value={cred.url} label="URL" />
                <a href={cred.url.match(/^https?:\/\//) ? cred.url : `https://${cred.url}`}
                   target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                  <ExternalLink className="h-3 w-3" /> Open
                </a>
              </>
            )}
            <CopyChip value={cred.username} label="Username" mono />

            {cred.password && (
              <button
                onClick={() => copyToClipboard(cred.password!, 'Password copied')}
                className="group inline-flex items-center gap-1.5 max-w-full text-left text-xs px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-transparent hover:border-amber-500/30 transition-colors"
                title="Click to copy password"
              >
                <span className="text-amber-600 text-[10px] uppercase tracking-wide font-medium">Password</span>
                <span className="font-mono text-foreground truncate">
                  {showPw ? cred.password : '••••••••'}
                </span>
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); setShowPw(v => !v); }}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  title={showPw ? 'Hide' : 'Show'}
                >
                  {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </span>
                <Copy className="h-3 w-3 text-muted-foreground/60 group-hover:text-foreground shrink-0" />
              </button>
            )}
          </div>

          {cred.notes && (
            <p className="text-xs text-muted-foreground italic line-clamp-2">{cred.notes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => setEditing(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleDelete}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  title: '', type: 'website' as CredType, url: '', username: '', password: '',
  notes: '', clientId: '', projectId: '',
};

function CreateForm({ clients, onCancel, onSaved }: {
  clients: ClientLite[];
  onCancel: () => void;
  onSaved: (c: Credential) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload: any = { ...form };
      if (!payload.clientId)  delete payload.clientId;
      if (!payload.projectId) delete payload.projectId;
      const created = await api.createCredential(payload);
      toast.success('Credential saved');
      onSaved(created);
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="bg-card border border-primary/30 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">New credential</p>
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <FormFields form={form} setForm={setForm} clients={clients} />
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted">
          Cancel
        </button>
        <button type="submit" disabled={saving || !form.title.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
      </div>
    </form>
  );
}

function EditForm({ cred, clients, onCancel, onSaved }: {
  cred: Credential;
  clients: ClientLite[];
  onCancel: () => void;
  onSaved: (c: Credential) => void;
}) {
  const [form, setForm] = useState({
    title: cred.title || '',
    type:  cred.type || 'other' as CredType,
    url:   cred.url || '',
    username: cred.username || '',
    password: cred.password || '',
    notes:    cred.notes || '',
    clientId:  clientIdOf(cred) || '',
    projectId: typeof cred.projectId === 'object' && cred.projectId?._id ? cred.projectId._id : '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = { ...form };
      if (!payload.clientId)  payload.clientId  = null;
      if (!payload.projectId) payload.projectId = null;
      const updated = await api.updateCredential(cred._id, payload);
      toast.success('Saved');
      onSaved(updated);
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="px-4 py-4 bg-primary/5 border-y border-primary/20 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Edit credential</p>
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <FormFields form={form} setForm={setForm} clients={clients} />
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
      </div>
    </form>
  );
}

function FormFields({
  form, setForm, clients,
}: {
  form: typeof EMPTY_FORM;
  setForm: (updater: (f: typeof EMPTY_FORM) => typeof EMPTY_FORM) => void;
  clients: ClientLite[];
}) {
  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm(f => ({ ...f, ...patch }));
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          autoFocus
          value={form.title}
          onChange={e => set({ title: e.target.value })}
          placeholder="Title (e.g. Acme WordPress)"
          required
          className="sm:col-span-2 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={form.type}
          onChange={e => set({ type: e.target.value as CredType })}
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm"
        >
          {TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          value={form.url}
          onChange={e => set({ url: e.target.value })}
          placeholder="URL (https://…)"
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono"
        />
        <select
          value={form.clientId}
          onChange={e => set({ clientId: e.target.value })}
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm"
        >
          <option value="">— No client —</option>
          {clients.map(c => (
            <option key={c._id} value={c._id}>{c.name || c.email}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          value={form.username}
          onChange={e => set({ username: e.target.value })}
          placeholder="Username / email"
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono"
        />
        <input
          type="text"
          value={form.password}
          onChange={e => set({ password: e.target.value })}
          placeholder="Password"
          className="px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono"
        />
      </div>

      <textarea
        value={form.notes}
        onChange={e => set({ notes: e.target.value })}
        placeholder="Notes (optional) — e.g. 2FA backup codes, contact info, gotchas"
        rows={2}
        className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm resize-y"
      />
    </>
  );
}
