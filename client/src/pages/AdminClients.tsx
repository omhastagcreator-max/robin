import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Building2, Briefcase, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import * as api from '@/api';
import { EmptyState } from '@/components/shared/EmptyState';

export default function AdminClients() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminClients().then(d => { setClients(Array.isArray(d) ? d : []); }).finally(() => setLoading(false));
  }, []);

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-5xl mx-auto space-y-5 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} client accounts</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : clients.length === 0 ? (
          <EmptyState icon={Building2} title="No clients yet" description="Add clients via the 'Add Member' flow in Employees." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((c, i) => (
              <motion.div key={c._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="bg-card border border-border rounded-2xl p-5 space-y-3 hover:border-primary/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center text-lg font-bold text-primary">
                    {(c.name || c.email)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{c.name || 'Unnamed'}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Briefcase className="h-3 w-3" />
                  <span>{c.projectCount || 0} active project{c.projectCount !== 1 ? 's' : ''}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
