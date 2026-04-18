import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Bell, CheckCheck, Trash2, Info, AlertTriangle, CheckCircle2, AlertOctagon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import * as api from '@/api';
import { EmptyState } from '@/components/shared/EmptyState';
import { toast } from 'sonner';

const typeConfig: Record<string, { icon: typeof Info; color: string }> = {
  info:    { icon: Info,          color: 'text-blue-400'   },
  success: { icon: CheckCircle2,  color: 'text-green-400'  },
  warning: { icon: AlertTriangle, color: 'text-amber-400'  },
  error:   { icon: AlertOctagon,  color: 'text-red-400'    },
};

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await api.listNotifications({ limit: 50 });
      setNotifs(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const readOne = async (id: string) => {
    await api.readNotification(id);
    setNotifs(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
  };

  const deleteOne = async (id: string) => {
    await api.deleteNotification(id);
    setNotifs(prev => prev.filter(n => n._id !== id));
  };

  const readAll = async () => {
    await api.readAllNotifications();
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    toast.success('All marked as read');
  };

  const unread = notifs.filter(n => !n.isRead).length;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5 page-transition-enter">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Notifications</h1>
            {unread > 0 && (
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">{unread}</span>
            )}
          </div>
          {unread > 0 && (
            <button onClick={readAll}
              className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors">
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
          )}
        </div>

        {loading ? (
          <div className="bg-card border border-border rounded-2xl h-64 animate-pulse" />
        ) : notifs.length === 0 ? (
          <EmptyState icon={Bell} title="All good!" description="No notifications at the moment." />
        ) : (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border/50 overflow-hidden">
            <AnimatePresence initial={false}>
              {notifs.map(n => {
                const cfg = typeConfig[n.type] || typeConfig.info;
                const Icon = cfg.icon;
                return (
                  <motion.div key={n._id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className={`flex gap-3 p-4 transition-colors ${!n.isRead ? 'bg-primary/5' : ''}`}>
                    <div className={`h-8 w-8 rounded-2xl flex items-center justify-center shrink-0 ${!n.isRead ? 'bg-primary/15' : 'bg-muted'}`}>
                      <Icon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium ${!n.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>{n.title}</p>
                        <p className="text-[10px] text-muted-foreground shrink-0">{format(new Date(n.createdAt), 'MMM d, h:mm a')}</p>
                      </div>
                      {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                      <div className="flex gap-3 mt-1.5">
                        {!n.isRead && (
                          <button onClick={() => readOne(n._id)} className="text-[11px] text-primary hover:text-primary/80">Mark read</button>
                        )}
                        <button onClick={() => deleteOne(n._id)} className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1">
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
