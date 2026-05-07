import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import {
  TrendingUp, IndianRupee, Eye, MousePointerClick, Target, AlertCircle,
  Loader2, RefreshCw, BarChart3, ChevronDown,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format } from 'date-fns';
import * as api from '@/api';

/**
 * MetaAdsReport — full drill-down at /ads/meta.
 *
 * Switch between any of the agency's 17 ad accounts (or however many),
 * pick a date range (last 7 / 30 / custom), see headline stats + per-day
 * spend chart + per-campaign breakdown table.
 */

interface AdAccount { id: string; name: string; currency?: string; }

interface Metrics {
  dateStart: string;
  dateStop: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  reach: number;
  frequency: number;
  conversions: number;
  conversionValue: number;
  costPerConversion: number;
  roas: number;
}

interface Campaign extends Metrics {
  campaignId: string;
  campaignName: string;
}

const fmtINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString('en-IN');
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}
function todayKey(): string { return isoDaysAgo(0); }
function yesterdayKey(): string { return isoDaysAgo(1); }

type Preset = 'yesterday' | 'last_7d' | 'last_30d' | 'custom';

export default function MetaAdsReport() {
  const [accounts, setAccounts]   = useState<AdAccount[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [preset, setPreset]       = useState<Preset>('last_7d');
  const [from, setFrom]           = useState<string>(isoDaysAgo(7));
  const [to, setTo]               = useState<string>(yesterdayKey());

  const [totals, setTotals]       = useState<Metrics | null>(null);
  const [daily, setDaily]         = useState<Metrics[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Effective date window from preset
  const window = useMemo(() => {
    if (preset === 'yesterday') return { from: yesterdayKey(),   to: yesterdayKey() };
    if (preset === 'last_7d')   return { from: isoDaysAgo(7),    to: yesterdayKey() };
    if (preset === 'last_30d')  return { from: isoDaysAgo(30),   to: yesterdayKey() };
    return { from, to };
  }, [preset, from, to]);

  // Load list of accounts on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await api.metaAdsAccounts();
        setAccounts(data.accounts);
        setAccountId(data.defaultAccountId || data.accounts[0]?.id || '');
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Could not load accounts');
        setLoading(false);
      }
    })();
  }, []);

  // Fetch report whenever account or window changes
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [rangeRes, dailyRes, campsRes] = await Promise.all([
          api.metaAdsRange({ adAccountId: accountId, from: window.from, to: window.to, daily: false }),
          api.metaAdsRange({ adAccountId: accountId, from: window.from, to: window.to, daily: true  }),
          api.metaAdsCampaigns({ adAccountId: accountId, from: window.from, to: window.to }),
        ]);
        if (cancelled) return;
        setTotals(rangeRes.metrics || null);
        setDaily(dailyRes.daily || []);
        setCampaigns(campsRes.campaigns || []);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.error || 'Could not load report');
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [accountId, window.from, window.to]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-5 page-transition-enter">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-500" /> Meta Ads Report
            </h1>
            <p className="text-sm text-muted-foreground">
              Live data from Meta Marketing API. Pick an account and a window.
            </p>
          </div>
          <button
            onClick={() => { setRefreshing(true); setAccountId(a => a); /* trigger effect */ }}
            disabled={refreshing}
            className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-2xl p-4 flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Ad account</span>
            <div className="relative">
              <select
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                className="bg-background border border-input rounded-lg pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring appearance-none min-w-[220px]"
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <ChevronDown className="h-3.5 w-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </label>

          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {(['yesterday', 'last_7d', 'last_30d', 'custom'] as Preset[]).map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  preset === p ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-background/50'
                }`}
              >
                {p === 'last_7d' ? 'Last 7d' : p === 'last_30d' ? 'Last 30d' : p === 'yesterday' ? 'Yesterday' : 'Custom'}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <>
              <input type="date" value={from} max={todayKey()} onChange={e => setFrom(e.target.value)} className="bg-background border border-input rounded-lg px-2.5 py-1.5 text-sm" />
              <span className="text-muted-foreground text-xs">→</span>
              <input type="date" value={to}   max={todayKey()} onChange={e => setTo(e.target.value)}   className="bg-background border border-input rounded-lg px-2.5 py-1.5 text-sm" />
            </>
          )}

          <div className="ml-auto text-[11px] text-muted-foreground">
            {window.from} → {window.to}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold text-amber-700">{error}</p>
              <p className="text-xs text-muted-foreground mt-0.5">If you're seeing a permissions error, the System User token may not have access to this specific ad account.</p>
            </div>
          </div>
        )}

        {/* Headline KPIs */}
        {loading && !totals ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
        ) : totals ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi icon={IndianRupee}       label="Spend"        value={fmtINR(totals.spend)} />
            <Kpi icon={Eye}               label="Impressions"  value={fmtNum(totals.impressions)} />
            <Kpi icon={MousePointerClick} label="Clicks"       value={fmtNum(totals.clicks)} sub={`CTR ${fmtPct(totals.ctr)}`} />
            <Kpi icon={Target}            label="Conversions"  value={fmtNum(totals.conversions)} sub={totals.conversions > 0 ? `${fmtINR(totals.costPerConversion)} / conv` : ''} />
            <Kpi icon={TrendingUp}        label="ROAS"         value={totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '—'} accent={totals.roas >= 2 ? 'green' : totals.roas >= 1 ? 'amber' : totals.roas > 0 ? 'red' : undefined} />
            <Kpi icon={IndianRupee}       label="Avg CPC"      value={totals.cpc > 0 ? fmtINR(totals.cpc) : '—'} sub={totals.cpm > 0 ? `CPM ${fmtINR(totals.cpm)}` : ''} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center bg-card border border-border rounded-2xl">
            No data for this account in the selected window.
          </p>
        )}

        {/* Daily spend trend */}
        {daily.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" /> Daily spend
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 13%)" />
                <XAxis dataKey="dateStart" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} tickFormatter={(d) => format(new Date(d), 'd MMM')} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ background: 'hsl(222 47% 7%)', border: '1px solid hsl(216 34% 13%)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => fmtINR(v)}
                  labelFormatter={(d) => format(new Date(d as string), 'EEE, d MMM yyyy')}
                />
                <Bar dataKey="spend" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Daily breakdown table — Date / Spend / Sales / CPR / ROAS in one view */}
        {daily.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm">Daily summary · {daily.length} day{daily.length === 1 ? '' : 's'}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                    <th className="text-right px-3 py-2 font-medium">Ad Spend</th>
                    <th className="text-right px-3 py-2 font-medium">Sales</th>
                    <th className="text-right px-3 py-2 font-medium" title="Cost Per Result (spend ÷ sales)">CPR</th>
                    <th className="text-right px-3 py-2 font-medium" title="Return On Ad Spend (revenue ÷ spend)">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {[...daily].sort((a, b) => b.dateStart.localeCompare(a.dateStart)).map(d => (
                    <tr key={d.dateStart} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium tabular-nums">{format(new Date(d.dateStart), 'EEE, dd MMM yyyy')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtINR(d.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(d.conversions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{d.conversions > 0 ? fmtINR(d.costPerConversion) : <span className="text-muted-foreground">—</span>}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${d.roas >= 2 ? 'text-green-600' : d.roas >= 1 ? 'text-amber-600' : d.roas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {d.roas > 0 ? `${d.roas.toFixed(2)}x` : '—'}
                      </td>
                    </tr>
                  ))}
                  {/* Footer row — totals across selected window */}
                  {totals && (
                    <tr className="bg-muted/30 font-bold">
                      <td className="px-4 py-2.5">Total ({daily.length}d)</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtINR(totals.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(totals.conversions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{totals.conversions > 0 ? fmtINR(totals.costPerConversion) : '—'}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${totals.roas >= 2 ? 'text-green-600' : totals.roas >= 1 ? 'text-amber-600' : totals.roas > 0 ? 'text-red-600' : ''}`}>
                        {totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '—'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Per-campaign table */}
        {campaigns.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm">Per-campaign breakdown · {campaigns.length}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Campaign</th>
                    <th className="text-right px-3 py-2 font-medium">Spend</th>
                    <th className="text-right px-3 py-2 font-medium">Impressions</th>
                    <th className="text-right px-3 py-2 font-medium">Clicks</th>
                    <th className="text-right px-3 py-2 font-medium">CTR</th>
                    <th className="text-right px-3 py-2 font-medium">CPC</th>
                    <th className="text-right px-3 py-2 font-medium">Conv</th>
                    <th className="text-right px-3 py-2 font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {campaigns.sort((a, b) => b.spend - a.spend).map(c => (
                    <tr key={c.campaignId} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 max-w-xs truncate" title={c.campaignName}>{c.campaignName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtINR(c.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtNum(c.impressions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(c.clicks)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtPct(c.ctr)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.cpc > 0 ? fmtINR(c.cpc) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(c.conversions)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${c.roas >= 2 ? 'text-green-600' : c.roas >= 1 ? 'text-amber-600' : c.roas > 0 ? 'text-red-600' : ''}`}>
                        {c.roas > 0 ? `${c.roas.toFixed(2)}x` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: 'green' | 'amber' | 'red' }) {
  const accentColor = accent === 'green' ? 'text-green-600' : accent === 'amber' ? 'text-amber-600' : accent === 'red' ? 'text-red-600' : '';
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">{label}</span>
      </div>
      <p className={`text-xl font-bold tabular-nums leading-none ${accentColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
