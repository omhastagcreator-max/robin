import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Archive, Download, Filter, Search, Sparkles, X, ChevronRight,
  ArrowDownToLine, ArrowUpFromLine, Globe2, ListChecks,
} from 'lucide-react';

import { AppLayout } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * TaskLedgerPage — permanent searchable history of EVERY assigned task.
 *
 * Owner ask (June 2026): "make sure these assigned tasks are kept in
 * a separate records to look back anytime". The live inbox hides done
 * tasks; the ledger keeps everything visible so the team can audit
 * what was promised, what landed, who took how long.
 *
 * Layout:
 *   Sticky filter row — direction, status, brand, sender, assignee,
 *                       since/until, free-text title search.
 *   Counts strip      — total + by-status (pending / ongoing / done / etc.).
 *   Table-style list  — one row per task with status badge, sender,
 *                       owner, due, ETA, completed.
 *   CSV export        — downloads the current filter result.
 */

type Direction = 'sent' | 'received' | 'both' | 'all';

interface LedgerRow {
  _id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  completedAt: string | null;
  estimatedCompletionAt: string | null;
  estimatedHours: number | null;
  assignedTo: string;
  assignedToName: string;
  assignedToAvatar?: string;
  assignedBy: string;
  assignedByName: string;
  clientWorkflowId: string;
  clientName: string;
}

interface LedgerResponse {
  rows: LedgerRow[];
  counts: {
    total: number;
    byStatus: Record<string, number>;
  };
  filter: any;
}

const STATUS_TONE: Record<string, string> = {
  pending_acceptance: 'bg-violet-500/12  text-violet-700  border-violet-500/30',
  pending:            'bg-muted          text-muted-foreground border-border',
  ongoing:            'bg-blue-500/12    text-blue-700    border-blue-500/25',
  blocked:            'bg-orange-500/12  text-orange-700  border-orange-500/30',
  done:               'bg-emerald-500/12 text-emerald-700 border-emerald-500/25',
};
const STATUS_LABEL: Record<string, string> = {
  pending_acceptance: 'Awaiting accept',
  pending:            'Pending',
  ongoing:            'In progress',
  blocked:            'Blocked',
  done:               'Done',
};
const PR_CLS: Record<string, string> = {
  urgent: 'bg-rose-500/12 text-rose-700',
  high:   'bg-amber-500/15 text-amber-700',
  medium: 'bg-blue-500/12 text-blue-700',
  low:    'bg-muted text-muted-foreground',
};

export default function TaskLedgerPage() {
  const { user, role } = useAuth();
  const [direction, setDirection] = useState<Direction>('both');
  const [status, setStatus]       = useState('');
  const [q, setQ]                 = useState('');
  const [since, setSince]         = useState('');
  const [until, setUntil]         = useState('');
  const [data, setData]           = useState<LedgerResponse | null>(null);
  const [loading, setLoading]     = useState(true);

  const isOrgWideAvailable = role === 'admin' || role === 'sales';

  const load = () => {
    setLoading(true);
    const params: Record<string, any> = { direction, limit: 200 };
    if (status) params.status = status;
    if (q.trim()) params.q = q.trim();
    if (since)  params.since = since;
    if (until)  params.until = until;
    api.taskLedger(params)
      .then((d: LedgerResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [direction, status, since, until]);
  // Debounced free-text search.
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const exportCsv = () => {
    if (!data) return;
    const header = ['Title', 'Brand', 'Sender', 'Assignee', 'Status', 'Priority', 'Due', 'ETA', 'Completed', 'Created'];
    const rows = data.rows.map(r => [
      r.title.replace(/"/g, '""'),
      r.clientName,
      r.assignedByName,
      r.assignedToName,
      STATUS_LABEL[r.status] || r.status,
      r.priority,
      r.dueDate ? format(parseISO(r.dueDate), 'yyyy-MM-dd') : '',
      r.estimatedCompletionAt ? format(parseISO(r.estimatedCompletionAt), 'yyyy-MM-dd') : '',
      r.completedAt ? format(parseISO(r.completedAt), 'yyyy-MM-dd') : '',
      r.createdAt ? format(parseISO(r.createdAt), 'yyyy-MM-dd') : '',
    ]);
    const csv = [header, ...rows].map(line => line.map(c => `"${String(c)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `robin-task-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-5 lg:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-muted-foreground">Records</p>
            <h1 className="text-[24px] sm:text-[26px] font-black tracking-tight leading-tight inline-flex items-center gap-2">
              <Archive className="h-5 w-5 text-primary" />
              Task Ledger
            </h1>
            <p className="text-[12px] text-muted-foreground">Permanent record of every task ever assigned. Filter, search, export.</p>
          </div>
          <button
            onClick={exportCsv}
            disabled={!data || data.rows.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card hover:bg-muted/40 text-[12px] font-semibold disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>

        {/* Sticky filter row */}
        <div className="sticky top-2 z-30 rounded-xl border border-border bg-card/90 backdrop-blur p-3 space-y-2 shadow-sm">
          {/* Direction segmented */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center rounded-lg border border-border bg-background overflow-hidden">
              <DirBtn active={direction === 'both'}     onClick={() => setDirection('both')}     icon={<ListChecks className="h-3 w-3" />} label="Both" />
              <DirBtn active={direction === 'sent'}     onClick={() => setDirection('sent')}     icon={<ArrowUpFromLine className="h-3 w-3" />} label="Sent by me" />
              <DirBtn active={direction === 'received'} onClick={() => setDirection('received')} icon={<ArrowDownToLine className="h-3 w-3" />} label="Received" />
              {isOrgWideAvailable && (
                <DirBtn active={direction === 'all'} onClick={() => setDirection('all')} icon={<Globe2 className="h-3 w-3" />} label="Whole agency" />
              )}
            </div>

            {/* Status filter */}
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="h-8 px-2.5 rounded-md border border-input bg-background text-[12px] focus:ring-2 focus:ring-ring focus:outline-none"
            >
              <option value="">All statuses</option>
              <option value="pending_acceptance">Awaiting accept</option>
              <option value="pending">Pending</option>
              <option value="ongoing">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>

            {/* Date range */}
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>From</span>
              <input type="date" value={since} onChange={e => setSince(e.target.value)}
                     className="h-8 px-2 rounded-md border border-input bg-background text-[12px] focus:ring-2 focus:ring-ring focus:outline-none" />
              <span>to</span>
              <input type="date" value={until} onChange={e => setUntil(e.target.value)}
                     className="h-8 px-2 rounded-md border border-input bg-background text-[12px] focus:ring-2 focus:ring-ring focus:outline-none" />
            </div>

            {(since || until || status) && (
              <button
                onClick={() => { setSince(''); setUntil(''); setStatus(''); }}
                className="text-[10.5px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Filter by task title…"
              className="w-full pl-10 pr-9 h-9 bg-background border border-input rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {q && (
              <button onClick={() => setQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Counts strip */}
        {data && (
          <CountsStrip total={data.counts.total} byStatus={data.counts.byStatus} />
        )}

        {/* Table */}
        <LedgerTable rows={data?.rows || []} loading={loading} meUserId={user?.id || ''} />
      </div>
    </AppLayout>
  );
}

function DirBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold border-r border-border last:border-r-0 transition-colors ${
        active ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
      }`}
    >
      {icon} {label}
    </button>
  );
}

function CountsStrip({ total, byStatus }: { total: number; byStatus: Record<string, number> }) {
  const order = ['pending_acceptance', 'pending', 'ongoing', 'blocked', 'done'];
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-card border border-border font-semibold">
        Total <span className="tabular-nums text-foreground">{total}</span>
      </span>
      {order.map(s => {
        const n = byStatus[s] || 0;
        if (n === 0) return null;
        return (
          <span key={s} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border ${STATUS_TONE[s] || STATUS_TONE.pending}`}>
            <span className="font-semibold">{STATUS_LABEL[s] || s}</span>
            <span className="tabular-nums">{n}</span>
          </span>
        );
      })}
    </div>
  );
}

function LedgerTable({ rows, loading, meUserId }: { rows: LedgerRow[]; loading: boolean; meUserId: string }) {
  if (loading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center text-[12.5px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
        <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Loading history…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-[13px] font-semibold mb-1">No tasks match these filters.</p>
        <p className="text-[11.5px] text-muted-foreground">Try widening the date range or clearing the status filter.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-2 px-4 py-2.5 border-b border-border text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground bg-muted/30">
        <div>Task / Brand</div>
        <div>Sender</div>
        <div>Assignee</div>
        <div>Status</div>
        <div>Due</div>
        <div>ETA</div>
        <div>Completed</div>
      </div>
      <ul className="divide-y divide-border/60 max-h-[640px] overflow-y-auto">
        {rows.map(r => <LedgerRow key={r._id} row={r} meUserId={meUserId} />)}
      </ul>
    </div>
  );
}

function LedgerRow({ row, meUserId }: { row: LedgerRow; meUserId: string }) {
  const senderIsMe   = row.assignedBy === meUserId;
  const assigneeIsMe = row.assignedTo === meUserId;
  const tone = STATUS_TONE[row.status] || STATUS_TONE.pending;
  const link = row.clientWorkflowId ? `/clients/pipeline/${row.clientWorkflowId}` : '/tasks';
  return (
    <li className="px-4 py-2.5 hover:bg-muted/30 md:grid md:grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_0.8fr] md:gap-2 md:items-center">
      <Link to={link} className="block min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[12.5px] font-semibold truncate">{row.title}</p>
          <span className={`text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${PR_CLS[row.priority] || PR_CLS.medium} shrink-0`}>
            {row.priority}
          </span>
        </div>
        <p className="text-[10.5px] text-muted-foreground truncate">
          {row.clientName ? <span>{row.clientName}</span> : <span className="italic">no brand</span>}
          {' · '}
          <span>created {row.createdAt ? format(parseISO(row.createdAt), 'MMM d') : '—'}</span>
        </p>
      </Link>
      <div className="text-[11.5px] truncate">
        {row.assignedByName || '—'}
        {senderIsMe && <span className="text-muted-foreground/70 ml-1">(you)</span>}
      </div>
      <div className="text-[11.5px] truncate">
        {row.assignedToName || '—'}
        {assigneeIsMe && <span className="text-muted-foreground/70 ml-1">(you)</span>}
      </div>
      <div>
        <span className={`text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${tone}`}>
          {STATUS_LABEL[row.status] || row.status}
        </span>
      </div>
      <div className="text-[11px] tabular-nums text-muted-foreground">
        {row.dueDate ? format(parseISO(row.dueDate), 'MMM d') : '—'}
      </div>
      <div className="text-[11px] tabular-nums text-muted-foreground">
        {row.estimatedCompletionAt ? format(parseISO(row.estimatedCompletionAt), 'MMM d') : '—'}
      </div>
      <div className="text-[11px] tabular-nums text-emerald-700">
        {row.completedAt ? format(parseISO(row.completedAt), 'MMM d') : <span className="text-muted-foreground">—</span>}
      </div>
    </li>
  );
}

// Silence the unused-import lint — kept for future filter chips.
void Filter; void ChevronRight;
