/**
 * Shared client-side enums — mirror the server Mongoose schemas exactly.
 *
 * Why this file exists: the audit found multiple "submit fails with 400 but
 * the toast is generic" bugs caused by the client sending values not in the
 * server's enum (e.g. task `status: 'in_progress'` when the server only
 * accepts `pending|ongoing|done`, or lead `source: 'manual'` when only
 * `referral|cold_call|website|social|inbound|outbound|other` are valid).
 *
 * Keep these in lock-step with:
 *   server/src/models/Task.ts
 *   server/src/models/Lead.ts
 *   server/src/models/Leave.ts
 *   server/src/models/User.ts
 *
 * If you change one side, change the other in the same commit. The server is
 * the security boundary, but the client should never send something the
 * server will reject — that's just a confusing error UX.
 */

// ── TASKS ───────────────────────────────────────────────────────────────
export const TASK_STATUSES = ['pending', 'ongoing', 'done'] as const;
export type  TaskStatus    = typeof TASK_STATUSES[number];

export const TASK_TYPES    = ['dev', 'ads', 'content', 'admin_task', 'personal'] as const;
export type  TaskType      = typeof TASK_TYPES[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type  TaskPriority    = typeof TASK_PRIORITIES[number];

// Friendly labels for UI dropdowns
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Not started',
  ongoing: 'In progress',
  done:    'Done',
};
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  dev:        'Development',
  ads:        'Ads / Marketing',
  content:    'Content',
  admin_task: 'Admin / Ops',
  personal:   'Personal',
};
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

/**
 * Cycle a task status forward. Used by the one-tap status toggle on
 * task cards. Pending → Ongoing → Done → Pending (loops).
 */
export function nextTaskStatus(current: TaskStatus): TaskStatus {
  const i = TASK_STATUSES.indexOf(current);
  return TASK_STATUSES[(i + 1) % TASK_STATUSES.length];
}

// ── LEADS ───────────────────────────────────────────────────────────────
export const LEAD_SOURCES = [
  'referral', 'cold_call', 'website', 'social',
  'inbound', 'outbound', 'other',
] as const;
export type LeadSource = typeof LEAD_SOURCES[number];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  referral:   'Referral',
  cold_call:  'Cold call',
  website:    'Website',
  social:     'Social / Meta',
  inbound:    'Inbound',
  outbound:   'Outbound',
  other:      'Other',
};

export const LEAD_STAGES = [
  'new_lead', 'dialed', 'connected', 'demo_booked', 'demo_done', 'demo2_conversion',
  'follow_up', 'hot_follow_up', 'cooking',
  'won', 'lost',
] as const;
export type LeadStage = typeof LEAD_STAGES[number];

// ── LEAVES ──────────────────────────────────────────────────────────────
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type  LeaveStatus    = typeof LEAVE_STATUSES[number];

export const LEAVE_DAY_TYPES = ['full', 'first_half', 'second_half'] as const;
export type  LeaveDayType    = typeof LEAVE_DAY_TYPES[number];

// ── USERS ───────────────────────────────────────────────────────────────
export const USER_ROLES = ['admin', 'employee', 'sales', 'client'] as const;
export type  UserRole   = typeof USER_ROLES[number];

// Teams an employee can be granted (separate from primary role).
// Single source of truth — was previously hardcoded inconsistently across
// AdminEmployees ('meta', 'ads', 'influencer', 'dev', 'content', 'sales')
// and ProfilePage ('web', 'marketing', 'content', 'sales', 'design', 'admin')
// — those didn't match each other so team chips never lined up.
export const USER_TEAMS = [
  'meta', 'ads', 'influencer', 'dev', 'content', 'sales', 'design',
] as const;
export type UserTeam = typeof USER_TEAMS[number];

export const USER_TEAM_LABEL: Record<UserTeam, string> = {
  meta:       'Meta Ads',
  ads:        'Google Ads',
  influencer: 'Influencer',
  dev:        'Development',
  content:    'Content',
  sales:      'Sales',
  design:     'Design',
};

// ── Helpers ─────────────────────────────────────────────────────────────
/**
 * Coerce an arbitrary string to a known enum value, or fall back to a
 * default. Use when accepting data from older records / external sources
 * that might have legacy values.
 */
export function coerceEnum<T extends readonly string[]>(
  value: any, list: T, fallback: T[number],
): T[number] {
  return list.includes(value) ? value : fallback;
}
