import api from './axios';

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
export const sessionHeartbeat = () => api.post('/sessions/heartbeat').then(r => r.data);

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

// ── Screen Sessions ───────────────────────────────────────────────────────────
export const updateScreenStatus = (d: Record<string, unknown>) => api.put('/screen-sessions/status', d).then(r => r.data);
export const listScreenSessions = ()                            => api.get('/screen-sessions').then(r => r.data);

// ── Leads ─────────────────────────────────────────────────────────────────────
export const listLeads   = (params?: Record<string, unknown>) => api.get('/leads', { params }).then(r => r.data);
export const createLead  = (d: Record<string, unknown>)       => api.post('/leads', d).then(r => r.data);
export const getLead     = (id: string)                        => api.get(`/leads/${id}`).then(r => r.data);
export const updateLead  = (id: string, d: Record<string, unknown>) => api.put(`/leads/${id}`, d).then(r => r.data);
export const deleteLead  = (id: string)                        => api.delete(`/leads/${id}`).then(r => r.data);
export const addLeadNote = (id: string, d: Record<string, unknown>) => api.post(`/leads/${id}/notes`, d).then(r => r.data);
export const convertLead = (id: string, d: Record<string, unknown>) => api.post(`/leads/${id}/convert`, d).then(r => r.data);

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
export const listNotifications    = (params?: Record<string, unknown>) => api.get('/notifications', { params }).then(r => r.data);
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
export const createLeave       = (d: { days: { date: string; reason: string }[] }) =>
  api.post('/leaves', d).then(r => r.data);
export const listMyLeaves      = () => api.get('/leaves/mine').then(r => r.data);
export const cancelLeave       = (id: string) => api.put(`/leaves/${id}/cancel`, {}).then(r => r.data);
export const adminListLeaves   = (params?: Record<string, unknown>) =>
  api.get('/leaves/admin', { params }).then(r => r.data);
export const approveLeave      = (id: string, note?: string) =>
  api.put(`/leaves/${id}/approve`, { note }).then(r => r.data);
export const rejectLeave       = (id: string, note?: string) =>
  api.put(`/leaves/${id}/reject`, { note }).then(r => r.data);
export const onLeaveToday      = () => api.get('/leaves/on-leave-today').then(r => r.data);
export const adminLeavesSummary = () => api.get('/leaves/admin/summary').then(r => r.data);
export const adminAttendance    = (date?: string) => api.get('/admin/attendance', { params: date ? { date } : {} }).then(r => r.data);

// ── Meta Ads ──────────────────────────────────────────────────────────────────
export const metaAdsAccounts        = () => api.get('/ads/meta/accounts').then(r => r.data);
export const metaAdsAccountsHealth  = () => api.get('/ads/meta/accounts/health').then(r => r.data);
export const metaAdsYesterday  = (adAccountId?: string) => api.get('/ads/meta/yesterday', { params: adAccountId ? { adAccountId } : {} }).then(r => r.data);
export const metaAdsRange      = (params: { adAccountId?: string; from: string; to: string; daily?: boolean }) =>
  api.get('/ads/meta/range', { params: { ...params, daily: params.daily ? 1 : 0 } }).then(r => r.data);
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

// ── Huddle (LiveKit) ──────────────────────────────────────────────────────────
export const getHuddleToken    = () => api.post('/huddle/token', {}).then(r => r.data);

// ── Reminders / Weekly Planner ────────────────────────────────────────────────
export const listMyReminders   = (params?: { from?: string; to?: string }) =>
  api.get('/reminders/mine', { params }).then(r => r.data);
export const createReminder    = (d: { title: string; scheduledFor: string; notes?: string }) =>
  api.post('/reminders', d).then(r => r.data);
export const updateReminder    = (id: string, d: Partial<{ title: string; scheduledFor: string; notes: string; status: 'pending' | 'done' }>) =>
  api.put(`/reminders/${id}`, d).then(r => r.data);
export const deleteReminder    = (id: string) =>
  api.delete(`/reminders/${id}`).then(r => r.data);
