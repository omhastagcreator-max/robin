# Robin — Product Overview

Robin is a custom, all-in-one agency-management platform built for **Hastag Creator**, a small (~5-person) digital marketing agency. It's not an off-the-shelf tool — it's a purpose-built internal system that replaces what would otherwise be five or six separate apps (a CRM, a project-management board, a time-tracking tool, a video-calling app, a password manager, and Slack) with one login, one database, and one shared source of truth. It's live at `robin.hastagcreator.com`, with a companion white-labelled video-call domain at `meeting.hastagcreator.com`.

## Who uses it

Robin has five roles, each with a different slice of the app:

- **Admin** (Rahul, the owner) — sees everything: sales, clients, payroll, attendance, team performance, vault credentials, system settings.
- **Employee** (most of the team — developers, meta-ads specialists, video/influencer coordinators) — clocks in/out, works their assigned client services, sees the full Client CRM, files leaves, joins the huddle.
- **Sales** (Rishi) — runs the lead pipeline, onboards won deals into real clients, tracks payments.
- **Workroom** (Janvi, Bhawna) — staff whose day centers on the always-on audio huddle; also has full Client CRM access.
- **Client** — an external, restricted login for the agency's own clients to see their project status via a portal.

Access is enforced twice: server-side middleware checks the role on every API call, and the client hides/shows entire pages and buttons based on role — so it's not just a UI convenience, it's a real permission boundary.

## Tech stack

- **Frontend**: React 18 + TypeScript, built with Vite, styled with Tailwind CSS (a warm teal/saffron/cream palette defined as HSL variables), Framer Motion for animation, Sonner for toast notifications, Socket.io-client for live updates, LiveKit's client SDK for audio/video. Deployed on **Vercel**, auto-deploying on every push to `main`.
- **Backend**: Node.js + Express + TypeScript, MongoDB via Mongoose (hosted on MongoDB Atlas), Socket.io for real-time events (rooms scoped per organization), JWT-based auth with a 30-day sliding refresh window, and the LiveKit server SDK for the huddle/video infrastructure. Deployed on **Render** (free tier, so the very first request after idle takes ~50 seconds to "wake up" — the UI is specifically designed to survive that gracefully rather than showing a broken timer).
- **AI**: Google's Gemini, called directly over REST (no SDK), with automatic fallback across model versions. Every AI feature is written to degrade gracefully if the API key isn't configured or the call fails — nothing in the app hard-depends on AI being available.
- **Timezone**: every business rule (work day boundaries, "today," cron jobs) is computed in IST, regardless of what timezone the server itself runs in.

## Design language

Robin's UI favors information density with a soft, rounded, card-based aesthetic — rounded-2xl cards, subtle borders, a restrained color system where color is used purposefully (green for healthy/done, amber for at-risk, rose for blocked/urgent, blue for in-progress) rather than decoratively. Status is communicated through small pills and chips rather than paragraphs of text, so a manager can scan a screen full of client cards and understand agency-wide health in seconds. Motion is used sparingly — modals fade and scale in, kanban cards animate on drop — never gratuitously. The app is fully responsive, with dedicated mobile layouts for the pipeline views (stacked columns instead of side-by-side, dropdown "move to stage" controls instead of drag-and-drop for touch devices).

A persistent app shell (`AppLayout`) wraps every page: a collapsible sidebar for navigation (scoped to what the current role can see), a top bar showing the live work-session clock, break controls, notifications, and a quick-access huddle pill so no one loses track of whether they're clocked in or who else is in the audio room.

---

## Feature walkthrough

### 1. Sales CRM

The entry point for new business. Leads move through an **11-stage pipeline** — New Lead → Dialed → Connected → Demo Booked → Demo Done → Demo2 Conversion → Follow Up → Hot Follow-up → Cooking → Won/Lost — visualized as a kanban board with drag-and-drop, plus a dropdown-based "move to stage" control for anyone on mobile or who prefers clicking over dragging. Each lead carries contact info, estimated deal value, a payment sub-ledger (deposit/balance tracking with a running history), free-form tags, and notes.

Leads can arrive three ways: typed in manually, auto-imported from **Meta Lead Ads**, or synced from a **Google Sheet** the sales team already uses. Every lead gets an automatic **AI-generated score** (hot/warm/cold) plus a suggested next action, computed by Gemini reading the lead's context — source, value, notes, how long it's been sitting.

When a deal is won, an onboarding modal walks the sales rep through turning that lead into a real client in one step: set a login for the client, pick which services they bought (Website Development, Meta Ads Management, UGC Videos — with a quantity field for "how many videos" — or a Miscellaneous catch-all), enter the deal's financials (total amount, advance received, with the remaining balance calculated automatically), set up a Meta Ads fee arrangement if relevant (flat monthly fee, percentage of ad spend, a hybrid of both, or a custom written arrangement), and leave delivery notes for whichever team picks up the work. Submitting this creates one real client record in the Client CRM below — not a disconnected duplicate — so the moment a deal closes, it's immediately visible to every other role.

### 2. Client CRM / Project Pipeline

This is Robin's biggest and most-used module — the live operational view of every client the agency is currently serving. Every client is one record holding: contact details, free-form tags, a priority level, an "operational status" (In Progress / Paused / Completed / Cancelled / On Hold — a simple human-set field, separate from the automatic health scoring below), full financials (total contracted amount, advance received, auto-calculated remaining balance, next payment amount/date/what triggers it), the Meta Ads fee model if applicable, who onboarded them and when, and a running activity log of every meaningful change.

Each client can have multiple **services** running in parallel — Website Development, Meta Ads Management, UGC Video production, Miscellaneous — and each service is its own mini-project: it has an owner (a specific teammate, not just "someone on the team"), a status (pending/in-progress/done/blocked), and a checklist of standard steps for that service type (e.g. Website goes through kickoff → theme → products → payments → tracking pixel → test order → handover). Checking off a checklist item, completing a service, or returning it for rework all require a short comment, so there's always a human-readable trail of *why* something changed, not just *that* it changed.

The pipeline is viewable multiple ways depending on what a person needs: a **kanban board** grouped by which stage of work a client is in, a **focused view** that groups by health (stuck / needs attention / going well / done), an **executive view** for a bird's-eye read, a **flat table** for scanning dozens of clients at once, and a **flow diagram** view. All of them read from the same underlying data and respect the same filters — by health, team, priority, blocker reason, service type, operational status, payment status, assigned employee, onboarding rep, or free-text tag search — plus a text search across name/phone/email that's fast enough to double as a universal "find this client" bar. A "Mine only" toggle scopes any of these views down to just the services assigned to the person looking, and a dashboard widget shows the same thing at a glance without leaving the homepage.

Every client also has a dedicated workspace page with a large "what's happening right now" hero section (current stage, who owns it, what's next, health, ETA), a compact project-journey timeline, a full activity/audit history, an AI-generatable client-facing status summary a manager can paste straight into a message, and — new as of the latest CRM upgrade — a collapsible details panel organized into five clearly labeled sections: **Info** (contact + tags), **Sales** (who onboarded them, when), **Services** (compact status of everything they've bought), **Financials** (money in, money owed, what triggers the next payment, the Meta fee arrangement), and **Operations** (status, priority, payment state).

An automated health-scoring system runs in the background every 15 minutes, looking at overdue deliverables, days of inactivity, missed meetings, and open blockers, and assigns each client a color-coded health level (green/yellow/orange/red) with a plain-English explanation — so nobody has to manually audit 20 clients to find the ones quietly falling behind.

### 3. Team Operations

Robin tracks the actual working day. Everyone clocks in and out, and the running timer follows an **"8 hours net work + 1 hour break allowance"** model — break time visibly pauses the clock rather than accruing separately, so a 9-hour clocked day with a 1-hour break shows as 8 hours worked. The timer is deliberately over-engineered for reliability: it survives the backend's ~50-second cold start without glitching, freezes rather than resets if the connection drops, and a background job auto-closes forgotten sessions at end of day. There's a full leave-request system, a personal + team task list, and a shared team calendar.

### 4. Workroom

The agency runs one always-on audio huddle — effectively a virtual open office — built on LiveKit, with screen sharing. Presence in the huddle is one of the primary ways working time gets measured, alongside the clock. A persistent "who's in the huddle right now" pill stays visible across the whole app so nobody has to guess if the room is empty or full.

### 5. Client Meetings

A separate, white-labelled video-calling surface (`meeting.hastagcreator.com`) for calls with the agency's own clients — kept visually distinct from the internal huddle so clients never see internal branding or tooling.

### 6. Vault

An encrypted store for client credentials (site logins, ad account access, hosting panels) with a full audit trail of who accessed what and when — solving the "credentials live in a shared spreadsheet" problem most small agencies have.

### 7. AI features ("Ask Robin")

Beyond lead scoring and client summaries, Robin has a morning-brief generator, an "Ask Robin" chat interface that can answer questions about agency data and in some cases execute commands on request, automated issue triage, and AI-assisted employee/attendance report generation for payroll review. All of it runs through Gemini with automatic model fallback and is designed to never block core functionality if the AI call fails.

### 8. Team performance & accountability

A weekly, automatically-computed scorecard per employee (0–100, built from attendance reliability, focused work hours, on-time task delivery, and check-in discipline), visible to managers with an 8-week trend line. A separate "Brand Pulse" system randomly, gently interrupts a clocked-in staff member during work hours with one quick question about one client they might own — sales figures, blockers, next steps — and routes the question to the right person if they don't own that brand, building a lightweight, low-friction accountability log without requiring anyone to fill out a status report.

### 9. Attendance & payroll tooling

Daily, monthly, and full custom-date-range attendance views, a color-coded calendar per employee, and an AI-generated payroll-ready summary for any date range — all built on one shared calculation engine so the numbers a manager sees in every view are guaranteed to agree with each other.

### 10. Real-time sync

Nearly everything in Robin updates live across every open browser tab and every teammate's screen without needing a manual refresh — a client gets reassigned, a checklist item gets ticked, a lead changes stage — via Socket.io events that any page can listen for. This is what makes it feel like one shared system rather than five people looking at five different snapshots of the truth.

---

## The throughline

Every module in Robin points back to the same idea: there should be exactly **one record** for a piece of truth — one client, one lead, one work session — visible with the right amount of detail to whoever's looking, updating live for everyone else. A recurring theme in the app's development has been finding and closing the gaps where that broke down (a lead that "won" but created a disconnected duplicate client record instead of updating the real one, a stage-change that updated the wrong field and silently didn't save) — the newest work on the platform has specifically been about making the Sales → Client CRM handoff airtight, so a deal closing in Sales shows up immediately, completely, and correctly for whoever picks up the delivery work next.
