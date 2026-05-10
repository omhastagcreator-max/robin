import { useMemo, useState } from 'react';
import { Search, Phone, Calendar, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

/**
 * LeadListView — one row per lead, stage as a colored pill, searchable
 * by name / phone / email / company. Both admin and Rishi use this when
 * they want to answer "where is X right now?" without scanning the kanban.
 *
 * Sortable in two flips: by created date (newest first by default) or by
 * stage. Click a row → opens detail. Stage pill → click to change stage
 * via a small inline picker.
 */

interface Stage { key: string; label: string; bg?: string; text?: string }

interface Props {
  leads: any[];
  onView: (lead: any) => void;
  onMove: (id: string, stage: string) => void;
  stageMeta: ReadonlyArray<Stage>;
}

type SortKey = 'newest' | 'stage' | 'value';

export function LeadListView({ leads, onView, onMove, stageMeta }: Props) {
  const [q, setQ]             = useState('');
  const [stageFilter, setSF]  = useState<string>('all');
  const [sort, setSort]       = useState<SortKey>('newest');
  const stageMap = useMemo(() => Object.fromEntries(stageMeta.map(s => [s.key, s])), [stageMeta]);

  const filtered = useMemo(() => {
    let out = leads.slice();
    if (stageFilter !== 'all') out = out.filter(l => (l.stage || l.status) === stageFilter);
    if (q.trim()) {
      const term = q.trim().toLowerCase();
      out = out.filter(l =>
        (l.name    || '').toLowerCase().includes(term) ||
        (l.contact || '').toLowerCase().includes(term) ||
        (l.email   || '').toLowerCase().includes(term) ||
        (l.company || '').toLowerCase().includes(term)
      );
    }
    if (sort === 'newest') out.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    if (sort === 'stage')  out.sort((a, b) => (a.stage || a.status || '').localeCompare(b.stage || b.status || ''));
    if (sort === 'value')  out.sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0));
    return out;
  }, [leads, q, stageFilter, sort]);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
        <div className="flex-1 min-w-[180px] flex items-center gap-2 bg-background border border-input rounded-lg px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, phone, email, company…"
            className="flex-1 text-xs bg-transparent outline-none"
          />
        </div>
        <select value={stageFilter} onChange={e => setSF(e.target.value)}
          className="text-xs px-2 py-1.5 bg-background border border-input rounded-lg cursor-pointer">
          <option value="all">All stages ({leads.length})</option>
          {stageMeta.map(s => (
            <option key={s.key} value={s.key}>
              {s.label} ({leads.filter(l => (l.stage || l.status) === s.key).length})
            </option>
          ))}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
          className="text-xs px-2 py-1.5 bg-background border border-input rounded-lg cursor-pointer">
          <option value="newest">Sort: Newest first</option>
          <option value="stage">Sort: Stage</option>
          <option value="value">Sort: Value (high → low)</option>
        </select>
        <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
          {filtered.length} of {leads.length}
        </span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border max-h-[calc(100vh-380px)] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-12">
            No leads match. Clear the filters or wait for sheet sync.
          </div>
        ) : filtered.map(lead => {
          const currentStage = lead.stage || lead.status;
          const stage = stageMap[currentStage] as Stage | undefined;
          const isNew = lead.createdAt && Date.now() - new Date(lead.createdAt).getTime() < 60 * 60 * 1000;
          return (
            <div
              key={lead._id}
              className="grid grid-cols-[1fr_140px_120px_140px_36px] gap-3 items-center px-4 py-2.5 hover:bg-muted/30 transition-colors group"
            >
              {/* Name + company */}
              <button onClick={() => onView(lead)} className="text-left min-w-0 flex items-center gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                    {lead.name || '—'}
                    {isNew && (
                      <span className="bg-emerald-500 text-white text-[8px] font-black uppercase px-1 py-0 rounded tracking-wider">
                        New
                      </span>
                    )}
                  </p>
                  {lead.company && <p className="text-[10px] text-muted-foreground truncate">{lead.company}</p>}
                </div>
              </button>

              {/* Phone — tappable */}
              <div className="min-w-0">
                {lead.contact ? (
                  <a href={`tel:${lead.contact}`} className="text-[11px] text-primary hover:underline tabular-nums truncate flex items-center gap-1">
                    <Phone className="h-2.5 w-2.5 shrink-0" /> {lead.contact}
                  </a>
                ) : (
                  <span className="text-[10px] text-muted-foreground/60">no phone</span>
                )}
              </div>

              {/* Stage picker — single click to change */}
              <select
                value={currentStage}
                onChange={(e) => onMove(lead._id, e.target.value)}
                className={`text-[10px] px-2 py-1 rounded-md border cursor-pointer font-semibold ${stage?.bg || 'bg-muted'} ${stage?.text || 'text-foreground'}`}
                title="Change stage"
              >
                {stageMeta.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>

              {/* Created date */}
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar className="h-2.5 w-2.5" />
                {lead.createdAt ? format(new Date(lead.createdAt), 'dd MMM yyyy') : '—'}
              </div>

              {/* Open detail */}
              <button onClick={() => onView(lead)} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary opacity-50 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default LeadListView;
