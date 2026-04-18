import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, X, ExternalLink, Trash2, Edit3,
  Instagram, Youtube, Twitter, Linkedin, Users, Star,
  TrendingUp, Filter, ChevronDown, Save, Loader2, BarChart3, IndianRupee
} from 'lucide-react';
import * as api from '@/api';
import { toast } from 'sonner';

// ── Constants ─────────────────────────────────────────────────────────────────
const CATEGORIES = [
  'all','fashion','beauty','food','lifestyle','fitness','travel',
  'tech','education','entertainment','parenting','business','photography','other',
] as const;

const PLATFORMS = ['all','instagram','youtube','twitter','linkedin','threads','other'] as const;
const STATUSES  = ['all','prospect','approached','active','paused','blacklisted'] as const;

const CATEGORY_COLORS: Record<string, string> = {
  fashion:       'bg-pink-100 text-pink-700',
  beauty:        'bg-rose-100 text-rose-700',
  food:          'bg-orange-100 text-orange-700',
  lifestyle:     'bg-purple-100 text-purple-700',
  fitness:       'bg-green-100 text-green-700',
  travel:        'bg-sky-100 text-sky-700',
  tech:          'bg-blue-100 text-blue-700',
  education:     'bg-indigo-100 text-indigo-700',
  entertainment: 'bg-yellow-100 text-yellow-700',
  parenting:     'bg-emerald-100 text-emerald-700',
  business:      'bg-slate-100 text-slate-700',
  photography:   'bg-violet-100 text-violet-700',
  other:         'bg-gray-100 text-gray-600',
};

const STATUS_COLORS: Record<string, string> = {
  prospect:    'bg-gray-100 text-gray-600',
  approached:  'bg-amber-100 text-amber-700',
  active:      'bg-green-100 text-green-700',
  paused:      'bg-orange-100 text-orange-600',
  blacklisted: 'bg-red-100 text-red-600',
};

const PLATFORM_ICONS: Record<string, any> = {
  instagram: Instagram,
  youtube:   Youtube,
  twitter:   Twitter,
  linkedin:  Linkedin,
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const EMPTY_FORM = {
  name: '', handle: '', platform: 'instagram', category: 'lifestyle',
  followers: '', engagementRate: '', ratePerPost: '',
  email: '', phone: '', city: '', profileUrl: '', status: 'prospect', notes: '',
};

export default function InfluencerSheet() {
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [stats, setStats]             = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [catFilter, setCatFilter]     = useState('all');
  const [platFilter, setPlatFilter]   = useState('all');
  const [statFilter, setStatFilter]   = useState('all');

  const [showAdd, setShowAdd]         = useState(false);
  const [editTarget, setEditTarget]   = useState<any | null>(null);
  const [form, setForm]               = useState({ ...EMPTY_FORM });
  const [saving, setSaving]           = useState(false);
  const [deleteId, setDeleteId]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (catFilter  !== 'all') params.category = catFilter;
      if (platFilter !== 'all') params.platform  = platFilter;
      if (statFilter !== 'all') params.status    = statFilter;
      if (search) params.search = search;
      const [list, st] = await Promise.all([
        api.listInfluencers(params),
        api.influencerStats(),
      ]);
      setInfluencers(Array.isArray(list) ? list : []);
      setStats(Array.isArray(st) ? st : []);
    } finally { setLoading(false); }
  }, [catFilter, platFilter, statFilter, search]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (inf: any) => {
    setEditTarget(inf);
    setForm({
      name: inf.name, handle: inf.handle, platform: inf.platform, category: inf.category,
      followers: String(inf.followers), engagementRate: String(inf.engagementRate),
      ratePerPost: String(inf.ratePerPost || ''), email: inf.email || '',
      phone: inf.phone || '', city: inf.city || '', profileUrl: inf.profileUrl || '',
      status: inf.status, notes: inf.notes || '',
    });
    setShowAdd(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        followers:      Number(form.followers)      || 0,
        engagementRate: Number(form.engagementRate) || 0,
        ratePerPost:    Number(form.ratePerPost)    || 0,
      };
      if (editTarget) {
        await api.updateInfluencer(editTarget._id, payload);
        toast.success('Influencer updated!');
      } else {
        await api.createInfluencer(payload);
        toast.success('Influencer added!');
      }
      setShowAdd(false); setEditTarget(null); setForm({ ...EMPTY_FORM });
      load();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await api.deleteInfluencer(id);
    toast.success('Removed');
    setDeleteId(null); load();
  };

  const totalFollowers = influencers.reduce((s, i) => s + (i.followers || 0), 0);
  const avgEngagement  = influencers.length
    ? (influencers.reduce((s, i) => s + (i.engagementRate || 0), 0) / influencers.length).toFixed(2)
    : '—';
  const activeCount = influencers.filter(i => i.status === 'active').length;

  const PlatformIcon = ({ platform }: { platform: string }) => {
    const Icon = PLATFORM_ICONS[platform] || Users;
    return <Icon className="h-3.5 w-3.5" />;
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-transition-enter max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Influencer Sheet</h1>
            <p className="text-sm text-gray-500">{influencers.length} influencers tracked across {stats.length} categories</p>
          </div>
          <button onClick={() => { setEditTarget(null); setForm({ ...EMPTY_FORM }); setShowAdd(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 shadow-sm">
            <Plus className="h-4 w-4" /> Add Influencer
          </button>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Influencers', value: influencers.length,   icon: Users,       color: 'text-primary',   bg: 'bg-primary/5'  },
            { label: 'Total Reach',       value: fmt(totalFollowers),  icon: TrendingUp,  color: 'text-blue-600',  bg: 'bg-blue-50'    },
            { label: 'Avg Engagement',    value: `${avgEngagement}%`,  icon: Star,        color: 'text-amber-600', bg: 'bg-amber-50'   },
            { label: 'Active Now',        value: activeCount,          icon: BarChart3,   color: 'text-green-600', bg: 'bg-green-50'   },
          ].map(k => (
            <div key={k.label} className={`${k.bg} border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3`}>
              <k.icon className={`h-5 w-5 ${k.color} opacity-80 shrink-0`} />
              <div>
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Category Stats Mini-bar */}
        {stats.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {stats.map((s: any) => (
              <button key={s._id} onClick={() => setCatFilter(catFilter === s._id ? 'all' : s._id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  catFilter === s._id ? 'border-primary bg-primary/10 text-primary' : `${CATEGORY_COLORS[s._id] || 'bg-gray-50 text-gray-600'} border-transparent hover:border-gray-200`
                }`}>
                {s._id} <span className="font-bold opacity-70">({s.count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, handle, city…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 bg-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <select value={platFilter} onChange={e => setPlatFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 bg-white rounded-xl text-sm text-gray-700">
            {PLATFORMS.map(p => <option key={p} value={p}>{p === 'all' ? 'All Platforms' : p}</option>)}
          </select>
          <select value={statFilter} onChange={e => setStatFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 bg-white rounded-xl text-sm text-gray-700">
            {STATUSES.map(s => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>)}
          </select>
          {(catFilter !== 'all' || platFilter !== 'all' || statFilter !== 'all' || search) && (
            <button onClick={() => { setCatFilter('all'); setPlatFilter('all'); setStatFilter('all'); setSearch(''); }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : influencers.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl py-20 flex flex-col items-center gap-4 text-gray-300">
            <Users className="h-12 w-12" />
            <p className="text-sm font-medium">No influencers yet</p>
            <button onClick={() => setShowAdd(true)}
              className="text-primary text-sm underline">+ Add your first influencer</button>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 bg-gray-50/60">
                    {['Influencer','Category','Platform','Followers','Eng. Rate','Rate/Post','City','Contact','Status',''].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {influencers.map((inf, i) => (
                      <motion.tr key={inf._id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors group ${i % 2 === 0 ? '' : 'bg-gray-50/20'}`}>
                        {/* Influencer */}
                        <td className="px-4 py-3 min-w-[180px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-primary">{inf.name[0]}</span>
                            </div>
                            <div>
                              <p className="font-semibold text-gray-800 leading-tight">{inf.name}</p>
                              {inf.handle && <p className="text-[11px] text-gray-400">@{inf.handle.replace('@','')}</p>}
                            </div>
                          </div>
                        </td>
                        {/* Category */}
                        <td className="px-4 py-3">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${CATEGORY_COLORS[inf.category] || 'bg-gray-100 text-gray-600'}`}>
                            {inf.category}
                          </span>
                        </td>
                        {/* Platform */}
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-xs text-gray-600 capitalize">
                            <PlatformIcon platform={inf.platform} /> {inf.platform}
                          </span>
                        </td>
                        {/* Followers */}
                        <td className="px-4 py-3 font-semibold text-gray-700">{fmt(inf.followers || 0)}</td>
                        {/* Engagement */}
                        <td className="px-4 py-3">
                          <span className={`font-semibold ${inf.engagementRate >= 3 ? 'text-green-600' : inf.engagementRate >= 1 ? 'text-amber-600' : 'text-gray-500'}`}>
                            {inf.engagementRate?.toFixed(1) || '—'}%
                          </span>
                        </td>
                        {/* Rate/post */}
                        <td className="px-4 py-3 text-gray-600">
                          {inf.ratePerPost > 0 ? `₹${inf.ratePerPost.toLocaleString('en-IN')}` : '—'}
                        </td>
                        {/* City */}
                        <td className="px-4 py-3 text-gray-500 text-xs">{inf.city || '—'}</td>
                        {/* Contact */}
                        <td className="px-4 py-3 text-xs text-gray-500">
                          <div>{inf.email || ''}</div>
                          <div>{inf.phone || ''}</div>
                          {!inf.email && !inf.phone && '—'}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <select value={inf.status}
                            onChange={async e => {
                              await api.updateInfluencer(inf._id, { status: e.target.value });
                              load();
                            }}
                            className={`text-[11px] font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer ${STATUS_COLORS[inf.status]}`}
                            style={{ background: 'transparent' }}>
                            {STATUSES.filter(s => s !== 'all').map(s => (
                              <option key={s} value={s} className="bg-white text-gray-800 capitalize">{s}</option>
                            ))}
                          </select>
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            {inf.profileUrl && (
                              <a href={inf.profileUrl} target="_blank" rel="noopener noreferrer"
                                className="p-1 text-gray-400 hover:text-primary rounded-lg hover:bg-primary/10 transition-all">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                            <button onClick={() => openEdit(inf)}
                              className="p-1 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-all">
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setDeleteId(inf._id)}
                              className="p-1 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-all">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Add / Edit Modal */}
        <AnimatePresence>
          {showAdd && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
              onClick={e => { if (e.target === e.currentTarget) { setShowAdd(false); setEditTarget(null); } }}>
              <motion.form initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
                onSubmit={handleSave}
                className="bg-white border border-gray-100 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl my-4">
                <div className="flex items-start justify-between">
                  <h2 className="font-bold text-gray-900 text-lg">{editTarget ? 'Edit Influencer' : 'Add Influencer'}</h2>
                  <button type="button" onClick={() => { setShowAdd(false); setEditTarget(null); }}><X className="h-4 w-4 text-gray-400" /></button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { field: 'name',    label: 'Name *',         required: true,  full: true },
                    { field: 'handle',  label: '@Handle',        required: false, full: false },
                    { field: 'email',   label: 'Email',          required: false, full: false },
                    { field: 'phone',   label: 'Phone',          required: false, full: false },
                    { field: 'city',    label: 'City',           required: false, full: false },
                    { field: 'profileUrl', label: 'Profile URL', required: false, full: true },
                  ].map(f => (
                    <div key={f.field} className={f.full ? 'col-span-2' : ''}>
                      <label className="text-[10px] uppercase font-semibold text-gray-400 mb-1 block">{f.label}</label>
                      <input value={(form as any)[f.field]} required={f.required}
                        onChange={e => setForm(p => ({ ...p, [f.field]: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                  ))}

                  {/* Selects */}
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-gray-400 mb-1 block">Platform</label>
                    <select value={form.platform} onChange={e => setForm(p => ({ ...p, platform: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm">
                      {['instagram','youtube','twitter','linkedin','threads','other'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-gray-400 mb-1 block">Category *</label>
                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm">
                      {['fashion','beauty','food','lifestyle','fitness','travel','tech','education','entertainment','parenting','business','photography','other'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-gray-400 mb-1 block">Status</label>
                    <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm">
                      {['prospect','approached','active','paused','blacklisted'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>

                  {/* Numeric */}
                  {[
                    { field: 'followers',      label: 'Followers' },
                    { field: 'engagementRate', label: 'Engagement %' },
                    { field: 'ratePerPost',    label: 'Rate / Post (₹)' },
                  ].map(f => (
                    <div key={f.field}>
                      <label className="text-[10px] uppercase font-semibold text-gray-400 mb-1 block">{f.label}</label>
                      <input type="number" value={(form as any)[f.field]}
                        onChange={e => setForm(p => ({ ...p, [f.field]: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                  ))}

                  <div className="col-span-2">
                    <label className="text-[10px] uppercase font-semibold text-gray-400 mb-1 block">Notes</label>
                    <textarea value={form.notes} rows={2}
                      onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>

                <button type="submit" disabled={saving || !form.name}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 shadow-sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editTarget ? 'Save Changes' : 'Add Influencer'}
                </button>
              </motion.form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Confirm */}
        <AnimatePresence>
          {deleteId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl text-center space-y-4">
                <Trash2 className="h-8 w-8 text-red-400 mx-auto" />
                <p className="font-semibold text-gray-900">Remove this influencer?</p>
                <p className="text-sm text-gray-500">This action cannot be undone.</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteId(null)}
                    className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button onClick={() => handleDelete(deleteId)}
                    className="flex-1 py-2 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600">Delete</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
