import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { celebrateBroadcast } from '@/lib/celebrate';

/**
 * CrmSharedModals — the two still-live components extracted from the old
 * ClientPipelinePage.tsx (superseded by ExecutiveDashboard/CRMView.tsx).
 * Kept as their own small file so the 88KB dead page could be deleted
 * outright without losing this real, working functionality:
 *
 *   - CreateWorkflowModal   — the real "onboard a client" flow used by
 *     CRMView's "Add client" button.
 *   - AllProjectsBriefButton — the real Gemini "brief all projects" button
 *     used by CRMView's header action.
 *
 * Logic is unchanged from the original — this is a pure extraction, not a
 * rewrite. See CRMView.tsx for how these are wired in.
 */

export function CreateWorkflowModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [templates, setTemplates] = useState<Record<string, any>>({});
  const [clientId, setClientId] = useState('');
  // Aug 2026 — owner ask: "allow Om to add a new client that is not even
  // onboarded as well." The dropdown only lists existing User(role:'client')
  // records, so a brand with no login/contact details yet couldn't be put in
  // the pipeline at all. `newMode` switches this field to a free-text name,
  // which the server turns into a placeholder client User (see
  // createWorkflow) before creating the workflow exactly as normal.
  const [newMode, setNewMode]       = useState(false);
  const [newClientName, setNewName] = useState('');
  const [chosen, setChosen]     = useState<Set<string>>(new Set());
  // Priority is captured on creation. Defaults to 'medium' — the
  // bulk of the agency's projects sit here. Owner ask (May 2026):
  // every member adding a Client CRM entry should commit to a
  // priority upfront so the sort/filter on the dashboard reflects
  // real urgency from day one, not whatever was auto-assigned.
  const [priority, setPriority] = useState<'urgent' | 'high' | 'medium' | 'low'>('medium');
  const [saving, setSaving]     = useState(false);
  // Needed to fire the org-wide confetti broadcast on a successful save.
  const socket = useSocket();
  const { user } = useAuth();

  useEffect(() => {
    api.listUsers({ role: 'client' }).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => {});
    api.cwGetTemplates().then(setTemplates).catch(() => {});
  }, []);

  const toggleSvc = (key: string) => setChosen(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const save = async () => {
    const typedName = newClientName.trim();
    if (newMode ? !typedName : !clientId) {
      toast.error(newMode ? 'Enter a client name' : 'Pick a client');
      return;
    }
    if (chosen.size === 0) { toast.error('Pick at least one service'); return; }
    setSaving(true);
    try {
      // Priority is sent alongside the standard fields. The server's
      // createWorkflow controller persists it as `workflow.priority`
      // — same field the dashboard's existing priority filter reads.
      // Exactly one of clientId / clientName goes up; the server accepts
      // either and mints a placeholder client login for the name-only case.
      await (api.cwCreateWorkflow as any)({
        ...(newMode ? { clientName: typedName } : { clientId }),
        services: Array.from(chosen),
        priority,
      });
      toast.success('Client CRM entry created — teammates have been auto-assigned');
      // Broadcast the celebration org-wide. Surface the client name on
      // every receiver's toast so the team knows WHO was just brought
      // on, not just that "something happened".
      const clientLabel = newMode ? typedName : (clients.find(c => c._id === clientId)?.name || 'a new client');
      celebrateBroadcast(socket, {
        reason:    `${clientLabel} added to Client CRM`,
        actorName: user?.name,
      });
      onCreated();
    } catch { /* interceptor toasts */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-bold">Onboard a client</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Client — either an existing client login, or (Aug 2026) just a
              name for a brand that hasn't been onboarded yet. */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground">Client</label>
              <button
                type="button"
                onClick={() => setNewMode(v => !v)}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                {newMode ? 'Pick an existing client' : 'Not onboarded yet? Add by name'}
              </button>
            </div>

            {newMode ? (
              <>
                <input
                  value={newClientName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Brand or client name"
                  autoFocus
                  className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Goes straight into the pipeline. No login or contact details needed — add those later if they ever need portal access.
                </p>
              </>
            ) : (
              <>
                <select value={clientId} onChange={e => setClientId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-background border border-input rounded-lg text-sm">
                  <option value="">— pick a client —</option>
                  {clients.map(c => (
                    <option key={c._id} value={c._id}>
                      {c.name || c.email}{(c as any).phone ? ` · ${(c as any).phone}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Don't see them? Use "Add by name" above, or Admin → Clients.</p>
              </>
            )}
          </div>

          {/* Priority — captured upfront so the dashboard's filters
              and sort reflect the creator's intent from day one. */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Priority</label>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {([
                { v: 'urgent', label: 'Urgent', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-700' },
                { v: 'high',   label: 'High',   cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700' },
                { v: 'medium', label: 'Medium', cls: 'border-blue-500/30 bg-blue-500/10 text-blue-700' },
                { v: 'low',    label: 'Low',    cls: 'border-border bg-muted text-muted-foreground' },
              ] as const).map(p => {
                const active = priority === p.v;
                return (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => setPriority(p.v)}
                    className={`rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition-all ${
                      active ? `${p.cls} ring-1 ring-current/20` : 'border-border bg-background text-foreground/70 hover:border-primary/30'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Drives sort + filter on the Client CRM dashboard. Change later from the project page.
            </p>
          </div>

          {/* Services */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Services for this client</label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(templates).map(([key, tpl]: any) => {
                const active = chosen.has(key);
                return (
                  <button key={key} type="button" onClick={() => toggleSvc(key)}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:border-primary/30'
                    }`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{tpl.label}</p>
                      <span className={`h-4 w-4 rounded border ${active ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {tpl.checklist.length} step{tpl.checklist.length === 1 ? '' : 's'} · auto-assigned to <strong>{tpl.team}</strong> team
                    </p>
                    {tpl.dependsOn?.length > 0 && (
                      <p className="text-[10px] text-amber-700 mt-0.5">starts after {tpl.dependsOn.join(', ')}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={save} disabled={saving || (newMode ? !newClientName.trim() : !clientId) || chosen.size === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add to Client CRM
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AllProjectsBriefButton — top-right button on the Client CRM page that
// fires a single Gemini call summarizing every active project. The
// resulting paragraph drops into a modal so the owner reads it once and
// closes. Cheap (one model call regardless of project count) and gives
// a "state of the agency" answer in 2 seconds.
// ─────────────────────────────────────────────────────────────────────────
export function AllProjectsBriefButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string>('');
  const [count, setCount] = useState<number>(0);

  const run = async () => {
    setOpen(true);
    if (brief) return; // already loaded — just re-open the modal
    setLoading(true);
    try {
      const r = await api.aiBriefAllProjects();
      setBrief(r.text || '');
      setCount(r.projectCount || 0);
    } catch { /* axios toast */ }
    finally { setLoading(false); }
  };

  return (
    <>
      <button
        onClick={run}
        title="AI brief covering every active project"
        className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-card border border-primary/30 text-primary hover:bg-primary/10 text-sm font-semibold transition-colors"
      >
        <Sparkles className="h-4 w-4" /> Brief all projects
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl shadow-2xl max-w-xl w-full p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-primary">AI brief</p>
                  <p className="text-base font-bold">State of {count || ''} active project{count === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Asking Gemini for a status sweep…
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{brief}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => { setBrief(''); run(); }}
                  className="text-xs font-semibold text-primary hover:underline">
                  Regenerate
                </button>
                <button onClick={() => setOpen(false)}
                  className="ml-auto px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
