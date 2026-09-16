import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import {
  Lock, Search, Zap, ShieldCheck, Loader2, Check, CheckCircle2,
  MessageSquarePlus, Ban, Unlock, Terminal, X, RefreshCcw, ClipboardCopy,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';
import { DT_SELECTED_KEY } from '@/lib/dtSelection';

/**
 * DecisionTreePage — the gated task-execution workspace (Sep 2026).
 *
 * GATING RULE (owner ask): the Decision Tree is only visible once client
 * data is loaded — either a client was selected on the CRM page
 * ("Select & Unlock DT"), or one is fetched right here on the gated
 * screen. No client context → locked prompt, nothing else renders.
 *
 * Everything on the unlocked screen is REAL workflow data:
 *   stage pointers  = the workflow's service lines + statuses
 *   sub-steps       = the active service's SOP checklist
 *   task execution  = cwToggleCheck / cwCompleteService / cwBlock
 *   audit feed      = the workflow's append-only activity log
 * so every action taken here lands in the same CRM record every other
 * Robin view reads.
 */

interface ChecklistItem { text?: string; title?: string; done: boolean; doneAt?: string }
interface Svc {
  _id: string;
  serviceType: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: ChecklistItem[];
  assignedTo?: string;
  eta?: string | null;
}
interface Activity { at: string; actorName?: string; actorId: string; action: string; detail?: string; serviceType?: string }
interface Wf {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  services: Svc[];
  activity?: Activity[];
  health?: string;
  blockerType?: string;
  blockerReason?: string;
  currentOwnerTeam?: string;
}

const TEAM_LABEL: Record<string, string> = {
  sales: 'Sales', development: 'Development', meta: 'Meta Ads',
  influencer: 'UGC / Influencer', qa: 'QA',
};

/** The stage the tree is currently pointing at: blocked > in_progress > pending. */
const activeServiceOf = (wf: Wf | null): Svc | null => {
  if (!wf) return null;
  return wf.services.find(s => s.status === 'blocked')
      || wf.services.find(s => s.status === 'in_progress')
      || wf.services.find(s => s.status === 'pending')
      || null;
};

export default function DecisionTreePage() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(DT_SELECTED_KEY); } catch { return null; }
  });
  const [wf, setWf]           = useState<Wf | null>(null);
  const [loading, setLoading] = useState(false);
  const [allWfs, setAllWfs]   = useState<Array<{ _id: string; clientName?: string; currentOwnerTeam?: string }>>([]);
  const [acting, setActing]   = useState(false);

  // Gated-screen fetch box
  const [fetchQ, setFetchQ]           = useState('');
  const [fetchBusy, setFetchBusy]     = useState(false);
  const [fetchMatches, setFetchMatches] = useState<Array<{ _id: string; clientName?: string; clientPhone?: string }> | null>(null);

  // Blocker mini-form
  const [showBlock, setShowBlock]     = useState(false);
  const [blockReason, setBlockReason] = useState('');
  // Note mini-form
  const [noteText, setNoteText]       = useState('');

  const load = useCallback((id: string) => {
    setLoading(true);
    api.cwGetWorkflow(id)
      .then((doc: any) => setWf(doc))
      .catch(() => {
        toast.error('Could not load that client — pick another from the CRM');
        try { localStorage.removeItem(DT_SELECTED_KEY); } catch { /* noop */ }
        setSelectedId(null);
        setWf(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (selectedId) load(selectedId); }, [selectedId, load]);

  // Dropdown roster — only needed once the workspace is unlocked.
  useEffect(() => {
    if (!selectedId) return;
    api.cwListWorkflows({})
      .then((data: any) => setAllWfs(Array.isArray(data) ? data : data?.workflows || []))
      .catch(() => { /* dropdown just stays short */ });
  }, [selectedId]);

  const select = (id: string) => {
    try { localStorage.setItem(DT_SELECTED_KEY, id); } catch { /* noop */ }
    setSelectedId(id);
  };

  const clearSelection = () => {
    try { localStorage.removeItem(DT_SELECTED_KEY); } catch { /* noop */ }
    setSelectedId(null);
    setWf(null);
    setFetchMatches(null);
    setFetchQ('');
  };

  const fetchClient = async () => {
    const q = fetchQ.trim();
    if (!q) { toast.error('Enter a brand name, phone or email to fetch from the CRM'); return; }
    setFetchBusy(true);
    try {
      const data: any = await api.cwListWorkflows({ q });
      const list = Array.isArray(data) ? data : data?.workflows || [];
      if (list.length === 0) {
        toast.error(`No CRM match for "${q}"`);
        setFetchMatches([]);
      } else if (list.length === 1) {
        select(list[0]._id);
        toast.success(`Client match found — Decision Tree unlocked for ${list[0].clientName || 'client'}`);
      } else {
        setFetchMatches(list.slice(0, 8));
      }
    } catch {
      toast.error('CRM lookup failed — try again');
    } finally {
      setFetchBusy(false);
    }
  };

  const active = useMemo(() => activeServiceOf(wf), [wf]);
  const activeIdx = useMemo(
    () => (wf && active ? wf.services.findIndex(s => s._id === active._id) : -1),
    [wf, active],
  );
  const doneSteps  = active ? active.checklist.filter(c => c.done).length : 0;
  const totalSteps = active ? active.checklist.length : 0;
  const isBlocked  = !!wf && (!!wf.blockerType || wf.health === 'blocked' || active?.status === 'blocked');

  const feed = useMemo(() => {
    const items = [...(wf?.activity || [])];
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return items.slice(0, 30);
  }, [wf]);

  const withRefresh = async (fn: () => Promise<any>, okMsg: string) => {
    if (!wf) return;
    setActing(true);
    try {
      await fn();
      toast.success(okMsg);
      load(wf._id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  const toggleStep = (index: number, item: ChecklistItem) => {
    if (!wf || !active) return;
    const label = item.text || item.title || `step ${index + 1}`;
    withRefresh(
      () => api.cwToggleCheck(wf._id, active._id, {
        index,
        done: !item.done,
        comment: `${!item.done ? 'Completed' : 'Reopened'} via Decision Tree: ${label}`,
      }),
      !item.done ? 'Step completed — logged to CRM' : 'Step reopened',
    );
  };

  const completeStage = () => {
    if (!wf || !active) return;
    if (!confirm(`Mark "${active.label}" complete for ${wf.clientName || 'this client'}? This advances the stage pointer and logs to the CRM.`)) return;
    withRefresh(
      () => api.cwCompleteService(wf._id, active._id, { comment: 'Stage completed via Decision Tree' }),
      'Stage completed — pointer advanced & logged to CRM',
    );
  };

  const submitBlock = () => {
    if (!wf) return;
    const reason = blockReason.trim();
    if (!reason) { toast.error('Write what you are waiting on the client for'); return; }
    setShowBlock(false); setBlockReason('');
    withRefresh(
      () => api.cwBlock(wf._id, {
        blockerType: 'waiting_client_input',
        blockerReason: reason,
        comment: `Blocked via Decision Tree — ${reason}`,
      }),
      'Marked as awaiting client — logged to CRM',
    );
  };

  const unblock = () => {
    if (!wf) return;
    withRefresh(
      () => api.cwUnblock(wf._id, { comment: 'Unblocked via Decision Tree' }),
      'Blocker cleared — back in motion',
    );
  };

  const addNote = () => {
    if (!wf) return;
    const detail = noteText.trim();
    if (!detail) return;
    setNoteText('');
    withRefresh(
      () => api.cwAddNote(wf._id, { detail, serviceType: active?.serviceType }),
      'Note added to the CRM log',
    );
  };

  const copyWhatsApp = () => {
    if (!wf) return;
    const stage = active ? active.label : 'final review';
    const text =
      `Hi ${wf.clientName || 'there'}! Quick update on your project: ` +
      `we're currently on "${stage}" — ${doneSteps} of ${totalSteps} steps are done and verified. ` +
      `We'll keep you posted on the next milestone. 🚀`;
    if (!navigator.clipboard) { toast.error('Clipboard unavailable in this browser'); return; }
    navigator.clipboard.writeText(text)
      .then(() => toast.success('Client WhatsApp update copied to clipboard'))
      .catch(() => toast.error('Could not copy — select and copy manually'));
  };

  /* ─────────────────────────── GATED SCREEN ─────────────────────────── */
  if (!selectedId || (!wf && !loading)) {
    return (
      <AppLayout>
        <div className="min-h-[70vh] flex items-center justify-center p-6 page-transition-enter">
          <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-8 text-center shadow-2xl space-y-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 text-primary flex items-center justify-center mx-auto shadow-inner">
              <Lock className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground tracking-tight">
                Fetch client details from the CRM first
              </h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                The Decision Tree only opens with a verified client context loaded — that's what
                enforces the stage gates. Select a client on the CRM page, or fetch one below.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-muted-foreground">
                  <Search className="h-4 w-4" />
                </span>
                <input
                  value={fetchQ}
                  onChange={e => setFetchQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') fetchClient(); }}
                  placeholder="Registered brand name, phone or email…"
                  className="w-full bg-background border border-input rounded-xl pl-11 pr-4 py-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition"
                />
              </div>

              {fetchMatches && fetchMatches.length > 1 && (
                <div className="text-left space-y-1.5 max-h-44 overflow-y-auto">
                  {fetchMatches.map(m => (
                    <button
                      key={m._id}
                      onClick={() => select(m._id)}
                      className="w-full flex items-center justify-between bg-background border border-border hover:border-primary/60 rounded-lg px-3 py-2 text-xs transition"
                    >
                      <span className="font-semibold text-foreground">{m.clientName || 'Unnamed client'}</span>
                      <span className="text-muted-foreground">{m.clientPhone || ''}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={fetchClient}
                  disabled={fetchBusy}
                  className="flex-1 bg-primary hover:bg-primary/85 text-primary-foreground py-2.5 rounded-xl text-xs font-semibold transition shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {fetchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  Fetch & unlock DT
                </button>
                <button
                  onClick={() => navigate('/crm')}
                  className="bg-card hover:bg-muted text-foreground px-4 py-2.5 rounded-xl text-xs font-semibold transition border border-border"
                >
                  Open CRM
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  /* ───────────────────────── UNLOCKED WORKSPACE ─────────────────────── */
  return (
    <AppLayout>
      <div className="space-y-4 page-transition-enter">

        {/* Client selector sub-bar */}
        <div className="bg-card border border-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground uppercase font-semibold">Active client workspace:</span>
            <select
              value={wf?._id || selectedId || ''}
              onChange={e => select(e.target.value)}
              className="bg-background border border-input rounded-lg px-3 py-1.5 text-xs text-foreground font-medium focus:outline-none focus:border-primary max-w-[280px]"
            >
              {(allWfs.length ? allWfs : wf ? [wf] : []).map(w => (
                <option key={w._id} value={w._id}>
                  {w.clientName || 'Unnamed client'}
                  {w.currentOwnerTeam ? ` (${TEAM_LABEL[w.currentOwnerTeam] || w.currentOwnerTeam})` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              title="Clear client context — relocks the Decision Tree"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> System-enforced Decision Tree active
          </span>
        </div>

        {loading && (
          <div className="min-h-[40vh] flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && wf && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

            {/* LEFT — stage pointers */}
            <div className="lg:col-span-4 bg-card border border-border rounded-xl p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/80">Decision Tree stage pointers</h3>
                {wf.currentOwnerTeam && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                    {TEAM_LABEL[wf.currentOwnerTeam] || wf.currentOwnerTeam}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {wf.services.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No services on this client yet.</p>
                )}
                {wf.services.map((s, i) => {
                  const isActive = i === activeIdx;
                  const done = s.status === 'done';
                  return (
                    <div
                      key={s._id || i}
                      className={`p-3 rounded-lg border text-xs transition ${
                        isActive
                          ? 'bg-primary/10 border-primary/40 text-foreground font-semibold'
                          : done
                            ? 'bg-background border-border text-foreground/70'
                            : 'bg-background/40 border-border/60 text-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{i + 1}. {s.label}</span>
                        {done
                          ? <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          : isActive
                            ? <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                            : <Lock className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
                      </div>
                      {isActive && s.checklist.length > 0 && (
                        <div className="mt-2 pl-3 border-l-2 border-primary space-y-1 text-[11px] text-foreground/80 font-normal">
                          {s.checklist.map((c, ci) => (
                            <div key={ci} className={c.done ? 'line-through opacity-60' : ci === s.checklist.findIndex(x => !x.done) ? 'text-primary font-bold' : ''}>
                              • {c.text || c.title || `Step ${ci + 1}`}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT — task execution + audit feed */}
            <div className="lg:col-span-8 flex flex-col space-y-4">

              {/* Task execution card */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-border mb-4 gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isBlocked ? 'bg-amber-400' : 'bg-primary animate-pulse'}`} />
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider truncate">
                      {active ? `Current stage: ${active.label}` : 'All stages complete 🎉'}
                    </h3>
                  </div>
                  {active && (
                    <span className="text-xs font-mono text-muted-foreground bg-background px-2.5 py-1 rounded border border-border shrink-0">
                      TASK #{active.serviceType.toUpperCase().replace(/_/g, '-')}-{String(activeIdx + 1).padStart(2, '0')}
                    </span>
                  )}
                </div>

                {isBlocked && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-400 flex items-center justify-between gap-3 flex-wrap">
                    <span>⏳ Awaiting client{wf.blockerReason ? ` — ${wf.blockerReason}` : ''}</span>
                    <button onClick={unblock} disabled={acting} className="inline-flex items-center gap-1 font-semibold hover:underline">
                      <Unlock className="h-3 w-3" /> Clear blocker
                    </button>
                  </div>
                )}

                {active ? (
                  <>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                      {doneSteps} of {totalSteps} SOP steps verified for <span className="text-foreground font-semibold">{wf.clientName || 'this client'}</span>.
                      Every tick below is logged to the CRM audit trail automatically — complete all steps to advance the stage pointer.
                    </p>

                    {/* Interactive SOP checklist */}
                    <div className="bg-background p-4 rounded-xl border border-border mb-4 space-y-1.5 max-h-64 overflow-y-auto">
                      {active.checklist.length === 0 && (
                        <p className="text-xs text-muted-foreground">This stage has no checklist — mark it complete when done.</p>
                      )}
                      {active.checklist.map((c, ci) => (
                        <button
                          key={ci}
                          onClick={() => toggleStep(ci, c)}
                          disabled={acting}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition border ${
                            c.done
                              ? 'bg-emerald-500/5 border-emerald-500/20 text-muted-foreground line-through'
                              : 'bg-card border-border text-foreground hover:border-primary/50'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${c.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-input'}`}>
                            {c.done && <Check className="h-3 w-3" />}
                          </span>
                          {c.text || c.title || `Step ${ci + 1}`}
                        </button>
                      ))}
                    </div>

                    {/* Quick note + WhatsApp helper */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <div className="flex-1 min-w-[220px] flex items-center gap-2">
                        <input
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addNote(); }}
                          placeholder="Add a note to the CRM log…"
                          className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
                        />
                        <button
                          onClick={addNote}
                          disabled={acting || !noteText.trim()}
                          className="bg-card hover:bg-muted text-foreground px-3 py-2 rounded-lg text-xs font-semibold border border-border disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          <MessageSquarePlus className="h-3.5 w-3.5" /> Note
                        </button>
                      </div>
                      <button
                        onClick={copyWhatsApp}
                        className="bg-card hover:bg-muted text-foreground px-3 py-2 rounded-lg text-xs font-semibold transition border border-border flex items-center gap-2"
                      >
                        <ClipboardCopy className="h-3.5 w-3.5 text-emerald-400" /> Copy client WhatsApp update
                      </button>
                    </div>

                    {/* Blocker mini-form */}
                    {showBlock && (
                      <div className="mt-4 bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 flex items-center gap-2 flex-wrap">
                        <input
                          autoFocus
                          value={blockReason}
                          onChange={e => setBlockReason(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitBlock(); if (e.key === 'Escape') setShowBlock(false); }}
                          placeholder="What are we waiting on the client for?"
                          className="flex-1 min-w-[220px] bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-amber-500"
                        />
                        <button onClick={submitBlock} className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-lg text-xs font-semibold">
                          Mark awaiting client
                        </button>
                        <button onClick={() => setShowBlock(false)} className="text-muted-foreground hover:text-foreground p-1.5">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="mt-6 pt-4 border-t border-border flex justify-end gap-3 flex-wrap">
                      {!isBlocked && (
                        <button
                          onClick={() => setShowBlock(true)}
                          disabled={acting}
                          className="bg-card hover:bg-muted text-foreground/80 px-4 py-2 rounded-lg text-xs font-semibold transition border border-border inline-flex items-center gap-1.5"
                        >
                          <Ban className="h-3.5 w-3.5 text-amber-400" /> Blocked / pending client
                        </button>
                      )}
                      <button
                        onClick={completeStage}
                        disabled={acting}
                        className="bg-primary hover:bg-primary/85 text-primary-foreground px-5 py-2 rounded-lg text-xs font-semibold transition shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-60"
                      >
                        {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Complete stage & auto-log to CRM
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Every stage for {wf.clientName || 'this client'} is complete. Pick another client from the selector above.
                  </p>
                )}
              </div>

              {/* Live CRM audit feed */}
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-emerald-400" /> Live CRM feed & audit trail
                  </h4>
                  <button
                    onClick={() => wf && load(wf._id)}
                    className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <RefreshCcw className="h-3 w-3" /> Refresh
                  </button>
                </div>
                <div className="bg-background rounded-lg p-3 font-mono text-[11px] text-foreground/80 overflow-y-auto space-y-2 max-h-72 border border-border/80">
                  {feed.length === 0 && <div className="text-muted-foreground">No activity logged yet.</div>}
                  {feed.map((a, i) => (
                    <div key={i} className={i === 0 ? 'text-emerald-400' : a.action === 'note' ? 'text-blue-400' : ''}>
                      [{format(new Date(a.at), 'dd MMM, hh:mm a')}] {(a.actorName || 'System').toUpperCase()} · {a.action.replace(/_/g, ' ')}
                      {a.detail ? ` — ${a.detail}` : ''}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
