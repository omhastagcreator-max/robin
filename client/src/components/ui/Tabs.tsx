import { useState, type ReactNode } from 'react';

/**
 * Robin v2 tabs primitive. Linear-style — segmented control look, bottom
 * underline for the active tab, no chrome around the tab panels.
 *
 * Usage:
 *   <Tabs initial="all">
 *     <Tabs.List>
 *       <Tabs.Tab id="all">All</Tabs.Tab>
 *       <Tabs.Tab id="open">Open</Tabs.Tab>
 *       <Tabs.Tab id="done">Done</Tabs.Tab>
 *     </Tabs.List>
 *     <Tabs.Panel id="all">{...}</Tabs.Panel>
 *     <Tabs.Panel id="open">{...}</Tabs.Panel>
 *     <Tabs.Panel id="done">{...}</Tabs.Panel>
 *   </Tabs>
 */

interface TabsContext {
  active: string;
  setActive: (id: string) => void;
}

import { createContext, useContext } from 'react';
const Ctx = createContext<TabsContext>({ active: '', setActive: () => {} });

interface TabsProps {
  initial: string;
  children: ReactNode;
  className?: string;
  /** Controlled mode — provide both `value` and `onChange`. */
  value?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ initial, children, className = '', value, onChange }: TabsProps) {
  const [internalActive, setInternalActive] = useState(initial);
  const active = value ?? internalActive;
  const setActive = (id: string) => {
    if (onChange) onChange(id);
    if (value === undefined) setInternalActive(id);
  };
  return (
    <Ctx.Provider value={{ active, setActive }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

Tabs.List = function TabsList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-0 border-b border-border ${className}`}>
      {children}
    </div>
  );
};

Tabs.Tab = function TabsTab({ id, children, count }: { id: string; children: ReactNode; count?: number }) {
  const { active, setActive } = useContext(Ctx);
  const isActive = active === id;
  return (
    <button
      onClick={() => setActive(id)}
      className={`
        relative px-3 h-9 text-[12.5px] font-semibold
        flex items-center gap-1.5 transition-colors
        ${isActive
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'}
      `}
    >
      {children}
      {typeof count === 'number' && count > 0 && (
        <span className={`px-1.5 h-4 rounded text-[10px] font-bold tabular-nums ${
          isActive ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        }`}>{count}</span>
      )}
      {isActive && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-primary rounded-full" />}
    </button>
  );
};

Tabs.Panel = function TabsPanel({ id, children, className = '' }: { id: string; children: ReactNode; className?: string }) {
  const { active } = useContext(Ctx);
  if (active !== id) return null;
  return <div className={className}>{children}</div>;
};
