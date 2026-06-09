import api, { silent } from './axios';

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login        = (email: string, password: string) => api.post('/auth/login', { email, password }).then(r => r.data);
export const googleLogin  = (credential: string)              => api.post('/auth/google', { credential }).then(r => r.data);
export const register     = (data: Record<string, unknown>)   => api.post('/auth/register', data).then(r => r.data);
export const getMe        = ()                                 => api.get('/auth/me').then(r => r.data);
export const updateMe     = (data: Record<string, unknown>)   => api.put('/auth/me', data).then(r => r.data);
export const changePassword = (data: Record<string, unknown>) => api.put('/auth/password', data).then(r => r.data);

// ── Sessions: heartbeat ───────────────────────────────────────────────────────
// Bump lastHeartbeatAt on the user's active session. Called every 60s while
// the dashboard is open. If the browser closes, pings stop, and time stops.
// Heartbeat runs every 60s in the background — never show toast errors for it.
// A few failed heartbeats during a network blip are normal and recoverable.
export const sessionHeartbeat = () => api.post('/sessions/heartbeat', undefined, silent()).then(r => r.data);

// Toggle "On Call" do-not-disturb flag.
export const setOnCall = (on: boolean) => api.post('/sessions/on-call', { on }).then(r => r.data);

// ── Transcripts (huddle Web Speech API) ───────────────────────────────────────
export const postTranscriptLines = (body: {
  roomId: string;
  lines: Array<{ text: string; confidence?: number; startedAt: string; endedAt?: string }>;
  language?: string;
}) => api.post('/transcripts/lines', body).then(r => r.data);

export const listTranscripts = (params?: { date?: string; userId?: string }) =>
  api.get('/transcripts', { params }).then(r => r.data);

// ── AI ────────────────────────────────────────────────────────────────────────
// Get today's morning briefing. Pass refresh=true to bypass cache (admin only,
// useful when iterating on prompts; backend ignores it for normal users).
export const aiMorningBrief = (refresh = false) =>
  api.get('/ai/morning-brief', { params: refresh ? { refresh: 1 } : {} }).then(r => r.data);

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getAdminStats        = ()   => api.get('/dashboard/stats').then(r => r.data);
export const getAtRiskProjects    = ()   => api.get('/dashboard/at-risk').then(r => r.data);
export const getEmployeeDashboard = ()   => api.get('/dashboard/employee').then(r => r.data);
export const getDashboardClient   = ()   => api.get('/dashboard/client').then(r => r.data);
export const getSalesDashboard    = ()   => api.get('/dashboard/sales').then(r => r.data);
// legacy alias
export const getClientDashboard   = ()   => getDashboardClient();

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsers   = (params?: Record<string, unknown>) => api.get('/users', { params }).then(r => r.data);
export const getUserById = (id: string)                        => api.get(`/users/${id}`).then(r => r.data);
export const updateUser  = (id: string, d: Record<string, unknown>) => api.put(`/users/${id}`, d).then(r => r.data);
export const deleteUser  = (id: string)                        => api.delete(`/users/${id}`).then(r => r.data);
// Admin resets any user's password. If newPassword is omitted, the server
// generates a random one and returns it for the admin to share.
export const adminResetPassword = (id: string, newPassword?: string) =>
  api.post(`/users/${id}/reset-password`, { newPassword }).then(r => r.data);

// ── Projects ──────────────────────────────────────────────────────────────────
export const listProjects        = ()                                      => api.get('/projects').then(r => r.data);
export const createProject       = (d: Record<string, unknown>)           => api.post('/projects', d).then(r => r.data);
export const getProject          = (id: string)                           => api.get(`/projects/${id}`).then(r => r.data);
export const updateProject       = (id: string, d: Record<string, unknown>) => api.put(`/projects/${id}`, d).then(r => r.data);
export const deleteProject       = (id: string)                           => api.delete(`/projects/${id}`).then(r => r.data);
export const addProjectMember    = (id: string, d: Record<string, unknown>) => api.post(`/projects/${id}/members`, d).then(r => r.data);
export const removeProjectMember = (id: string, uid: string)              => api.delete(`/projects/${id}/members/${uid}`).then(r => r.data);

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const listTasks       = ()                                        => api.get('/tasks').then(r => r.data);
export const createTask      = (d: Record<string, unknown>)             => api.post('/tasks', d).then(r => r.data);
export const getTask         = (id: string)                             => api.get(`/tasks/${id}`).then(r => r.data);
export const updateTask      = (id: string, d: Record<string, unknown>) => api.put(`/tasks/${id}`, d).then(r => r.data);
export const deleteTask      = (id: string)                             => api.delete(`/tasks/${id}`).then(r => r.data);
export const getProjectTasks = (projectId: string)                      => api.get(`/tasks/project/${projectId}`).then(r => r.data);
export const addTaskComment  = (id: string, content: string)            => api.post(`/tasks/${id}/comments`, { content }).then(r => r.data);

// ── Goals ─────────────────────────────────────────────────────────────────────
export const getGoals   = (projectId: string)                        => api.get(`/goals/project/${projectId}`).then(r => r.data);
export const createGoal = (d: Record<string, unknown>)              => api.post('/goals', d).then(r => r.data);
export const updateGoal = (id: string, d: Record<string, unknown>)  => api.put(`/goals/${id}`, d).then(r => r.data);
export const deleteGoal = (id: string)                              => api.delete(`/goals/${id}`).then(r => r.data);

// ── Metrics ───────────────────────────────────────────────────────────────────
export const getMetrics   = (projectId: string, params?: Record<string, unknown>) => api.get(`/metrics/project/${projectId}`, { params }).then(r => r.data);
export const createMetric = (d: Record<string, unknown>)                           => api.post('/metrics', d).then(r => r.data);

// ── Updates ───────────────────────────────────────────────────────────────────
export const getUpdates    = (projectId: string)                      => api.get(`/updates/project/${projectId}`).then(r => r.data);
export const createUpdate  = (d: Record<string, unknown>)             => api.post('/updates', d).then(r => r.data);
export const approveUpdate = (id: string)                             => api.put(`/updates/${id}/approve`, {}).then(r => r.data);
export const rejectUpdate  = (id: string, feedback: string)           => api.put(`/updates/${id}/reject`, { feedback }).then(r => r.data);

// ── Sessions ──────────────────────────────────────────────────────────────────
export const startSession      = () => api.post('/sessions/start', {}).then(r => r.data);
export const startBreak        = () => api.post('/sessions/break', {}).then(r => r.data);
export const endBreak          = () => api.post('/sessions/break/end', {}).then(r => r.data);
export const endSession        = () => api.post('/sessions/end', {}).then(r => r.data);
export const getActiveSession  = () => api.get('/sessions/active').then(r => r.data);
export const getSessionHistory = (params?: Record<string, unknown>) => api.get('/sessions/history', { params }).then(r => r.data);
export const getPerformance    = (params?: Record<string, unknown>) => api.get('/sessions/performance', { params }).then(r => r.data);
export const getTeamSessionStatus = () => api.get('/sessions/team-status').then(r => r.data);
// Huddle attendance — when called, the server starts/pauses the work
// counter for this session. silent() because these fire on every join/
// leave and we don't want a network blip toasting the user mid-meeting.
export const huddleJoined  = () => api.post('/sessions/huddle-joined', {}, silent()).then(r => r.data);
export const huddleLeft    = () => api.post('/sessions/huddle-left',   {}, silent()).then(r => r.data);

// ── Screen Sessions ───────────────────────────────────────────────────────────
export const updateScreenStatus = (d: Record<string, unknown>) => api.put('/screen-sessions/status', d).then(r => r.data);
export const listScreenSessions = ()                            => api.get('/screen-sessions').then(r => r.data);

// ── Leads ─────────────────────────────────────────────────────────────────────
export const listLeads   = (params?: Record<string, unknown>) => api.get('/leads', { params }).then(r => r.data);
export const createLead  = (d: Record<string, unknown>)       => api.post('/leads', d).then(r => r.data);
// Bulk import — accepts an array of {name, phone?, email?, company?, source?, value?, notes?} rows
// parsed from CSV or a Google Sheets paste. Server dedupes by phone+email.
export const importLeads = (rows: Array<Record<string, any>>)  => api.post('/leads/import', { rows }).then(r => r.data);

// ── Focus This Week — sales priority list + assignments ────────────────
// Each rep owns one FocusList per week. Items reference a Lead or a
// Client User; assignees get a notification when added.
export const listFocusLists       = (params?: { weekStart?: string; mine?: '1'; ownerId?: string }) =>
  api.get('/focus-list', { params }).then(r => r.data);
export const getOrCreateFocusList = (weekStart?: string) =>
  api.post('/focus-list', { weekStart }).then(r => r.data);
export const addFocusItem         = (id: string, body: {
  leadId?: string; clientUserId?: string;
  label: string; subLabel?: string;
  urgency?: 'watch' | 'high' | 'critical';
  note?: string;
  assignedTo?: string[];
}) => api.post(`/focus-list/${id}/items`, body).then(r => r.data);
export const updateFocusItem      = (id: string, itemId: string, body: Record<string, unknown>) =>
  api.put(`/focus-list/${id}/items/${itemId}`, body).then(r => r.data);
export const assignFocusItem      = (id: string, itemId: string, assignedTo: string[]) =>
  api.post(`/focus-list/${id}/items/${itemId}/assign`, { assignedTo }).then(r => r.data);
export const removeFocusItem      = (id: string, itemId: string) =>
  api.delete(`/focus-list/${id}/items/${itemId}`).then(r => r.data);

// ── Lead source integrations (Google Sheets live sync) ──────────────────
export const sheetGetStatus    = () => api.get('/integrations/sheet').then(r => r.data);
export const sheetConnect      = (body: { spreadsheetId: string; sheetName?: string }) =>
  api.post('/integrations/sheet', body).then(r => r.data);
export const sheetDisconnect   = () => api.delete('/integrations/sheet').then(r => r.data);
export const sheetSyncNow      = () => api.post('/integrations/sheet/sync').then(r => r.data);
// Live read-through of the connected sheet, headers + rows untouched.
export const sheetPreview      = (limit = 500) =>
  api.get('/integrations/sheet/preview', { params: { limit } }).then(r => r.data);

// ── Centralized error logs (admin-only) ────────────────────────────────
// Returns up to 500 most-recent errors (server + client) for the admin's org.
export const listErrorLogs = (params: { source?: 'server' | 'client'; limit?: number } = {}) =>
  api.get('/logs', { params }).then(r => r.data);

// ── Seed (admin-only, one-shot helpers) ────────────────────────────────
export const seedDemoClients = () => api.post('/seed/demo-clients', {}).then(r => r.data);
// One-shot: maps Om/Sakshi/Priyanka/Rishi to their canonical team + role
// so the workflow auto-assigner picks the right person. Admin-only.
export const assignTeamRoles  = () => api.post('/seed/assign-roles', {}).then(r => r.data);

// ── Client Workflow pipeline (services + SOP checklists per client) ────
export const cwListWorkflows    = (params: { q?: string; mine?: '1' } = {}) =>
  api.get('/client-workflows', { params }).then(r => r.data);
export const cwGetWorkflow      = (id: string) => api.get(`/client-workflows/${id}`).then(r => r.data);
export const cwCreateWorkflow   = (body: { clientId: string; services: string[] }) =>
  api.post('/client-workflows', body).then(r => r.data);
// A short `comment` is now REQUIRED on every check / uncheck and on
// completeService — captured for the activity log so admin can audit who
// said what when changing pipeline state.
export const cwToggleCheck      = (wid: string, sid: string, body: { index: number; done: boolean; comment: string }) =>
  api.put(`/client-workflows/${wid}/services/${sid}/check`, body).then(r => r.data);
export const cwCompleteService  = (wid: string, sid: string, body: { comment: string }) =>
  api.put(`/client-workflows/${wid}/services/${sid}/complete`, body).then(r => r.data);
export const cwReturnService    = (wid: string, body: { targetServiceType: string; reason: string }) =>
  api.put(`/client-workflows/${wid}/return`, body).then(r => r.data);
export const cwAddNote          = (wid: string, body: { detail: string; serviceType?: string }) =>
  api.post(`/client-workflows/${wid}/notes`, body).then(r => r.data);
export const cwReassignService  = (wid: string, sid: string, body: { userId: string }) =>
  api.put(`/client-workflows/${wid}/services/${sid}/reassign`, body).then(r => r.data);
// Assignee's tentative completion date — see server route comment.
// `eta` is YYYY-MM-DD (or null to clear). Optional one-line comment
// for the audit log so admin can see WHY the ETA was set / shifted.
export const cwSetServiceEta    = (wid: string, sid: string, body: { eta: string | null; comment?: string }) =>
  api.put(`/client-workflows/${wid}/services/${sid}/eta`, body).then(r => r.data);
export const cwGetTemplates     = () => api.get('/client-workflows/templates').then(r => r.data);

// Pipeline 2.0 — explicit project-level blocker.
// blockerType MUST be one of: waiting_client_input | waiting_internal_approval | dependency | technical | budget.
// blockerReason is required ("WHY blocked"); comment is the audit trail line.
export const cwBlock            = (wid: string, body: { blockerType: string; blockerReason: string; comment: string }) =>
  api.put(`/client-workflows/${wid}/block`, body).then(r => r.data);
export const cwUnblock          = (wid: string, body: { comment: string }) =>
  api.put(`/client-workflows/${wid}/unblock`, body).then(r => r.data);

// Cursor-paginated activity feed for the right-drawer timeline.
// Pass cursor = last _id you've seen; backend returns { rows, nextCursor }.
// Pipeline 2.1 — bulk action across many workflows in one request. Powers
// the multi-select toolbar (priority bump, post-note-to-many, mark-on-track).
// Returns counters so the UI can render "12 updated, 1 skipped" toast.
export const cwBulk             = (body: {
  ids: string[];
  action: 'priority' | 'note' | 'mark-on-track';
  payload?: { value?: 'low'|'medium'|'high'|'urgent'; detail?: string };
}) => api.post('/client-workflows/bulk', body).then(r => r.data as {
  updated: number; skipped: number; errors: string[]; total: number;
});

export const cwListActivity     = (wid: string, params: { cursor?: string; limit?: number } = {}) =>
  api.get(`/client-workflows/${wid}/activity`, { params }).then(r => r.data as {
    rows: Array<{
      _id: string;
      action: string;
      serviceType?: string;
      serviceId?: string;
      checklistIndex?: number;
      actorId: string;
      actorName: string;
      actorRole?: string;
      comment?: string;
      before?: any;
      after?: any;
      createdAt: string;
      isClientRelevant?: boolean;
    }>;
    nextCursor: string | null;
  });

// ── Client Schedule (per-employee weekly calendar of clients to serve) ──
export const listClientSchedule = (params: { from?: string; to?: string; userId?: string } = {}) =>
  api.get('/client-schedule', { params }).then(r => r.data);
export const todaysClientSchedule = () =>
  api.get('/client-schedule/today').then(r => r.data);
export const createClientScheduleEntry = (body: {
  clientId: string; serviceDate: string; userId?: string; taskType?: string; notes?: string;
}) => api.post('/client-schedule', body).then(r => r.data);
export const updateClientScheduleEntry = (id: string, body: Record<string, any>) =>
  api.put(`/client-schedule/${id}`, body).then(r => r.data);
export const deleteClientScheduleEntry = (id: string) =>
  api.delete(`/client-schedule/${id}`).then(r => r.data);
export const getLead     = (id: string)                        => api.get(`/leads/${id}`).then(r => r.data);
export const updateLead  = (id: string, d: Record<string, unknown>) => api.put(`/leads/${id}`, d).then(r => r.data);
export const deleteLead  = (id: string)                        => api.delete(`/leads/${id}`).then(r => r.data);
export const addLeadNote = (id: string, d: Record<string, unknown>) => api.post(`/leads/${id}/notes`, d).then(r => r.data);
export const convertLead = (id: string, d: Record<string, unknown>) => api.post(`/leads/${id}/convert`, d).then(r => r.data);
// Lead payment ledger — appends one event, updates the denormalised
// status/paid/note fields on the parent doc. See server markLeadPayment.
//   status — part_paid / full_paid / refunded
//   amount — what was just paid (or refunded)
//   note   — what triggers the NEXT payment (rep's own words)
//   total  — optional, set the full deal value once and keep updating amount
export const markLeadPayment = (id: string, body: {
  status: 'part_paid' | 'full_paid' | 'refunded';
  amount: number;
  note?:  string;
  total?: number;
}) => api.post(`/leads/${id}/payment`, body).then(r => r.data);

// ── Deals ─────────────────────────────────────────────────────────────────────
export const listDeals  = ()                                        => api.get('/deals').then(r => r.data);
export const createDeal = (d: Record<string, unknown>)             => api.post('/deals', d).then(r => r.data);
export const updateDeal = (id: string, d: Record<string, unknown>) => api.put(`/deals/${id}`, d).then(r => r.data);
export const deleteDeal = (id: string)                             => api.delete(`/deals/${id}`).then(r => r.data);

// ── Transactions / Alerts ─────────────────────────────────────────────────────
export const listTransactions  = (params?: Record<string, unknown>) => api.get('/transactions', { params }).then(r => r.data);
export const myTransactions    = ()                                  => api.get('/transactions/me').then(r => r.data);
export const createTransaction = (d: Record<string, unknown>)       => api.post('/transactions', d).then(r => r.data);
export const updateTransaction = (id: string, d: Record<string, unknown>) => api.put(`/transactions/${id}`, d).then(r => r.data);
export const myAlerts          = ()                                  => api.get('/alerts/me').then(r => r.data);
export const readAlert         = (id: string)                        => api.put(`/alerts/${id}/read`, {}).then(r => r.data);
export const createAlert       = (d: Record<string, unknown>)       => api.post('/alerts', d).then(r => r.data);

// ── Notifications ─────────────────────────────────────────────────────────────
export const listNotifications    = (params?: Record<string, unknown> & { silent?: boolean }) => {
  // Background polls can pass { silent: true } so a transient 401 / 5xx
  // doesn't trigger a toast OR boot the user to /login. We strip the flag
  // before sending so it doesn't end up as a URL query param.
  const isSilent = params?.silent === true;
  const { silent: _stripped, ...rest } = (params || {}) as any;
  void _stripped;
  return api.get('/notifications', {
    params: rest,
    headers: isSilent ? { 'X-Silent': '1' } : undefined,
  }).then(r => r.data);
};
export const readAllNotifications = ()                                  => api.put('/notifications/read-all', {}).then(r => r.data);
export const readNotification     = (id: string)                       => api.put(`/notifications/${id}/read`, {}).then(r => r.data);
export const deleteNotification   = (id: string)                       => api.delete(`/notifications/${id}`).then(r => r.data);

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminEmployees  = ()                                         => api.get('/admin/employees').then(r => r.data);
export const adminClients    = ()                                         => api.get('/admin/clients').then(r => r.data);
export const adminActivity   = (params?: Record<string, unknown>)        => api.get('/admin/activity', { params }).then(r => r.data);
export const adminInvite     = (d: Record<string, unknown>)              => api.post('/admin/invite', d).then(r => r.data);
export const adminUpdateRole = (id: string, role: string)                => api.put(`/admin/users/${id}/role`, { role }).then(r => r.data);
// Multi-team / multi-role assignment — admin-only via /api/users/:id (existing route)
export const adminUpdateUser = (id: string, patch: { team?: string; teams?: string[]; roles?: string[] }) =>
  api.put(`/users/${id}`, patch).then(r => r.data);
export const adminResetPass  = (id: string, newPassword?: string)        => api.put(`/admin/users/${id}/reset-password`, { newPassword }).then(r => r.data);
// Delegate workroom-onboarding permission to a non-admin user (e.g. Om).
export const adminSetCanManageWorkroom = (id: string, enabled: boolean) =>
  api.put(`/admin/users/${id}/can-manage-workroom`, { enabled }).then(r => r.data);
// Create a new role='workroom' teammate. Admin OR canManageWorkroom users.
export const onboardWorkroomUser = (body: { email: string; name?: string; password?: string }) =>
  api.post('/workroom-onboard', body).then(r => r.data);

// ── Issue reporter + Ask Robin (AI helper) ────────────────────────────
export const reportIssue = (body: {
  description: string;
  screenshotData?: string;
  context?: Record<string, unknown>;
}) => api.post('/issues', body).then(r => r.data);
export const askRobin = (body: { question: string; context?: Record<string, unknown> }) =>
  api.post('/issues/ask', body).then(r => r.data);
export const listIssues    = (params?: { status?: string; area?: string; limit?: number }) =>
  api.get('/issues', { params }).then(r => r.data);
export const getIssue      = (id: string) => api.get(`/issues/${id}`).then(r => r.data);
export const updateIssue   = (id: string, body: { status?: string; resolution?: string }) =>
  api.put(`/issues/${id}`, body).then(r => r.data);
export const issueClusters = () => api.get('/issues/clusters').then(r => r.data);

// ── AI Automation (lead scoring, workflow summary, org-wide morning brief)
// Note: distinct from the existing per-user `aiMorningBrief` (Claude-based,
// individualised). These call the new Gemini-backed automation routes.
export const aiRescoreLead          = (id: string) => api.post(`/ai-automation/score-lead/${id}`).then(r => r.data);
export const aiSummarizeWorkflow    = (id: string) => api.post(`/ai-automation/summarize-workflow/${id}`).then(r => r.data);
export const aiBriefAllProjects     = ()           => api.post('/ai-automation/brief-all-projects', {}).then(r => r.data);
export const aiParseCommand         = (message: string) => api.post('/ai-automation/parse-command', { message }).then(r => r.data);
// Robin Copilot — context-aware Q&A. The page passes its current route plus
// any contextual IDs (workflow / lead) so the server can pull a tight slice
// of the org's data to feed the model. Server caches per (user, ctx, q).
export const aiCopilot              = (body: {
  question:    string;
  route:       string;
  workflowId?: string;
  leadId?:     string;
}) => api.post('/ai-automation/copilot', body).then(r => r.data as {
  answer:    string;
  aiUsed:    boolean;
  threadId:  string;
  turnCount: number;
});

// Robin Copilot — persistent thread per user (memory + Robin-aware + role-tuned).
// Drawer loads the thread on open so the conversation picks up where it left off.
export interface CopilotTurn {
  _id:    string;
  role:   'user' | 'assistant' | 'system';
  text:   string;
  route?: string;
  aiUsed: boolean;
  at:     string;
}
export const aiCopilotThread        = () =>
  api.get('/ai-automation/copilot/thread').then(r => r.data as {
    _id: string; pinnedNote: string; turns: CopilotTurn[];
  });
export const aiCopilotReset         = () =>
  api.delete('/ai-automation/copilot/thread').then(r => r.data as { ok: boolean });
export const aiCopilotPin           = (note: string) =>
  api.patch('/ai-automation/copilot/thread/pin', { note }).then(r => r.data as { ok: boolean; pinnedNote: string });

// Sales lead AI — heuristic insights (no LLM call) + drafted follow-up (Gemini).
export const aiLeadInsights         = (id: string) =>
  api.get(`/ai-automation/lead-insights/${id}`).then(r => r.data as {
    closingProbability: number;
    ghostingRisk:       number;
    nextMove:           string;
    aiScore?:           '' | 'hot' | 'warm' | 'cold';
    aiReason?:          string;
    aiNextAction?:      string;
  });

// Admin one-click "how is this person doing?" — last N days of sessions
// (break-credit math applied), tasks, attendance patterns. Server batches
// it into one Gemini call cached per (user, periodDays, recent activity).
export const aiEmployeeReport       = (userId: string, periodDays = 7) =>
  api.post(`/ai-automation/employee-report/${userId}`, { periodDays }).then(r => r.data as {
    text: string;
    aiUsed: boolean;
    snapshot: {
      name: string;
      role?: string;
      team?: string;
      periodDays: number;
      days: Array<{
        date: string;
        workedMin: number;
        grossMin: number;
        breakMin: number;
        onCallMin: number;
        huddleMin: number;
        awayMin: number;
        firstStart?: string;
        lastEnd?: string;
        sessionCount: number;
      }>;
      patterns: {
        avgWorkedHoursPerDay: number;
        avgBreakMin: number;
        shortBreakDays: number;
        longBreakDays: number;
        noBreakDays: number;
        lateStartDays: number;
        onCallDays: number;
        huddleDayPct: number;
      };
      tasks: { completed: number; assigned: number; ongoing: number; overdue: number };
    };
  });

// Task AI Focus — "what should I do RIGHT NOW?". Heuristic, no LLM call.
// Server ranks the calling user's open tasks; UI picks top N.
export const aiFocus                = (limit = 5) =>
  api.get('/ai-automation/focus', { params: { limit } }).then(r => r.data as {
    items: Array<{
      _id: string; title: string; priority: 'low'|'medium'|'high'|'urgent';
      dueDate?: string; status: 'pending'|'ongoing'|'done';
      taskType?: string; projectName?: string;
      focusScore: number; reason: string;
      bucket: 'overdue' | 'today' | 'next' | 'unblock';
    }>;
    totalOpen: number;
    generatedAt: string;
  });

export const aiLeadFollowup         = (id: string, body: { channel?: 'whatsapp' | 'email' } = {}) =>
  api.post(`/ai-automation/lead-followup/${id}`, body).then(r => r.data as {
    message:               string;
    aiUsed:                boolean;
    channel:               'whatsapp' | 'email';
    daysSinceLastContact:  number;
  });
export const aiOrgMorningBrief      = ()           => api.get('/ai-automation/morning-brief').then(r => r.data);
export const aiRegenerateOrgBrief   = ()           => api.post('/ai-automation/morning-brief', {}).then(r => r.data);
export const adminRemoveUser = (id: string)                              => api.delete(`/admin/users/${id}`).then(r => r.data);
export const adminEmployeeReport = (employeeId: string, period: 'daily' | 'weekly' | 'monthly' = 'daily') =>
  api.get(`/admin/employees/${employeeId}/report`, { params: { period } }).then(r => r.data);

// ── Chat ──────────────────────────────────────────────────────────────────────
export const getChatHistory = (params?: Record<string, unknown>) => api.get('/chat/history', { params }).then(r => r.data);
export const postChatMessage = (d: Record<string, unknown>)      => api.post('/chat', d).then(r => r.data);

// ── Client Queries ────────────────────────────────────────────────────────────
export const listQueries       = (params?: Record<string, unknown>) => api.get('/queries', { params }).then(r => r.data);
export const createQuery       = (d: Record<string, unknown>)      => api.post('/queries', d).then(r => r.data);
export const replyQuery        = (id: string, content: string)     => api.post(`/queries/${id}/reply`, { content }).then(r => r.data);
export const updateQueryStatus = (id: string, status: string)      => api.put(`/queries/${id}/status`, { status }).then(r => r.data);
export const sendPaymentAlert  = (d: Record<string, unknown>)      => api.post('/queries/payment-alert', d).then(r => r.data);

// ── Ad Reports ────────────────────────────────────────────────────────────────
export const listAdReports     = (params?: Record<string, unknown>) => api.get('/ad-reports', { params }).then(r => r.data);
export const createAdReport    = (d: Record<string, unknown>)       => api.post('/ad-reports', d).then(r => r.data);
export const updateAdReport    = (id: string, d: Record<string, unknown>) => api.put(`/ad-reports/${id}`, d).then(r => r.data);
export const deleteAdReport    = (id: string)                        => api.delete(`/ad-reports/${id}`).then(r => r.data);
export const getAdReportSummary = (params?: Record<string, unknown>)  => api.get('/ad-reports/summary', { params }).then(r => r.data);

// ── Influencer Sheet ──────────────────────────────────────────────────────────
export const listInfluencers    = (params?: Record<string, unknown>)      => api.get('/influencers', { params }).then(r => r.data);
export const createInfluencer   = (d: Record<string, unknown>)            => api.post('/influencers', d).then(r => r.data);
export const updateInfluencer   = (id: string, d: Record<string, unknown>)=> api.put(`/influencers/${id}`, d).then(r => r.data);
export const deleteInfluencer   = (id: string)                            => api.delete(`/influencers/${id}`).then(r => r.data);
export const influencerStats    = ()                                       => api.get('/influencers/stats').then(r => r.data);
export const createUser = (d: Record<string, unknown>) => api.post('/users', d).then(r => r.data);

// ── Client Credential Vault ───────────────────────────────────────────────────
export const listCredentials   = (params?: Record<string, unknown>)      => api.get('/credentials', { params }).then(r => r.data);
export const createCredential  = (d: Record<string, unknown>)            => api.post('/credentials', d).then(r => r.data);
export const updateCredential  = (id: string, d: Record<string, unknown>)=> api.put(`/credentials/${id}`, d).then(r => r.data);
export const deleteCredential  = (id: string)                            => api.delete(`/credentials/${id}`).then(r => r.data);
export const logCredentialAccess = (id: string, action: 'copy' | 'reveal' = 'copy') =>
  api.post(`/credentials/${id}/access`, { action }).then(r => r.data).catch(() => null);
export const listVaultAudit    = (params?: Record<string, unknown>) =>
  api.get('/credentials/audit', { params }).then(r => r.data);

// ── Leave Applications ────────────────────────────────────────────────────────
export const createLeave       = (d: { days: { date: string; reason: string; dayType?: 'full' | 'first_half' | 'second_half' }[] }) =>
  api.post('/leaves', d).then(r => r.data);
export const listMyLeaves      = () => api.get('/leaves/mine').then(r => r.data);
export const cancelLeave       = (id: string) => api.put(`/leaves/${id}/cancel`, {}).then(r => r.data);
export const adminListLeaves   = (params?: Record<string, unknown>) =>
  api.get('/leaves/admin', { params }).then(r => r.data);
export const approveLeave      = (id: string, note?: string) =>
  api.put(`/leaves/${id}/approve`, { note }).then(r => r.data);
export const rejectLeave       = (id: string, note?: string) =>
  api.put(`/leaves/${id}/reject`, { note }).then(r => r.data);
// Admin fix dates / status on any leave (e.g. correcting off-by-one date)
export const adminEditLeave    = (id: string, body: { days?: { date: string; reason?: string; dayType?: string }[]; status?: string }) =>
  api.put(`/leaves/${id}/admin-edit`, body).then(r => r.data);
export const onLeaveToday      = () => api.get('/leaves/on-leave-today').then(r => r.data);
// "Are you working today?" — fetch self's approved leave for today (or null)
export const myLeaveToday      = () => api.get('/leaves/mine-today').then(r => r.data);
// Convert today's leave because user is actually working
//   workingType: 'full' (cancel leave) | 'first_half' (work morning, off pm) | 'second_half' (work pm, off morning)
export const setWorkingDespiteLeave = (workingType: 'full' | 'first_half' | 'second_half') =>
  api.put('/leaves/mine-today/working', { workingType }).then(r => r.data);
export const adminLeavesSummary = () => api.get('/leaves/admin/summary').then(r => r.data);
export const adminAttendance    = (date?: string) => api.get('/admin/attendance', { params: date ? { date } : {} }).then(r => r.data);

// ── Meta Ads ──────────────────────────────────────────────────────────────────
export const metaAdsAccounts        = () => api.get('/ads/meta/accounts').then(r => r.data);
export const metaAdsAccountsHealth  = () => api.get('/ads/meta/accounts/health').then(r => r.data);
export const metaAdsYesterday  = (adAccountId?: string) => api.get('/ads/meta/yesterday', { params: adAccountId ? { adAccountId } : {} }).then(r => r.data);
export const metaAdsToday      = (adAccountId?: string) => api.get('/ads/meta/today',     { params: adAccountId ? { adAccountId } : {} }).then(r => r.data);
export const metaAdsRange      = (params: { adAccountId?: string; from: string; to: string; daily?: boolean }) =>
  api.get('/ads/meta/range', { params: { ...params, daily: params.daily ? 1 : 0 } }).then(r => r.data);
export const metaAdsAIInsights = (adAccountId?: string, refresh = false) =>
  api.get('/ads/meta/ai-insights', { params: { ...(adAccountId ? { adAccountId } : {}), ...(refresh ? { refresh: 1 } : {}) } }).then(r => r.data);
export const metaAdsCampaigns  = (params: { adAccountId?: string; from?: string; to?: string; datePreset?: string }) =>
  api.get('/ads/meta/campaigns', { params }).then(r => r.data);

// Sharing
export const metaCreateShare   = (body: { adAccountId: string; datePreset?: string; fromDate?: string; toDate?: string; clientUserId?: string; clientLabel?: string; note?: string; expiresInDays?: number; }) =>
  api.post('/ads/meta/share', body).then(r => r.data);
export const metaListShares    = (adAccountId?: string) =>
  api.get('/ads/meta/shares', { params: adAccountId ? { adAccountId } : {} }).then(r => r.data);
export const metaRevokeShare   = (id: string) =>
  api.delete(`/ads/meta/share/${id}`).then(r => r.data);
// Public — no auth required, raw axios call to a path that bypasses the bearer
export const metaViewShare     = (token: string) =>
  api.get(`/share/meta/${token}`).then(r => r.data);

// Bulk create clients from ad accounts
export const adminBulkCreateMetaClients = () => api.post('/admin/meta/clients/bulk').then(r => r.data);

// ── Meetings (team calendar) ────────────────────────────────────────────────
export const meetingsDay     = (date?: string) =>
  api.get('/meetings/day', { params: date ? { date } : {} }).then(r => r.data);
export const meetingsMine    = (params?: { from?: string; to?: string }) =>
  api.get('/meetings/mine', { params }).then(r => r.data);
export const meetingsCreate  = (body: {
  title: string; description?: string; type?: string; link?: string;
  startTime: string; endTime: string; attendees?: string[]; visibility?: 'public' | 'private';
}) => api.post('/meetings', body).then(r => r.data);
export const meetingsUpdate  = (id: string, body: Record<string, any>) =>
  api.put(`/meetings/${id}`, body).then(r => r.data);
export const meetingsDelete  = (id: string) =>
  api.delete(`/meetings/${id}`).then(r => r.data);
export const meetingsNow      = () => api.get('/meetings/now').then(r => r.data);
export const meetingsFindFree = (params: { date?: string; duration?: number; users: string[] }) =>
  api.get('/meetings/find-free', {
    params: { date: params.date, duration: params.duration, users: params.users.join(',') },
  }).then(r => r.data);

// ── Client meetings (instant external prospect calls) ──────────────────────
export const clientMeetingsCreate = (body: { clientName?: string; note?: string; durationMinutes?: number }) =>
  api.post('/client-meetings', body).then(r => r.data);
export const clientMeetingsMine   = () => api.get('/client-meetings/mine').then(r => r.data);
export const clientMeetingsActive = () => api.get('/client-meetings/active').then(r => r.data);
export const clientMeetingsEnd    = (slug: string) => api.put(`/client-meetings/${slug}/end`).then(r => r.data);
export const clientMeetingsExtend = (slug: string) => api.put(`/client-meetings/${slug}/extend`).then(r => r.data);
export const clientMeetingsHostToken = (slug: string) =>
  api.post(`/client-meetings/${slug}/host-token`).then(r => r.data);
// Public — guest endpoints. Don't require auth, just hit the path.
export const clientMeetingsPublicInfo = (slug: string) =>
  api.get(`/meet/${slug}`).then(r => r.data);
export const clientMeetingsGuestToken = (slug: string, name: string) =>
  api.post(`/meet/${slug}/guest-token`, { name }).then(r => r.data);

// ── Huddle (LiveKit) ──────────────────────────────────────────────────────────
// Explicit 8s timeout: axios's default is no-timeout, so when the Render API
// is mid-deploy / paused / OOM-killed, this call would hang for ~minutes and
// the user would sit at "Connecting…" with no signal. 8s is plenty for a
// healthy server (the controller just signs a JWT) and short enough that the
// user gets a real error if things are wrong.
export const getHuddleToken    = () =>
  api.post('/huddle/token', {}, { timeout: 8_000 }).then(r => r.data);

// ── Reminders / Weekly Planner ────────────────────────────────────────────────
export const listMyReminders   = (params?: { from?: string; to?: string }) =>
  api.get('/reminders/mine', { params }).then(r => r.data);
export const createReminder    = (d: { title: string; scheduledFor: string; notes?: string }) =>
  api.post('/reminders', d).then(r => r.data);
export const updateReminder    = (id: string, d: Partial<{ title: string; scheduledFor: string; notes: string; status: 'pending' | 'done' }>) =>
  api.put(`/reminders/${id}`, d).then(r => r.data);
export const deleteReminder    = (id: string) =>
  api.delete(`/reminders/${id}`).then(r => r.data);

// ── Agency-OS rebuild (May 2026) ──────────────────────────────────────────────
// Cross-team task inbox, monthly targets, risk feed, recurring meetings,
// daily brief. Compact helpers — every endpoint returns plain JSON; the
// UI does any reshaping it needs locally.

// Task inbox: groups my-assigned + delegated + brand-watch tasks.
export const taskInbox            = (showDone = false) =>
  api.get('/tasks/inbox', { params: showDone ? { done: 1 } : undefined }).then(r => r.data);
// Permanent audit history of every assigned task. Filters mirror the
// server endpoint: direction, status, brand, assignee, sender,
// since/until, q (title text), limit.
export const taskLedger           = (params?: Record<string, string | number | undefined>) =>
  api.get('/tasks/ledger', { params }).then(r => r.data);
export const tasksForWorkflow     = (workflowId: string) =>
  api.get(`/tasks/workflow/${workflowId}`).then(r => r.data);
export const taskGraph            = (taskId: string) =>
  api.get(`/tasks/${taskId}/graph`).then(r => r.data);
export const setTaskDependencies  = (taskId: string, dependsOn: string[]) =>
  api.put(`/tasks/${taskId}/dependencies`, { dependsOn }).then(r => r.data);
// Task acceptance flow — assignee accepts (with ETA) or declines.
export const acceptTask           = (taskId: string, body: { estimatedCompletionAt: string; estimatedHours?: number }) =>
  api.post(`/tasks/${taskId}/accept`, body).then(r => r.data);
export const declineTask          = (taskId: string, reason?: string) =>
  api.post(`/tasks/${taskId}/decline`, { reason }).then(r => r.data);

// Targets — self read, admin team read, admin upsert, self ETA.
// `period` is 'weekly' | 'monthly' (default monthly when omitted).
// `month` here is the periodKey: YYYY-MM for monthly, YYYY-Www for weekly.
export const getMyTargets         = (opts?: { period?: 'weekly' | 'monthly'; month?: string }) =>
  api.get('/targets/me',   { params: opts }).then(r => r.data);
export const getTeamTargets       = (opts?: { period?: 'weekly' | 'monthly'; month?: string }) =>
  api.get('/targets/team', { params: opts }).then(r => r.data);
export const setUserTargets       = (userId: string, body: { targets: any[]; notes?: string }, opts?: { period?: 'weekly' | 'monthly'; month?: string }) =>
  api.put(`/targets/user/${userId}`, body, { params: opts }).then(r => r.data);
// Self ETA / commentary on one target line — no admin gate.
export const setMyTargetLineEta   = (lineId: string, body: { etaDate?: string | null; employeeNote?: string }, opts?: { period?: 'weekly' | 'monthly'; month?: string }) =>
  api.put(`/targets/me/line/${lineId}`, body, { params: opts }).then(r => r.data);

// Risks — top "needs attention" feed for admin/sales.
export const listRisks            = (limit = 15) =>
  api.get('/risks', { params: { limit } }).then(r => r.data);

// Recurring meetings + upcoming meetings.
export const upcomingMeetings     = () =>
  api.get('/meetings/upcoming').then(r => r.data);
export const setBrandRecurring    = (workflowId: string, body: { dayOfWeek: number | null; timeIST?: string; label?: string }) =>
  api.put(`/meetings/recurring/${workflowId}`, body).then(r => r.data);

// Daily brief — live-computed for the caller.
export const getMyBrief           = (kind?: 'morning' | 'evening') =>
  api.get('/brief/me', { params: kind ? { kind } : undefined }).then(r => r.data);

// ── Mission Control (June 2026) ───────────────────────────────────────────────
// Single endpoint returning KPIs + critical alerts + team accountability +
// client cards + upcoming meetings in one shot.
export const getCommandSnapshot   = () =>
  api.get('/command-center/snapshot').then(r => r.data);
// AI Copilot — natural-language Q&A.
export const copilotAsk           = (question: string) =>
  api.post('/copilot/ask', { question }).then(r => r.data);
// Global entity search — instant jump-to results (no AI call).
export const globalSearch         = (q: string) =>
  api.get('/search', { params: { q } }).then(r => r.data);
// New Workroom dashboard — user-scoped agency snapshot.
export const getWorkroomSnapshot  = () =>
  api.get('/workroom/snapshot').then(r => r.data);
