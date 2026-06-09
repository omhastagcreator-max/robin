import { useEffect, useMemo, useState } from 'react';
import { Send, X, Sparkles, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * AssignTaskModal — global "anyone can assign anyone to anything" form.
 *
 * Lives in AppLayout so it can be opened from any internal page (the
 * launcher is a topbar pill + a sidebar entry). Fields:
 *
 *   Title       (required)
 *   Description (optional, multiline)
 *   Brand       (optional dropdown — pre-fills the brand workspace
 *                tasks row + the assignee's "Brand" inbox tab)
 *   Assignee    (required; defaults to "me")
 *   Priority    (low / medium / high / urgent — default medium)
 *   Due date    (optional)
 *
 * On submit:
 *   - createTask fires with the chosen fields.
 *   - Backend already routes cross-assigned tasks (assignee != me) into
 *     'pending_acceptance' status. The assignee then sees the existing
 *     PendingAcceptanceBanner on /workroom-home with Accept (date
 *     picker for ETA + hours) and Decline buttons.
 *   - Self-assigned tasks go straight to 'pending' (active inbox).
 *
 * The modal closes on success and fires a toast naming the recipient
 * so the creator gets feedback that the handoff is in flight.
 */

interface Brand { _id: string; clientName?: string }
interface UserLite { _id: string; name?: string; email?: string; role?: string }

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional default brand id — used when launching from a brand page. */
  defaultBrandId?: string;
}

const PRIORITIES: Array<{ value: 'low' | 'medium' | 'high' | 'urgent'; label: string; tone: string }> = [
  { value: 'low',    label: 'Low',    tone: 'border-muted text-muted-foreground' },
  { value: 'medium', label: 'Medium', tone: 'border-blue-500/30 bg-blue-500/10 text-blue-700' },
  { value: 'high',   label: 'High',   tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700' },
  { value: 'urgent', label: 'Urgent', tone: 'border-rose-500/30 bg-rose-500/10 text-rose-700' },
];

export function AssignTaskModal({ open, onClose, defaultBrandId }: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brandId, setBrandId] = useState(defaultBrandId || '');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [team, setTeam] = useState<UserLite[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  // Reset state on each open + default the assignee to "me" so a quick
  // personal todo is a single-keystroke save.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setBrandId(defaultBrandId || '');
    setAssigneeId(user?.id || '');
    setPriority('medium');
    setDueDate('');
  }, [open, defaultBrandId, user?.id]);

  useEffect(() => {
    if (!open) return;
    api.listUsers()
      .then((arr: any[]) => setTeam(Array.isArray(arr) ? arr.filter((u: any) => u.role !== 'client') : []))
      .catch(() => setTeam([]));
    api.cwListWorkflows({})
      .then((arr: any[]) => setBrands(Array.isArray(arr) ? arr : []))
      .catch(() => setBrands([]));
  }, [open]);

  const isCrossAssign = useMemo(
    () => !!assigneeId && assigneeId !== user?.id,
    [assigneeId, user?.id],
  );

  const submit = async () => {
    if (!title.trim()) { toast.error('Add a task title'); return; }
    if (!assigneeId)    { toast.error('Pick who should do this'); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assignedTo: assigneeId,
      };
      if (brandId)  body.clientWorkflowId = brandId;
      if (dueDate)  body.dueDate = new Date(dueDate).toISOString();
      await api.createTask(body);

      const assignee = team.find(u => u._id === assigneeId);
      const aname = assignee?.name || assignee?.email || 'them';
      if (isCrossAssign) {
        toast.success(`Sent to ${aname}. They'll set an ETA when they accept.`);
      } else {
        toast.success(`Task added to your inbox.`);
      }
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not create task');
    } finally { setSubmitting(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-primary">Assign a task</p>
            <h2 className="text-[15px] font-bold leading-tight mt-0.5">
              {isCrossAssign ? 'Hand off to a teammate' : 'Add to my inbox'}
            </h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-3 space-y-3">
          <Field label="Task" required>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
              placeholder="e.g. Update WOODSIFY landing page copy"
              autoFocus
              className="w-full px-2.5 h-9 rounded-md border border-input bg-background text-[13px] focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </Field>

          <Field label="Description" hint="Optional — context for the assignee">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Anything they need to know"
              className="w-full px-2.5 py-2 rounded-md border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none resize-none"
            />
          </Field>

          <Field label="Brand" hint="Links the task to this brand's workspace">
            <select
              value={brandId}
              onChange={e => setBrandId(e.target.value)}
              className="w-full px-2.5 h-9 rounded-md border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none"
            >
              <option value="">— No brand link —</option>
              {brands.map(b => (
                <option key={b._id} value={b._id}>{b.clientName || 'Unnamed'}</option>
              ))}
            </select>
          </Field>

          <Field label="Assignee" required>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="w-full px-2.5 h-9 rounded-md border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none"
            >
              <option value="">— Pick a teammate —</option>
              {user?.id && <option value={user.id}>Me ({user.name || user.email})</option>}
              {team.filter(u => u._id !== user?.id).map(u => (
                <option key={u._id} value={u._id}>{u.name || u.email} {u.role ? `· ${u.role}` : ''}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Priority">
              <div className="flex items-center gap-1">
                {PRIORITIES.map(p => (
                  <button
                    type="button"
                    key={p.value}
                    onClick={() => setPriority(p.value)}
                    className={`flex-1 h-7 rounded-md text-[10.5px] font-semibold border uppercase tracking-wider transition-colors ${
                      priority === p.value ? p.tone : 'border-border text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Due date" hint="Optional deadline">
              <input
                type="date"
                value={dueDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-2.5 h-9 rounded-md border border-input bg-background text-[12.5px] focus:ring-2 focus:ring-ring focus:outline-none"
              />
            </Field>
          </div>

          {isCrossAssign && (
            <div className="rounded-md bg-violet-500/8 border border-violet-500/20 px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] text-violet-800">
              <Sparkles className="h-3 w-3 text-violet-600 shrink-0" />
              <span>They'll accept and pick their own expected completion date.</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <p className="text-[10.5px] text-muted-foreground flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> ⌘/Ctrl + Enter to send
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-8 px-3 rounded-md text-[12px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
            >Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !title.trim() || !assigneeId}
              className="h-8 px-3 rounded-md text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
            >
              <Send className="h-3 w-3" />
              {submitting ? 'Sending…' : (isCrossAssign ? 'Send for accept' : 'Add task')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
        {label} {required && <span className="text-rose-600 normal-case">*</span>}
        {hint && <span className="ml-1 text-muted-foreground/70 normal-case font-normal">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}
