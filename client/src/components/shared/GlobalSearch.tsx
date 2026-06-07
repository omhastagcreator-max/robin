import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Building2, ListChecks, User as UserIcon } from 'lucide-react';
import * as api from '@/api';

/**
 * GlobalSearch — instant entity search over brands/tasks/employees.
 *
 * Opens with Cmd-K / Ctrl-K (matched in window keydown). Renders a
 * full-screen overlay with a search input + grouped results. Arrow
 * keys + Enter select; Esc closes.
 *
 * Distinct from the AI Copilot — this is fast "jump to entity",
 * no Gemini call. The Copilot answers questions; this finds things.
 */

interface Hit {
  id: string;
  name?: string;
  title?: string;
  role?: string;
  status?: string;
  priority?: string;
  healthLevel?: string;
  avatarUrl?: string;
  link: string;
}
interface Hits {
  brands: Hit[];
  tasks: Hit[];
  employees: Hit[];
}

const EMPTY: Hits = { brands: [], tasks: [], employees: [] };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState('');
  const [hits, setHits] = useState<Hits>(EMPTY);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  // Cmd-K / Ctrl-K opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQ(''); setHits(EMPTY); setActive(0); }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setHits(EMPTY); return; }
    const t = setTimeout(() => {
      api.globalSearch(q.trim()).then(setHits).catch(() => setHits(EMPTY));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // Flatten for keyboard nav.
  const flat: Hit[] = [...hits.brands, ...hits.tasks, ...hits.employees];
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);

  const open$1 = (hit?: Hit) => {
    const target = hit ?? flat[active];
    if (!target) return;
    nav(target.link);
    setOpen(false);
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') open$1();
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
            }}
            placeholder="Search brands, tasks, people… (Cmd-K)"
            className="flex-1 bg-transparent focus:outline-none text-[13px]"
          />
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {flat.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] text-muted-foreground italic">
              {q.trim().length < 2 ? 'Type at least 2 characters.' : 'No matches.'}
            </p>
          ) : (
            <div className="py-1">
              {hits.brands.length > 0 && (
                <Group label="Brands">
                  {hits.brands.map((b, i) => (
                    <Row key={b.id} active={active === i} onClick={() => open$1(b)} icon={<Building2 className="h-3.5 w-3.5 text-blue-600" />}
                         primary={b.name || ''} secondary={`${b.healthLevel} · ${b.priority}`} />
                  ))}
                </Group>
              )}
              {hits.tasks.length > 0 && (
                <Group label="Tasks">
                  {hits.tasks.map((t, i) => (
                    <Row key={t.id} active={active === hits.brands.length + i} onClick={() => open$1(t)} icon={<ListChecks className="h-3.5 w-3.5 text-violet-600" />}
                         primary={t.title || ''} secondary={`${t.status || ''} · ${t.priority}`} />
                  ))}
                </Group>
              )}
              {hits.employees.length > 0 && (
                <Group label="People">
                  {hits.employees.map((p, i) => (
                    <Row key={p.id} active={active === hits.brands.length + hits.tasks.length + i} onClick={() => open$1(p)}
                         icon={p.avatarUrl
                           ? <img src={p.avatarUrl} alt="" className="h-4 w-4 rounded object-cover" />
                           : <UserIcon className="h-3.5 w-3.5 text-emerald-600" />}
                         primary={p.name || ''} secondary={p.role || ''} />
                  ))}
                </Group>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
          <span>↑↓ navigate · Enter open · Esc close</span>
          <span>Powered by Robin search</span>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 pt-2 pb-1 text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground">{label}</p>
      <ul>{children}</ul>
    </div>
  );
}

function Row({ active, onClick, icon, primary, secondary }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-[12.5px] ${active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'}`}
      >
        <span className="shrink-0 w-4 h-4 inline-flex items-center justify-center">{icon}</span>
        <span className="font-medium truncate flex-1">{primary}</span>
        {secondary && <span className="text-[10px] text-muted-foreground capitalize shrink-0">{secondary}</span>}
      </button>
    </li>
  );
}
