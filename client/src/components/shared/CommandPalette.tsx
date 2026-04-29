import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ArrowRight, LayoutDashboard, ListTodo, Briefcase, Users, Building2,
  BarChart2, Video, MessageSquare, Bell, User as UserIcon, KeyRound, Plus,
  Coffee, Play, StopCircle, CornerDownLeft, CalendarOff, ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';
import { toast } from 'sonner';

/**
 * Global command palette.
 *
 * Open with Cmd-K (mac) / Ctrl-K (everywhere). Type to filter, ↑/↓ to
 * navigate, Enter to run. Lets anyone jump to any page or trigger common
 * actions without hunting through sidebars or dialogs — keyboard-first.
 *
 * Mounted once at the top of AppLayout so it works on every page.
 */

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: 'go' | 'do';
  icon: any;
  visibleFor?: string[];                 // role allow-list
  action: () => void | Promise<void>;
  keywords?: string;                     // extra search terms
}

export function CommandPalette() {
  const { role, user } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Build the action list. Memoised on role so we don't rebuild on every keystroke.
  const items: Item[] = useMemo(() => {
    const goto = (path: string) => () => { navigate(path); setOpen(false); };

    const list: Item[] = [
      // ── Go ──
      { id: 'go-dashboard', label: 'Dashboard',  hint: 'Your home view',   group: 'go', icon: LayoutDashboard,
        visibleFor: ['employee'],
        action: goto('/dashboard') },
      { id: 'go-admin', label: 'Admin overview', hint: 'Org-wide overview', group: 'go', icon: LayoutDashboard,
        visibleFor: ['admin'], action: goto('/admin') },
      { id: 'go-sales', label: 'Sales CRM',      hint: 'Pipeline & leads',  group: 'go', icon: LayoutDashboard,
        visibleFor: ['sales'], action: goto('/sales') },
      { id: 'go-client', label: 'Client dashboard', hint: 'Your account', group: 'go', icon: LayoutDashboard,
        visibleFor: ['client'], action: goto('/client') },

      { id: 'go-tasks', label: 'My Tasks',       hint: 'See all tasks',     group: 'go', icon: ListTodo,
        visibleFor: ['admin', 'employee', 'sales'], action: goto('/tasks') },
      { id: 'go-vault', label: 'Client Vault',   hint: 'Logins & links',    group: 'go', icon: KeyRound,
        visibleFor: ['admin', 'employee', 'sales'], action: goto('/vault'),
        keywords: 'credentials passwords accounts' },
      { id: 'go-workroom', label: 'Work Room',   hint: 'Huddle & screens',  group: 'go', icon: Video,
        visibleFor: ['admin', 'employee', 'sales'], action: goto('/workroom'),
        keywords: 'meeting screen share huddle voice mic' },
      { id: 'go-chat', label: 'Group Chat',      hint: 'Team messages',     group: 'go', icon: MessageSquare,
        visibleFor: ['admin', 'employee', 'sales'], action: goto('/chat') },

      { id: 'go-projects',  label: 'Projects',   hint: 'All projects',      group: 'go', icon: Briefcase,
        visibleFor: ['admin'], action: goto('/admin/projects') },
      { id: 'go-employees', label: 'Employees',  hint: 'Manage team',       group: 'go', icon: Users,
        visibleFor: ['admin'], action: goto('/admin/employees'),
        keywords: 'reports productivity' },
      { id: 'go-clients',   label: 'Clients',    hint: 'Manage clients',    group: 'go', icon: Building2,
        visibleFor: ['admin'], action: goto('/admin/clients') },
      { id: 'go-reports',   label: 'Reports',    hint: 'Org analytics',     group: 'go', icon: BarChart2,
        visibleFor: ['admin'], action: goto('/admin/reports') },
      { id: 'go-admin-leaves', label: 'Leave Approvals', hint: 'Review pending leave', group: 'go', icon: ClipboardCheck,
        visibleFor: ['admin'], action: goto('/admin/leaves') },

      { id: 'go-leaves',    label: 'My Leaves',  hint: 'Apply / view your leave',     group: 'go', icon: CalendarOff,
        visibleFor: ['employee', 'sales'], action: goto('/leaves'),
        keywords: 'time off vacation holiday' },

      { id: 'go-notifs',  label: 'Notifications', hint: 'Inbox',            group: 'go', icon: Bell,
        action: goto('/notifications') },
      { id: 'go-profile', label: 'Profile',       hint: 'Your settings',    group: 'go', icon: UserIcon,
        action: goto('/profile') },

      // ── Do ──
      { id: 'do-add-credential', label: 'Add a credential', hint: 'Save a new client login', group: 'do', icon: Plus,
        visibleFor: ['admin', 'employee', 'sales'], action: goto('/vault?new=1') },
      { id: 'do-apply-leave', label: 'Apply for leave', hint: 'Pick days and submit', group: 'do', icon: CalendarOff,
        visibleFor: ['employee', 'sales'], action: goto('/leaves') },
      { id: 'do-join-huddle', label: 'Join the huddle', hint: 'Open Work Room and connect', group: 'do', icon: Video,
        visibleFor: ['admin', 'employee', 'sales'], action: goto('/workroom') },

      { id: 'do-start-day', label: 'Start your day', hint: 'Clock in', group: 'do', icon: Play,
        visibleFor: ['employee', 'sales'],
        action: async () => {
          try { await api.startSession(); toast.success('You are clocked in'); setOpen(false); }
          catch (e: any) { toast.error(e?.response?.data?.error || 'Could not start session'); }
        } },
      { id: 'do-take-break', label: 'Take a break', hint: 'Pause work', group: 'do', icon: Coffee,
        visibleFor: ['employee', 'sales'],
        action: async () => {
          try { await api.startBreak(); toast.success('Break started'); setOpen(false); }
          catch (e: any) { toast.error(e?.response?.data?.error || 'No active session'); }
        } },
      { id: 'do-end-break', label: 'End break / resume', hint: 'Back to work', group: 'do', icon: Play,
        visibleFor: ['employee', 'sales'],
        action: async () => {
          try { await api.endBreak(); toast.success('Welcome back'); setOpen(false); }
          catch (e: any) { toast.error(e?.response?.data?.error || 'Not on break'); }
        } },
      { id: 'do-end-day', label: 'End your day', hint: 'Clock out', group: 'do', icon: StopCircle,
        visibleFor: ['employee', 'sales'],
        action: async () => {
          try { await api.endSession(); toast.success('Have a good evening'); setOpen(false); }
          catch (e: any) { toast.error(e?.response?.data?.error || 'No active session'); }
        } },
    ];

    return list.filter(i => !i.visibleFor || i.visibleFor.includes(role));
  }, [role, navigate]);

  // Filter + group
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(i => {
      const hay = `${i.label} ${i.hint || ''} ${i.keywords || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [q, items]);

  // Reset highlighted item when filter changes
  useEffect(() => { setHi(0); }, [q, open]);

  // Open / close on Cmd-K (or Ctrl-K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      // "/" opens too, when focus isn't already in an input
      if (e.key === '/' && !open) {
        const tag = (document.activeElement?.tagName || '').toUpperCase();
        const editable = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;
        if (!editable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the search field on open
  useEffect(() => {
    if (open) {
      setQ('');
      setHi(0);
      // wait a tick for the modal to mount
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const runHighlighted = () => {
    const it = filtered[hi];
    if (it) it.action();
  };

  // Keyboard navigation inside the palette
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape')      { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); runHighlighted(); }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            role="dialog" aria-modal="true" aria-label="Command palette"
            className="fixed left-1/2 top-24 -translate-x-1/2 z-[61] w-[min(640px,calc(100vw-2rem))] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Search */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Type a page or action…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
              />
              <kbd className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">Esc</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">No matches.</p>
              )}
              {(['go', 'do'] as const).map(group => {
                const items = filtered.filter(i => i.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">
                      {group === 'go' ? 'Go to' : 'Actions'}
                    </p>
                    {items.map(it => {
                      const idx = filtered.indexOf(it);
                      const active = idx === hi;
                      return (
                        <button
                          key={it.id}
                          onClick={it.action}
                          onMouseEnter={() => setHi(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            active ? 'bg-primary/10' : 'hover:bg-muted/40'
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          }`}>
                            <it.icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{it.label}</p>
                            {it.hint && <p className="text-[11px] text-muted-foreground truncate">{it.hint}</p>}
                          </div>
                          {active && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">↑</kbd><kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">↓</kbd> navigate</span>
                <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">↵</kbd> select</span>
              </div>
              <span>Signed in as {user?.name || user?.email}</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default CommandPalette;
