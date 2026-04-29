import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarOff, Loader2, Check, X, Filter, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import * as api from '@/api';
import { toast } from 'sonner';

interface LeaveDay { date: string; reason: string; }

interface AdminLeave {
  _id: string;
  userId: string;
  user?: { _id: string; name?: string; email?: string; role?: string; team?: string };
  days: LeaveDay[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
}

const STATUS_META = {
  pending:   { label: 'Pending',   color: 'bg-amber-500/15 text-amber-600 border-amber-500/30',  icon: Clock },
  approved:  { label: 'Approved',  color: 'bg-green-500/15 text-green-600 border-green-500/30',  icon: CheckCircle2 },
  rejected:  { label: 'Rejected',  color: 'bg-red-500/15 text-red-600 border-red-500/30',         icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-muted text-muted-foreground border-border',         icon: X },
} as const;

type Status = keyof typeof STATUS_META;

export default function AdminLeaves() {
  const [list, setList] = useState<AdminLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [acting, setActing] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.adminListLeaves();
      setList(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return list;
    return list.filter(l => l.status === filter);
  }, [list, filter]);

  const counts = useMemo(() => ({
    all:       list.length,
    pending:   list.filter(l => l.status === 'pending').length,
    approved:  list.filter(l => l.status === 'approved').length,
    rejected:  list.filter(l => l.status === 'rejected').length,
    cancelled: list.filter(l => l.status === 'cancelled').length,
  }), [list]);

  const approve = async (id: string) => {
    setActing(id);
    try { await api.approveLeave(id); toast.success('Approved'); reload(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Approve failed'); }
    finally { setActing(null); }
  };

  const reject = async (id: string) => {
    setActing(id);
    try {
      await api.rejectLeave(id, rejectNote.trim() || undefined);
      toast.success('Rejected');
      setRejectFor(null); setRejectNote('');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Reject failed');
    } finally { setActing(null); }
  };

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarOff className="h-6 w-6 text-primary" /> Leave Approvals
          </h1>
          <p className="text-sm text-muted-foreground">
            Review pending leave applications and respond. Approving notifies the requester instantly.
          </p>
        </div>

        {/* Filter chips */}
        <div className="bg-card border border-border rounded-2xl p-2 flex items-center gap-1 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground ml-2 mr-1" />
          {(['all', 'pending', 'approved', 'rejected', 'cancelled'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f} <span className="opacity-60">· {(counts as any)[f]}</span>
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 bg-card border border-border rounded-2xl">
            No leave applications match this filter.
          </p>
        ) : (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border/40 overflow-hidden">
            <AnimatePresence initial={false}>
              {filtered.map(l => {
                const Meta = STATUS_META[l.status];
                const Icon = Meta.icon;
                const isRejecting = rejectFor === l._id;
                const busy = acting === l._id;

                return (
                  <motion.div
                    key={l._id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary font-bold shrink-0">
                        {(l.user?.name || l.user?.email || '?')[0].toUpperCase()}
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold truncate">{l.user?.name || 'Unknown'}</p>
                          {l.user?.role && <span className="text-[10px] uppercase font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{l.user.role}</span>}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${Meta.color}`}>
                            <Icon className="h-3 w-3" /> {Meta.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(l.createdAt), 'dd MMM yyyy, h:mm a')}
                          </span>
                        </div>

                        {/* Day chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {l.days.map((d, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 text-xs">
                              <span className="font-medium">{format(new Date(d.date), 'EEE, dd MMM')}</span>
                              <span className="text-muted-foreground">— {d.reason}</span>
                            </span>
                          ))}
                        </div>

                        {l.reviewNote && (
                          <p className="text-[11px] italic text-muted-foreground">Note: {l.reviewNote}</p>
                        )}

                        {/* Inline reject form */}
                        {isRejecting && (
                          <div className="flex flex-col sm:flex-row gap-2 pt-2">
                            <input
                              autoFocus
                              value={rejectNote}
                              onChange={e => setRejectNote(e.target.value)}
                              placeholder="Optional note for the requester…"
                              className="flex-1 px-3 py-2 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                              onKeyDown={(e) => { if (e.key === 'Enter') reject(l._id); }}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => reject(l._id)}
                                disabled={busy}
                                className="flex items-center gap-1 px-3 py-2 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 disabled:opacity-50"
                              >
                                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                Confirm reject
                              </button>
                              <button
                                onClick={() => { setRejectFor(null); setRejectNote(''); }}
                                className="px-3 py-2 border border-border rounded-lg text-xs hover:bg-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {l.status === 'pending' && !isRejecting && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => approve(l._id)}
                            disabled={busy}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-500/15 text-green-600 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-500/25 disabled:opacity-50"
                            title="Approve"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Approve
                          </button>
                          <button
                            onClick={() => { setRejectFor(l._id); setRejectNote(''); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-500/15 text-red-600 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/25"
                            title="Reject"
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
