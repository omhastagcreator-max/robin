# CLAUDE.md — AI Context for Robin

> Read this first. It tells any AI tool what this app is, how it's built, what was done recently, and where the landmines are. Deeper docs live in the parent folder (`../ROBIN_OVERVIEW.md`, `../ROBIN_AUDIT.md`, etc.).

## What this app is

**Robin** is a custom agency-management platform for **Hastag Creator**, a ~5-person digital marketing agency. Live at `robin.hastagcreator.com`. One app covering:

- **Sales CRM** — 11-stage lead kanban, AI lead scoring, Meta Lead Ads + Google Sheets auto-import
- **Project pipeline** — per-client service workflows (Website/Shopify, Meta Ads, Influencer) with SOP checklists and mandatory audit comments
- **Team ops** — clock in/out, breaks, leaves, tasks, attendance, team calendar
- **Workroom** — one always-on agency audio huddle with screen share (LiveKit); working time is largely measured by huddle presence
- **Client meetings** — white-labelled video calls at `meeting.hastagcreator.com`
- **Vault** — encrypted client credentials with audit trail
- **AI (Gemini via raw REST)** — morning brief, lead scoring, workflow summaries, issue triage, "Ask Robin" chat that can execute commands

Owner/admin: **Rahul**. Dev: **Om**. Sales: **Rishi**. Workroom staff: Janvi, Bhawna. Roles: `admin | employee | sales | workroom | client` (enforced by `requireRole` middleware server-side, `ProtectedRoute` client-side).

## Stack & deploy

- **Client**: React 18 + TypeScript + Vite, Tailwind (HSL vars, teal/saffron/cream palette), React Router 6 persistent AppLayout shell, Socket.io-client, LiveKit client, Framer Motion, Sonner toasts. Deployed on **Vercel** (auto on push to `main`).
- **Server**: Node + Express + TypeScript, Mongoose/MongoDB Atlas, Socket.io (org-scoped rooms), JWT auth (30-day, sliding refresh, 2-strike 401 guard), LiveKit server SDK. Deployed on **Render** at `robinrobin-api.onrender.com` (free tier — cold starts ~50s).
- **Timezone**: all business logic is **IST** (UTC+5:30, hardcoded as `330 * 60_000` offsets). Server runs UTC.
- Push to `main` deploys both. Build checks: `npx tsc --noEmit` in `client/` and `server/`.

## Layout

```
client/src/pages/            one file per route
client/src/components/shared/  cross-page widgets (SessionTopBar, HuddleDock, BreakOverlay…)
client/src/hooks/            useSession (time model!), useTeamPresence…
client/src/contexts/         AuthContext, HuddleContext, ScreenShareContext…
client/src/api/index.ts      typed API wrappers
server/src/controllers/      one per resource (sessionsController = time tracking)
server/src/models/           Mongoose schemas (Session, User, Lead, ClientWorkflow…)
server/src/jobs/             crons: dailyAutoClose, idleAutoClose, morningBrief, sheetSync
server/src/scripts/          maintenance: fixOpenBreaks, resetPassword, wipeNonSales…
```

## The session/time model (most bug-prone area — read before touching)

A `Session` doc tracks a work day: `status: active | on_break | ended`, `startTime`, `breakEvents[{startedAt, endedAt?}]`, `awayMs`, `huddleMs`, `lastHeartbeatAt`.

- Client pings `/sessions/heartbeat` every **30s**. Gap > 90s ⇒ user was away ⇒ gap (capped 15 min) added to `awayMs`.
- `workedMs` (client, `useSession.ts`) = elapsed − break-beyond-1h-allowance − awayMs, with layered safety: heartbeat upper-clamp (freeze if hb stale > 3 min), away capped at elapsed/2, per-break-event 4h cap, IST-midnight clamp on "today" totals, monotonic ratchet (displayed timer never goes backwards).
- Server heartbeat **auto-heals** a break open > 4h (closes it at last heartbeat, flips to active). Crons close forgotten sessions at 23:59 IST / idle at 18:00 IST.
- Cleanup script for corrupted break data: `cd server && npm run fix-open-breaks -- --apply` (dry-run without `--apply`).
- History of bugs here: "253h break", "timer stuck at 0", "timer runs backwards", "can't end break". Every guard in `useSession.ts` / `sessionsController.ts` has a comment explaining which bug it prevents — **don't remove guards without reading the comments.**

## Last done (Aug 2026) — Bhawna promoted to `employee` (role parity with Sakshi)

Owner ask: "bhawana doesnt have the whole access similar to sakhasi plz do that." Root cause: the June 2026 correction had set Bhawna's role to `workroom` — Robin's most restricted staff tier, gated into only `/workroom`, `/workroom-home`, and (as of the change just before this one) `/clients/pipeline*`. No amount of route-by-route `workroom` additions would ever match Sakshi's access, because Sakshi is role `employee` (confirmed across `seed.ts`/`routes/seed.ts`/`updateTeamRoles.ts`), which unlocks a much wider set: `/dashboard`, `/tasks`, `/chat`, `/team-pulse`, `/team-progress`, `/vault`, `/leaves`, `/client-schedule`, `/ads/meta`, `/team/calendar`, `/influencers`, `/workroom-onboard`, plus Client CRM. Fixed at the ROLE level, not the route level: `server/src/scripts/addBhawna.ts`'s `DETAILS.role` flipped `'workroom'` → `'employee'` (script is idempotent/safe to re-run — `npm run add-bhawna`, patches role on her existing account). She keeps her `team: 'meta'` tag (informational only, doesn't gate anything).

## Earlier (Aug 2026) — Purge a brand's data everywhere (Vellore + History)

Owner ask: "remove all the old brand history, vellore from the whole robin." New reusable script `server/src/scripts/purgeBrand.ts` (`npm run purge-brand -- --apply`, dry-run by default) — hardcoded this run to `/vellor/i` + `/\bhistory\b/i` (two separate brand records, even though the owner's sheet showed them as one combined "Vellore + History" row since they're routed to the same people). Full cascade: finds root docs (ClientWorkflow by clientName, Lead by name/company, legacy Project by name, client User by name) → collects their ids + linked client-login ids (ClientWorkflow.clientId, Lead.convertedToClientId, Project.clientId) → deletes everything referencing those ids across ProjectTask, ClientPerformanceEntry, WorkflowActivity, BrandPulse, ClientSchedule, ClientTransaction, Deal (via Lead), Notification → `$pull`s matching entries out of FocusList (shared doc, can't delete whole thing) → finally deletes the root docs. Also removed the `/vellore/i` and `/history/i` entries from `BRAND_ROUTING` in `brandPulseCron.ts` so Brand Pulse stops asking about a brand that no longer exists. To purge a different brand later, edit `BRAND_PATTERNS` in the script and re-run.

## Earlier (Aug 2026) — Full client-detail edit for all staff + per-client performance calendar

Owner ask: "employees are able to edit a client details fully... visible across the Robin ecosystem, also for each client add one calendar where we can add meta ads spend, total sales achieved, sales target" (daily AND weekly AND monthly, all staff roles — owner's explicit answers when asked). Two parts:

1. **Full client-detail edit, opened to every staff role** (previously admin/sales/employee only saw workflows they created/were assigned to — `employee`/`workroom` were extra-restricted, and there was NO edit endpoint at all post-creation). New `PUT /api/client-workflows/:id/details` (`clientWorkflowController.ts`, `updateWorkflowDetails`) edits `clientName/clientPhone/clientEmail/priority/tags/paymentStatus` and best-effort syncs the linked `User`'s name/phone so the two don't drift; every change logged to `activity[]`. `canSeeWorkflow()` and `listWorkflows()`'s "mine" gate now grant full org-wide visibility to `admin|sales|employee|workroom` (was `admin|sales` only). Added `'workroom'` to every route in `clientWorkflows.ts` (except the admin-only `reassignService` — ownership control, left restrictive on purpose), to the `/clients/pipeline*` `ProtectedRoute` guards in `App.tsx`, and to the sidebar "Client CRM" nav item in `SlimSidebar.tsx` (workroom previously had ZERO client-CRM access). UI: pencil icon next to the client name on `ClientWorkspacePage.tsx` opens `EditClientDetailsModal.tsx`.

2. **Per-client performance calendar** — new model `ClientPerformanceEntry.ts`: one doc per `(clientWorkflow, periodType, periodKey)`, three INDEPENDENT granularities (`day` → `YYYY-MM-DD`, `week` → ISO `YYYY-Www`, `month` → `YYYY-MM`) — deliberately NOT auto-summed from each other (owner asked for daily AND weekly AND monthly, not daily-rolls-up-to-monthly) since reps may only track spend/sales at whichever level is convenient. Controller `clientPerformanceController.ts`: `GET/PUT /api/client-workflows/:id/performance`, upsert-by-unique-index. UI: `ClientPerformanceCalendar.tsx` — Daily/Weekly/Monthly tabs, day-grid / week-list / month-grid calendars, click a period to log Meta Ads spend + sales achieved + sales target in `EntryEditModal`. Mounted as a collapsed "Performance calendar" row on `ClientWorkspacePage.tsx`, right under Tasks.

## Earlier (Aug 2026) — Bulk-add clients from brand sheet

Owner pasted a screenshot of a brand-routing spreadsheet and asked to add the non-highlighted brands as clients with their Website marked completed (except one, `dufft`). New script `server/src/scripts/bulkAddWebsiteClients.ts` (`npm run bulk-add-website-clients -- --apply`, dry-run by default): upserts a `User(role:'client')` per brand (placeholder email `<slug>@client.hastagcreator.com`, default password, since the sheet only had brand names) + upserts a `ClientWorkflow` with a single `shopify` service (that's the literal "Website" service type everywhere in this codebase, see `reassignByRole.ts`) — `status:'done'` + full ticked checklist + `completedAt` for every brand except `dufft`, which stays `status:'pending'`. Assignee resolved to Om by name (his standing Website-owner rule). Brands added: Sroja, Darpan, Ghee-Neeraj, Oudfy, HeightAyura, MotoCasa, ArdoWellness, Bombay, Woodsify, dufft, Polmouni. Placeholder emails/passwords should be replaced with real ones if/when these clients need actual portal logins.

## Earlier (Aug 2026) — Sales Dashboard "data wiped on refresh" fix

Owner report: reloading `/sales` sometimes showed an empty pipeline (0 leads/clients/deals) — looked like data loss but nothing was actually deleted server-side. Root cause: `SalesDashboard.tsx`'s `load()` had **no catch** around its `Promise.all([listLeads, listUsers, listDeals])`. Any single transient failure on the very first load after a hard refresh — a 401 from the JWT sliding-refresh race (see `api/axios.ts`'s "first strike" comment), a cold-start blip not covered by axios's built-in retry, one dropped request — threw unhandled, and the old `finally` block still marked the load "done" and stopped the spinner, leaving `leads/clients/deals` on their initial empty arrays **permanently** (until the 2-min background poll happened to succeed). No toast fired for the 401 case, so it looked like silent data loss. Fix: `load()` now catches, and on an *initial*-load failure keeps `initialLoadDone.current = false` + the spinner up and retries with backoff (1.5s/3s/4.5s/6s/8s, max 5 tries) instead of flashing an empty board; only shows an error toast if all retries are exhausted. CRUD-triggered/background refreshes are unaffected (never blank existing data). Same class of bug as `1bbf873` (blank screen on refresh) — different cause, same "trust the spinner state, not just try/finally" lesson.

## Earlier (July 2026) — Leaves-taken metric in employee reports

`EmployeeReportModal.tsx` now shows a "Leaves Taken" stat card + a dates+reasons list (`LeavesPanel`) for whatever period is selected (Daily/Weekly/Monthly/Custom) — approved leaves only, same definition as everywhere else in the app. Server: `getEmployeeReport` (adminController.ts) computes it bounded to the exact same `[startDate, endDate||now]` window as the rest of the report. Also fed into the AI side: `EmployeeReportInput.leaves` (aiTriage.ts) + `employeeReportEndpoint` (aiAutomationController.ts) now carry leave count/dates into the Gemini prompt for the preset-period AI report, and the Custom-range AI summary already got leave counts for free via `buildAttendanceMatrix`'s `daysLeave` (used by `/admin/attendance/range/summary`).

## Earlier (July 2026) — Custom date range in the per-employee report modal (payroll)

The existing `EmployeeReportModal.tsx` (opened from Admin Employees — Daily/Weekly/Monthly productivity + attendance panel) now has a 4th **Custom** toggle with From/To date pickers (owner ask: pick any range, e.g. to process one person's salary). Server: `getEmployeeReport` in `adminController.ts` now accepts `?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` — all queries (activities, tasks, sessions) bound to `[startDate, endDate]` instead of `[startDate, now)`; `effectiveNow` replaces raw `now` everywhere so a HISTORICAL custom range (e.g. last month, viewed today) computes correctly, not as "up to today". The AI "Generate" button in Custom mode calls a DIFFERENT endpoint than the preset periods: `/admin/attendance/range/summary` (userId-scoped) — same engine as the Attendance page's range summary, payroll-framed prompt that explicitly flags anything needing manual review before processing salary. This guarantees the AI reads the exact same numbers shown in the modal (owner ask: "make sure Robin AI is fed the same data"). Also added generic `userId` filter to `/admin/attendance/range` + `/range/summary` for the standalone Attendance-page use case.

## Earlier (July 2026) — Attendance: Monthly / Calendar / Date-range + AI

`client/src/pages/AdminAttendance.tsx` now has 4 tabs: Daily (original), Monthly (per-day org rollup table), Calendar (color-coded month grid per employee — click through employees via dropdown), Range (custom from/to + "Generate AI summary" button that has Gemini write an executive read of attendance for that window, graceful fallback to a computed summary if AI is down). Server: shared `buildAttendanceMatrix()` helper in `adminController.ts` powers all three new views (`/admin/attendance/monthly`, `/admin/attendance/range`, `/admin/attendance/range/summary`) — same `sessionTotals()` math as everywhere else. Day status: present (≥6h), partial, absent, leave, off (Sunday). Also fixed a real bug while in there: the Daily view's header "Active total" was recomputed as `totalWorked − totalBreak` (dropping away-time deduction), which could disagree with the sum of the expanded session rows below it — now sums each session's own `activeMs`.

## Earlier (July 2026) — breaks now PAUSE the clock

Owner reversed the break-credit rule: every break minute is deducted from worked time (timer visibly freezes on Break, resumes on Resume). Clock 9h with 1h break = 8h worked — consistent with the 8h+1h day. `STANDARD_BREAK_MS` (1h) is now only the warning budget + breakOkDays metric, NOT a work credit. Changed in both `client/src/hooks/useSession.ts` (workedMs) and `server/src/services/sessionTime.ts` (sessionTotals) — keep them in lockstep. Also: away-threshold raised 90s→5min (background-tab throttling caused phantom awayMs — see `npm run inspect-session` to diagnose/repair), and Brand Pulse questions are AI-generated via Gemini with follow-up context (fallback to templates).

## Earlier (July 2026) — Brand Pulse random questions

Random blocking brand-accountability questions (owner ask): during work hours (10:30–18:30 IST, Mon–Sat) a cron (`jobs/brandPulseCron.ts`, 15-min ticks, 35% fire chance) asks one clocked-in staff member one question about one brand — sales achieved, target status, next plan, Meta ads, blockers, client update, engagement, script/content. Blocking modal (`client/src/components/shared/BrandPulseModal.tsx`, mounted in AppLayout, polls `/api/brand-pulse/pending` every 60s) — answer ≥10 chars or "I don't manage this brand" → pick who does → question redirects to them (max 2 hops). Limits: 1 pending/user, 2 asks/user/day, 4h brand cooldown. **Owner's brand→people routing table lives in `BRAND_ROUTING` in brandPulseCron.ts** (name-regex matched; Darpan is engagement-only: Shakshi=ads/engagement, Priyanka=script, Om=overall-no-sales — edit that table when brand ownership changes). Report on `/team-progress`: per-employee answer rate/response time + per-brand Q&A feed (`/api/brand-pulse/admin/report`). Progress page also got a color-coded team bar chart + Excellent/Good/Needs-attention labels.

## Earlier (July 2026) — weekly employee progress system

Per-employee weekly scorecard (Mon–Sun IST), 0–100 from four pillars: Reliability /25 (attendance, punctuality), Focus /25 (hours vs 8h, breaks vs 1h allowance, away ratio), Delivery /30 (morning-planned vs evening-done tasks, on-time ProjectTask completions), Discipline /20 (3-pulse check-in rate). Formulas in `server/src/services/progressReport.ts`. Snapshots stored in `EmployeeProgress` model, frozen by `jobs/progressCron.ts` Mondays 00:30 IST; current week recomputed live on read. API `/api/progress/team` + `/api/progress/recompute` (gate: admin/sales/canManageWorkroom — same as Team Pulse; employees do NOT see it, owner decision). UI: `client/src/pages/TeamProgressPage.tsx` at `/team-progress` ("Progress" sidebar link) — score ring, pillar bars, 8-week trend line = the improvement graph. Also: morning check-in now auto-starts the work session if the user forgot Log In (`MorningCheckinModal` + `robin:session-refresh` event), and `npm run backdate-session` (server) credits missed time.

## Earlier (July 8, 2026) — 8h + 1h day model

Owner defined the working day as **8h net work + 1h break allowance** (9h total). No countdown/remaining-time is shown (explicit owner ask). `useSession` now exports `workdayMs` (8h) and `dayComplete`; `SessionTopBar` + `SessionClockCard` show an "8h done — day complete" badge once net work crosses 8h, and break totals render against the allowance ("today: 15:00 / 60:00"). Break allowance logic itself was already 1h (`STANDARD_BREAK_MS`, mirrored in `server/src/services/sessionTime.ts`).

## Earlier same day (July 8, 2026) — break desync fix

Commit `1fbb228`. User showed 15-min break as "today: 185:35" + a Resume button that did nothing.

1. **Client stuck on stale status** — heartbeat responses and the 60s reconcile refetch were dropping the server's `status`/`breakEvents`; when the server auto-healed a break, the UI stayed "On break" and end-break 404'd forever. Fixed in `client/src/hooks/useSession.ts`: heartbeat merge now includes `status`; reconcile merges `status/breakEvents/awayMs/lastHeartbeatAt`; a 404 from end-break triggers a session refetch instead of a dead button.
2. **Inflated break totals** — `totalBreakMs` counted *every* open (no `endedAt`) break event as still-running. Only the **last** event may be ongoing; earlier open events are broken data and now count as zero.
3. **Server self-heal** — `closeStaleOpenBreaks()` in `sessionsController.ts`: startBreak/endBreak now close any straggler open events (end = lastHeartbeat, capped start+4h, never future).

## Recent work before that (newest first, from git log)

- `4bb7a24` resetPassword script (env-var driven)
- `2fe2d2d` Landing profiles removed; Bhawna → workroom role
- `1e2dcdd` Fix task status update on dashboard; include past delegated tasks
- `fe465fa` Bulletproof working-hours timer (self-contained, immune to data bugs)
- `d0b23df` Daily check-in popups fire once per day
- `e3e717f`/`a18d2af` Daily 3-popup pulse — morning popup blocks huddle, evening blocks logout; undismissable
- `2cfd029` Always-visible Check-in pill in TopBar
- `eba8232` Team Pulse dashboard (admin + Om see everyone's day)
- `1bbf873` Fix blank screen on refresh (React #310 — hooks must all be above early returns; see SessionTopBar comment)
- `957a570` Fix timer-stuck-at-zero (stale session reuse on Log In — sessions with heartbeat > 4h old are ended, fresh one created)

## Gotchas & conventions

- **Hooks order**: every component calls all hooks before any early return (React #310 bit us in prod).
- **Time display**: `tabular-nums` monospace; `fmtHMS` = HH:MM:SS, `fmtMS` = MM:SS.
- **Optimistic UI + server reconcile** is the standard pattern (see startBreak/toggleOnCall in useSession).
- **Gemini** is called with raw `fetch`, auto-fallback across models, `thinkingBudget: 0`; everything degrades gracefully with no `GEMINI_API_KEY`.
- **Single-org assumption** — controllers often grab the first Organization; fine for one agency.
- **Render cold start** — first API call after idle can take ~50s; client timers are designed to survive it (stale-hb freeze, not reset).
- Env vars (Render): `MONGODB_URI, JWT_SECRET, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, GEMINI_API_KEY?, CREDENTIAL_KEY?`.

## Deeper docs (parent folder)

`ROBIN_OVERVIEW.md` (full product/feature map, runbook), `ROBIN_AUDIT.md`, `ROBIN_RBAC_AUDIT.md`, `ROBIN_REALTIME_AUDIT.md`, `ROBIN_PIPELINE_REDESIGN.md`, `ROBIN_UI_REDESIGN.md`, `ROBIN_LOW_BANDWIDTH.md`, `ROBIN_COMPLETION_AUDIT.md`.

---
*Last updated: July 8, 2026 (break-desync fix session). Keep the "Last done" section current — update it whenever you finish meaningful work.*
