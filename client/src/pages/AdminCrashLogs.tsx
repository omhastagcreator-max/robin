import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Bug, Loader2, RefreshCcw, Search, ChevronDown, ChevronRight,
  Globe, Server, User, Clock, Copy, ExternalLink,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { AppLayout }  from '@/components/AppLayout';
import { Button }     from '@/components/ui/Button';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import * as api from '@/api';

/**
 * AdminCrashLogs
 *
 * Admin-only page that surfaces the centralized ErrorLog collection so the
 * agency owner can see at a glance:
 *   - what's crashing (server-side or in the browser)
 *   - which user / which page
 *   - the stack trace
 *   - when it last happened
 *
 * No mutation actions — read-only triage. The reporting pipeline (errorReporter
 * on the client + errorHandler middleware on the server) writes to ErrorLog
 * automatically; this page just displays them.
 */

interface LogEntry {
  _id: string;
  source: 'client' | 'server';
  level?: string;
  message: string;
  stack?: string;
  url?: string;
  userId?: string;
  userEmail?: string;
  userAgent?: string;
  meta?: any;
  createdAt: string;
}

const SOURCE_TONE: Record<string, string> = {
  client: 'bg-amber-500/12 text-amber-700 border-amber-500/25',
  server: 'bg-rose-500/12  text-rose-700  border-rose-500/25',
};

export default function AdminCrashLogs() {
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<'all' | 'server' | 'client'>('all');
  const [query, setQuery]     = useState('');
  const [open, setOpen]       = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.listErrorLogs({
        source: filter === 'all' ? undefined : filter,
        limit: 200,
      });
      setLogs(Array.isArray(res) ? res : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not load logs');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  // ── Filter / search ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(l =>
      l.message?.toLowerCase().includes(q) ||
      l.url?.toLowerCase().includes(q) ||
      l.userEmail?.toLowerCase().includes(q) ||
      l.stack?.toLowerCase().includes(q),
    );
  }, [logs, query]);

  // ── Group identical errors so the noisy ones collapse together ───────
  const grouped = useMemo(() => {
    const m = new Map<string, { sample: LogEntry; count: number; last: string; first: string; users: Set<string> }>();
    for (const l of filtered) {
      const k = `${l.source}|${(l.message || '').slice(0, 200)}`;
      const existing = m.get(k);
      if (existing) {
        existing.count++;
        if (l.createdAt > existing.last) existing.last = l.createdAt;
        if (l.createdAt < existing.first) existing.first = l.createdAt;
        if (l.userEmail) existing.users.add(l.userEmail);
      } else {
        m.set(k, {
          sample: l, count: 1, last: l.createdAt, first: l.createdAt,
          users: new Set(l.userEmail ? [l.userEmail] : []),
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.last.localeCompare(a.last));
  }, [filtered]);

  const counts = useMemo(() => ({
    server: logs.filter(l => l.source === 'server').length,
    client: logs.filter(l => l.source === 'client').length,
    total:  logs.length,
  }), [logs]);

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight inline-flex items-center gap-2">
              <Bug className="h-5 w-5 text-rose-600" /> Crash &amp; error logs
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Most recent {logs.length} errors. Identical messages are grouped so noisy ones don't drown out the rest.
            </p>
          </div>
          <Button size="sm" intent="primary" loading={loading} onClick={load} iconLeft={<RefreshCcw className="h-3.5 w-3.5" />}>
            Reload
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          <KpiBlock icon={<AlertTriangle className="h-4 w-4" />} label="All"    value={counts.total}  tone="muted"   />
          <KpiBlock icon={<Server className="h-4 w-4" />}        label="Server" value={counts.server} tone="danger"  />
          <KpiBlock icon={<Globe className="h-4 w-4" />}         label="Client" value={counts.client} tone="warning" />
        </div>

        {/* Filter pills + search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-1">
            {(['all', 'server', 'client'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {f === 'all' ? 'All sources' : f === 'server' ? 'Server' : 'Browser'}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search by message, URL, email, stack…"
              className="w-full pl-8 pr-3 py-1.5 bg-background border border-input rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        {/* Body */}
        {error && (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3 text-[12px] text-rose-700">
            {error}
          </div>
        )}

        {loading && logs.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading logs…
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState
            size="lg"
            icon={<Bug className="h-6 w-6" />}
            title="No errors recorded"
            hint="Either everything's clean, or the reporter isn't catching what you're seeing. Check Render server logs or DevTools console for anything missing."
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {grouped.map(({ sample, count, last, first, users }) => {
              const isOpen = !!open[sample._id];
              return (
                <div key={sample._id} className="hover:bg-muted/10 transition-colors">
                  <button
                    onClick={() => setOpen(o => ({ ...o, [sample._id]: !o[sample._id] }))}
                    className="w-full px-4 py-3 flex items-start gap-3 text-left"
                  >
                    <div className={`mt-0.5 h-7 w-7 rounded-md border flex items-center justify-center shrink-0 ${SOURCE_TONE[sample.source]}`}>
                      {sample.source === 'server' ? <Server className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold break-words">
                        {sample.message?.slice(0, 200) || '(no message)'}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDistanceToNow(new Date(last), { addSuffix: true })}</span>
                        {count > 1 && <span className="font-semibold text-foreground">×{count}</span>}
                        {users.size > 0 && (
                          <span className="flex items-center gap-1 truncate">
                            <User className="h-3 w-3 shrink-0" />
                            {users.size === 1 ? Array.from(users)[0] : `${users.size} users`}
                          </span>
                        )}
                        {sample.url && (
                          <span className="truncate">on <code className="text-foreground">{sample.url.replace(/^https?:\/\/[^/]+/, '')}</code></span>
                        )}
                      </div>
                    </div>
                    {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />}
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-muted/10"
                      >
                        <div className="px-4 pb-4 space-y-3">
                          <Meta label="First seen" value={format(new Date(first), 'd MMM, h:mm a')} />
                          <Meta label="Last seen"  value={format(new Date(last),  'd MMM, h:mm a')} />
                          {users.size > 0 && (
                            <Meta label="Affected users" value={Array.from(users).join(', ')} />
                          )}
                          {sample.url && (
                            <Meta label="URL" value={sample.url} mono linkify />
                          )}
                          {sample.userAgent && (
                            <Meta label="Browser" value={sample.userAgent} mono />
                          )}
                          {sample.stack && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Stack trace</p>
                                <button
                                  onClick={() => { navigator.clipboard?.writeText(sample.stack || ''); toast.success('Stack copied'); }}
                                  className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                >
                                  <Copy className="h-3 w-3" /> Copy
                                </button>
                              </div>
                              <pre className="text-[10px] bg-background border border-border rounded-md p-2 overflow-x-auto whitespace-pre font-mono text-foreground/80 max-h-64">
{sample.stack}
                              </pre>
                            </div>
                          )}
                          {sample.meta && Object.keys(sample.meta).length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Extra context</p>
                              <pre className="text-[10px] bg-background border border-border rounded-md p-2 overflow-x-auto font-mono text-foreground/80">
{JSON.stringify(sample.meta, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}

        {/* Where to find more */}
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-3 text-[11px] text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">Looking for more detail?</p>
          <p>
            <strong>Server logs</strong> (Express stdout) live in your Render dashboard → Robin service → <em>Logs</em> tab. They show every request,
            cron-job tick and crash with full stack traces — including ones the catch-all error handler couldn't capture.
            <strong className="ml-2">Frontend logs</strong> are visible in your own browser DevTools console (Cmd-Option-J / Ctrl-Shift-J).
            Anything that throws there auto-posts to this page via the global window.onerror reporter.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}

function Meta({ label, value, mono, linkify }: { label: string; value: string; mono?: boolean; linkify?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      {linkify ? (
        <a href={value} target="_blank" rel="noreferrer" className={`text-xs text-primary hover:underline break-all flex items-center gap-1 ${mono ? 'font-mono' : ''}`}>
          {value} <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <p className={`text-xs break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
      )}
    </div>
  );
}

// Small KPI block with icon + tone (shared shape with AdminReports).
function KpiBlock({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'muted' | 'danger' | 'warning';
}) {
  const toneCls =
    tone === 'danger'  ? 'text-rose-700  bg-rose-500/12'  :
    tone === 'warning' ? 'text-amber-700 bg-amber-500/12' :
                         'text-muted-foreground bg-muted/40';
  return (
    <div className="border border-border rounded-xl bg-card p-3 flex items-center gap-3">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${toneCls}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">{label}</p>
        <p className="text-[18px] font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
// (unused Stat import retained for future use elsewhere)
void Stat;
