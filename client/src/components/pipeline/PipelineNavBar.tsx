import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * PipelineNavBar — the shared sticky search + view-toggle strip that
 * appears at the top of every client-CRM surface (the listing AND each
 * brand workspace).
 *
 * Owner ask (June 2026): "keep the search bar visible and fixed across
 * the pipeline and client CRM, also keep the focus and dashboard
 * button fixed as well." Same chrome on both pages means a teammate
 * never has to navigate back just to type a different brand name.
 *
 * Behavior:
 *   - Search input + clear button.
 *   - Enter key navigates to /clients/pipeline/:id of the top match
 *     (case-insensitive substring on clientName).
 *   - Focused / Dashboard buttons navigate back to /clients/pipeline
 *     with ?view=<key> so the listing opens directly in the chosen
 *     mode. ClientPipelinePage reads that param on mount.
 *
 * Cache: brand list is fetched once per mount; cheap (~17 rows). The
 * navbar lives at the top of the page so this happens early and the
 * Enter-to-open path is instant after first paint.
 */

interface Brand {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
}

export function PipelineNavBar() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch once on mount. The list endpoint already returns lightweight
  // rows; we just need name + ids for client-side filtering.
  useEffect(() => {
    api.cwListWorkflows({})
      .then((d: any) => setBrands(Array.isArray(d) ? d : []))
      .catch(() => setBrands([]));
  }, []);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return brands.filter(b => {
      const haystack = `${b.clientName || ''} ${b.clientPhone || ''} ${b.clientEmail || ''}`.toLowerCase();
      return haystack.includes(term);
    }).slice(0, 6);
  }, [q, brands]);

  const open = (id: string) => {
    navigate(`/clients/pipeline/${id}`);
    setQ('');
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (!q.trim()) return;
    if (matches.length === 0) {
      toast.error('No clients match that search.');
      return;
    }
    open(matches[0]._id);
  };

  return (
    <div className="sticky top-2 z-30 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 rounded-xl border border-border shadow-sm p-2 mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* View toggle */}
        <div className="inline-flex items-center rounded-lg border border-border bg-card overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => navigate('/clients/pipeline?view=focused')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors text-muted-foreground hover:text-foreground"
          >
            <Search className="h-3 w-3" /> Focused
          </button>
          <button
            type="button"
            onClick={() => navigate('/clients/pipeline?view=executive')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors border-l border-border text-muted-foreground hover:text-foreground"
          >
            <LayoutDashboard className="h-3 w-3" /> Dashboard
          </button>
        </div>

        {/* Search (with inline dropdown of matches) */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search by phone, name or email — press Enter to open the brand"
            className="w-full pl-10 pr-9 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {q && (
            <button onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Inline suggestion dropdown — appears when there are matches.
              Mouse-down (not click) so it fires before the input blur. */}
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden z-40">
              <ul className="max-h-[260px] overflow-y-auto">
                {matches.map(b => (
                  <li key={b._id}>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => open(b._id)}
                      className="w-full px-3 py-1.5 text-left hover:bg-muted/50 text-[12.5px] flex items-center gap-2"
                    >
                      <span className="font-semibold truncate">{b.clientName || '(unnamed)'}</span>
                      {b.clientPhone && <span className="text-[10.5px] text-muted-foreground tabular-nums">{b.clientPhone}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
