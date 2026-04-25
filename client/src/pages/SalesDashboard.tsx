import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, UserCheck, Calendar, Presentation, CheckCheck,
  TrendingUp, Repeat, Flame, ChefHat, Trophy, XCircle,
  Plus, IndianRupee, Loader2, X, Users, Bell, BadgeCheck,
  AlertCircle, Clock, Building2, LayoutDashboard, ChevronDown
} from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ── Stage Config ──────────────────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { key: 'new_lead',         label: 'New Lead',         icon: Phone,        color: 'border-t-blue-500',    bg: 'bg-blue-50',     text: 'text-blue-600'   },
  { key: 'dialed',           label: 'Dialed',           icon: Phone,        color: 'border-t-purple-500',  bg: 'bg-purple-50',   text: 'text-purple-600' },
  { key: 'connected',        label: 'Connected',        icon: UserCheck,    color: 'border-t-indigo-500',  bg: 'bg-indigo-50',   text: 'text-indigo-600' },
  { key: 'demo_booked',      label: 'Demo Booked',      icon: Calendar,     color: 'border-t-amber-500',   bg: 'bg-amber-50',    text: 'text-amber-600'  },
  { key: 'demo_done',        label: 'Demo Done',        icon: Presentation, color: 'border-t-orange-500',  bg: 'bg-orange-50',   text: 'text-orange-600' },
  { key: 'demo2_conversion', label: 'Demo2 Conversion', icon: TrendingUp,   color: 'border-t-violet-500',  bg: 'bg-violet-50',   text: 'text-violet-600' },
] as const;

const SALES_STAGES = [
  { key: 'follow_up',    label: 'Follow Up',    icon: Repeat,   color: 'border-t-sky-500',     bg: 'bg-sky-50',      text: 'text-sky-600'     },
  { key: 'hot_follow_up',label: 'Hot Follow Up',icon: Flame,    color: 'border-t-red-500',     bg: 'bg-red-50',      text: 'text-red-600'     },
  { key: 'cooking',      label: 'Cooking',      icon: ChefHat,  color: 'border-t-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-600' },
] as const;

const OUTCOME_STAGES = [
  { key: 'won',  label: 'Sale Won',  icon: Trophy,   color: 'border-t-green-500', bg: 'bg-green-50',  text: 'text-green-600'  },
  { key: 'lost', label: 'Sale Lost', icon: XCircle,  color: 'border-t-gray-400',  bg: 'bg-gray-50',   text: 'text-gray-500'   },
] as const;

const ALL_STAGES = [...PIPELINE_STAGES, ...SALES_STAGES, ...OUTCOME_STAGES];
const EMPTY_FORM = { name: '', contact: '', email: '', company: '', source: 'other', estimatedValue: '' };

type Tab = 'pipeline' | 'clients' | 'won';

export default function SalesDashboard() {
  const [tab, setTab]         = useState<Tab>('pipeline');
  const [leads, setLeads]     = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [deals, setDeals]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, u, d] = await Promise.all([
        api.listLeads({}),
        api.listUsers({ role: 'client' }),
        api.listDeals(),
      ]);
      setLeads(Array.isArray(l) ? l : []);
      setClients(Array.isArray(u) ? u : []);
      setDeals(Array.isArray(d) ? d : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

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
      await api.createLead({ ...form, stage: 'new_lead', estimatedValue: Number(form.estimatedValue) || 0 });
      toast.success('Lead created!');
      setForm({ ...EMPTY_FORM }); setShowAdd(false); load();
    } catch { toast.error('Failed to create lead'); }
    finally { setSaving(false); }
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

  // ── Lead Card ─────────────────────────────────────────────────────────────
  const LeadCard = ({ lead }: { lead: any }) => (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('leadId', lead._id); setDragging(lead._id); }}
      onDragEnd={() => setDragging(null)}
      onClick={() => setViewLead(lead)}
      className={`bg-white border border-gray-100 rounded-xl p-3 cursor-grab active:cursor-grabbing space-y-1.5 group hover:border-primary/40 hover:shadow-sm transition-all ${dragging === lead._id ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-gray-800 line-clamp-1">{lead.name}</p>
        {lead.estimatedValue > 0 && <span className="text-[10px] text-emerald-600 font-medium shrink-0">₹{lead.estimatedValue.toLocaleString('en-IN')}</span>}
      </div>
      {lead.company && <p className="text-[10px] text-gray-500">{lead.company}</p>}
      <div className="flex items-center gap-1.5 flex-wrap">
        {lead.source && <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded capitalize">{lead.source.replace('_',' ')}</span>}
        {lead.contact && <span className="text-[9px] text-gray-400">{lead.contact}</span>}
      </div>
    </div>
  );

  // ── Kanban Column ─────────────────────────────────────────────────────────
  const Column = ({ stage }: { stage: typeof ALL_STAGES[number] }) => {
    const Icon = stage.icon;
    const items = byStage(stage.key);
    const stageValue = items.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    return (
      <div
        className={`bg-card border-t-2 ${stage.color} border border-gray-100 rounded-2xl flex flex-col min-w-[195px] max-h-[calc(100vh-300px)] shadow-sm`}
        onDragOver={e => e.preventDefault()}
        onDrop={e => handleDrop(e, stage.key)}
      >
        <div className="px-3 py-2.5 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <div className={`h-6 w-6 rounded-lg flex items-center justify-center ${stage.bg}`}>
              <Icon className={`h-3.5 w-3.5 ${stage.text}`} />
            </div>
            <p className="text-xs font-semibold text-gray-700 flex-1 truncate">{stage.label}</p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${stage.bg} ${stage.text}`}>{items.length}</span>
          </div>
          {stageValue > 0 && (
            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-0.5">
              <IndianRupee className="h-2.5 w-2.5" />{stageValue.toLocaleString('en-IN')}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
          <AnimatePresence initial={false}>
            {items.map(lead => (
              <motion.div key={lead._id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <LeadCard lead={lead} />
              </motion.div>
            ))}
          </AnimatePresence>
          {items.length === 0 && (
            <div className="h-14 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-xl">
              <p className="text-[10px] text-gray-300">Drop here</p>
            </div>
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
      <div className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors group">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-primary">{(c.name || c.email || '?')[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
          <p className="text-xs text-gray-400 truncate">{c.email}</p>
        </div>
        <div className="text-right text-xs text-gray-500 hidden sm:block">
          <p className="font-medium text-gray-700">₹{totalValue.toLocaleString('en-IN')}</p>
          <p>{clientDeals.length} deal{clientDeals.length !== 1 ? 's' : ''}</p>
        </div>
        {lastDeal && (
          <span className={`text-[10px] px-2 py-1 rounded-full font-medium hidden md:inline-flex ${
            lastDeal.status === 'paid' ? 'bg-green-100 text-green-700' :
            lastDeal.status === 'overdue' ? 'bg-red-100 text-red-700' :
            'bg-amber-100 text-amber-700'
          }`}>
            {lastDeal.status || 'active'}
          </span>
        )}
        <button
          onClick={() => { setPaymentTarget(c); setPaymentForm({ amount: String(totalValue || ''), dueDate: '', note: '' }); }}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100 transition-all"
        >
          <Bell className="h-3 w-3" /> Payment Due
        </button>
      </div>
    );
  };

  // ── Won Deal Row ──────────────────────────────────────────────────────────
  const WonRow = ({ lead }: { lead: any }) => (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors group">
      <div className="h-9 w-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
        <Trophy className="h-4 w-4 text-green-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{lead.name}</p>
        <p className="text-xs text-gray-400">{lead.company} {lead.closedAt ? `· Closed ${format(new Date(lead.closedAt), 'dd MMM yyyy')}` : ''}</p>
      </div>
      <p className="text-sm font-bold text-green-600 shrink-0">₹{(lead.wonAmount || lead.estimatedValue || 0).toLocaleString('en-IN')}</p>
      <button
        onClick={() => { setPaymentTarget(lead); setPaymentForm({ amount: String(lead.wonAmount || lead.estimatedValue || ''), dueDate: '', note: '' }); }}
        className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100 transition-all"
      >
        <Bell className="h-3 w-3" /> Payment Due
      </button>
    </div>
  );

  return (
    <AppLayout>
      <div className="space-y-5 page-transition-enter">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales CRM</h1>
            <p className="text-sm text-gray-500">
              {leads.length} leads · {wonLeads.length} won · ₹{pipelineValue.toLocaleString('en-IN')} pipeline
            </p>
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 shadow-sm">
            <Plus className="h-4 w-4" /> New Lead
          </button>
        </div>

        {/* KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pipeline Value', value: `₹${pipelineValue.toLocaleString('en-IN')}`, color: 'text-primary',     bg: 'bg-primary/5',   icon: IndianRupee },
            { label: 'Won Revenue',    value: `₹${wonValue.toLocaleString('en-IN')}`,       color: 'text-green-600',  bg: 'bg-green-50',    icon: Trophy },
            { label: 'Total Leads',    value: String(leads.length),                          color: 'text-gray-900',   bg: 'bg-gray-50',     icon: Users },
            { label: 'Conversion',     value: `${leads.length ? Math.round((wonLeads.length / leads.length) * 100) : 0}%`, color: 'text-amber-600', bg: 'bg-amber-50', icon: TrendingUp },
          ].map(k => (
            <div key={k.label} className={`${k.bg} border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3`}>
              <k.icon className={`h-5 w-5 ${k.color} opacity-70`} />
              <div>
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {([
            ['pipeline', 'Pipeline', LayoutDashboard],
            ['clients',  'Clients',  Building2],
            ['won',      'Won Deals', Trophy],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon className="h-3.5 w-3.5" />{label}
              {key === 'won' && wonLeads.length > 0 && (
                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 rounded-full">{wonLeads.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* New Lead Form */}
        <AnimatePresence>
          {showAdd && (
            <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              onSubmit={createLead} className="bg-white border border-primary/20 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-sm text-gray-800">Add New Lead</p>
                <button type="button" onClick={() => setShowAdd(false)}><X className="h-4 w-4 text-gray-400" /></button>
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
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                ))}
                <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))}
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm">
                  {['inbound','outbound','referral','cold_call','website','social','other'].map(s => (
                    <option key={s} value={s}>{s.replace('_',' ')}</option>
                  ))}
                </select>
                <input type="number" value={form.estimatedValue} placeholder="Est. value (₹)"
                  onChange={e => setForm(p => ({ ...p, estimatedValue: e.target.value }))}
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <button type="submit" disabled={saving || !form.name}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create Lead
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* ── PIPELINE TAB ── */}
            {tab === 'pipeline' && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">📊 Pipeline</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {PIPELINE_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">💼 Sales Follow-Through</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {SALES_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">🏁 Outcomes</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {OUTCOME_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
                  </div>
                </div>
              </div>
            )}

            {/* ── CLIENTS TAB ── */}
            {tab === 'clients' && (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <p className="font-semibold text-sm text-gray-800">All Clients ({clients.length})</p>
                  <p className="text-xs text-gray-400">Hover a row → Payment Due button appears</p>
                </div>
                {clients.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-gray-300">
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
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <p className="font-semibold text-sm text-gray-800">
                    Won Deals ({wonLeads.length}) · ₹{wonValue.toLocaleString('en-IN')} total
                  </p>
                  <p className="text-xs text-gray-400">Hover → Payment Due alert</p>
                </div>
                {wonLeads.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-gray-300">
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
                className="bg-white border border-gray-100 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-lg text-gray-900">{viewLead.name}</h2>
                    {viewLead.company && <p className="text-sm text-gray-400">{viewLead.company}</p>}
                  </div>
                  <button onClick={() => setViewLead(null)}><X className="h-4 w-4 text-gray-400" /></button>
                </div>
                <div className="space-y-2 text-sm text-gray-700">
                  {viewLead.contact && <p>📱 {viewLead.contact}</p>}
                  {viewLead.email   && <p>✉️ {viewLead.email}</p>}
                  <p>🎯 Stage: <span className="font-semibold capitalize">{(viewLead.stage||viewLead.status||'new_lead').replace(/_/g,' ')}</span></p>
                  {viewLead.estimatedValue > 0 && <p>💰 Value: <span className="font-semibold text-green-600">₹{viewLead.estimatedValue.toLocaleString('en-IN')}</span></p>}
                  {viewLead.source && <p>📣 Source: <span className="capitalize">{viewLead.source.replace(/_/g,' ')}</span></p>}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase">Move to stage</p>
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
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm">
                    {ALL_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => { setViewLead(null); setPaymentTarget(viewLead); setPaymentForm({ amount: String(viewLead.estimatedValue||''), dueDate: '', note: '' }); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm font-medium hover:bg-amber-100 transition-all">
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
                className="bg-white border border-gray-100 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl my-8">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-xl text-green-700 inline-flex items-center gap-2"><Trophy className="h-5 w-5" /> Deal Won! Onboard Client</h2>
                    <p className="text-sm text-gray-500">Create client portal & set up projects/services</p>
                  </div>
                  <button type="button" onClick={() => setOnboardLead(null)}><X className="h-4 w-4 text-gray-400" /></button>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="col-span-2 sm:col-span-1 border rounded-xl p-3 bg-gray-50 space-y-2">
                    <p className="text-xs font-semibold uppercase text-gray-500">Client Details</p>
                    <input required value={onboardForm.clientName} onChange={e => setOnboardForm(p => ({ ...p, clientName: e.target.value }))} placeholder="Client Name" className="w-full text-sm p-2 border rounded-lg bg-white" />
                    <input required type="email" value={onboardForm.email} onChange={e => setOnboardForm(p => ({ ...p, email: e.target.value }))} placeholder="Client Email" className="w-full text-sm p-2 border rounded-lg bg-white" />
                    <input value={onboardForm.password} onChange={e => setOnboardForm(p => ({ ...p, password: e.target.value }))} placeholder="Set Password (opt)" className="w-full text-sm p-2 border rounded-lg bg-white" />
                  </div>
                  <div className="col-span-2 sm:col-span-1 border rounded-xl p-3 bg-gray-50 space-y-2">
                    <p className="text-xs font-semibold uppercase text-gray-500">Services</p>
                    <select value={onboardForm.projectType} onChange={e => setOnboardForm(p => ({ ...p, projectType: e.target.value }))} className="w-full text-sm p-2 border rounded-lg bg-white">
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
                      <textarea value={onboardForm.servicesDescription} onChange={e => setOnboardForm(p => ({...p, servicesDescription: e.target.value}))} placeholder="Specific instructions for delivery team... (e.g. Needs 5 creatives per week, focus on ROAS)" className="w-full p-2 border rounded-lg bg-gray-50 flex-1 resize-none h-20" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button type="button" onClick={() => setOnboardLead(null)} className="flex-1 py-2 text-gray-500 font-medium text-sm">Cancel</button>
                  <button type="submit" disabled={onboarding || !onboardForm.email} className="flex-2 py-2 px-4 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 flex-grow">
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
                className="bg-white border border-amber-100 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
                        <Bell className="h-4 w-4 text-amber-600" />
                      </div>
                      <h2 className="font-bold text-gray-900">Payment Due Alert</h2>
                    </div>
                    <p className="text-sm text-gray-500">Notify: <span className="font-medium text-gray-800">{paymentTarget.name || paymentTarget.company}</span></p>
                  </div>
                  <button type="button" onClick={() => setPaymentTarget(null)}><X className="h-4 w-4 text-gray-400" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Amount Due (₹)</label>
                    <input type="number" required value={paymentForm.amount}
                      onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))}
                      placeholder="e.g. 50000"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Due Date</label>
                    <input type="date" required value={paymentForm.dueDate}
                      onChange={e => setPaymentForm(p => ({ ...p, dueDate: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Note (optional)</label>
                    <textarea value={paymentForm.note} rows={2}
                      onChange={e => setPaymentForm(p => ({ ...p, note: e.target.value }))}
                      placeholder="Invoice #, services included…"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                </div>
                <button type="submit" disabled={sendingPayment || !paymentForm.amount || !paymentForm.dueDate}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-all shadow-md shadow-amber-200">
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
