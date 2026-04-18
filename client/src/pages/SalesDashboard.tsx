import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, UserCheck, Calendar, Presentation, CheckCheck,
  TrendingUp, Repeat, Flame, ChefHat, Trophy, XCircle,
  Plus, ChevronRight, IndianRupee, Loader2, X
} from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';

// ── Stage Config ────────────────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { key: 'new_lead',          label: 'New Lead',         icon: Phone,        color: 'border-t-blue-500',     bg: 'bg-blue-500/10',   text: 'text-blue-400'   },
  { key: 'dialed',            label: 'Dialed',           icon: Phone,        color: 'border-t-purple-500',   bg: 'bg-purple-500/10', text: 'text-purple-400' },
  { key: 'connected',         label: 'Connected',        icon: UserCheck,    color: 'border-t-indigo-500',   bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
  { key: 'demo_booked',       label: 'Demo Booked',      icon: Calendar,     color: 'border-t-amber-500',    bg: 'bg-amber-500/10',  text: 'text-amber-400'  },
  { key: 'demo_done',         label: 'Demo Done',        icon: Presentation, color: 'border-t-orange-500',   bg: 'bg-orange-500/10', text: 'text-orange-400' },
  { key: 'demo2_conversion',  label: 'Demo2 Conversion', icon: RepeatIcon,   color: 'border-t-violet-500',   bg: 'bg-violet-500/10', text: 'text-violet-400' },
] as const;

const SALES_STAGES = [
  { key: 'follow_up',         label: 'Follow Up',        icon: Repeat,       color: 'border-t-sky-500',      bg: 'bg-sky-500/10',    text: 'text-sky-400'    },
  { key: 'hot_follow_up',     label: 'Hot Follow Up',    icon: Flame,        color: 'border-t-red-500',      bg: 'bg-red-500/10',    text: 'text-red-400'    },
  { key: 'cooking',           label: 'Cooking',          icon: ChefHat,      color: 'border-t-emerald-500',  bg: 'bg-emerald-500/10',text: 'text-emerald-400'},
] as const;

const OUTCOME_STAGES = [
  { key: 'won',  label: 'Sale Won',  icon: Trophy,   color: 'border-t-green-500', bg: 'bg-green-500/10',  text: 'text-green-400'  },
  { key: 'lost', label: 'Sale Lost', icon: XCircle,  color: 'border-t-gray-500',  bg: 'bg-gray-500/10',   text: 'text-gray-400'   },
] as const;

const ALL_STAGES = [...PIPELINE_STAGES, ...SALES_STAGES, ...OUTCOME_STAGES];

// icon workaround
function RepeatIcon(p: any) { return <Repeat {...p} />; }

const STAGE_KEYS = ALL_STAGES.map(s => s.key);

// ── New Lead Form ────────────────────────────────────────────────────────────
const EMPTY_FORM = { name: '', contact: '', email: '', company: '', source: 'other', estimatedValue: '' };

export default function SalesDashboard() {
  const [leads, setLeads]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [saving, setSaving]     = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [viewLead, setViewLead] = useState<any | null>(null);

  const load = async () => {
    const data = await api.listLeads({});
    setLeads(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const byStage = (key: string) => leads.filter(l => (l.stage || l.status) === key);

  const pipelineValue = leads
    .filter(l => !['won','lost'].includes(l.stage || l.status))
    .reduce((s, l) => s + (l.estimatedValue || 0), 0);

  const wonValue = leads.filter(l => (l.stage || l.status) === 'won').reduce((s, l) => s + (l.wonAmount || l.estimatedValue || 0), 0);

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('leadId');
    if (!id) return;
    setLeads(prev => prev.map(l => l._id === id ? { ...l, stage: targetStage, status: targetStage } : l));
    try {
      await api.updateLead(id, { stage: targetStage, status: targetStage, ...(targetStage === 'won' ? { closedAt: new Date() } : {}) });
    } catch { toast.error('Failed to update stage'); load(); }
    setDragging(null);
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

  const LeadCard = ({ lead }: { lead: any }) => {
    const val = lead.estimatedValue || 0;
    return (
      <div
        draggable
        onDragStart={e => { e.dataTransfer.setData('leadId', lead._id); setDragging(lead._id); }}
        onDragEnd={() => setDragging(null)}
        onClick={() => setViewLead(lead)}
        className={`bg-background border border-border/60 rounded-xl p-3 cursor-grab active:cursor-grabbing space-y-2 group hover:border-primary/40 transition-all ${dragging === lead._id ? 'opacity-40' : ''}`}
      >
        <div className="flex items-start justify-between gap-1">
          <p className="text-xs font-semibold line-clamp-1">{lead.name}</p>
          {val > 0 && <span className="text-[10px] text-emerald-400 shrink-0">₹{val.toLocaleString('en-IN')}</span>}
        </div>
        {lead.company && <p className="text-[10px] text-muted-foreground">{lead.company}</p>}
        <div className="flex items-center gap-1.5 flex-wrap">
          {lead.source && <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded capitalize">{lead.source.replace('_',' ')}</span>}
          {lead.contact && <span className="text-[9px] text-muted-foreground">{lead.contact}</span>}
        </div>
      </div>
    );
  };

  const Column = ({ stage }: { stage: typeof ALL_STAGES[number] }) => {
    const Icon = stage.icon;
    const items = byStage(stage.key);
    const stageValue = items.reduce((s,l) => s+(l.estimatedValue||0), 0);
    return (
      <div
        className={`bg-card border-t-2 ${stage.color} border-x border-b border-border rounded-2xl flex flex-col min-w-[200px] max-h-[calc(100vh-240px)]`}
        onDragOver={e => e.preventDefault()}
        onDrop={e => handleDrop(e, stage.key)}
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className={`h-6 w-6 rounded-lg flex items-center justify-center ${stage.bg}`}>
              <Icon className={`h-3.5 w-3.5 ${stage.text}`} />
            </div>
            <p className="text-xs font-semibold flex-1 truncate">{stage.label}</p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${stage.bg} ${stage.text}`}>{items.length}</span>
          </div>
          {stageValue > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5">
              <IndianRupee className="h-2.5 w-2.5" />{stageValue.toLocaleString('en-IN')}
            </p>
          )}
        </div>
        {/* Cards */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
          <AnimatePresence initial={false}>
            {items.map(lead => (
              <motion.div key={lead._id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <LeadCard lead={lead} />
              </motion.div>
            ))}
          </AnimatePresence>
          {items.length === 0 && (
            <div className="h-16 flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl">
              <p className="text-[10px] text-muted-foreground/40">Drop here</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-transition-enter h-full">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Sales CRM</h1>
            <p className="text-sm text-muted-foreground">Drag cards to move leads through the pipeline</p>
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 shadow-lg shadow-primary/20">
            <Plus className="h-4 w-4" /> New Lead
          </button>
        </div>

        {/* KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pipeline Value', value: `₹${pipelineValue.toLocaleString('en-IN')}`, color: 'text-primary' },
            { label: 'Won Revenue',    value: `₹${wonValue.toLocaleString('en-IN')}`,      color: 'text-green-400' },
            { label: 'Total Leads',    value: leads.length,                                 color: 'text-foreground' },
            { label: 'Conversion',     value: `${leads.length ? Math.round((byStage('won').length / leads.length) * 100) : 0}%`, color: 'text-amber-400' },
          ].map(k => (
            <div key={k.label} className="bg-card border border-border rounded-2xl px-4 py-3">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* New Lead Form */}
        <AnimatePresence>
          {showAdd && (
            <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              onSubmit={createLead} className="bg-card border border-primary/30 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-sm">Add New Lead</p>
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
                    className="px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                ))}
                <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))}
                  className="px-3 py-2 bg-background border border-input rounded-xl text-sm">
                  {['inbound','outbound','referral','cold_call','website','social','other'].map(s => (
                    <option key={s} value={s}>{s.replace('_',' ')}</option>
                  ))}
                </select>
                <input type="number" value={form.estimatedValue} placeholder="Est. value (₹)"
                  onChange={e => setForm(p => ({ ...p, estimatedValue: e.target.value }))}
                  className="px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <button type="submit" disabled={saving || !form.name}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create Lead
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">
            {/* Section: Pipeline */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">📊 Pipeline Stages</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {PIPELINE_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
              </div>
            </div>

            {/* Section: Sales */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">💼 Sales Follow-Through</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {SALES_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
              </div>
            </div>

            {/* Section: Outcomes */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">🏁 Outcomes</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {OUTCOME_STAGES.map(s => <Column key={s.key} stage={s as any} />)}
              </div>
            </div>
          </div>
        )}

        {/* Lead Detail Modal */}
        <AnimatePresence>
          {viewLead && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={e => { if (e.target === e.currentTarget) setViewLead(null); }}>
              <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-bold text-lg">{viewLead.name}</h2>
                    {viewLead.company && <p className="text-sm text-muted-foreground">{viewLead.company}</p>}
                  </div>
                  <button onClick={() => setViewLead(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                </div>
                <div className="space-y-2 text-sm">
                  {viewLead.contact && <p>📱 {viewLead.contact}</p>}
                  {viewLead.email   && <p>✉️ {viewLead.email}</p>}
                  <p>🎯 Stage: <span className="font-semibold capitalize">{(viewLead.stage||viewLead.status||'new_lead').replace(/_/g,' ')}</span></p>
                  {viewLead.estimatedValue > 0 && <p>💰 Value: ₹{viewLead.estimatedValue.toLocaleString('en-IN')}</p>}
                  {viewLead.source && <p>📣 Source: <span className="capitalize">{viewLead.source.replace(/_/g,' ')}</span></p>}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Move to stage</p>
                  <select defaultValue={viewLead.stage || viewLead.status}
                    onChange={async e => {
                      const stage = e.target.value;
                      await api.updateLead(viewLead._id, { stage, status: stage });
                      toast.success('Stage updated'); setViewLead(null); load();
                    }}
                    className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm">
                    {ALL_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
