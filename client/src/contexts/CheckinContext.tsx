import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * CheckinContext — single source of truth for whether the logged-in user
 * has filled today's morning / midday / evening popups.
 *
 * Owner ask (June 2026): "Pop-ups are NECESSITY to keep Robin updated."
 *   - Morning  → blocks huddle join until done.
 *   - Midday   → auto-prompts between 1pm-2pm IST.
 *   - Evening  → blocks logout until done.
 *
 * The context owns:
 *   - status     (which popups are done today)
 *   - openKind   (which popup, if any, is currently open)
 *   - actions    (refresh, openMorning/Midday/Evening, close)
 *
 * Why context not a hook: three different surfaces (HuddleRequiredBanner,
 * the orchestrator timer, the logout flow) all need to read AND mutate
 * the same "is open?" state. Lifting into a context lets the logout
 * helper await `openEvening()` and then proceed.
 */

export type CheckinKind = 'morning' | 'midday' | 'evening';

export interface BrandForMorning {
  clientWorkflowId: string;
  clientName: string;
  hasMeta: boolean;
}

export interface MorningTask {
  taskId?: string;
  title: string;
  clientWorkflowId?: string | null;
  priority?: string;
  middayStatus?: string;
  middayNote?: string;
  eveningStatus?: string;
  eveningReason?: string;
}

export interface CheckinStatus {
  dateIST: string;
  morning:  { done: boolean; submittedAt: string | null; tasks: MorningTask[]; brands: any[] };
  midday:   { done: boolean; submittedAt: string | null; blockers: string };
  evening:  { done: boolean; submittedAt: string | null; tomorrowPlan: string };
  brandsForMorning: BrandForMorning[];
  yesterdayTomorrowPlan: string;
}

interface CheckinContextValue {
  status: CheckinStatus | null;
  loading: boolean;
  openKind: CheckinKind | null;
  /** Open a specific popup. Returns a promise that resolves when it closes. */
  open: (k: CheckinKind) => Promise<void>;
  close: () => void;
  /** Force a refresh of /api/checkin/today. */
  refresh: () => Promise<void>;
  /** Convenience boolean checks — the rest of the app reads these. */
  morningDone: boolean;
  middayDone:  boolean;
  eveningDone: boolean;
}

const CheckinContext = createContext<CheckinContextValue | null>(null);

export function CheckinProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [openKind, setOpenKind] = useState<CheckinKind | null>(null);
  const [closeResolver, setCloseResolver] = useState<(() => void) | null>(null);

  // Internal staff only. Clients never see the popups.
  const isStaff = !!user && ['admin', 'employee', 'sales', 'workroom'].includes(role);

  const refresh = useCallback(async () => {
    if (!isStaff) { setStatus(null); return; }
    setLoading(true);
    try {
      const s = await api.getCheckinToday();
      if (s && (s as any).ok && !(s as any).empty) {
        setStatus(s as CheckinStatus);
      } else {
        setStatus(null);
      }
    } catch {
      // Silent — banners will keep nudging; user retries.
    } finally {
      setLoading(false);
    }
  }, [isStaff]);

  // Initial load + reload on user change.
  useEffect(() => {
    if (!isStaff) { setStatus(null); return; }
    refresh();
  }, [isStaff, user?.id, refresh]);

  // Refresh whenever the app gets a data:changed event for checkins —
  // this catches the case where Sakshi submits her morning on her phone
  // and her desktop tab needs to remove the banner without a manual
  // reload. (And updates the admin report live.)
  useEffect(() => {
    if (!isStaff) return;
    const onData = (e: any) => {
      const detail = e?.detail;
      if (detail?.entity === 'checkin') refresh();
    };
    window.addEventListener('robin:data-changed', onData);
    return () => window.removeEventListener('robin:data-changed', onData);
  }, [isStaff, refresh]);

  const open = useCallback(async (k: CheckinKind) => {
    // No-op for non-staff. Resolve immediately so logout doesn't hang.
    if (!isStaff) return;
    setOpenKind(k);
    await new Promise<void>(resolve => setCloseResolver(() => resolve));
  }, [isStaff]);

  const close = useCallback(() => {
    setOpenKind(null);
    // Drain any pending resolver from open(). Use setTimeout so the
    // resolve fires AFTER React commits the close — otherwise the
    // caller of open() can run before the modal unmounts.
    setTimeout(() => {
      if (closeResolver) {
        try { closeResolver(); } catch { /* */ }
        setCloseResolver(null);
      }
    }, 0);
  }, [closeResolver]);

  const morningDone = !!status?.morning?.done;
  const middayDone  = !!status?.midday?.done;
  const eveningDone = !!status?.evening?.done;

  // Mirror morning-done state onto a window flag so non-React surfaces
  // (HuddleContext auto-join, axios interceptors) can read it without
  // creating a circular import. False = morning is pending → huddle
  // auto-join should bail.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__robinMorningDone = !isStaff || morningDone;
    (window as any).__robinEveningDone = !isStaff || eveningDone;
    // AuthContext.logout uses this to AWAIT the evening modal before
    // wiping the session. Storing the function (not the result) on the
    // window keeps it importable from any non-React caller too.
    (window as any).__robinOpenCheckin = open;
  }, [isStaff, morningDone, eveningDone, open]);

  return (
    <CheckinContext.Provider value={{
      status, loading, openKind, open, close, refresh,
      morningDone, middayDone, eveningDone,
    }}>
      {children}
    </CheckinContext.Provider>
  );
}

export function useCheckin() {
  const ctx = useContext(CheckinContext);
  if (!ctx) throw new Error('useCheckin must be used within CheckinProvider');
  return ctx;
}
