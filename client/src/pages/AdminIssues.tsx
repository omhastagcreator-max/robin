import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import * as api from '@/api';
import { Loader2, AlertTriangle, ChevronDown, ChevronRight, Check, Eye, RefreshCw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

/**
 * AdminIssues — clustered view of user-reported issues + a full list.
 *
 * Top: AI-generated clusters grouped by (area, severity) so admin sees
 *      "5 huddle bug reports today" at a glance.
 * Below: scrollable list, click any row to expand the full report
 *        (description + screenshot + context + AI suggestion).
 *
 * Status transitions: open → investigating → resolved | wont_fix.
 */

interface Cluster {
  _id:        { area: string; severity: string };
  count:      number;
  latest:     string;
  example:    string;
  suggestion: string;
}

interface IssueRow {
  _id:        string;
  userName:   string;
  userEmail:  string;
  userRole:   string;
  description: string;
  ai:         { category: string; severity: string; area: string; suspectedCause: string; suggestedFix: string; adminNote: string };
  context:    { url: string; userAgent: string; viewport: string; recentErrors: string[]; recentNetwork: string[] };
  status:     string;
  resolution?: string;
  createdAt:  string;
}

const STATUS_TABS = [
  { key: 'open',          label: 'Open' },
  { key: 'investigating', label: 'Investigating' },
  { key: 'resolved',      label: 'Resolved' },
  { key: 'wont_fix',      label: "Won't fix" },
] as const;

export default function AdminIssues() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [issues, setIssues]     = useState<IssueRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus]     = useState<typeof STATUS_TABS[number]['key']>('open');

  const load = async (bg = false) => {
    if (bg) setRefreshing(true); else setLoading(true);
    try {
      const [c, list] = await Promise.all([
        api.issueClusters().catch(() => []),
        api.listIssues({ status }).catch(() => []),
      ]);
      setClusters(Array.isArray(c) ? c : []);
      setIssues(Array.isArray(list) ? list : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const updateStatus = async (id: string, newStatus: string) => {
    const prev = issues;
    setIssues(rows => rows.map(r => r._id === id ? { ...r, status: newStatus } : r));
    try {
      await api.updateIssue(id, { status: newStatus });
      toast.success('Status updated');
      load(true);
    } catch {
      setIssues(prev);
      toast.error('Could not update');
    }
  };

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-primary" /> Issues
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              User reports + AI-suggested fixes. Click a row to see the full context.
            </p>
          </div>
          <button onClick={() => load(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-card border border-border text-xs font-semibold hover:bg-muted">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        {/* Clusters strip */}
        {clusters.length > 0 && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-xs uppercase tracking-[0.14em] font-semibold text-muted-foreground">What's hurting users right now</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
              {clusters.slice(0, 9).map((c, i) => (
                <div key={i} className="rounded-xl border border-border p-3 bg-background space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase tracking-wider font-bold ${severityClass(c._id.severity)}`}>
                      {c._id.severity || 'medium'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-xs font-bold capitalize">{c._id.area || 'general'}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{c.count}</span>
                  </div>
                  <p className="text-[12px] line-clamp-2 text-foreground">{c.example}</p>
                  {c.suggestion && (
                    <p className="text-[11px] text-muted-foreground italic line-clamp-2">→ {c.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status tabs */}
        <div className="flex gap-1 border-b border-border">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setStatus(t.key)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                status === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : issues.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <p className="text-sm font-semibold">No {STATUS_TABS.find(t => t.key === status)?.label.toLowerCase()} issues</p>
            <p className="text-xs text-muted-foreground mt-1">When teammates report bugs via the floating help bubble, they show up here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {issues.map(i => <IssueRowView key={i._id} issue={i} onUpdate={updateStatus} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function IssueRowView({ issue, onUpdate }: { issue: IssueRow; onUpdate: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [loadingShot, setLoadingShot] = useState(false);

  const fetchShot = async () => {
    if (shot !== null) return;
    setLoadingShot(true);
    try {
      const full = await api.getIssue(issue._id);
      setShot(full?.screenshotData || '');
    } catch { setShot(''); }
    finally { setLoadingShot(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button onClick={() => { setOpen(o => !o); if (!open) fetchShot(); }}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-muted/15">
        <span className="mt-0.5">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wider font-bold ${severityClass(issue.ai.severity)}`}>{issue.ai.severity || 'medium'}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[11px] capitalize font-semibold">{issue.ai.area || 'general'}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{format(new Date(issue.createdAt), 'MMM d, HH:mm')}</span>
          </div>
          <p className="text-sm font-medium line-clamp-2">{issue.description}</p>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold">{issue.userName || issue.userEmail}</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase">{issue.userRole}</span>
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/15 p-4 space-y-3 text-[12px]">
          {issue.ai.suggestedFix && (
            <Section label="AI suggested fix"><p>{issue.ai.suggestedFix}</p></Section>
          )}
          {issue.ai.adminNote && (
            <Section label="AI admin note"><p className="text-muted-foreground italic">{issue.ai.adminNote}</p></Section>
          )}
          {issue.ai.suspectedCause && (
            <Section label="Suspected cause"><p className="text-muted-foreground">{issue.ai.suspectedCause}</p></Section>
          )}

          <Section label="Where they hit it">
            <p className="font-mono text-[11px] break-all">{issue.context.url || '—'}</p>
            <p className="text-[11px] text-muted-foreground">{issue.context.userAgent || '—'} · {issue.context.viewport}</p>
          </Section>

          {issue.context.recentErrors?.length > 0 && (
            <Section label="Recent console errors">
              <ul className="font-mono text-[10px] space-y-0.5 text-muted-foreground">
                {issue.context.recentErrors.slice(0, 5).map((e, i) => <li key={i} className="break-all">{e}</li>)}
              </ul>
            </Section>
          )}
          {issue.context.recentNetwork?.length > 0 && (
            <Section label="Recent failed network calls">
              <ul className="font-mono text-[10px] space-y-0.5 text-muted-foreground">
                {issue.context.recentNetwork.slice(0, 5).map((n, i) => <li key={i} className="break-all">{n}</li>)}
              </ul>
            </Section>
          )}

          {loadingShot ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> loading screenshot</div>
          ) : shot ? (
            <Section label="Screenshot"><img src={shot} alt="screenshot" className="rounded-lg border border-border max-h-72" /></Section>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {issue.status === 'open' && (
              <button onClick={() => onUpdate(issue._id, 'investigating')}
                className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold border border-primary/20 inline-flex items-center gap-1.5">
                <Eye className="h-3 w-3" /> Mark investigating
              </button>
            )}
            {(issue.status === 'open' || issue.status === 'investigating') && (
              <>
                <button onClick={() => onUpdate(issue._id, 'resolved')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-700 text-[11px] font-semibold border border-emerald-500/20 inline-flex items-center gap-1.5">
                  <Check className="h-3 w-3" /> Mark resolved
                </button>
                <button onClick={() => onUpdate(issue._id, 'wont_fix')}
                  className="px-3 py-1.5 rounded-lg bg-card border border-border text-[11px] font-semibold inline-flex items-center gap-1.5">
                  Won't fix
                </button>
              </>
            )}
            {(issue.status === 'resolved' || issue.status === 'wont_fix') && (
              <button onClick={() => onUpdate(issue._id, 'open')}
                className="px-3 py-1.5 rounded-lg bg-card border border-border text-[11px] font-semibold inline-flex items-center gap-1.5">
                Reopen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</p>
      {children}
    </div>
  );
}

function severityClass(severity?: string): string {
  switch (severity) {
    case 'blocking': return 'text-rose-700';
    case 'high':     return 'text-amber-700';
    case 'medium':   return 'text-blue-700';
    case 'low':      return 'text-muted-foreground';
    default:         return 'text-muted-foreground';
  }
}
