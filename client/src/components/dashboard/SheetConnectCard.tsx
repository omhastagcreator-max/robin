import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sheet, Loader2, RefreshCcw, Check, AlertTriangle, Plug, X, Copy } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * SheetConnectCard — admin pastes their Google Sheet URL/ID, Robin pulls
 * leads from it every 5 minutes automatically. Sales / employees can
 * trigger a manual "Sync now" but only admins can connect / disconnect.
 *
 * Setup the user (admin) does:
 *   1. Open their Google Sheet of leads.
 *   2. Click Share → invite the service account email shown in this card.
 *   3. Copy the spreadsheet URL or ID.
 *   4. Paste here, set the tab name (default Sheet1), click Connect.
 *
 * Robin then polls every 5 minutes and creates new leads in "New Lead"
 * stage. Dedupe by phone + email so the same row never imports twice.
 */

function extractSheetId(input: string): string {
  // Accept either a raw ID OR a full URL.
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : input.trim();
}

function fmtAgo(iso?: string): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)   return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

interface Status {
  connected: boolean;
  configured: boolean;
  serviceAccountEmail: string;
  source: null | {
    spreadsheetId: string;
    sheetName: string;
    enabled: boolean;
    lastSyncedAt?: string;
    lastError?: string;
    totalImported?: number;
  };
}

export function SheetConnectCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [status,   setStatus]   = useState<Status | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [input,    setInput]    = useState('');
  const [tab,      setTab]      = useState('Sheet1');
  const [busy,     setBusy]     = useState(false);
  const [syncing,  setSyncing]  = useState(false);

  const load = async () => {
    setLoading(true);
    try { setStatus(await api.sheetGetStatus()); }
    catch { /* ignore — non-fatal */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const connect = async () => {
    const id = extractSheetId(input);
    if (!id) { toast.error('Paste the sheet URL or ID'); return; }
    setBusy(true);
    try {
      const res = await api.sheetConnect({ spreadsheetId: id, sheetName: tab.trim() || 'Sheet1' });
      const synced = res?.sync?.createdCount ?? 0;
      toast.success(`Connected. Imported ${synced} new lead${synced === 1 ? '' : 's'}.`);
      setShowForm(false); setInput(''); load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not connect sheet');
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect this sheet? Existing leads stay; new sheet rows will stop syncing.')) return;
    setBusy(true);
    try { await api.sheetDisconnect(); toast.success('Disconnected'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Could not disconnect'); }
    finally { setBusy(false); }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.sheetSyncNow();
      if (!r.ok) toast.error(r.error || 'Sync failed');
      else if (r.createdCount > 0) toast.success(`+${r.createdCount} new lead${r.createdCount === 1 ? '' : 's'}`);
      else toast.success('No new rows since last sync');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Sync failed'); }
    finally { setSyncing(false); }
  };

  if (loading) return null;
  if (!status) return null;

  // Server doesn't have Google credentials configured — show admin-only setup hint.
  if (!status.configured) {
    if (!isAdmin) return null;
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-3 text-xs">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-700">Google Sheets sync not yet configured on the server.</p>
          <p className="text-amber-700/80 mt-0.5">
            Add <code className="bg-card px-1 rounded">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and <code className="bg-card px-1 rounded">GOOGLE_SERVICE_ACCOUNT_KEY</code> env vars on Render to enable it.
          </p>
        </div>
      </div>
    );
  }

  // ── Already connected → status pill + Sync now ────────────────────────
  if (status.connected && status.source) {
    const s = status.source;
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
          <Sheet className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            Google Sheet connected
            {s.lastError
              ? <span className="text-[10px] text-red-600 font-normal">· {s.lastError.slice(0, 60)}</span>
              : <Check className="h-3 w-3 text-emerald-600" />}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Tab "{s.sheetName}" · last sync {fmtAgo(s.lastSyncedAt)} · {s.totalImported || 0} imported total
          </p>
        </div>
        <button onClick={syncNow} disabled={syncing}
          className="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50">
          {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} Sync now
        </button>
        {isAdmin && (
          <button onClick={disconnect} disabled={busy}
            title="Disconnect"
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500 flex items-center justify-center disabled:opacity-50">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </motion.div>
    );
  }

  // ── Not connected → admin sees connect CTA ────────────────────────────
  if (!isAdmin) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
          <Sheet className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">Auto-import leads from Google Sheets</p>
          <p className="text-[10px] text-muted-foreground">Live sync every 5 minutes. Dedupe by phone + email.</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="h-7 px-3 flex items-center gap-1 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
            <Plug className="h-3 w-3" /> Connect
          </button>
        )}
      </div>
      {showForm && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="text-[11px] bg-muted/30 rounded-md p-2 space-y-1">
            <p className="font-semibold">Setup (one time):</p>
            <p>1. Open your sheet → <strong>Share</strong> → invite this email as <strong>Viewer</strong>:</p>
            <div className="flex items-center gap-1.5 bg-background border border-input rounded px-2 py-1">
              <code className="text-[10px] flex-1 truncate">{status.serviceAccountEmail}</code>
              <button onClick={() => { navigator.clipboard?.writeText(status.serviceAccountEmail); toast.success('Email copied'); }}
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted">
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <p>2. Paste the sheet URL or ID below + the tab name. Robin starts polling immediately.</p>
            <p className="text-muted-foreground">
              Sheets linked to <strong>Meta Lead Ads</strong> (Zapier / Lead Center) work out of the box —
              Robin auto-detects <code>full_name</code>, <code>phone_number</code>, <code>email</code>,
              <code>campaign_name</code>, etc. Plain sheets just need a <code>name</code> column plus
              <code>phone</code> or <code>email</code>.
            </p>
          </div>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <input
              value={tab}
              onChange={e => setTab(e.target.value)}
              placeholder="Sheet1"
              className="flex-1 px-2 py-1.5 bg-background border border-input rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button onClick={connect} disabled={busy || !input.trim()}
              className="h-8 px-3 flex items-center gap-1 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} Connect & sync
            </button>
            <button onClick={() => { setShowForm(false); setInput(''); }}
              className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default SheetConnectCard;
