import type { ReactNode } from 'react';
import {
  Activity, Coffee, Moon, Plane, Headphones, Monitor, ShieldX,
  Search, Rocket, AlertTriangle, Clock, UserCheck, RefreshCw,
} from 'lucide-react';

/**
 * <StatusPill /> — single canonical pill for ANY status in the app.
 *
 * Supports both presence states (in_huddle, working, on_break, etc.) and
 * project health states (healthy, at_risk, delayed, blocked, etc.). The
 * UI never needs to know how the pill is colored or which icon is used —
 * just pass the state.
 *
 * Sizes:  xs (compact, dashboards) · sm (default) · md (header / hero)
 */

export type Status =
  // Presence
  | 'in_huddle' | 'working' | 'lurking' | 'on_break' | 'away' | 'on_leave' | 'off_clock'
  // Project health
  | 'healthy' | 'at_risk' | 'delayed' | 'blocked'
  | 'waiting_client' | 'waiting_internal' | 'revision' | 'final_qa' | 'ready_to_deliver';

interface Props {
  state: Status;
  size?: 'xs' | 'sm' | 'md';
  label?: string;            // override the default label
  icon?: 'auto' | 'none';
  className?: string;
}

const config: Record<Status, { label: string; tone: string; icon: ReactNode }> = {
  // Presence
  in_huddle:        { label: 'In huddle',     tone: 'bg-primary/12 text-primary border-primary/20',                icon: <Headphones className="h-3 w-3" /> },
  working:          { label: 'Working',       tone: 'bg-emerald-500/12 text-emerald-700 border-emerald-500/20',   icon: <Activity   className="h-3 w-3" /> },
  lurking:          { label: 'In huddle · not clocked in', tone: 'bg-amber-500/12 text-amber-700 border-amber-500/20', icon: <Headphones className="h-3 w-3" /> },
  on_break:         { label: 'On break',      tone: 'bg-amber-500/12 text-amber-700 border-amber-500/20',         icon: <Coffee     className="h-3 w-3" /> },
  away:             { label: 'Away',          tone: 'bg-slate-400/12 text-slate-600 border-slate-400/20',         icon: <Clock      className="h-3 w-3" /> },
  on_leave:         { label: 'On leave',      tone: 'bg-blue-500/12 text-blue-700 border-blue-500/20',            icon: <Plane      className="h-3 w-3" /> },
  off_clock:        { label: 'Off the clock', tone: 'bg-muted text-muted-foreground border-border',                icon: <Moon       className="h-3 w-3" /> },
  // Project health
  healthy:          { label: 'On track',      tone: 'bg-emerald-500/12 text-emerald-700 border-emerald-500/20',   icon: <Activity   className="h-3 w-3" /> },
  at_risk:          { label: 'At risk',       tone: 'bg-amber-500/12 text-amber-700 border-amber-500/20',         icon: <AlertTriangle className="h-3 w-3" /> },
  delayed:          { label: 'Delayed',       tone: 'bg-orange-500/15 text-orange-700 border-orange-500/25',      icon: <Clock      className="h-3 w-3" /> },
  blocked:          { label: 'Blocked',       tone: 'bg-rose-500/12 text-rose-700 border-rose-500/20',             icon: <ShieldX    className="h-3 w-3" /> },
  waiting_client:   { label: 'Waiting on client',   tone: 'bg-violet-500/12 text-violet-700 border-violet-500/20', icon: <UserCheck className="h-3 w-3" /> },
  waiting_internal: { label: 'Waiting on team',     tone: 'bg-blue-500/12 text-blue-700 border-blue-500/20',       icon: <Monitor   className="h-3 w-3" /> },
  revision:         { label: 'Revision',      tone: 'bg-fuchsia-500/12 text-fuchsia-700 border-fuchsia-500/20',    icon: <RefreshCw  className="h-3 w-3" /> },
  final_qa:         { label: 'Final QA',      tone: 'bg-cyan-500/12 text-cyan-700 border-cyan-500/20',             icon: <Search    className="h-3 w-3" /> },
  ready_to_deliver: { label: 'Ready to ship', tone: 'bg-emerald-600/15 text-emerald-800 border-emerald-600/25',    icon: <Rocket    className="h-3 w-3" /> },
};

const sizeMap = {
  xs: 'h-5 px-1.5 text-[10px] gap-1 rounded',
  sm: 'h-[22px] px-2 text-[11px] gap-1 rounded-md',
  md: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
};

export function StatusPill({ state, size = 'sm', label, icon = 'auto', className = '' }: Props) {
  const c = config[state];
  return (
    <span className={`inline-flex items-center font-semibold border ${c.tone} ${sizeMap[size]} ${className}`}>
      {icon !== 'none' && c.icon}
      <span className="leading-none">{label || c.label}</span>
    </span>
  );
}
