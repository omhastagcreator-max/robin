import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Plus, X, Eye, EyeOff, Copy, RefreshCw,
  Trophy, ArrowRight, IndianRupee, UserPlus, CheckCircle2,
  Building2, Wand2, Phone, Mail, Briefcase, Info,
  LayoutGrid, List as ListIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout }   from '@/components/AppLayout';
import { Button }      from '@/components/ui/Button';
import { Row }         from '@/components/ui/Row';
import { EmptyState }  from '@/components/ui/EmptyState';
import { StatusPill }  from '@/components/ui/StatusPill';
import { Avatar }      from '@/components/shared/Avatar';
import * as api from '@/api';

/**
 * AdminClients v2 — rebuilt on design-system primitives.
 *
 * What changed vs v1:
 *   • 3-column client card grid → dense Row list.
 *   • Hardcoded gray-100/300/500/700/900 chrome → semantic tokens
 *     (`muted-foreground`, `foreground`, `card`, `border`).
 *   • Won-leads green strip rebuilt as a tinted Row list.
 *   • "How clients enter" info block → EmptyState with hint copy.
 *   • CreateClientModal repaletted to v2 Button + tokens.
 *
 * What stayed:
 *   • All existing actions: Add Client manually, Convert won leads,
 *     Seed demo clients (Wand2), Import from Meta (Wand2).
 *   • The credentials-share success state inside the modal.
 *
 * Density: ~12 clients visible per fold vs. ~6 in v1.
 */

// ─── helpers ────────────────────────────────────────────────────────────────
function genPassword(name: string) {
  const clean = (name || 'client').replace(/\s+/g, '').slice(0, 6);
  return `${clean}@${Math.floor(1000 + Math.random() * 9000)}`;
}

// ─── Create / Convert modal ────────────────────────────────────────────────
function CreateClientModal({
  onClose, onCreated, prefill, fromLead,
}: {
  onClose: () => void;
  onCreated: (result: any) => void;
  prefill?: { name?: string; email?: string; phone?: string; company?: string; fromLeadId?: string; wonAmount?: number };
  fromLead?: boolean;
}) {
  const [form, setForm] = useState({
    name:     prefill?.name    || '',
    email:    prefill?.email   || '',
    phone:    prefill?.phone   || '',
    company:  prefill?.company || '',
    password: prefill?.name ? genPassword(prefill.name) : '',
  });
  const [showPw, setShowPw] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone]     = useState<any>(null);

  const f = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await api.createUser({
        name:       form.name,
        email:      form.email,
        password:   form.password,
        phone:      form.phone,
        company:    form.company,
        role:       'client',
        fromLeadId: prefill?.fromLeadId,
      });
      setDone(result);
      onCreated(result);
      toast.success(`Client "${form.name}" created`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create client');
    } finally { setSaving(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className={`px-5 py-3 flex items-center justify-between border-b border-border ${fromLead ? 'bg-emerald-500/[0.06]' : ''}`}>
          <div className="flex items-center gap-2 min-w-0">
            {fromLead ? <Trophy className="h-4 w-4 text-emerald-600 shrink-0" /> : <UserPlus className="h-4 w-4 text-primary shrink-0" />}
            <p className="text-sm font-semibold truncate">{fromLead ? 'Convert Lead → Client' : 'Add New Client'}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {fromLead && prefill?.wonAmount && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[12.5px] text-emerald-700">
                <IndianRupee className="h-3.5 w-3.5" />
                <span className="font-semibold">Won deal: ₹{Number(prefill.wonAmount).toLocaleString('en-IN')}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                { field: 'name',    label: 'Client name *',  required: true,  span: 'col-span-2' },
                { field: 'email',   label: 'Email *',         required: true,  span: '' },
                { field: 'phone',   label: 'Phone',           required: false, span: '' },
                { field: 'company', label: 'Company / brand', required: false, span: 'col-span-2' },
              ].map(field => (
                <div key={field.field} className={field.span}>
                  <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-1 block">{field.label}</label>
                  <input
                    value={(form as any)[field.field]}
                    onChange={f(field.field as any)}
                    required={field.required}
                    type={field.field === 'email' ? 'email' : 'text'}
                    className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              ))}

              <div className="col-span-2">
                <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-1 block">Login password *</label>
                <div className="relative">
                  <input
                    value={form.password}
                    onChange={f('password')}
                    required
                    type={showPw ? 'text' : 'password'}
                    className="w-full px-3 h-9 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring pr-20"
                  />
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                    <button type="button" onClick={() => setShowPw(v => !v)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => setForm(p => ({ ...p, password: genPassword(form.name) }))} className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted" title="Generate new password">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Copy this and share it with the client.</p>
              </div>
            </div>

            <Button
              type="submit"
              size="md"
              intent={fromLead ? 'success' : 'primary'}
              loading={saving}
              disabled={!form.name || !form.email || !form.password}
              iconLeft={<UserPlus className="h-3.5 w-3.5" />}
              full
            >
              {fromLead ? 'Create client account' : 'Add client'}
            </Button>
          </form>
        ) : (
          /* Success state — credentials handoff */
          <div className="p-5 space-y-4 text-center">
            <div className="h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-[15px] font-bold">{done.name} added</p>
              <p className="text-[12px] text-muted-foreground">Share these credentials with the client.</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-left space-y-1.5">
              <CredRow label="Login URL" value="robin.hastagcreator.com/login" tone="primary" />
              <CredRow label="Email"     value={done.email} mono />
              <CredRow label="Password"  value={done.generatedPassword} mono copy />
            </div>
            <Button size="md" intent="primary" full onClick={onClose}>Done</Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function CredRow({ label, value, mono, tone, copy }: { label: string; value: string; mono?: boolean; tone?: 'primary'; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`text-[12px] truncate ${mono ? 'font-mono' : ''} ${tone === 'primary' ? 'text-primary font-semibold' : 'text-foreground'}`}>{value}</span>
        {copy && (
          <button onClick={() => { navigator.clipboard?.writeText(value); toast.success('Copied'); }} className="text-muted-foreground hover:text-foreground p-0.5 rounded">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function AdminClients() {
  const [clients, setClients]       = useState<any[]>([]);
  const [wonLeads, setWonLeads]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [convertLead, setConvertLead] = useState<any | null>(null);
  // View toggle — persisted per page. Grid fits ~3× the clients per fold.
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try { return (localStorage.getItem('people.clients.layout') as any) === 'list' ? 'list' : 'grid'; }
    catch { return 'grid'; }
  });
  const setViewPersist = (v: 'grid' | 'list') => {
    setView(v);
    try { localStorage.setItem('people.clients.layout', v); } catch { /* private mode */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, leads] = await Promise.all([
        api.listUsers({ role: 'client' }),
        api.listLeads({ stage: 'won' }),
      ]);
      setClients(Array.isArray(users) ? users : []);
      const won = (Array.isArray(leads) ? leads : []).filter((l: any) => !l.convertedToClientId);
      setWonLeads(won);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight">Clients</h1>
            <p className="text-[12px] text-muted-foreground">{clients.length} active account{clients.length === 1 ? '' : 's'}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden text-[11.5px]">
              <button
                onClick={() => setViewPersist('grid')}
                className={`flex items-center gap-1 px-2 py-1.5 transition-colors ${view === 'grid' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="Grid view"
              >
                <LayoutGrid className="h-3 w-3" /> Grid
              </button>
              <button
                onClick={() => setViewPersist('list')}
                className={`flex items-center gap-1 px-2 py-1.5 transition-colors ${view === 'list' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="List view"
              >
                <ListIcon className="h-3 w-3" /> List
              </button>
            </div>
            <UtilityButton
              label="Seed 3 demo clients"
              busyLabel="Seeding…"
              icon={<Wand2 className="h-3.5 w-3.5" />}
              prompt="Seed 3 demo clients (Velloer Living, History Life, Darpan) with workflows at different stages? Safe to re-run."
              onAction={() => api.seedDemoClients()}
              onDone={load}
              successKey="message"
            />
            <UtilityButton
              label="Import from Meta"
              busyLabel="Creating…"
              icon={<Wand2 className="h-3.5 w-3.5" />}
              prompt="Create one Robin Client account per Meta ad account?\n\nPlaceholder emails will be assigned — edit afterwards. Accounts already linked are skipped."
              onAction={() => api.adminBulkCreateMetaClients()}
              onDone={load}
              successKey="summary"
            />
            <Button size="sm" intent="primary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>
              Add client
            </Button>
          </div>
        </div>

        {/* Won leads awaiting conversion */}
        {wonLeads.length > 0 && (
          <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] overflow-hidden">
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-emerald-500/15">
              <Trophy className="h-4 w-4 text-emerald-600" />
              <p className="text-[12.5px] font-semibold text-emerald-800">
                {wonLeads.length} won deal{wonLeads.length === 1 ? '' : 's'} ready to convert
              </p>
              <span className="ml-auto text-[10.5px] text-emerald-700/70">Click to create the client account</span>
            </div>
            <div>
              {wonLeads.map(lead => (
                <Row key={lead._id} onClick={() => setConvertLead(lead)} density="comfy" accent="success">
                  <Row.Leading>
                    <Avatar name={lead.name} size="sm" tone="primary" />
                  </Row.Leading>
                  <Row.Main>
                    <Row.Title>{lead.name}</Row.Title>
                    <Row.Meta>{lead.company || '—'}{lead.contact ? ` · ${lead.contact}` : ''}</Row.Meta>
                  </Row.Main>
                  <Row.Trail>
                    <span className="text-[12.5px] font-bold text-emerald-700 tabular-nums">
                      ₹{(lead.wonAmount || lead.estimatedValue || 0).toLocaleString('en-IN')}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />
                  </Row.Trail>
                </Row>
              ))}
            </div>
          </section>
        )}

        {/* "How clients enter" empty-state hint */}
        {!loading && clients.length === 0 && wonLeads.length === 0 && (
          <EmptyState
            size="lg"
            icon={<Building2 className="h-7 w-7" />}
            title="No clients yet"
            hint="Two ways in: Sales closes a deal in /sales → it appears here as a green row to convert. Or click 'Add client' to onboard one directly."
            action={
              <Button size="sm" intent="primary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>
                Add your first client
              </Button>
            }
          />
        )}

        {/* Client list */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : clients.length > 0 ? (
          view === 'grid' ? (
            // Grid view: dense cards. 4-up on desktop. Each card surfaces
            // the same data as the list row but vertically stacked, so
            // ~24 clients fit per fold instead of ~12.
            <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {clients.map(c => (
                <div
                  key={c._id}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-col gap-1.5 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={c.name} email={c.email} size="sm" tone="primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold truncate">{c.name || 'Unnamed'}</p>
                      {c.company && (
                        <p className="text-[10.5px] text-muted-foreground truncate">{c.company}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 truncate">
                      <Mail className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <Briefcase className="h-2.5 w-2.5" />
                      {c.projectCount || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {c.phone ? (
                      <span className="text-[10.5px] text-muted-foreground truncate inline-flex items-center gap-1">
                        <Phone className="h-2.5 w-2.5 shrink-0" /> {c.phone}
                      </span>
                    ) : <span />}
                    <StatusPill state={c.isActive !== false ? 'working' : 'off_clock'} size="xs" label={c.isActive !== false ? 'Active' : 'Inactive'} icon="none" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
              {clients.map(c => (
                <Row key={c._id} density="comfy">
                  <Row.Leading>
                    <Avatar name={c.name} email={c.email} size="sm" tone="primary" />
                  </Row.Leading>
                  <Row.Main>
                    <Row.Title>{c.name || 'Unnamed'}</Row.Title>
                    <Row.Meta>
                      {c.company && <><span className="font-medium text-foreground/70">{c.company}</span> · </>}
                      <span className="inline-flex items-center gap-1"><Mail className="h-2.5 w-2.5" />{c.email}</span>
                      {c.phone && <> · <span className="inline-flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{c.phone}</span></>}
                    </Row.Meta>
                  </Row.Main>
                  <Row.Trail>
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                      <Briefcase className="h-3 w-3" />
                      {c.projectCount || 0}
                    </span>
                    <StatusPill state={c.isActive !== false ? 'working' : 'off_clock'} size="xs" label={c.isActive !== false ? 'Active' : 'Inactive'} icon="none" />
                  </Row.Trail>
                </Row>
              ))}
            </div>
          )
        ) : null}

        {/* Discovery hint — keep it small once there ARE clients but no won leads,
            so the team remembers the alternate entry path. */}
        {!loading && clients.length > 0 && wonLeads.length === 0 && (
          <p className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Tip: a deal moved to "Won" in /sales will appear here as a green row, ready to convert.
          </p>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateClientModal
            onClose={() => setShowCreate(false)}
            onCreated={() => { load(); setShowCreate(false); }}
          />
        )}
        {convertLead && (
          <CreateClientModal
            fromLead
            prefill={{
              name:       convertLead.name,
              phone:      convertLead.contact,
              company:    convertLead.company,
              fromLeadId: convertLead._id,
              wonAmount:  convertLead.wonAmount || convertLead.estimatedValue,
            }}
            onClose={() => setConvertLead(null)}
            onCreated={() => { load(); setConvertLead(null); }}
          />
        )}
      </AnimatePresence>
    </AppLayout>
  );
}

// ─── Utility button (Seed / Import-from-Meta share the same shape) ─────────
function UtilityButton({
  label, busyLabel, icon, prompt, onAction, onDone, successKey,
}: {
  label: string;
  busyLabel: string;
  icon: React.ReactNode;
  prompt: string;
  onAction: () => Promise<any>;
  onDone: () => void;
  successKey: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!confirm(prompt)) return;
    setBusy(true);
    try {
      const res = await onAction();
      toast.success((res && res[successKey]) || 'Done', { duration: 6000 });
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || `${label} failed`);
    } finally { setBusy(false); }
  };
  return (
    <Button size="sm" intent="secondary" loading={busy} onClick={run} iconLeft={icon}>
      {busy ? busyLabel : label}
    </Button>
  );
}
