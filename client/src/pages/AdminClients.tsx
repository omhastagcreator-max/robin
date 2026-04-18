import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Briefcase, Plus, X, Loader2, Trophy,
  Eye, EyeOff, Users, ArrowRight, CheckCircle2, Mail,
  Phone, Copy, RefreshCw, IndianRupee, UserPlus, Star
} from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';

// ── Helpers ───────────────────────────────────────────────────────────────────
function genPassword(name: string) {
  const clean = name.replace(/\s+/g, '').slice(0, 6);
  return `${clean}@${Math.floor(1000 + Math.random() * 9000)}`;
}

// ── Create Client Modal ───────────────────────────────────────────────────────
function CreateClientModal({
  onClose, onCreated, prefill, fromLead,
}: {
  onClose: () => void;
  onCreated: (result: any) => void;
  prefill?: { name?: string; email?: string; phone?: string; company?: string; fromLeadId?: string; wonAmount?: number };
  fromLead?: boolean;
}) {
  const [form, setForm] = useState({
    name:    prefill?.name    || '',
    email:   prefill?.email   || '',
    phone:   prefill?.phone   || '',
    company: prefill?.company || '',
    password: prefill?.name ? genPassword(prefill.name) : '',
  });
  const [showPw, setShowPw]   = useState(true);
  const [saving, setSaving]   = useState(false);
  const [done, setDone]       = useState<any>(null);

  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await api.createUser({
        name:       form.name,
        email:      form.email,
        password:   form.password,
        phone:      form.phone,
        company:    form.company,
        role:       'client',
        fromLeadId: prefill?.fromLeadId,
      });
      setDone(result);
      onCreated(result);
      toast.success(`Client "${form.name}" created! 🎉`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create client');
    } finally { setSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="bg-white border border-gray-100 rounded-2xl w-full max-w-md shadow-xl overflow-hidden">

        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between ${fromLead ? 'bg-green-50 border-b border-green-100' : 'border-b border-gray-50'}`}>
          <div className="flex items-center gap-2">
            {fromLead && <Trophy className="h-5 w-5 text-green-600" />}
            <h2 className="font-bold text-gray-900">{fromLead ? 'Convert Lead → Client' : 'Add New Client'}</h2>
          </div>
          <button onClick={onClose}><X className="h-4 w-4 text-gray-400" /></button>
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {fromLead && prefill?.wonAmount && (
              <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm">
                <IndianRupee className="h-4 w-4 text-green-600" />
                <span className="text-green-700 font-medium">Won deal: ₹{Number(prefill.wonAmount).toLocaleString('en-IN')}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                { field: 'name',    label: 'Client Name *', required: true,  span: 'col-span-2' },
                { field: 'email',   label: 'Email *',       required: true,  span: '' },
                { field: 'phone',   label: 'Phone',         required: false, span: '' },
                { field: 'company', label: 'Company / Brand', required: false, span: 'col-span-2' },
              ].map(f2 => (
                <div key={f2.field} className={f2.span}>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">{f2.label}</label>
                  <input value={(form as any)[f2.field]} required={f2.required} type={f2.field === 'email' ? 'email' : 'text'}
                    onChange={f(f2.field)}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-[10px] font-semibold text-gray-400 uppercase mb-1 block">Login Password *</label>
                <div className="relative">
                  <input value={form.password} required onChange={f('password')} type={showPw ? 'text' : 'password'}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring pr-20" />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => setForm(p => ({ ...p, password: genPassword(form.name || 'client') }))}
                      className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">📋 Copy this password and share it with the client</p>
              </div>
            </div>

            <button type="submit" disabled={saving || !form.name || !form.email || !form.password}
              className="w-full py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {fromLead ? 'Create Client Account' : 'Add Client'}
            </button>
          </form>
        ) : (
          /* ── Success State ── */
          <div className="p-6 space-y-5 text-center">
            <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">{done.name} added!</p>
              <p className="text-sm text-gray-500">Share these credentials with the client</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Login URL</span>
                <span className="text-xs font-medium text-primary">robin.hastagcreator.com/login</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Email</span>
                <span className="text-xs font-mono text-gray-800">{done.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Password</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-gray-800">{done.generatedPassword}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(done.generatedPassword); toast.success('Copied!'); }}
                    className="p-1 text-gray-400 hover:text-gray-600">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
            <button onClick={onClose}
              className="w-full py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90">
              Done
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminClients() {
  const [clients, setClients]       = useState<any[]>([]);
  const [wonLeads, setWonLeads]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [convertLead, setConvertLead] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, leads] = await Promise.all([
        api.listUsers({ role: 'client' }),
        api.listLeads({ stage: 'won' }),
      ]);
      setClients(Array.isArray(users) ? users : []);
      // Only show won leads that have NOT been converted yet
      const won = (Array.isArray(leads) ? leads : []).filter((l: any) => !l.convertedToClientId);
      setWonLeads(won);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <AppLayout requiredRole="admin">
      <div className="max-w-5xl mx-auto space-y-6 page-transition-enter">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
            <p className="text-sm text-gray-500">{clients.length} active client accounts</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 shadow-sm">
            <Plus className="h-4 w-4" /> Add Client
          </button>
        </div>

        {/* ── Won Leads awaiting conversion ─────────────────────────── */}
        {wonLeads.length > 0 && (
          <div className="bg-green-50 border border-green-100 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 text-green-600" />
              <p className="text-sm font-semibold text-green-800">
                {wonLeads.length} won deal{wonLeads.length !== 1 ? 's' : ''} ready to convert
              </p>
              <span className="ml-auto text-[11px] text-green-600">Click to create client account</span>
            </div>
            <div className="space-y-2">
              {wonLeads.map(lead => (
                <div key={lead._id}
                  className="bg-white border border-green-100 rounded-xl px-4 py-3 flex items-center gap-4 hover:border-green-300 transition-all group">
                  <div className="h-9 w-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-green-700">{(lead.name || '?')[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{lead.name}</p>
                    <p className="text-xs text-gray-400">{lead.company} {lead.contact ? `· ${lead.contact}` : ''}</p>
                  </div>
                  <p className="text-sm font-bold text-green-600 shrink-0">
                    ₹{(lead.wonAmount || lead.estimatedValue || 0).toLocaleString('en-IN')}
                  </p>
                  <button
                    onClick={() => setConvertLead(lead)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-all shadow-sm opacity-0 group-hover:opacity-100">
                    <ArrowRight className="h-3.5 w-3.5" /> Convert
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Info block — how clients enter ────────────────────────── */}
        {clients.length === 0 && wonLeads.length === 0 && !loading && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 space-y-3">
            <p className="font-semibold text-blue-900 text-sm">How do clients enter the dashboard?</p>
            <div className="space-y-2 text-sm text-blue-700">
              <div className="flex items-start gap-2.5">
                <div className="h-5 w-5 bg-blue-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-blue-700">1</span>
                </div>
                <p><strong>Rishi closes a deal</strong> → moves the lead to "Won" in the Sales pipeline → it appears here as a green card for you to review</p>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="h-5 w-5 bg-blue-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-blue-700">2</span>
                </div>
                <p><strong>You click "Convert"</strong> → fill in their email + set a password → they get access to their client dashboard</p>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="h-5 w-5 bg-blue-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-blue-700">3</span>
                </div>
                <p><strong>Or add directly</strong> → click "Add Client" above if the client came in without going through the sales pipeline</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Client cards ──────────────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : clients.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((c, i) => (
              <motion.div key={c._id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3 hover:border-primary/30 hover:shadow-sm transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
                    {(c.name || c.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{c.name || 'Unnamed'}</p>
                    {c.company && <p className="text-[11px] text-gray-400 truncate">{c.company}</p>}
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{c.email}</div>
                  {c.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{c.phone}</div>}
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
                  <Briefcase className="h-3 w-3 text-gray-400" />
                  <span className="text-xs text-gray-500">{c.projectCount || 0} project{c.projectCount !== 1 ? 's' : ''}</span>
                  <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium ${c.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.isActive !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        ) : null}

        {/* ── Modals ── */}
        <AnimatePresence>
          {showCreate && (
            <CreateClientModal
              onClose={() => setShowCreate(false)}
              onCreated={() => { load(); setShowCreate(false); }}
            />
          )}
          {convertLead && (
            <CreateClientModal
              fromLead
              prefill={{
                name:       convertLead.name,
                phone:      convertLead.contact,
                company:    convertLead.company,
                fromLeadId: convertLead._id,
                wonAmount:  convertLead.wonAmount || convertLead.estimatedValue,
              }}
              onClose={() => setConvertLead(null)}
              onCreated={() => { load(); setConvertLead(null); }}
            />
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
