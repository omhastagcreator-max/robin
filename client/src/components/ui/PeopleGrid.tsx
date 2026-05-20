import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import { Avatar } from '@/components/shared/Avatar';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Row } from '@/components/ui/Row';

/**
 * <PeopleGrid /> — compact, scannable grid of teammates / clients.
 *
 * Born out of the Team Status request: when there are ten+ people, a
 * vertical Row list forces scrolling to see them all. A grid of small
 * tiles fits everyone in one viewport.
 *
 * Two layouts in one primitive:
 *   • 'grid' — responsive 2/3/4/5 column tiles
 *   • 'list' — falls back to <Row> rendering (same look as before)
 *
 * The toggle is persisted in localStorage so each user's preference
 * survives navigation + reload. Pass `storageKey` to scope the preference
 * (e.g. 'people.workroom.layout' vs 'people.employees.layout').
 */

export interface PeopleGridItem {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  team?: string;
  state?: Status;
  /** Optional extra detail rendered under the role line — e.g. last seen. */
  hint?: string;
  /** Click handler — if provided, the tile becomes a button. */
  onClick?: () => void;
  /** Optional trailing slot for inline actions (e.g. a ping button). */
  trailing?: ReactNode;
}

interface Props {
  items: PeopleGridItem[];
  /** localStorage key for layout preference. Omit for in-memory only. */
  storageKey?: string;
  /** Force a layout (hides the toggle). Useful for parent-controlled views. */
  layout?: 'grid' | 'list';
  /** Hide the layout toggle even when storageKey is set. */
  hideToggle?: boolean;
  /** Empty-state contents. */
  empty?: ReactNode;
}

function readPref(key?: string): 'grid' | 'list' {
  if (!key) return 'grid';
  try { return (localStorage.getItem(key) as any) === 'list' ? 'list' : 'grid'; }
  catch { return 'grid'; }
}

function writePref(key: string | undefined, val: 'grid' | 'list') {
  if (!key) return;
  try { localStorage.setItem(key, val); } catch { /* private mode */ }
}

export function PeopleGrid({ items, storageKey, layout, hideToggle, empty }: Props) {
  const [pref, setPref] = useState<'grid' | 'list'>(() => layout || readPref(storageKey));
  useEffect(() => { if (layout) setPref(layout); }, [layout]);

  const effective = layout || pref;

  if (items.length === 0) return <>{empty}</>;

  const toggle = !hideToggle && !layout && storageKey ? (
    <div className="inline-flex items-center rounded-md border border-border bg-card overflow-hidden text-[11px]">
      <button
        onClick={() => { setPref('grid'); writePref(storageKey, 'grid'); }}
        className={`flex items-center gap-1 px-2 py-1 transition-colors ${effective === 'grid' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        title="Grid view"
      >
        <LayoutGrid className="h-3 w-3" /> Grid
      </button>
      <button
        onClick={() => { setPref('list'); writePref(storageKey, 'list'); }}
        className={`flex items-center gap-1 px-2 py-1 transition-colors ${effective === 'list' ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        title="List view"
      >
        <ListIcon className="h-3 w-3" /> List
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-2">
      {toggle && <div className="flex justify-end">{toggle}</div>}
      {effective === 'grid' ? (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((it) => <Tile key={it.id} item={it} />)}
        </div>
      ) : (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          {items.map((it) => (
            <Row
              key={it.id}
              density="comfy"
              onClick={it.onClick}
              accent={
                it.state === 'in_huddle' ? 'primary' :
                it.state === 'working'   ? 'success' :
                it.state === 'on_break'  ? 'warning' :
                it.state === 'on_leave'  ? 'info'    :
                                            'none'
              }
            >
              <Row.Leading>
                <Avatar name={it.name} email={it.email} size="sm" tone="primary" />
              </Row.Leading>
              <Row.Main>
                <Row.Title>{it.name || 'Unnamed'}</Row.Title>
                <Row.Meta>
                  {it.role || 'employee'}{it.team ? ` · ${it.team}` : ''}{it.hint ? ` · ${it.hint}` : ''}
                </Row.Meta>
              </Row.Main>
              <Row.Trail>
                <div className="flex items-center gap-2">
                  {it.state && <StatusPill state={it.state} size="xs" />}
                  {it.trailing}
                </div>
              </Row.Trail>
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tile — the grid cell variant ────────────────────────────────────────────
function Tile({ item }: { item: PeopleGridItem }) {
  const accent =
    item.state === 'in_huddle' ? 'border-primary/40 bg-primary/[0.04]'  :
    item.state === 'working'   ? 'border-emerald-500/30 bg-emerald-500/[0.04]' :
    item.state === 'on_break'  ? 'border-amber-500/30 bg-amber-500/[0.04]'     :
    item.state === 'on_leave'  ? 'border-blue-500/30 bg-blue-500/[0.04]'       :
                                  'border-border bg-card';
  const wrapperCls = `relative rounded-lg border ${accent} px-3 py-2.5 flex flex-col gap-1.5 min-w-0 transition-colors hover:bg-accent/[0.03]`;

  const inner = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={item.name} email={item.email} size="sm" tone="primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold truncate">{item.name || 'Unnamed'}</p>
          <p className="text-[10.5px] text-muted-foreground truncate">
            {(item.role || 'employee')}{item.team ? ` · ${item.team}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {item.state ? <StatusPill state={item.state} size="xs" /> : <span />}
        {item.trailing}
      </div>
      {item.hint && (
        <p className="text-[10.5px] text-muted-foreground truncate">{item.hint}</p>
      )}
    </>
  );

  if (item.onClick) {
    return <button type="button" onClick={item.onClick} className={`${wrapperCls} text-left cursor-pointer`}>{inner}</button>;
  }
  return <div className={wrapperCls}>{inner}</div>;
}

export default PeopleGrid;
