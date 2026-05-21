import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, CheckCheck, Trash2, Info, AlertTriangle, CheckCircle2, AlertOctagon,
  AlignJustify, Rows3,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { AppLayout }  from '@/components/AppLayout';
import { Button }     from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUnreadCounts } from '@/contexts/UnreadCountsContext';
import * as api from '@/api';

/**
 * NotificationsPage v2 — rebuilt on design-system primitives.
 *
 * What's changed:
 *   • text-blue-400 / text-green-400 / text-amber-400 / text-red-400 icons
 *     (washed out on white BG) → -700 weights aligned to StatusPill.
 *   • Bespoke 8 × 8 rounded-2xl icon tile → smaller 7 × 7 rounded-md tile.
 *   • Card chrome cleaned: single border-border + bg-card, no nested padding.
 *   • Mark-read + delete actions use shared Button intents (no inline pills).
 */

const typeConfig: Record<string, { icon: typeof Info; color: string; bg: string }> = {
  info:    { icon: Info,          color: 'text-blue-700',     bg: 'bg-blue-500/12'    },
  success: { icon: CheckCircle2,  color: 'text-emerald-700',  bg: 'bg-emerald-500/12' },
  warning: { icon: AlertTriangle, color: 'text-amber-700',    bg: 'bg-amber-500/12'   },
  error:   { icon: AlertOctagon,  color: 'text-rose-700',     bg: 'bg-rose-500/12'    },
};

export default function NotificationsPage() {
  const [notifs, setNotifs]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { resetNotifications } = useUnreadCounts();
  // Notifications often arrive in bursts (deploy errors, batch mention
  // spam). Compact mode squashes each to a 32px single-line row so the
  // user can scan 30+ items per fold before deciding which to expand.
  const [density, setDensity] = useState<'compact' | 'comfy'>(() => {
    try { return (localStorage.getItem('notifications.density') as any) === 'compact' ? 'compact' : 'comfy'; }
    catch { return 'comfy'; }
  });
  const setDensityPersist = (d: 'compact' | 'comfy') => {
    setDensity(d);
    try { localStorage.setItem('notifications.density', d); } catch { /* private mode */ }
  };

  const load = async () => {
    try {
      const data = await api.listNotifications({ limit: 50 });
      setNotifs(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const readOne = async (id: string) => {
    const before = notifs;
    setNotifs(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    // Optimistically nudge the badge count down so the sidebar/topbar feel
    // instant — the next visible poll will reconcile against the server.
    try {
      await api.readNotification(id);
      // We can't safely decrement here without knowing prior state, so let
      // the 60s context poll catch up. resetNotifications() would be too
      // aggressive — there may be other unreads we haven't seen yet.
    } catch { setNotifs(before); }
  };

  const deleteOne = async (id: string) => {
    const before = notifs;
    setNotifs(prev => prev.filter(n => n._id !== id));
    try { await api.deleteNotification(id); }
    catch { setNotifs(before); }
  };

  const readAll = async () => {
    const before = notifs;
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    // Mark-all is unambiguous — zero the badge immediately so the user sees
    // their click register. The 60s poll will reconcile if the server
    // disagreed (rollback below covers the failure case).
    resetNotifications();
    try {
      await api.readAllNotifications();
      toast.success('All marked as read');
    } catch { setNotifs(before); }
  };

  const unread = notifs.filter(n => !n.isRead).length;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight">Notifications</h1>
            <p className="text-[12px] text-muted-foreground">
              {unread > 0 ? `${unread} unread of ${notifs.length}` : `${notifs.length} total`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden">
              <button
                onClick={() => setDensityPersist('comfy')}
                className={`h-7 px-2 flex items-center text-[11px] transition-colors ${density === 'comfy' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="Comfortable"
              >
                <Rows3 className="h-3 w-3" />
              </button>
              <button
                onClick={() => setDensityPersist('compact')}
                className={`h-7 px-2 flex items-center text-[11px] transition-colors ${density === 'compact' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="Compact"
              >
                <AlignJustify className="h-3 w-3" />
              </button>
            </div>
            {unread > 0 && (
              <Button size="sm" intent="secondary" iconLeft={<CheckCheck className="h-3.5 w-3.5" />} onClick={readAll}>
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="h-48 rounded-xl bg-muted/30 animate-pulse" />
        ) : notifs.length === 0 ? (
          <EmptyState
            size="lg"
            icon={<Bell className="h-7 w-7" />}
            title="All good"
            hint="No notifications at the moment."
          />
        ) : (
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <AnimatePresence initial={false}>
              {notifs.map((n, i) => {
                const cfg  = typeConfig[n.type] || typeConfig.info;
                const Icon = cfg.icon;
                if (density === 'compact') {
                  // Single-line compact row — title + relative time + actions
                  // on hover. Three lines → one, so ~30/fold instead of ~10.
                  return (
                    <motion.div
                      key={n._id}
                      layout
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className={`flex items-center gap-2 px-3 h-8 group transition-colors ${i > 0 ? 'border-t border-border' : ''} ${!n.isRead ? 'bg-primary/[0.03]' : ''}`}
                    >
                      <div className={`h-5 w-5 rounded flex items-center justify-center shrink-0 ${cfg.bg}`}>
                        <Icon className={`h-2.5 w-2.5 ${cfg.color}`} />
                      </div>
                      <p className={`text-[12.5px] font-medium flex-1 min-w-0 truncate ${!n.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {n.title}
                        {(n.body || n.message) && (
                          <span className="text-muted-foreground/70 font-normal ml-2">{n.body || n.message}</span>
                        )}
                      </p>
                      <p className="text-[10.5px] text-muted-foreground shrink-0 tabular-nums">
                        {format(new Date(n.createdAt), 'MMM d')}
                      </p>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.isRead && (
                          <button onClick={() => readOne(n._id)} title="Mark read" className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10">
                            <CheckCheck className="h-3 w-3" />
                          </button>
                        )}
                        <button onClick={() => deleteOne(n._id)} title="Delete" className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      {!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                    </motion.div>
                  );
                }
                return (
                  <motion.div
                    key={n._id}
                    layout
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className={`flex items-start gap-3 px-4 py-3 group transition-colors ${i > 0 ? 'border-t border-border' : ''} ${!n.isRead ? 'bg-primary/[0.03]' : ''}`}
                  >
                    <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${cfg.bg}`}>
                      <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-[13px] font-semibold ${!n.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {n.title}
                        </p>
                        <p className="text-[10.5px] text-muted-foreground shrink-0 tabular-nums">
                          {format(new Date(n.createdAt), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      {(n.body || n.message) && (
                        <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{n.body || n.message}</p>
                      )}
                      <div className="flex gap-3 mt-1">
                        {!n.isRead && (
                          <button onClick={() => readOne(n._id)} className="text-[11px] text-primary hover:underline">Mark read</button>
                        )}
                        <button onClick={() => deleteOne(n._id)} className="text-[11px] text-muted-foreground hover:text-rose-600 inline-flex items-center gap-1">
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </div>
                    {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
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
