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

## Last done (July 2026) — breaks now PAUSE the clock

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
