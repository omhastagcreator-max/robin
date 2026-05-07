import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bird, BarChart3, IndianRupee, Eye, MousePointerClick, Target, TrendingUp, Loader2, AlertCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format } from 'date-fns';
import * as api from '@/api';

/**
 * MetaShareView — public read-only Meta Ads report.
 *
 * Mounted at /share/meta/:token (no AppLayout, no sidebar, no auth). The
 * client opens the link, sees just the report. Clean, branded, designed
 * to be screenshot-friendly so the client can easily forward it.
 *
 * If the link is expired or revoked we render a friendly empty state
 * instead of a stack trace.
 */

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
interface Payload {
  adAccountId: string;
  label: string;
  datePreset?: string;
  fromDate?: string;
  toDate?: string;
  expiresAt: string;
  generatedAt: string;
  totals: Metrics | null;
  daily: Metrics[];
  campaigns: Campaign[];
}

const fmtINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString('en-IN');
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

export default function MetaShareView() {
  const { token } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.metaViewShare(token);
        setData(res);
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Could not load report');
        setErrorCode(e?.response?.status || null);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold">{errorCode === 410 ? 'Link expired' : 'Report not available'}</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-[11px] text-muted-foreground">Ask your agency to send a fresh link.</p>
        </div>
      </div>
    );
  }

  const { totals, daily, campaigns, label, expiresAt, generatedAt } = data;
  const window = data.fromDate && data.toDate ? `${data.fromDate} → ${data.toDate}` : (data.datePreset || '').replace('_', ' ');

  return (
    <div className="min-h-screen bg-background">
      {/* Branded header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center">
            <Bird className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Meta Ads Report · powered by Robin</p>
            <h1 className="text-lg font-bold leading-tight flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" /> {label}
            </h1>
          </div>
          <div className="text-right text-[10px] text-muted-foreground">
            <p>Generated {format(new Date(generatedAt), 'd MMM yyyy, h:mm a')}</p>
            <p>Window: <strong className="text-foreground">{window}</strong></p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* Headline KPIs */}
        {totals ? (
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi icon={IndianRupee}       label="Spend"        value={fmtINR(totals.spend)} />
            <Kpi icon={Eye}               label="Impressions"  value={fmtNum(totals.impressions)} />
            <Kpi icon={MousePointerClick} label="Clicks"       value={fmtNum(totals.clicks)} sub={`CTR ${fmtPct(totals.ctr)}`} />
            <Kpi icon={Target}            label="Sales"        value={fmtNum(totals.conversions)} sub={totals.conversions > 0 ? `${fmtINR(totals.costPerConversion)} / sale` : ''} />
            <Kpi icon={TrendingUp}        label="ROAS"         value={totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '—'} accent={totals.roas >= 2 ? 'green' : totals.roas >= 1 ? 'amber' : totals.roas > 0 ? 'red' : undefined} />
            <Kpi icon={IndianRupee}       label="Avg CPC"      value={totals.cpc > 0 ? fmtINR(totals.cpc) : '—'} sub={totals.cpm > 0 ? `CPM ${fmtINR(totals.cpm)}` : ''} />
          </section>
        ) : (
          <p className="text-center text-sm text-muted-foreground py-8 bg-card border border-border rounded-2xl">
            No spend data for this window.
          </p>
        )}

        {/* Daily spend chart */}
        {daily.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-4">
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" /> Daily spend
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 13%)" />
                <XAxis dataKey="dateStart" tick={{ fontSize: 10 }} tickFormatter={(d) => format(new Date(d), 'd MMM')} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ background: 'hsl(222 47% 7%)', border: '1px solid hsl(216 34% 13%)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => fmtINR(v)}
                  labelFormatter={(d) => format(new Date(d as string), 'EEE, d MMM yyyy')}
                />
                <Bar dataKey="spend" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>
        )}

        {/* Daily summary table */}
        {daily.length > 0 && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm">Daily summary</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                    <th className="text-right px-3 py-2 font-medium">Ad Spend</th>
                    <th className="text-right px-3 py-2 font-medium">Sales</th>
                    <th className="text-right px-3 py-2 font-medium">CPR</th>
                    <th className="text-right px-3 py-2 font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {[...daily].sort((a, b) => b.dateStart.localeCompare(a.dateStart)).map(d => (
                    <tr key={d.dateStart}>
                      <td className="px-4 py-2.5 font-medium tabular-nums">{format(new Date(d.dateStart), 'EEE, dd MMM yyyy')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtINR(d.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(d.conversions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{d.conversions > 0 ? fmtINR(d.costPerConversion) : <span className="text-muted-foreground">—</span>}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${d.roas >= 2 ? 'text-green-600' : d.roas >= 1 ? 'text-amber-600' : d.roas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {d.roas > 0 ? `${d.roas.toFixed(2)}x` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Campaigns */}
        {campaigns.length > 0 && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm">Campaigns · {campaigns.length}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Campaign</th>
                    <th className="text-right px-3 py-2 font-medium">Spend</th>
                    <th className="text-right px-3 py-2 font-medium">CTR</th>
                    <th className="text-right px-3 py-2 font-medium">Conv</th>
                    <th className="text-right px-3 py-2 font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {campaigns.sort((a, b) => b.spend - a.spend).map(c => (
                    <tr key={c.campaignId}>
                      <td className="px-4 py-2.5 max-w-xs truncate" title={c.campaignName}>{c.campaignName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtINR(c.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(c.ctr)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(c.conversions)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${c.roas >= 2 ? 'text-green-600' : c.roas >= 1 ? 'text-amber-600' : c.roas > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {c.roas > 0 ? `${c.roas.toFixed(2)}x` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-center text-[10px] text-muted-foreground pt-4 pb-8">
          Link valid until {format(new Date(expiresAt), 'd MMM yyyy')} · Read-only view
        </footer>
      </main>
    </div>
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
