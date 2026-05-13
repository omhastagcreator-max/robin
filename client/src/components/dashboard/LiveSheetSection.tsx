import { useEffect, useMemo, useState } from 'react';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sheet, RefreshCcw, Loader2, ExternalLink, Search, Phone, Mail,
  Megaphone, Calendar, ChevronRight, ChevronDown, CheckCircle2, Inbox, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * LiveSheetSection
 *
 * Sales-dashboard panel that presents the connected Google Sheet AS-IS
 * (Meta Lead Ads format, columns untouched), but in a friendly two-column
 * layout instead of a raw spreadsheet table:
 *
 *   ┌── Live from your sheet ──────────────────────── [Search] [Reload] ──┐
 *   │ Today (3)                                                            │
 *   │   ▸ Priya Sharma · 98765 43210 · "Diwali Reel" · just now            │
 *   │   ▸ Rohit Verma · rohit@…    · "Diwali Reel" · 12 min ago            │
 *   │ Earlier this week (8)                                                │
 *   │   ▸ …                                                                │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Click a row → expands inline with EVERY column from the original sheet
 * (campaign_name, ad_name, form_id, created_time, platform, etc.) so the
 * sales rep can see the full Meta context. If Robin already created a Lead
 * for that row, the row shows the current pipeline stage as a pill;
 * otherwise it shows "New" and links to "Add to pipeline" (sync now).
 *
 * No mutation of the sheet, no rewrite of headers — the sheet is the
 * backend. Robin just makes it readable.
 */

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New', dialed: 'Dialed', connected: 'Connected',
  demo_booked: 'Demo booked', demo_done: 'Demo done', demo2_conversion: 'Demo2',
  follow_up: 'Follow up', hot_follow_up: 'Hot follow', cooking: 'Cooking',
  won: 'Won', lost: 'Lost',
};
const STAGE_TONE: Record<string, string> = {
  new_lead: 'bg-blue-500/15 text-blue-700',
  dialed: 'bg-purple-500/15 text-purple-700',
  connected: 'bg-indigo-500/15 text-indigo-700',
  demo_booked: 'bg-amber-500/15 text-amber-700',
  demo_done: 'bg-orange-500/15 text-orange-700',
  demo2_conversion: 'bg-violet-500/15 text-violet-700',
  follow_up: 'bg-sky-500/15 text-sky-700',
  hot_follow_up: 'bg-red-500/15 text-red-700',
  cooking: 'bg-emerald-500/15 text-emerald-700',
  won: 'bg-green-500/15 text-green-700',
  lost: 'bg-gray-300 text-gray-700',
};

// Tries a list of header variants and returns the first non-empty value.
// Lets the UI cope with whatever Meta / Zapier / native lead-export named
// the column without forcing the user to rename anything.
const pick = (row: Record<string, any>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.replace(/_/g, ' ')];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
};

const fmtAgo = (s: string): string => {
  if (!s) return '';
  const t = new Date(s).getTime();
  if (isNaN(t)) return s;
  const ms = Date.now() - t;
  const min = Math.round(ms / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)   return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

// Buckets a row into a friendly group label by created_time
const bucketFor = (created: string): string => {
  if (!created) return 'Undated';
  const t = new Date(created).getTime();
  if (isNaN(t)) return 'Undated';
  const diffDays = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (diffDays === 0)   return 'Today';
  if (diffDays === 1)   return 'Yesterday';
  if (diffDays < 7)     return 'Earlier this week';
  if (diffDays < 30)    return 'This month';
  return 'Older';
};

// Order buckets sensibly even though we collect them from the data
const BUCKET_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'This month', 'Older', 'Undated'];

interface PreviewResp {
  headers: string[];
  rows: Array<Record<string, any> & { _robin: null | { leadId: string; stage: string; assignedTo?: string } }>;
  total: number;
  fetchedAt: string;
  spreadsheetId: string;
  sheetName: string;
  sheetUrl: string;
}

export function LiveSheetSection() {
  const [data, setData]       = useState<PreviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [open, setOpen]       = useState<Record<number, boolean>>({});
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { setData(await api.sheetPreview(500)); }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Could not load sheet';
      // 404 = no sheet connected. We hide the whole section in that case.
      if (e?.response?.status === 404) setData(null);
      else setError(msg);
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Auto-refresh every 60s so the team sees new Meta leads without clicking.
  // Visible-only: don't poll while the tab is backgrounded.
  useVisiblePoll(load, 60_000);

  const syncToPipeline = async () => {
    setSyncing(true);
    try {
      const r = await api.sheetSyncNow();
      if (!r.ok) toast.error(r.error || 'Sync failed');
      else if (r.createdCount > 0) toast.success(`+${r.createdCount} new lead${r.createdCount === 1 ? '' : 's'} added to pipeline`);
      else toast('Already up to date — every sheet row is in your pipeline');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Sync failed'); }
    finally { setSyncing(false); }
  };

  // ── Render guards ────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading live sheet…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        <div className="text-xs text-red-700">
          <p className="font-semibold">Live sheet unavailable</p>
          <p className="mt-0.5">{error}</p>
          <button onClick={load} className="mt-2 text-red-600 underline">Retry</button>
        </div>
      </div>
    );
  }
  if (!data) return null; // no sheet connected yet

  // ── Filter + group ───────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? data.rows
    : data.rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(q)));

  const groups: Record<string, typeof filtered> = {};
  for (const r of filtered) {
    const created = pick(r, 'created_time', 'created', 'date', 'timestamp');
    const b = bucketFor(created);
    (groups[b] ||= []).push(r);
  }
  const orderedBuckets = BUCKET_ORDER.filter(b => groups[b]?.length);

  const linkedCount = filtered.filter(r => r._robin).length;
  const newCount    = filtered.length - linkedCount;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header strip */}
      <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-emerald-500/5 to-transparent flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
          <Sheet className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2">
            Live from your sheet
            <span className="text-[10px] font-normal text-muted-foreground">
              · tab "{data.sheetName}" · {data.total} row{data.total === 1 ? '' : 's'}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Updates every 60 seconds · {newCount} not yet in pipeline · {linkedCount} already working
          </p>
        </div>
        <a href={data.sheetUrl} target="_blank" rel="noreferrer"
          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          title="Open the sheet in Google Sheets">
          <ExternalLink className="h-4 w-4" />
        </a>
        <button onClick={load} disabled={loading}
          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"
          title="Reload now">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
        </button>
        {newCount > 0 && (
          <button onClick={syncToPipeline} disabled={syncing}
            className="h-8 px-3 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
            {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Inbox className="h-3 w-3" />}
            Add {newCount} to pipeline
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="px-4 py-2 border-b border-border bg-muted/20">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone, email, campaign…"
            className="w-full pl-8 pr-3 py-1.5 bg-background border border-input rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Body */}
      {filtered.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground">
          {q ? 'No rows match that search.' : 'Your sheet is empty — when Meta sends a new lead it will appear here.'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {orderedBuckets.map(bucket => (
            <div key={bucket}>
              <div className="px-4 py-1.5 bg-muted/10 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground sticky top-0 z-10">
                {bucket} <span className="text-muted-foreground/60 normal-case">· {groups[bucket].length}</span>
              </div>
              {groups[bucket].map((r, i) => {
                // Use a stable key per row in the original data.rows array
                const rowIndex = data.rows.indexOf(r);
                const isOpen   = !!open[rowIndex];
                const name     = pick(r, 'full_name', 'name', 'lead_name') ||
                                 [pick(r, 'first_name'), pick(r, 'last_name')].filter(Boolean).join(' ') ||
                                 'Unnamed lead';
                const phone    = pick(r, 'phone_number', 'phone', 'mobile', 'whatsapp', 'contact');
                const email    = pick(r, 'email', 'email_address');
                const campaign = pick(r, 'campaign_name', 'ad_name', 'adset_name', 'campaign');
                const created  = pick(r, 'created_time', 'created', 'date', 'timestamp');
                const stage    = r._robin?.stage;

                return (
                  <div key={`${bucket}-${i}-${rowIndex}`} className="hover:bg-muted/20 transition-colors">
                    <button
                      onClick={() => setOpen(o => ({ ...o, [rowIndex]: !o[rowIndex] }))}
                      className="w-full px-4 py-2.5 flex items-center gap-3 text-left"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{name}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-2 truncate">
                          {phone && <span className="flex items-center gap-1 shrink-0"><Phone className="h-3 w-3" />{phone}</span>}
                          {email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{email}</span></span>}
                          {campaign && <span className="flex items-center gap-1 truncate text-emerald-700"><Megaphone className="h-3 w-3 shrink-0" /><span className="truncate">{campaign}</span></span>}
                        </p>
                      </div>
                      {created && (
                        <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline">
                          {fmtAgo(created)}
                        </span>
                      )}
                      {stage ? (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STAGE_TONE[stage] || 'bg-muted text-foreground'}`}>
                          {STAGE_LABEL[stage] || stage}
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700">
                          New
                        </span>
                      )}
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden bg-muted/10"
                        >
                          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                            {data.headers.map(h => {
                              const v = r[h];
                              if (v == null || String(v).trim() === '') return null;
                              return (
                                <div key={h} className="flex gap-2 min-w-0">
                                  <span className="text-muted-foreground font-mono uppercase text-[9px] tracking-wide shrink-0 pt-0.5 w-32 truncate">{h}</span>
                                  <span className="text-foreground break-all">{String(v)}</span>
                                </div>
                              );
                            })}
                          </div>
                          {!stage && (
                            <div className="px-4 pb-3">
                              <button
                                onClick={syncToPipeline}
                                disabled={syncing}
                                className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                              >
                                {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                Add this to my pipeline
                              </button>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default LiveSheetSection;
