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

## Last done (Aug 2026) — Fixed the REAL cause of "Client CRM is blank" for employees (Bhawna/Sakshi) + wired up dead /details and /performance routes

Owner reported Bhawna and Sakshi both see an empty Client CRM ("0 projects — No Client CRM entries yet"). Earlier session work had already ruled out role, route guards, and the client-side `mineOnly` default/filter-state bugs — but the symptom persisted. Logged into the live production site as Bhawna (`bhawnahastagcreator@gmail.com`) via browser automation and hit the API directly to get ground truth instead of guessing again:

1. **Root cause (server-side, not client-side)**: `listWorkflows()` in `clientWorkflowController.ts` still had the OLD restrictive gate — `if (role !== 'admin' && role !== 'sales')` forced employees/workroom to only see workflows they personally created or have a service assigned to them on. Bhawna has zero assigned services and created none of the 15 live `ClientWorkflow` docs, so the query matched nothing → `[]`. Confirmed directly: admin token → `GET /client-workflows` returns 15 docs; Bhawna's own token → same endpoint returns `[]`. `canSeeWorkflow()` (the per-workflow authz gate used by every other workflow route) had the identical old policy. Both are now widened so **all internal staff (admin/sales/employee/workroom) see the full org list by default**, with `mine=1` staying available as an explicit opt-in narrow filter for anyone (not just admin/sales) via the existing "Just mine" toggle.
2. **`routes/clientWorkflows.ts` had drifted from the client-side role gates**: `App.tsx`/`SlimSidebar.tsx` already let `workroom` into the Client CRM pages, but every server route was still `requireRole('admin', 'employee', 'sales')` — missing `workroom` entirely. Consolidated into one `STAFF` array used across every internal-staff route.
3. **Bonus find while in this file**: the full client-detail edit (`updateWorkflowDetails`) and performance-calendar (`getPerformance`/`upsertPerformance`) controllers from earlier "add full client edit + Meta spend/sales calendar" work were fully implemented but **never wired to any route** — `PUT /:id/details` and `GET`/`PUT /:id/performance` didn't exist server-side, so the client-side edit modal and performance calendar (which already call these paths) were 404ing silently. Added both routes.

**Deploy note**: this fix is server-only (`clientWorkflowController.ts`, `routes/clientWorkflows.ts`) — needs a `git push` to `main` to redeploy on Render before Bhawna/Sakshi will see data. Verify after deploy: log in as an affected employee, `/clients/pipeline` should show all org clients, not an empty state.

## Also today (Aug 2026) — blank-screen-on-stale-deploy fix + Om granted full client-edit rights

Owner reported "when I try to open anything it just goes blank" right after a deploy. Root cause: a stale-chunk failure (browser tab still holding the OLD `index.html`, trying to fetch a JS chunk hash that no longer exists after the new build shipped — classic Vite SPA deploy gap). `PageErrorBoundary.tsx` already had auto-recovery for this (detect the "Failed to fetch dynamically imported module" error, force one reload with a cache-busting query param, 60s cooldown to avoid loop) — but that ONLY catches errors that surface through React's render cycle. The console screenshot showed this specific failure firing as a genuinely **uncaught** window-level error (a native `<script type="module">`/modulepreload load failure, which happens outside React entirely), so it never reached the error boundary — the global handlers in `errorReporter.ts` were only logging it, not recovering, leaving the tab permanently blank until a manual hard refresh.

Fix: extracted the detection + recovery logic into a shared `client/src/lib/chunkRecovery.ts` (`isChunkLoadFailure`, `recoverFromChunkFailure`), and wired it into BOTH `PageErrorBoundary.tsx` (unchanged behavior, now sharing the util) AND `errorReporter.ts`'s `window.addEventListener('error'/'unhandledrejection')` handlers (the actual gap). Now a stale-chunk crash self-heals no matter which layer catches it first.

**If you're seeing the blank screen RIGHT NOW**: that's the OLD broken bundle still loaded in your tab — do one manual hard refresh (Cmd+Shift+R / Ctrl+Shift+R) to clear it. This fix only prevents it from happening on the NEXT deploy, it can't un-stick a tab that's already stuck on today's old bundle.

**Om granted full client-edit rights** ("edit anything any status of clients... change the project owner as well, edit the timelines and everything") — added a new delegated-permission flag `User.canEditAllClients` (same pattern as the existing `canManageWorkroom` flag: gives one trusted non-admin a specific admin-equivalent power without making them a full admin, which would've also opened unrelated admin-only surfaces like payroll). Wired through: `authMiddleware.ts` (attaches it to `req.user`), a new `isPrivilegedEditor()` helper in `clientWorkflowController.ts` (replaces every raw `role !== 'admin'` ownership check — checklist toggle, complete service, set ETA, reassign owner, bulk priority/on-track), `routes/clientWorkflows.ts` (the reassign route was STILL `requireRole('admin')` only — would've 403'd Om at the route level before the controller check ever ran — loosened to the STAFF set), `authController.ts`'s `publicUser()` (ships the flag to the client), `AuthContext.tsx`, and the two workflow-detail pages' `isAdmin`/`isAdminEffective` checks (`StageWorkspacePage.tsx`, `ClientWorkflowDetailPage.tsx` — the reassign-owner dropdown was gated to strict `role==='admin'`, now also opens for this flag). Grant via `npm run grant-client-edit` (finds Om by name, idempotent).

## Also today (Aug 2026) — more brand updates + Silvque onboarded + "dummy" tag turned out to be unreliable + everyone can add clients

Owner kept feeding brand status updates in chat across several messages, and `updateBrandStatuses.ts` was rewritten to a more general per-service `ServiceOp` shape (`{type, ticked, status, reason?}`) instead of the earlier narrow add-done/add-pending/return distinction, since "meta awareness running" etc. needed partial checklist progress, not just a clean done/pending toggle. Covers: Oudfy (checked — already correctly represented, no change made), Bombay, dufft (website paused, ~25% done, blocked on missing product photos from client), Ghee-Neeraj (meta running), plus revised ArdoWellness (meta_ads is now literally `status: 'blocked'`, not `in_progress` — owner said "currently blocked") and Darpan (meta_ads now "running" = `in_progress`, not the earlier "reverted to pending" framing).

**IMPORTANT — the "dummy" tag heuristic from earlier today turned out to be wrong.** The duplicate-Darpan investigation assumed the doc tagged `"dummy"` with `clientId: "dummy:darpan"` (a placeholder string, not a real User id) was safe-to-ignore seed data. But Oudfy's only remaining `ClientWorkflow` doc has the EXACT same signature (tagged `"dummy"`, `clientId: "dummy:oudfy"`) and is clearly the live, actively-tracked real record (daily check-ins through today, 46 activity entries). So "dummy" tag + placeholder clientId does NOT reliably mean fake/discardable — `updateBrandStatuses.ts` does NOT delete either Darpan doc, and its docstring flags this explicitly. **Needs owner review**: look at both Darpan `ClientWorkflow` docs (`6a0eff0f8caf9cd458df2fa6` and `6a0aa03bc1dc825d88b42e4a`) and confirm which is current before anything gets deleted.

**Silvque onboarded** — new client, not on the original 11-brand sheet. No `shopify` service line at all (owner: "website we are not managing"); `influencer` in_progress (video started), `meta_ads` pending. Added to `keepOnlyBrands.ts`'s `KEEP_BRANDS` too so a future re-run doesn't wipe it.

**"Allow everyone to add new client"** — server route (`POST /client-workflows`) already accepted the full `STAFF` set from the earlier CRM-visibility fix. The gap was client-side: `ClientPipelinePage.tsx`'s `isAdminOrSales` (gates the "+ Add client" button/shortcut/empty-state CTA) was still `['admin','sales','employee']` — missing `workroom`. Fixed to match `STAFF`.

## Also today (Aug 2026) — per-brand status updates script + Brand Pulse pruned to the 11 kept brands

Owner gave specific status updates for 6 of the 11 brands in chat (not a screenshot this time): Polmouni (website done, video pending, meta pending — video/meta service lines didn't exist yet, since `bulkAddWebsiteClients.ts` only ever created a `shopify` line), Darpan (website + video done, "social media posting" i.e. meta ads reverted to pending), Sroja and MotoCasa (all 3 services done, ads running — with exact Meta spend/sales figures + ad tenure dates to log), ArdoWellness (website + video done, meta ads stopped — client's payment gateway suspended), Woodsify (all 3 done, ads running).

1. **Attempted this live via authenticated admin API calls from a browser session** (same approach used earlier to diagnose the CRM bug) — Cowork's safety classifier correctly blocked raw production writes done outside the normal script-review flow. Pivoted to `server/src/scripts/updateBrandStatuses.ts` (new) instead, following the same dry-run/`--apply` convention as every other maintenance script this session.
2. **`updateBrandStatuses.ts`** — per brand, adds missing service lines (Polmouni/Sroja/MotoCasa/Woodsify never had `meta_ads`/`influencer` at all, only the original bulk-added `shopify`), marks them done or leaves pending as instructed, and uses the service-level `returnedReason`/`returnedAt` fields (the same ones the in-app "Return service" action writes) to record ArdoWellness's payment-gateway pause and Darpan's meta-ads revert — there's no per-service "blocked with a custom free-text reason" field in the schema, so `returnedReason` (status → `in_progress`, reason visible on the service card) is the closest accurate fit, not a literal `status: 'blocked'`. Confirmed via live API inspection which of the two "Darpan" `ClientWorkflow` docs is real: the one with `clientId: "dummy:darpan"` (a literal placeholder string, not an ObjectId) and a `"dummy"` tag is seed/demo data — updates applied to the other one (`6a0aa03bc1dc825d88b42e4a`). Also logs Sroja/MotoCasa's exact Meta spend + sales figures as an August 2026 `ClientPerformanceEntry` (the model only buckets by day/week/month, so the custom "11 July – 10 Aug" / "1 July – 10 Aug" ad-tenure ranges are preserved in the entry's `notes` field, not as the structured period itself).
3. **`brandPulseCron.ts`'s `BRAND_ROUTING` pruned** — owner ask: "the pop[up] should be for these brands only." The pulse's brand *pool* was already just "every live `ClientWorkflow` in the org" (unaffected by this table), but the routing table itself still had three dead entries (`/dpk/i`, `/shrikanth/i`, `/bazaar|qatar/i`) for brands outside the current 11-brand keep-list. Removed them so the table only documents brands that actually still exist. Polmouni still has no explicit routing entry (falls back to assignedTo/anyone) — needs an owner decision on who should own its pulse questions.

**Deploy note**: needs the usual `git push`. Run order once deployed: `keep-only-brands` (from earlier today) before `update-brand-statuses`, so the status updates land on the final, de-duplicated set of docs.

## Also today (Aug 2026) — keep-only-brands script + performance calendar defaults open

Owner shared a second screenshot (same 11-brand sheet, more columns visible: onboarding date, meta-starting date, breakeven order count, amount to be collected, AOV, sales target further right) and asked to (a) make sure Robin's Client CRM contains **only** these 11 brands — Sroja, Darpan, Ghee-Neeraj, Oudfy, HeightAyura, MotoCasa, ArdoWellness, Bombay, Woodsify, dufft, Polmouni — deleting everything else, and (b) make sure the per-client daily/weekly/monthly performance report (built earlier, wired up today) is visible by default, not hidden behind a click.

1. **`server/src/scripts/keepOnlyBrands.ts`** (new) — inverse of `purgeBrand.ts`: keeps an explicit 11-brand allow-list, removes everything else. Root-doc matching (ClientWorkflow/Lead/Project) is a simple "name not in the list" check, but every cascade/reference deletion (linked client Users, FocusList items, BrandPulse) is kept surgical — only touches things explicitly referenced by a removed root doc, or whose name/label EXACTLY matches one of the specific brand names being removed this run. Deliberately does NOT do a blanket "not in the keep-list" sweep on FocusList labels or orphan text, since those can hold content with nothing to do with a brand name. Dry-run by default (`npm run keep-only-brands`), `--apply` to commit. Flags the known duplicate-"Darpan" ClientWorkflow pair (both match the keep-list by name) as a manual-review item every run — one is tagged `"dummy"` (looks like the seed/demo copy) — never auto-deletes either.
2. **Performance calendar defaults expanded**: `ClientWorkspacePage.tsx`'s `perfOpen` state was `useState(false)` — changed to `true` so the report is visible on page load instead of requiring a click to discover it exists.
3. **Sales target per brand — pending**: owner is sharing the rest of the sheet (target column was cut off in the first screenshot) — once received, seed each of the 11 with an initial `salesTarget` via the now-live `PUT /:id/performance` endpoint.

## Earlier (Aug 2026) — Fixed duplicate clients from the bulk-import + broadened the Vellore purge

Owner spotted from the Client CRM table (screenshot) that "Oudfy" and "Darpan" each showed up TWICE — one real row with actual progress/activity, one flat "Bulk-imported" row — plus "Vellore Living" and a spelling variant "Velloer Living" and "History Life" were STILL showing despite the earlier purge work.

1. **Root cause of duplicates**: `bulkAddWebsiteClients.ts` only checked for an existing `User` by its OWN synthetic placeholder email (`<slug>@client.hastagcreator.com`) — brands that were already real, live clients under a real email were invisible to that check, so the script created a second `User` + `ClientWorkflow` instead of skipping them. Fixed the script itself (now refuses to touch a brand name that already has ANY `ClientWorkflow` in the org, checked by exact case-insensitive `clientName` match, before doing anything else) AND wrote `dedupeBulkImportedClients.ts` to clean up the damage already done: finds every `ClientWorkflow` tagged `importedFrom: 'bulk-website-clients-2026-08'`, and if a REAL (non-tagged) entry with the same name already exists, deletes the duplicate + its full cascade (tasks, performance entries, activity, brand pulse) + the placeholder `User` it created — never touches anything not carrying that exact import tag. Genuinely-new brands from the original bulk-add (no pre-existing real entry) are left alone. Also flags — but does NOT touch — a separate, pre-existing "two real Darpan rows" duplication it found along the way, since resolving that needs a human to pick which one is current.
2. **Vellore purge widened**: `purgeBrand.ts`'s pattern was `/vellor/i`, which matches "Vellore Living" but NOT "Velloer Living" (note the transposed letters — a genuine second spelling of the same brand, also referenced in `seedDummyPipelines.ts`'s own cleanup list). Changed to `/^vell/i` (prefix match on the brand-name field only) to catch every spelling variant. The `/\bhistory\b/i` pattern for History was already correct — "History Life" showing up just means `purge-brand -- --apply` was never actually run yet, only dry-run/planned.

Run order matters: `dedupe-bulk-clients` first (removes the bulk-import duplicates), THEN `purge-brand` (removes Vellore + History entirely, including "History Life" / "Vellore Living" / "Velloer Living").

## Earlier (Aug 2026) — Client CRM: universal access + real-time sync across roles

Owner ask: "make sure everyone in robin have Client CRM option and the same data should sync across all roles." Confirmed via `inspectUserAccess.ts` (new read-only diagnostic script, `EMAIL=<x> npm run inspect-user-access` — prints a user's role/org + exactly what listWorkflows would return for them) that Bhawna's account + the server query were BOTH already correct (17 workflows, isStaff=true) — the previous "still can't see" reports were a client-side illusion: `ClientPipelinePage.tsx` computed `filteredList` from the fetched `list` but only showed `<EmptyState>` when `list.length === 0`; if a leftover "Mine only" toggle or filter chip (persisted per-browser in localStorage via `usePipelineState`) zeroed out `filteredList` while `list` had data, the page rendered as if there were zero clients with no indication why — indistinguishable from a real permissions bug. Fixed:

1. **New empty-state branch** — `list.length > 0 && filteredList.length === 0` now shows "N clients loaded, but your filters are hiding all of them" + a one-click "Clear filters" button, instead of falling through to a view that silently renders nothing.
2. **Real-time cross-role sync** — `ClientPipelinePage.tsx`, `ClientWorkspacePage.tsx`, and `ClientPerformanceCalendar.tsx` now listen for the `robin:data-changed` DOM event (AppLayout already re-dispatches the server's `data:changed` socket event this way) and refresh in the background — no more waiting on the 5-minute poll. Added `notifyDataChanged(...)` calls to every ClientWorkflow mutation that was missing one: `returnService`, `addNote`, `blockWorkflow`, `unblockWorkflow`, `bulkWorkflowAction`, and the new `clientPerformanceController.upsertPerformance`.
3. All 4 non-client roles (`admin/employee/sales/workroom`) already had matching access from the earlier "full client-detail edit" change — confirmed no other gate (TopBar, mobile nav, AppLayout) exists beyond `App.tsx` routes + `SlimSidebar.tsx` nav + the server's `canSeeWorkflow`/`listWorkflows`, all three already opened.

## Earlier (Aug 2026) — Fixed the REAL reason Bhawna's Client CRM looked empty

After promoting Bhawna to `employee` (previous entry), she still couldn't see clients. Real cause: `ClientPipelinePage.tsx` had `const [mineOnly, setMineOnly] = useState(role === 'employee'); // employees default to their own` — so any `employee`-role user lands on the page with the "Mine only" filter pre-enabled, scoping the list to `services.assignedTo === their own id`. Bhawna isn't in `reassignByRole.ts`'s `DEFAULT_RULES` (only Om/Sakshi/Priyanka are), so she has zero services assigned to her → the mine-only-filtered list was empty → looked like a permissions bug when it was actually a view-default bug. Changed the default to `useState(false)` for everyone — the Mine-only toggle is still available in the UI for anyone who wants to narrow it themselves, it's just no longer forced on by role.

## Earlier (Aug 2026) — Bhawna promoted to `employee` (role parity with Sakshi)

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
