import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, UserCheck, Calendar, Presentation, CheckCheck,
  TrendingUp, Repeat, Flame, ChefHat, Trophy, XCircle,
  Plus, IndianRupee, Loader2, X, Users, Bell, BadgeCheck,
  AlertCircle, Clock, Building2, LayoutDashboard, ChevronDown, List, Search, Sheet,
} from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { SessionClockCard } from '@/components/shared/SessionClockCard';
import { SheetConnectCard } from '@/components/dashboard/SheetConnectCard';
import { LiveSheetSection } from '@/components/dashboard/LiveSheetSection';
import { TodayClientsCard } from '@/components/dashboard/TodayClientsCard';
import { LeadListView } from '@/components/dashboard/LeadListView';
import { HuddleQuickPill } from '@/components/shared/HuddleQuickPill';

// ── Stage Config ──────────────────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { key: 'new_lead',         label: 'New Lead',         icon: Phone,        color: 'border-t-blue-500',    bg: 'bg-blue-50',     text: 'text-blue-600'   },
  { key: 'dialed',           label: 'Dialed',           icon: Phone,        color: 'border-t-purple-500',  bg: 'bg-purple-50',   text: 'text-purple-600' },
  { key: 'connected',        label: 'Connected',        icon: UserCheck,    color: 'border-t-indigo-500',  bg: 'bg-indigo-50',   text: 'text-indigo-600' },
  { key: 'demo_booked',      label: 'Demo Booked',      icon: Calendar,     color: 'border-t-amber-500',   bg: 'bg-amber-50',    text: 'text-amber-700'  },
  { key: 'demo_done',        label: 'Demo Done',        icon: Presentation, color: 'border-t-orange-500',  bg: 'bg-orange-50',   text: 'text-orange-700' },
  { key: 'demo2_conversion', label: 'Demo2 Conversion', icon: TrendingUp,   color: 'border-t-violet-500',  bg: 'bg-violet-50',   text: 'text-violet-600' },
] as const;

const SALES_STAGES = [
  { key: 'follow_up',    label: 'Follow Up',    icon: Repeat,   color: 'border-t-sky-500',     bg: 'bg-sky-50',      text: 'text-sky-600'     },
  { key: 'hot_follow_up',label: 'Hot Follow Up',icon: Flame,    color: 'border-t-rose-500',     bg: 'bg-rose-500/10',      text: 'text-rose-700'     },
  { key: 'cooking',      label: 'Cooking',      icon: ChefHat,  color: 'border-t-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-600' },
] as const;

const OUTCOME_STAGES = [
  { key: 'won',  label: 'Sale Won',  icon: Trophy,   color: 'border-t-emerald-500', bg: 'bg-emerald-500/10',  text: 'text-emerald-700'  },
  { key: 'lost', label: 'Sale Lost', icon: XCircle,  color: 'border-t-muted-foreground/40',  bg: 'bg-muted/30',   text: 'text-muted-foreground'   },
] as const;

const ALL_STAGES = [...PIPELINE_STAGES, ...SALES_STAGES, ...OUTCOME_STAGES];
const EMPTY_FORM = { name: '', contact: '', email: '', company: '', source: 'other', estimatedValue: '' };

/**
 * parseContactBlob — extracts {name, phone, email} from a single freeform
 * string. Lets people paste a contact line like "Priya Sharma — Acme Corp,
 * priya@acme.com, +91 98765 43210" and have it split correctly. Used by
 * both the full New Lead form and the per-column quick-add.
 */
function parseContactBlob(blob: string): { name: string; phone?: string; email?: string } {
  if (!blob) return { name: '' };
  const emailMatch = blob.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  const phoneMatch = blob.match(/(\+?\d[\d\s().-]{8,})/);
  let name = blob;
  if (emailMatch) name = name.replace(emailMatch[0], '');
  if (phoneMatch) name = name.replace(phoneMatch[0], '');
  // Clean trailing separators and whitespace
  name = name.replace(/[,–—|·;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    name,
    email: emailMatch ? emailMatch[0] : undefined,
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ').trim() : undefined,
  };
}

type Tab = 'pipeline' | 'list' | 'clients' | 'won';

export default function SalesDashboard() {
  const [tab, setTab]         = useState<Tab>('pipeline');
  const [leads, setLeads]     = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [deals, setDeals]     = useState<any[]>([]);
  // Two flags so subsequent refreshes never blank the page:
  //   loading      — true ONLY on the very first mount, drives the
  //                  full-screen spinner. Never set true again.
  //   refreshing   — true while a background refresh is in flight. Could
  //                  drive a subtle inline indicator if we want; mostly
  //                  used to prevent overlapping refreshes.
  // Without this, every CRUD action (drag-drop, quick-add, stage flip)
  // called load() → setLoading(true) → spinner → setLoading(false) →
  // dashboard re-renders. From the user POV that looked like the page
  // was fluctuating between blank and dashboard.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ ...EMPTY_FORM });
  const [saving, setSaving]   = useState(false);
  const [dragging, setDragging]           = useState<string | null>(null);
  const [viewLead, setViewLead]           = useState<any | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<any | null>(null);
  const [paymentForm, setPaymentForm]     = useState({ amount: '', dueDate: '', note: '' });
  const [sendingPayment, setSendingPayment] = useState(false);
  const [onboardLead, setOnboardLead]     = useState<any | null>(null);
  const [onboardForm, setOnboardForm]     = useState({ clientName: '', email: '', password: '', services: [] as string[], projectType: 'combined', servicesDescription: '' });
  const [onboarding, setOnboarding]       = useState(false);
  // Quick-add per column — when set, that stage's column shows an inline
  // single-line input above the cards. Hitting Enter creates a lead in that
  // stage with smart defaults. Massively reduces clicks vs. opening the
  // full new-lead modal every time.
  const [quickAddStage, setQuickAddStage]   = useState<string | null>(null);
  const [quickAddName,  setQuickAddName]    = useState('');
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  // Mobile: which stage is being viewed (kanban is horizontal scroll on
  // desktop, but on a phone we show one stage at a time via this picker).
  const [mobileStage, setMobileStage] = useState<string>('new_lead');

  // Single shared fingerprint reference — used by BOTH the foreground
  // load (after a CRUD action) and the background 2-min interval. Means
  // a CRUD that didn't actually change anything visible won't re-render
  // the kanban, and the interval can't undo an optimistic update.
  const fgSigRef = useRef<string>('');
  const fingerprint = (l: any[], u: any[], d: any[]) =>
    `L:${l.map(x => `${x._id}/${x.stage || x.status}/${x.aiScore || ''}`).join(',')}|` +
    `U:${u.map(x => x._id).join(',')}|` +
    `D:${d.map(x => `${x._id}/${x.status || ''}`).join(',')}`;

  const load = useCallback(async () => {
    // First call → drive the full-screen spinner. Subsequent calls (after
    // any CRUD action) → silent refresh; keep the existing data visible
    // so the page doesn't flicker.
    if (!initialLoadDone.current) setLoading(true);
    else                          setRefreshing(true);
    try {
      const [l, u, d] = await Promise.all([
        api.listLeads({}),
        api.listUsers({ role: 'client' }),
        api.listDeals(),
      ]);
      const ll = Array.isArray(l) ? l : [];
      const uu = Array.isArray(u) ? u : [];
      const dd = Array.isArray(d) ? d : [];
      // FIRST load — always set state so the empty placeholder is replaced
      // by real data. After that, skip setState if the data is identical
      // to what we already rendered. This is what stops Rishi's kanban
      // from "blinking" after every drag / quick-add / status change.
      const sig = fingerprint(ll, uu, dd);
      if (!initialLoadDone.current || sig !== fgSigRef.current) {
        fgSigRef.current = sig;
        setLeads(ll);
        setClients(uu);
        setDeals(dd);
      }
    } finally {
      initialLoadDone.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 2 minutes. Skips setState when the data fingerprint
  // matches the last-rendered one (set by EITHER this interval OR the
  // foreground load above — they share `fgSigRef`). No data change → no
  // re-render → no flicker.
  useEffect(() => {
    const i = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const [l, u, d] = await Promise.all([
          api.listLeads({}),
          api.listUsers({ role: 'client' }),
          api.listDeals(),
        ]);
        const ll = Array.isArray(l) ? l : [];
        const uu = Array.isArray(u) ? u : [];
        const dd = Array.isArray(d) ? d : [];
        const sig = fingerprint(ll, uu, dd);
        if (sig === fgSigRef.current) return;     // no change → no flicker
        fgSigRef.current = sig;
        setLeads(ll);
        setClients(uu);
        setDeals(dd);
      } catch { /* silent — next tick will retry */ }
    }, 120_000);
    return () => clearInterval(i);
  }, []);

  const byStage = (key: string) => leads.filter(l => (l.stage || l.status) === key);
  const wonLeads   = leads.filter(l => (l.stage || l.status) === 'won');
  const pipelineValue = leads.filter(l => !['won','lost'].includes(l.stage || l.status))
    .reduce((s, l) => s + (l.estimatedValue || 0), 0);
  const wonValue = wonLeads.reduce((s, l) => s + (l.wonAmount || l.estimatedValue || 0), 0);

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('leadId');
    if (!id) return;
    setDragging(null);
    if (targetStage === 'won') {
      const actualLead = leads.find(l => l._id === id);
      if (actualLead) {
        setOnboardLead(actualLead);
        setOnboardForm({ clientName: actualLead.name || '', email: actualLead.email || '', password: '', services: [], projectType: 'combined', servicesDescription: '' });
      }
      return;
    }
    setLeads(prev => prev.map(l => l._id === id ? { ...l, stage: targetStage, status: targetStage } : l));
    try {
      await api.updateLead(id, { stage: targetStage, status: targetStage });
    } catch { toast.error('Failed to update stage'); load(); }
  };

  const createLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Smart paste: if "name" looks like it has phone/email mixed in, parse them out.
      const parsed = parseContactBlob(form.name);
      const payload = {
        ...form,
        name:    parsed.name    || form.name,
        contact: form.contact   || parsed.phone || '',
        email:   form.email     || parsed.email || '',
        stage: 'new_lead',
        estimatedValue: Number(form.estimatedValue) || 0,
      };
      await api.createLead(payload);
      toast.success('Lead created!');
      setForm({ ...EMPTY_FORM }); setShowAdd(false); load();
    } catch { toast.error('Failed to create lead'); }
    finally { setSaving(false); }
  };

  // Per-column quick add. Pre-fills the stage so you don't have to drag.
  // Smart-parse the input: if you paste "Priya 9876543210 priya@acme.com"
  // it splits into name + phone + email automatically.
  const quickAddSubmit = async (stageKey: string) => {
    const trimmed = quickAddName.trim();
    if (!trimmed) return;
    setQuickAddSaving(true);
    try {
      const parsed = parseContactBlob(trimmed);
      await api.createLead({
        name:    parsed.name || trimmed,
        contact: parsed.phone || '',
        email:   parsed.email || '',
        source:  'other',  // 'manual' isn't in the Lead.source enum — use 'other' so save doesn't 400
        stage:   stageKey,
        estimatedValue: 0,
      });
      setQuickAddName('');
      setQuickAddStage(null);
      load();
    } catch { toast.error('Could not add lead'); }
    finally { setQuickAddSaving(false); }
  };

  const sendPaymentDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentTarget) return;
    setSendingPayment(true);
    try {
      await api.sendPaymentAlert({
        clientId: paymentTarget._id || paymentTarget.clientId,
        clientName: paymentTarget.name || paymentTarget.company,
        amount: Number(paymentForm.amount),
        dueDate: paymentForm.dueDate,
        note: paymentForm.note,
      });
      toast.success(`Payment due alert sent to ${paymentTarget.name || paymentTarget.company} ✅`);
      setPaymentTarget(null);
      setPaymentForm({ amount: '', dueDate: '', note: '' });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to send payment alert');
    } finally { setSendingPayment(false); }
  };

  const handleOnboardClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onboardLead) return;
    setOnboarding(true);
    try {
      // 1. Create User (Client)
      const userRes = await api.createUser({
        name: onboardForm.clientName,
        email: onboardForm.email,
        password: onboardForm.password || 'Welcome123!',
        role: 'client',
        company: onboardLead.company,
        fromLeadId: onboardLead._id
      });
      
      // 2. Create Project
      await api.createProject({
        name: `${onboardLead.company || onboardLead.name} - ${onboardForm.projectType}`,
        clientId: userRes._id,
        projectType: onboardForm.projectType,
        services: onboardForm.services,
        servicesDescription: onboardForm.servicesDescription,
        deadline: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0] // default 30 days
      });
      
      // 3. Move Lead to Won
      await api.updateLead(onboardLead._id, { stage: 'won', status: 'won', closedAt: new Date() });
      
      toast.success('Client onboarded successfully!');
      setOnboardLead(null);
      load();
    } catch(err: any) {
      toast.error('Failed to onboard: ' + (err.response?.data?.error || err.message));
    } finally {
      setOnboarding(false);
    }
  };

  // Move a lead to a different stage (used by the mobile-friendly stage
  // dropdown, since drag-drop doesn't work on touch devices).
  const moveLeadStage = async (leadId: string, targetStage: string) => {
    if (targetStage === 'won') {
      const actualLead = leads.find(l => l._id === leadId);
      if (actualLead) {
        setOnboardLead(actualLead);
        setOnboardForm({ clientName: actualLead.name || '', email: actualLead.email || '', password: '', services: [], projectType: 'combined', servicesDescription: '' });
      }
      return;
    }
    setLeads(prev => prev.map(l => l._id === leadId ? { ...l, stage: targetStage, status: targetStage } : l));
    try { await api.updateLead(leadId, { stage: targetStage, status: targetStage }); }
    catch { toast.error('Failed to update stage'); load(); }
  };

  // Single-click next-stage mapping — the most likely transition Rishi
  // will want for each stage. Returns null for terminal stages (won/lost).
  const nextStageFor = (stage: string): { key: string; label: string } | null => {
    const flow: Record<string, { key: string; label: string }> = {
      new_lead:          { key: 'dialed',           label: 'Mark dialed' },
      dialed:            { key: 'connected',        label: 'Mark connected' },
      connected:         { key: 'demo_booked',      label: 'Book demo' },
      demo_booked:       { key: 'demo_done',        label: 'Demo done' },
      demo_done:         { key: 'demo2_conversion', label: 'Send to demo 2' },
      demo2_conversion:  { key: 'won',              label: 'Mark won' },
      follow_up:         { key: 'hot_follow_up',    label: 'Mark hot' },
      hot_follow_up:     { key: 'cooking',          label: 'Mark cooking' },
      cooking:           { key: 'won',              label: 'Mark won' },
    };
    return flow[stage] || null;
  };

  // ── Lead Card ─────────────────────────────────────────────────────────────
  // Designed for Rishi's workflow: new lead arrives → he calls → he hits
  // ONE button to mark the outcome. No dropdowns to open, no modals.
  const LeadCard = ({ lead }: { lead: any }) => {
    const currentStage = lead.stage || lead.status;
    const next = nextStageFor(currentStage);
    const isNew = lead.createdAt && Date.now() - new Date(lead.createdAt).getTime() < 60 * 60 * 1000;
    const isTerminal = currentStage === 'won' || currentStage === 'lost';

    return (
      <div
        draggable
        onDragStart={e => { e.dataTransfer.setData('leadId', lead._id); setDragging(lead._id); }}
        onDragEnd={() => setDragging(null)}
        className={`bg-card border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing space-y-1.5 group hover:border-primary/40 hover:shadow-sm transition-all relative ${dragging === lead._id ? 'opacity-40' : ''}`}
      >
        {/* NEW badge — top-right corner, only for fresh leads */}
        {isNew && (
          <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full shadow-sm tracking-wider">
            New
          </span>
        )}

        {/* Name + value (clickable to open detail) */}
        <button
          type="button"
          onClick={() => setViewLead(lead)}
          className="w-full text-left flex items-start justify-between gap-1"
        >
          <p className="text-xs font-semibold line-clamp-1 flex-1">{lead.name}</p>
          {lead.estimatedValue > 0 && (
            <span className="text-[10px] text-emerald-600 font-semibold shrink-0">
              ₹{lead.estimatedValue.toLocaleString('en-IN')}
            </span>
          )}
        </button>

        {/* AI score chip — populated automatically on lead create via
            Gemini. Shows hot/warm/cold + the recommended next action so
            Rishi sees what to do without opening the lead detail. */}
        {lead.aiScore && (
          <div className={`flex items-start gap-1.5 mt-1 px-2 py-1 rounded-md text-[10px] ${
            lead.aiScore === 'hot'  ? 'bg-rose-500/10 text-rose-700' :
            lead.aiScore === 'warm' ? 'bg-amber-500/10 text-amber-700' :
                                       'bg-muted/40 text-muted-foreground'
          }`}>
            <span className="font-bold uppercase shrink-0">{lead.aiScore}</span>
            {lead.aiNextAction && (
              <span className="line-clamp-2 leading-tight">{lead.aiNextAction}</span>
            )}
          </div>
        )}

        {/* Phone — tappable on mobile to call directly. Single tap = action. */}
        {lead.contact && (
          <a
            href={`tel:${lead.contact}`}
            onClick={e => e.stopPropagation()}
            className="block text-[11px] text-primary hover:underline tabular-nums"
          >
            📞 {lead.contact}
          </a>
        )}
        {(lead.company || lead.source) && (
          <p className="text-[10px] text-muted-foreground truncate">
            {[lead.company, lead.source ? `via ${lead.source.replace('_', ' ')}` : null].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* ONE-CLICK ACTIONS — primary "next stage", secondary "lost" */}
        {!isTerminal && (
          <div className="flex items-center gap-1 pt-1">
            {next && (
              <button
                onClick={(e) => { e.stopPropagation(); moveLeadStage(lead._id, next.key); }}
                className="flex-1 h-7 px-2 rounded-md bg-primary/10 text-primary text-[10px] font-semibold hover:bg-primary/20 truncate"
                title={`Move to ${next.label}`}
              >
                ✓ {next.label}
              </button>
            )}
            {currentStage !== 'lost' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Mark "${lead.name}" as Lost?`)) moveLeadStage(lead._id, 'lost');
                }}
                className="h-7 px-2 rounded-md bg-card border border-border text-muted-foreground text-[10px] font-semibold hover:bg-rose-500/10 hover:text-rose-600 hover:border-rose-500/30"
                title="Mark Lost"
              >
                ✗
              </button>
            )}
            {/* Quiet "more stages" picker — collapsed into a dropdown so it's
                not visible noise but available when needed */}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  moveLeadStage(lead._id, e.target.value);
                  e.target.value = '';
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 w-7 text-[10px] bg-card border border-border rounded-md text-muted-foreground hover:bg-muted cursor-pointer text-center appearance-none"
              title="Move to other stage"
            >
              <option value="">⋯</option>
              {ALL_STAGES.filter(s => s.key !== currentStage).map(s => (
                <option key={s.key} value={s.key}>→ {s.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  };

  // ── Kanban Column ─────────────────────────────────────────────────────────
  const Column = ({ stage }: { stage: typeof ALL_STAGES[number] }) => {
    const Icon = stage.icon;
    const items = byStage(stage.key);
    const stageValue = items.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const isAdding = quickAddStage === stage.key;
    return (
      <div
        className={`bg-card border-t-2 ${stage.color} border border-border rounded-xl flex flex-col min-w-[210px] w-full md:w-auto max-h-[calc(100vh-300px)] shadow-sm`}
        onDragOver={e => e.preventDefault()}
        onDrop={e => handleDrop(e, stage.key)}
      >
        <div className="px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <div className={`h-6 w-6 rounded-md flex items-center justify-center ${stage.bg}`}>
              <Icon className={`h-3.5 w-3.5 ${stage.text}`} />
            </div>
            <p className="text-xs font-semibold flex-1 truncate">{stage.label}</p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${stage.bg} ${stage.text}`}>{items.length}</span>
            <button
              onClick={() => { setQuickAddStage(isAdding ? null : stage.key); setQuickAddName(''); }}
              className="h-5 w-5 rounded-md flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title={`Add lead to ${stage.label}`}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          {stageValue > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5">
              <IndianRupee className="h-2.5 w-2.5" />{stageValue.toLocaleString('en-IN')}
            </p>
          )}
        </div>
        {/* Quick-add inline form — collapses when not in use */}
        {isAdding && (
          <div className="px-2 pt-2 space-y-1">
            <input
              autoFocus
              value={quickAddName}
              onChange={e => setQuickAddName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); quickAddSubmit(stage.key); }
                if (e.key === 'Escape') { setQuickAddStage(null); setQuickAddName(''); }
              }}
              placeholder="Name, phone, email…"
              className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => quickAddSubmit(stage.key)}
                disabled={quickAddSaving || !quickAddName.trim()}
                className="flex-1 h-7 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold disabled:opacity-50 hover:bg-primary/90"
              >
                {quickAddSaving ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : 'Add'}
              </button>
              <button
                onClick={() => { setQuickAddStage(null); setQuickAddName(''); }}
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[9px] text-muted-foreground/70 px-1">Tip: paste "name 9876543210 email@x.com" — auto-splits.</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
          <AnimatePresence initial={false}>
            {items.map(lead => (
              <motion.div key={lead._id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <LeadCard lead={lead} />
              </motion.div>
            ))}
          </AnimatePresence>
          {items.length === 0 && !isAdding && (
            <button
              onClick={() => { setQuickAddStage(stage.key); setQuickAddName(''); }}
              className="h-14 w-full flex items-center justify-center border-2 border-dashed border-border rounded-lg text-[10px] text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors"
            >
              + Add lead here
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── Client Row ────────────────────────────────────────────────────────────
  const ClientRow = ({ c }: { c: any }) => {
    const clientDeals = deals.filter(d => d.clientId === c._id || d.clientId?._id === c._id);
    const totalValue  = clientDeals.reduce((s, d) => s + (d.value || d.amount || 0), 0);
    const lastDeal    = clientDeals[0];
    return (
      <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 rounded-xl transition-colors group">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-primary">{(c.name || c.email || '?')[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
          <p className="text-xs text-muted-foreground truncate">{c.email}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground hidden sm:block">
          <p className="font-medium text-foreground/80">₹{totalValue.toLocaleString('en-IN')}</p>
          <p>{clientDeals.length} deal{clientDeals.length !== 1 ? 's' : ''}</p>
        </div>
        {lastDeal && (
          <span className={`text-[10px] px-2 py-1 rounded-full font-medium hidden md:inline-flex ${
            lastDeal.status === 'paid' ? 'bg-emerald-500/12 text-emerald-700' :
            lastDeal.status === 'overdue' ? 'bg-rose-500/12 text-rose-700' :
            'bg-amber-500/12 text-amber-700'
          }`}>
            {lastDeal.status || 'active'}
          </span>
        )}
        <button
          onClick={() => { setPaymentTarget(c); setPaymentForm({ amount: String(totalValue || ''), dueDate: '', note: '' }); }}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-700 border border-amber-500/25 rounded-lg text-xs font-medium hover:bg-amber-500/20 transition-all"
        >
          <Bell className="h-3 w-3" /> Payment Due
        </button>
      </div>
    );
  };

  // ── Won Deal Row ──────────────────────────────────────────────────────────
  const WonRow = ({ lead }: { lead: any }) => (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 rounded-xl transition-colors group">
      <div className="h-9 w-9 rounded-full bg-emerald-500/12 flex items-center justify-center shrink-0">
        <Trophy className="h-4 w-4 text-emerald-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{lead.name}</p>
        <p className="text-xs text-muted-foreground">{lead.company} {lead.closedAt ? `· Closed ${format(new Date(lead.closedAt), 'dd MMM yyyy')}` : ''}</p>
      </div>
      <p className="text-sm font-bold text-emerald-700 shrink-0">₹{(lead.wonAmount || lead.estimatedValue || 0).toLocaleString('en-IN')}</p>
      <button
        onClick={() => { setPaymentTarget(lead); setPaymentForm({ amount: String(lead.wonAmount || lead.estimatedValue || ''), dueDate: '', note: '' }); }}
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-700 border border-amber-500/25 rounded-lg text-xs font-medium hover:bg-amber-500/20 transition-all"
      >
        <Bell className="h-3 w-3" /> Payment Due
      </button>
    </div>
  );

  return (
    <AppLayout>
      <div className="space-y-5 page-transition-enter">
        {/* Branded hero — same style as employee/admin dashboards */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-border p-5 sm:p-6">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-accent to-primary opacity-90" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                {format(new Date(), 'EEEE · dd MMM yyyy')} · Sales
              </p>
              <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight">
                Sales <span className="text-primary">CRM</span>.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {leads.length} leads · {wonLeads.length} won · <span className="font-semibold text-foreground">₹{pipelineValue.toLocaleString('en-IN')}</span> pipeline
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-center px-4 py-2 rounded-xl border border-border bg-background">
                <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground leading-none">{format(new Date(), 'MMM')}</p>
                <p className="text-2xl font-black text-primary leading-none mt-1">{format(new Date(), 'dd')}</p>
              </div>
              <HuddleQuickPill />
              <button onClick={() => setShowAdd(v => !v)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 shadow-sm">
                <Plus className="h-4 w-4" /> New Lead
              </button>
            </div>
          </div>
        </div>

        {/* Clock-in (Start Day / Break / End Day) */}
        <SessionClockCard />

        {/* Today's clients — sales reps' own scheduled clients with quick
            mark-done. Hidden when nothing's scheduled. */}
        <TodayClientsCard />

        {/* Google Sheets auto-import — admin connects, sales sees status */}
        <SheetConnectCard />

        {/* Live view of the connected Meta-linked sheet — formatted nicely,
            grouped by date, expandable rows for the full campaign context.
            Hidden automatically until a sheet is connected. */}
        <LiveSheetSection />

        {/* KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pipeline Value', value: `₹${pipelineValue.toLocaleString('en-IN')}`, color: 'text-primary',     bg: 'bg-primary/5',   icon: IndianRupee },
            { label: 'Won Revenue',    value: `₹${wonValue.toLocaleString('en-IN')}`,       color: 'text-emerald-700',  bg: 'bg-emerald-500/10',    icon: Trophy },
            { label: 'Total Leads',    value: String(leads.length),                          color: 'text-foreground',   bg: 'bg-muted/30',     icon: Users },
            { label: 'Conversion',     value: `${leads.length ? Math.round((wonLeads.length / leads.length) * 100) : 0}%`, color: 'text-amber-700', bg: 'bg-amber-50', icon: TrendingUp },
          ].map(k => (
            <div key={k.label} className={`${k.bg} border border-border rounded-2xl px-4 py-3 flex items-center gap-3`}>
              <k.icon className={`h-5 w-5 ${k.color} opacity-70`} />
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
          {([
            ['pipeline', 'Pipeline', LayoutDashboard],
            ['list',     'All leads · list', List],
            ['clients',  'Clients',  Building2],
            ['won',      'Won Deals', Trophy],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground/80'
              }`}>
              <Icon className="h-3.5 w-3.5" />{label}
              {key === 'won' && wonLeads.length > 0 && (
                <span className="bg-emerald-500/12 text-emerald-700 text-[10px] font-bold px-1.5 rounded-full">{wonLeads.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* New Lead Form */}
        <AnimatePresence>
          {showAdd && (
            <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              onSubmit={createLead} className="bg-card border border-primary/20 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-sm text-foreground">Add New Lead</p>
                <button type="button" onClick={() => setShowAdd(false)}><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { field: 'name',    placeholder: 'Full name *', required: true },
                  { field: 'contact', placeholder: 'Phone number' },
                  { field: 'email',   placeholder: 'Email' },
                  { field: 'company', placeholder: 'Company name' },
                ].map(f => (
                  <input key={f.field} value={(form as any)[f.field]} required={f.required}
                    onChange={e => setForm(p => ({ ...p, [f.field]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                ))}
                <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))}
                  className="px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm">
                  {['inbound','outbound','referral','cold_call','website','social','other'].map(s => (
                    <option key={s} value={s}>{s.replace('_',' ')}</option>
                  ))}
                </select>
                <input type="number" value={form.estimatedValue} placeholder="Est. value (₹)"
                  onChange={e => setForm(p => ({ ...p, estimatedValue: e.target.value }))}
                  className="px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <button type="submit" disabled={saving || !form.name}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create Lead
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Subtle inline indicator when a background refresh is happening
            (CRUD action + 30s poll). Keeps the dashboard visible — no
            full-screen spinner flash. */}
        {refreshing && (
          <div className="flex items-center justify-center text-[10px] text-muted-foreground gap-1 -mt-1">
            <Loader2 className="h-3 w-3 animate-spin" /> refreshing
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* ── PIPELINE TAB ── */}
            {tab === 'pipeline' && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">📊 Pipeline</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {PIPELINE_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">💼 Sales Follow-Through</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {SALES_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">🏁 Outcomes</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {OUTCOME_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
                  </div>
                </div>
              </div>
            )}

            {/* ── LIST VIEW ── one row per lead, stage clearly visible.
                Designed for "where is X right now?" scanning. Searchable. */}
            {tab === 'list' && (
              <LeadListView
                leads={leads}
                onView={(l) => setViewLead(l)}
                onMove={(id, stage) => moveLeadStage(id, stage)}
                stageMeta={ALL_STAGES}
              />
            )}

            {/* ── CLIENTS TAB ── */}
            {tab === 'clients' && (
              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="font-semibold text-sm text-foreground">All Clients ({clients.length})</p>
                  <p className="text-xs text-muted-foreground">Hover a row → Payment Due button appears</p>
                </div>
                {clients.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground/60">
                    <Building2 className="h-10 w-10" />
                    <p className="text-sm">No clients found</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50 p-2">
                    {clients.map(c => <ClientRow key={c._id} c={c} />)}
                  </div>
                )}
              </div>
            )}

            {/* ── WON DEALS TAB ── */}
            {tab === 'won' && (
              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="font-semibold text-sm text-foreground">
                    Won Deals ({wonLeads.length}) · ₹{wonValue.toLocaleString('en-IN')} total
                  </p>
                  <p className="text-xs text-muted-foreground">Hover → Payment Due alert</p>
                </div>
                {wonLeads.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground/60">
                    <Trophy className="h-10 w-10" />
                    <p className="text-sm">No won deals yet — keep going! 💪</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50 p-2">
                    {wonLeads.map(l => <WonRow key={l._id} lead={l} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Lead Detail Modal ── */}
        <AnimatePresence>
          {viewLead ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={e => { if (e.target === e.currentTarget) setViewLead(null); }}>
              <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-lg text-foreground">{viewLead.name}</h2>
                    {viewLead.company && <p className="text-sm text-muted-foreground">{viewLead.company}</p>}
                  </div>
                  <button onClick={() => setViewLead(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                </div>
                <div className="space-y-2 text-sm text-foreground/80">
                  {viewLead.contact && <p>📱 {viewLead.contact}</p>}
                  {viewLead.email   && <p>✉️ {viewLead.email}</p>}
                  <p>🎯 Stage: <span className="font-semibold capitalize">{(viewLead.stage||viewLead.status||'new_lead').replace(/_/g,' ')}</span></p>
                  {viewLead.estimatedValue > 0 && <p>💰 Value: <span className="font-semibold text-emerald-700">₹{viewLead.estimatedValue.toLocaleString('en-IN')}</span></p>}
                  {viewLead.source && <p>📣 Source: <span className="capitalize">{viewLead.source.replace(/_/g,' ')}</span></p>}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Move to stage</p>
                  <select defaultValue={viewLead.stage || viewLead.status}
                    onChange={async e => {
                      const stage = e.target.value;
                      if (stage === 'won') {
                        setOnboardLead(viewLead);
                        setOnboardForm({ clientName: viewLead.name || '', email: viewLead.email || '', password: '', services: [], projectType: 'combined', servicesDescription: '' });
                        setViewLead(null);
                        return;
                      }
                      await api.updateLead(viewLead._id, { stage, status: stage });
                      toast.success('Stage updated'); setViewLead(null); load();
                    }}
                    className="w-full px-3 py-2 bg-muted/30 border border-border rounded-xl text-sm">
                    {ALL_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => { setViewLead(null); setPaymentTarget(viewLead); setPaymentForm({ amount: String(viewLead.estimatedValue||''), dueDate: '', note: '' }); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500/10 text-amber-700 border border-amber-500/25 rounded-xl text-sm font-medium hover:bg-amber-500/20 transition-all">
                  <Bell className="h-4 w-4" /> Raise Payment Due Alert
                </button>
              </motion.div>
            </motion.div>
          ) : onboardLead ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
              onClick={e => { if (e.target === e.currentTarget) setOnboardLead(null); }}>
              <motion.form initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                onSubmit={handleOnboardClient}
                className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl my-8">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-xl text-emerald-700 inline-flex items-center gap-2"><Trophy className="h-5 w-5" /> Deal Won! Onboard Client</h2>
                    <p className="text-sm text-muted-foreground">Create client portal & set up projects/services</p>
                  </div>
                  <button type="button" onClick={() => setOnboardLead(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="col-span-2 sm:col-span-1 border rounded-xl p-3 bg-muted/30 space-y-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Client Details</p>
                    <input required value={onboardForm.clientName} onChange={e => setOnboardForm(p => ({ ...p, clientName: e.target.value }))} placeholder="Client Name" className="w-full text-sm p-2 border rounded-lg bg-card" />
                    <input required type="email" value={onboardForm.email} onChange={e => setOnboardForm(p => ({ ...p, email: e.target.value }))} placeholder="Client Email" className="w-full text-sm p-2 border rounded-lg bg-card" />
                    <input value={onboardForm.password} onChange={e => setOnboardForm(p => ({ ...p, password: e.target.value }))} placeholder="Set Password (opt)" className="w-full text-sm p-2 border rounded-lg bg-card" />
                  </div>
                  <div className="col-span-2 sm:col-span-1 border rounded-xl p-3 bg-muted/30 space-y-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Services</p>
                    <select value={onboardForm.projectType} onChange={e => setOnboardForm(p => ({ ...p, projectType: e.target.value }))} className="w-full text-sm p-2 border rounded-lg bg-card">
                      <option value="ads">Ads (Meta/Google)</option>
                      <option value="website">Website Dev</option>
                      <option value="combined">Combined / Both</option>
                      <option value="seo">SEO</option>
                      <option value="social">Social Media</option>
                    </select>
                    <div>
                        {['Meta Ads', 'Google Ads', 'Shopify', 'WordPress', 'SEO', 'Creative'].map(svc => (
                            <label key={svc} className="flex items-center gap-2 text-xs mb-1">
                                <input type="checkbox" checked={onboardForm.services.includes(svc)} onChange={e => {
                                    if(e.target.checked) setOnboardForm(p => ({...p, services: [...p.services, svc]}));
                                    else setOnboardForm(p => ({...p, services: p.services.filter(s => s !== svc)}));
                                }} /> {svc}
                            </label>
                        ))}
                    </div>
                  </div>
                  <div className="col-span-2 text-sm">
                      <textarea value={onboardForm.servicesDescription} onChange={e => setOnboardForm(p => ({...p, servicesDescription: e.target.value}))} placeholder="Specific instructions for delivery team... (e.g. Needs 5 creatives per week, focus on ROAS)" className="w-full p-2 border rounded-lg bg-muted/30 flex-1 resize-none h-20" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button type="button" onClick={() => setOnboardLead(null)} className="flex-1 py-2 text-muted-foreground font-medium text-sm">Cancel</button>
                  <button type="submit" disabled={onboarding || !onboardForm.email} className="flex-2 py-2 px-4 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2 flex-grow">
                    {onboarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} Create Client & Handover
                  </button>
                </div>
              </motion.form>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ── Payment Due Modal ── */}
        <AnimatePresence>
          {paymentTarget && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={e => { if (e.target === e.currentTarget) setPaymentTarget(null); }}>
              <motion.form initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                onSubmit={sendPaymentDue}
                className="bg-card border border-amber-500/25 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-8 w-8 rounded-full bg-amber-500/15 flex items-center justify-center">
                        <Bell className="h-4 w-4 text-amber-700" />
                      </div>
                      <h2 className="font-bold text-foreground">Payment Due Alert</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">Notify: <span className="font-medium text-foreground">{paymentTarget.name || paymentTarget.company}</span></p>
                  </div>
                  <button type="button" onClick={() => setPaymentTarget(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Amount Due (₹)</label>
                    <input type="number" required value={paymentForm.amount}
                      onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))}
                      placeholder="e.g. 50000"
                      className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Due Date</label>
                    <input type="date" required value={paymentForm.dueDate}
                      onChange={e => setPaymentForm(p => ({ ...p, dueDate: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Note (optional)</label>
                    <textarea value={paymentForm.note} rows={2}
                      onChange={e => setPaymentForm(p => ({ ...p, note: e.target.value }))}
                      placeholder="Invoice #, services included…"
                      className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                </div>
                <button type="submit" disabled={sendingPayment || !paymentForm.amount || !paymentForm.dueDate}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-all shadow-md">
                  {sendingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                  Send Payment Due Alert
                </button>
              </motion.form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
