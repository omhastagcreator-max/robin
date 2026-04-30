import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Eye, Copy, FileSearch, Loader2, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import * as api from '@/api';

interface AuditEntry {
  _id: string;
  action: 'vault.list' | 'vault.copy' | 'vault.reveal' | string;
  at: string;
  entityId: string | null;
  metadata?: any;
  user?: { userId: string; name?: string; email?: string; role?: string } | null;
}

const ACTION_META: Record<string, { label: string; icon: any; color: string }> = {
  'vault.copy':   { label: 'Copied password',  icon: Copy,       color: 'bg-amber-500/15 text-amber-600' },
  'vault.reveal': { label: 'Revealed password', icon: Eye,       color: 'bg-orange-500/15 text-orange-600' },
  'vault.list':   { label: 'Opened the vault',  icon: FileSearch, color: 'bg-primary/15 text-primary' },
};

/**
 * Admin-only panel that shows the recent client-vault access feed.
 * Used on the AdminDashboard so admins can audit who saw which credentials
 * and when, at a glance.
 */
export function VaultAuditPanel({ limit = 12 }: { limit?: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.listVaultAudit({ limit })
      .then((data: AuditEntry[]) => { if (!cancelled) setEntries(Array.isArray(data) ? data : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.response?.data?.error || 'Could not load audit log'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [limit]);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Vault Audit Log</h2>
        <span className="ml-auto text-[10px] text-muted-foreground">
          who saw which credentials, last
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : error ? (
        <p className="px-5 py-6 text-xs text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="px-5 py-6 text-xs text-muted-foreground text-center">
          No vault activity yet. Once teammates open or copy credentials, you'll see it here.
        </p>
      ) : (
        <div className="divide-y divide-border/40 max-h-[420px] overflow-y-auto">
          {entries.map(e => {
            const meta = ACTION_META[e.action] || { label: e.action, icon: FileSearch, color: 'bg-muted text-muted-foreground' };
            const Icon = meta.icon;
            const credTitle = e.metadata?.title;
            const credClient = e.metadata?.client;
            const userName  = e.user?.name || e.user?.email || 'Someone';
            return (
              <div key={e._id} className="px-5 py-3 flex items-start gap-3 hover:bg-muted/10">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs">
                    <span className="font-semibold">{userName}</span>{' '}
                    <span className="text-muted-foreground">{meta.label.toLowerCase()}</span>
                    {credTitle && (
                      <>
                        {' '}<span className="text-muted-foreground">·</span>{' '}
                        <span className="font-medium">{credTitle}</span>
                      </>
                    )}
                    {credClient && (
                      <>
                        {' '}<span className="text-muted-foreground">for {credClient}</span>
                      </>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                    {e.user?.role && <> · <span className="capitalize">{e.user.role}</span></>}
                    {e.action === 'vault.list' && e.metadata?.count != null && (
                      <> · viewed {e.metadata.count} credential{e.metadata.count === 1 ? '' : 's'}</>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Link
        to="/vault"
        className="flex items-center justify-center gap-1 py-3 text-xs text-primary hover:text-primary/80 border-t border-border"
      >
        Open the Client Vault <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export default VaultAuditPanel;
