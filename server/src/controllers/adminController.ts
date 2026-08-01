import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Project from '../models/Project';
import Session from '../models/Session';
import ProjectTask from '../models/ProjectTask';
import ActivityLog from '../models/ActivityLog';
import bcrypt from 'bcryptjs';
import Organization from '../models/Organization';
import LeaveApplication from '../models/LeaveApplication';
import { sessionTotals, effectiveEndMs } from '../services/sessionTime';
import * as meta from '../services/metaAdsService';
import { callGemini } from '../services/aiTriage';

// GET /api/admin/employees
export async function listEmployees(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Include 'workroom' role here so admin can see + manage huddle-only
    // teammates from the same Employees screen. Without this, workroom
    // users would be invisible to admin even though they're internal staff.
    const employees = await User.find({ role: { $in: ['employee', 'sales', 'workroom'] }, isActive: true }).select('-passwordHash').lean();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const enriched = await Promise.all(employees.map(async (e) => {
      const activeSession = await Session.findOne({ userId: String(e._id), status: { $in: ['active', 'on_break'] } });
      const tasksDoneToday = await ProjectTask.countDocuments({
        assignedTo: String(e._id), status: 'done',
        completedAt: { $gte: today },
      });
      return {
        ...e,
        sessionStatus: activeSession?.status || 'none',
        tasksDoneToday,
      };
    }));

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/clients
export async function listClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const clients = await User.find({ role: 'client', isActive: true }).select('-passwordHash').lean();
    const enriched = await Promise.all(clients.map(async (c) => {
      const projectCount = await Project.countDocuments({ clientId: String(c._id), status: 'active' });
      return { ...c, projectCount };
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/activity
export async function getActivityLog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// POST /api/admin/invite  (creates user directly)
//
// June 2026 — fixed three compounding bugs that surfaced as "unable
// to create new team member from admin side":
//
//   1. The duplicate check was GLOBAL (any org), not org-scoped.
//      Re-using an email that ever existed (incl. another tenant)
//      returned 409 "User already exists" and admin couldn't add a
//      new teammate even though the email was free in their agency.
//
//   2. A user that was previously DEACTIVATED (soft-delete sets
//      isActive=false but keeps the row) still triggered the dup
//      check, so re-adding a teammate who left and came back was
//      impossible. Now: detect a deactivated match in THIS org and
//      reactivate it instead of failing.
//
//   3. The Mongo email-unique index throws E11000 if you slip past
//      the explicit check (e.g. race between two admin invites).
//      We now catch that distinct error code and translate to a
//      clear, actionable 409 instead of a 500 with raw Mongo guts.
export async function inviteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { email, role = 'employee', name = '', team = '', password = 'Robin2024!' } = req.body;
    if (!email) { res.status(400).json({ error: 'Email required' }); return; }
    const normalized = String(email).trim().toLowerCase();

    // Resolve the inviting admin's org. Falls back to first org if the
    // admin's record somehow has none (legacy seed accounts).
    let org;
    const actor = await User.findById(req.user!.id).select('organizationId').lean();
    if (actor?.organizationId) {
      org = await Organization.findById(actor.organizationId);
    }
    if (!org) org = await Organization.findOne();
    if (!org) org = await Organization.create({ name: 'Robin Agency', plan: 'pro' });

    // Same-org duplicate check FIRST.
    const sameOrgMatch = await User.findOne({
      email: normalized,
      organizationId: org._id,
    });
    if (sameOrgMatch) {
      if (sameOrgMatch.isActive === false) {
        // Deactivated teammate coming back — reactivate + (optionally)
        // reset role + password instead of throwing.
        sameOrgMatch.isActive = true;
        if (role)  sameOrgMatch.role  = role;
        if (team)  sameOrgMatch.team  = team;
        sameOrgMatch.passwordHash = password;     // pre-save hook bcrypts
        await sameOrgMatch.save();
        res.status(200).json({
          message: `Reactivated existing teammate: ${normalized}`,
          credentials: { email: normalized, password, role: sameOrgMatch.role },
          userId: String(sameOrgMatch._id),
          reactivated: true,
        });
        return;
      }
      res.status(409).json({ error: `${normalized} is already a teammate in this agency.` });
      return;
    }

    // Cross-org collision: the email exists in ANOTHER tenant. The
    // global unique index on User.email would throw E11000 below if
    // we proceed. Surface a clear error so admin knows it's not
    // their copy of the email that's the problem.
    const crossOrgMatch = await User.findOne({ email: normalized });
    if (crossOrgMatch) {
      res.status(409).json({
        error: `${normalized} is registered in another Robin workspace. Use a different email.`,
      });
      return;
    }

    try {
      const user = await User.create({
        email: normalized,
        passwordHash: password,
        name: name || normalized.split('@')[0],
        role,
        team,
        organizationId: org._id,
      });
      res.status(201).json({
        message: `User created: ${normalized}`,
        credentials: { email: normalized, password, role },
        userId: String(user._id),
      });
    } catch (createErr: any) {
      // E11000 = duplicate key on the unique email index. Translate
      // to a clean 409 instead of leaking Mongo internals.
      if (createErr?.code === 11000) {
        res.status(409).json({ error: `${normalized} is already registered. Use a different email.` });
        return;
      }
      throw createErr;
    }
  } catch (err) {
    console.error('[adminInvite] failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message || 'Could not create user' });
  }
}

// PUT /api/admin/users/:id/role
export async function updateUserRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/admin/users/:id/can-manage-workroom
// Admin-only — toggles whether this user can onboard 'workroom'-role
// teammates. Used to delegate huddle-only-staff onboarding to Om without
// granting him admin access.
export async function setCanManageWorkroom(req: AuthRequest, res: Response): Promise<void> {
  try {
    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { canManageWorkroom: enabled },
      { new: true },
    ).select('-passwordHash');
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(user);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// DELETE /api/admin/users/:id
// Soft-deactivate the user (preserves history). Admin can't deactivate themselves.
export async function deactivateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.params.id === req.user!.id) {
      res.status(400).json({ error: "You can't deactivate your own admin account" });
      return;
    }
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    user.isActive = false;
    await user.save();
    res.json({ message: `${user.name || user.email} has been removed`, userId: String(user._id) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/admin/users/:id/reset-password
//
// Admin sets a new password for any user in THEIR organization. Org-scoped
// so an admin from agency A can't reset agency B's users. The User model's
// pre-save hook auto-hashes plaintext passwords, so we just assign and save.
export async function resetUserPassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Org-scope: actor's org === target's org
    const actor = await User.findById(req.user!.id).select('organizationId').lean();
    const orgId = actor?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const user = await User.findOne({ _id: req.params.id, organizationId: orgId });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const { newPassword: provided } = req.body || {};
    const newPassword = (provided && String(provided).trim().length >= 6)
      ? String(provided).trim()
      : 'Robin2024!';   // safe default if admin didn't pick one

    user.passwordHash = newPassword;   // pre-save hook bcrypts it
    await user.save();
    res.json({ message: `Password reset for ${user.name || user.email}`, newPassword, email: user.email });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/admin/meta/clients/bulk
 *
 * For each Meta ad account the agency has access to, ensure a
 * corresponding Robin Client user exists (role='client', team=''),
 * linked via metaAdAccountId. Skips any account that already has a
 * client mapped to it.
 *
 * Placeholder email is generated (e.g., "client.scent-diffuser@robin.local")
 * so the user record is valid; admin can edit to the real email later
 * from /admin/clients. Password hash is a random unguessable string —
 * client gets in via SSO/OAuth or admin reset, not by typing a password.
 */
export async function bulkCreateMetaClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!meta.isConfigured()) { res.status(503).json({ error: 'Meta Ads not configured on server' }); return; }
    const orgId = (await User.findById(req.user!.id).select('organizationId'))?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const accounts = await meta.listAdAccounts();
    const results = {
      created: [] as Array<{ adAccountId: string; name: string; userId: string }>,
      skipped: [] as Array<{ adAccountId: string; name: string; reason: string }>,
    };

    for (const acc of accounts) {
      // Already linked?
      const existing = await User.findOne({ metaAdAccountId: acc.id });
      if (existing) {
        results.skipped.push({ adAccountId: acc.id, name: acc.name, reason: `already linked to ${existing.email}` });
        continue;
      }

      // Slugify the account name for the placeholder email
      const slug = (acc.name || acc.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client';
      const email = `client.${slug}.${acc.id.replace('act_', '')}@robin.local`;

      // Random unguessable password — admin will reset / share email-link login later
      const randomPw = Math.random().toString(36) + Math.random().toString(36);

      try {
        const user = await User.create({
          email,
          name: acc.name || acc.id,
          role: 'client',
          organizationId: orgId,
          metaAdAccountId: acc.id,
          passwordHash: randomPw, // pre-save hook bcrypts it
        });
        results.created.push({ adAccountId: acc.id, name: acc.name, userId: String(user._id) });
      } catch (e: any) {
        results.skipped.push({ adAccountId: acc.id, name: acc.name, reason: e?.message || 'create failed' });
      }
    }

    res.json({
      ok: true,
      summary: `Created ${results.created.length}, skipped ${results.skipped.length}.`,
      ...results,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/attendance?date=YYYY-MM-DD
//
// Daily attendance report: every internal staff member with their
// session timestamps for the chosen IST date. Lets admin see at a
// glance who clocked in when, who's still active, who got auto-closed
// for forgetting to clock out.
export async function getAttendance(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Pull org from current admin
    const adminUser = await User.findById(req.user!.id).select('organizationId');
    const orgId = adminUser?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    // IST date window. Default = today in IST.
    const dateStr = (req.query.date as string) || (() => {
      const ist = new Date(Date.now() + 330 * 60_000);
      return ist.toISOString().slice(0, 10);
    })();
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { res.status(400).json({ error: 'Invalid date — use YYYY-MM-DD' }); return; }
    const [, y, mo, d] = m.map(Number) as unknown as number[];
    // IST midnight start of that day, expressed in UTC = -5:30h from IST
    const dayStartIstUtc = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 330 * 60_000);
    const dayEndIstUtc   = new Date(dayStartIstUtc.getTime() + 24 * 3600 * 1000);
    const now = Date.now();

    // Pull every internal staff member (includes 'workroom' role — they
    // can clock in via huddle attendance, so they belong in the report).
    const staff = await User.find({
      organizationId: orgId,
      role: { $in: ['admin', 'employee', 'sales', 'workroom'] },
      isActive: true,
    }).select('_id name email role team avatarUrl').sort({ name: 1 }).lean();

    // Pull all sessions that overlap that IST day.
    const sessions = await Session.find({
      organizationId: orgId,
      $or: [
        { startTime: { $gte: dayStartIstUtc, $lt: dayEndIstUtc } },           // started in-day
        { endTime:   { $gte: dayStartIstUtc, $lt: dayEndIstUtc } },           // ended in-day
        { startTime: { $lt: dayStartIstUtc }, endTime:   { $gte: dayEndIstUtc } }, // spanned
        { startTime: { $lt: dayStartIstUtc }, status: { $in: ['active', 'on_break'] } }, // still open
      ],
    }).sort({ startTime: 1 }).lean();

    // Group + summarise per user.
    const byUser = staff.map((u: any) => {
      const uid = String(u._id);
      const userSessions = sessions.filter(s => String(s.userId) === uid);

      // Compute time totals clamped to the IST day window.
      let totalWorkedMs = 0;
      let totalBreakMs  = 0;
      const sessionRows = userSessions.map(s => {
        const t = sessionTotals(s as any, dayStartIstUtc.getTime(), Math.min(dayEndIstUtc.getTime(), now));
        totalWorkedMs += t.workedMs;
        totalBreakMs  += t.breakMs;
        const effEnd = effectiveEndMs(s as any, now);
        return {
          _id: s._id,
          startTime: s.startTime,
          endTime:   s.endTime || null,
          effectiveEnd: new Date(effEnd),
          status:    s.status,
          autoClosedAt: s.autoClosedAt || null,
          lastHeartbeatAt: s.lastHeartbeatAt || null,
          breakEvents: s.breakEvents || [],
          workedMs: t.workedMs,
          breakMs:  t.breakMs,
          activeMs: t.activeMs,
        };
      });
      // Sum each session's OWN activeMs (already net of break + away) —
      // do NOT recompute as totalWorkedMs − totalBreakMs, which silently
      // drops the away-time deduction and made this header total drift
      // from the sum of the expanded session rows below it. (July 2026
      // fix — this was part of the "time calculation is off" reports.)
      const totalActiveMs = sessionRows.reduce((sum, s) => sum + s.activeMs, 0);

      // Friendly aggregates for the row.
      const firstClockIn = userSessions.length ? userSessions[0].startTime : null;
      const lastSession  = userSessions[userSessions.length - 1];
      const lastClockOut = lastSession?.endTime || null;
      const isStillActive = userSessions.some(s => s.status === 'active' || s.status === 'on_break');

      return {
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          team: u.team,
          avatarUrl: u.avatarUrl,
        },
        firstClockIn,
        lastClockOut,
        isStillActive,
        sessionCount: userSessions.length,
        totalWorkedMs,
        totalActiveMs,
        totalBreakMs,
        sessions: sessionRows,
      };
    });

    res.json({
      date: dateStr,
      now: new Date(now),
      windowStart: dayStartIstUtc,
      windowEnd:   dayEndIstUtc,
      rows: byUser,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * buildAttendanceMatrix — shared engine behind the Monthly, Calendar, and
 * date-Range attendance views (owner ask, July 2026: "let me pick a date
 * range too, and have AI summarise it"). Given an org and an arbitrary
 * [rangeStartUtc, rangeEndUtc) window, walks every day in the window and
 * returns, per staff member, a day → {firstClockIn, lastClockOut,
 * activeMs, breakMs, status} map plus rollup totals.
 *
 * One function, three callers (getMonthlyAttendance / getRangeAttendance
 * / getRangeAttendanceSummary) — so all attendance surfaces always agree
 * with each other and with the live timer (same sessionTotals() math).
 *
 * Status: 'leave' (approved leave beats everything), 'off' (Sunday),
 * 'present' (≥6h net work), 'partial' (worked some, under 6h), 'absent'
 * (expected, zero worked). Days beyond "now" are simply not included.
 */
async function buildAttendanceMatrix(orgId: any, rangeStartUtc: number, rangeEndUtc: number) {
  const IST = 330 * 60_000;
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const effectiveEnd = Math.min(rangeEndUtc, now);
  const totalDays = Math.max(0, Math.round((rangeEndUtc - rangeStartUtc) / DAY));

  const staff = await User.find({
    organizationId: orgId,
    role: { $in: ['admin', 'employee', 'sales', 'workroom'] },
    isActive: true,
  }).select('_id name email role team avatarUrl').sort({ name: 1 }).lean();

  const sessions = await Session.find({
    organizationId: orgId,
    startTime: { $lt: new Date(rangeEndUtc) },
    $or: [
      { endTime: { $gte: new Date(rangeStartUtc) } },
      { endTime: null },
      { endTime: { $exists: false } },
    ],
  }).lean();

  const leaves = await LeaveApplication.find({
    organizationId: orgId, status: 'approved',
    'days.date': { $gte: new Date(rangeStartUtc - DAY), $lt: new Date(rangeEndUtc + DAY) },
  }).lean();
  const leaveByUser = new Map<string, Set<string>>();
  for (const l of leaves) {
    const uid = String((l as any).userId);
    const set = leaveByUser.get(uid) || new Set<string>();
    for (const d of (l as any).days || []) {
      const dateIST = new Date(new Date(d.date).getTime() + IST).toISOString().slice(0, 10);
      set.add(dateIST);
    }
    leaveByUser.set(uid, set);
  }

  const FULL_DAY_MS = 6 * 60 * 60 * 1000;   // ≥6h net = counted as a full present day

  const employees = staff.map((u: any) => {
    const uid = String(u._id);
    const userSessions = sessions.filter(s => String(s.userId) === uid);
    const leaveSet = leaveByUser.get(uid) || new Set<string>();
    const days: Record<string, any> = {};
    let daysPresent = 0, daysPartial = 0, daysAbsent = 0, daysLeave = 0;
    let totalActiveMs = 0, totalBreakMs = 0;
    const startMinsSample: number[] = [];

    for (let i = 0; i < totalDays; i++) {
      const dStart = rangeStartUtc + i * DAY;
      if (dStart >= now) break;   // future — omit entirely
      const dEnd = Math.min(dStart + DAY, effectiveEnd);
      const dateIST = new Date(dStart + IST).toISOString().slice(0, 10);
      const dow = new Date(dStart + IST).getUTCDay();
      const onLeave = leaveSet.has(dateIST);

      let activeMs = 0, breakMs = 0, firstClockIn: string | null = null, lastClockOut: string | null = null;
      for (const s of userSessions) {
        const t = sessionTotals(s as any, dStart, dEnd);
        if (t.workedMs <= 0) continue;
        activeMs += t.activeMs;
        breakMs += t.breakMs;
        const st = new Date(s.startTime).getTime();
        if (st >= dStart && st < dEnd && (!firstClockIn || st < new Date(firstClockIn).getTime())) {
          firstClockIn = new Date(st).toISOString();
        }
        if (s.endTime) {
          const en = new Date(s.endTime).getTime();
          if (en >= dStart && en < dEnd) lastClockOut = new Date(en).toISOString();
        }
      }

      let status: 'leave' | 'off' | 'present' | 'partial' | 'absent';
      if (onLeave) { status = 'leave'; daysLeave++; }
      else if (dow === 0) { status = 'off'; }
      else if (activeMs >= FULL_DAY_MS) { status = 'present'; daysPresent++; }
      else if (activeMs > 0) { status = 'partial'; daysPartial++; }
      else { status = 'absent'; daysAbsent++; }

      if (firstClockIn) {
        const istMins = Math.floor(((new Date(firstClockIn).getTime() + IST) % DAY) / 60_000);
        startMinsSample.push(istMins);
      }
      totalActiveMs += activeMs;
      totalBreakMs += breakMs;
      days[dateIST] = { firstClockIn, lastClockOut, activeMs: Math.round(activeMs), breakMs: Math.round(breakMs), status };
    }

    const avgStartMins = startMinsSample.length
      ? Math.round(startMinsSample.reduce((a, b) => a + b, 0) / startMinsSample.length)
      : null;

    return {
      user: { _id: u._id, name: u.name, email: u.email, role: u.role, team: u.team, avatarUrl: u.avatarUrl },
      days,
      totals: { daysPresent, daysPartial, daysAbsent, daysLeave, totalActiveMs, totalBreakMs, avgStartMins },
    };
  });

  return { employees, totalDays };
}

/**
 * GET /api/admin/attendance/monthly?month=YYYY-MM
 *
 * Powers BOTH the Monthly rollup table and the Calendar grid (owner ask,
 * July 2026: "monthly, daily and calendar report of attendance and log
 * in/out — currently only a single date works").
 */
export async function getMonthlyAttendance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const adminUser = await User.findById(req.user!.id).select('organizationId');
    const orgId = adminUser?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const monthStr = (req.query.month as string) || (() => {
      const ist = new Date(Date.now() + 330 * 60_000);
      return ist.toISOString().slice(0, 7);
    })();
    const m = monthStr.match(/^(\d{4})-(\d{2})$/);
    if (!m) { res.status(400).json({ error: 'Invalid month — use YYYY-MM' }); return; }
    const [, yStr, moStr] = m;
    const year = Number(yStr), month = Number(moStr);
    const IST = 330 * 60_000;
    const monthStartUtc = Date.UTC(year, month - 1, 1) - IST;
    const monthEndUtc = Date.UTC(year, month, 1) - IST;

    const { employees, totalDays } = await buildAttendanceMatrix(orgId, monthStartUtc, monthEndUtc);
    res.json({ month: monthStr, daysInMonth: totalDays, employees });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/** Parses & validates a from/to query pair shared by the range endpoints. */
function parseRangeQuery(req: AuthRequest): { from: string; to: string; fromUtc: number; toUtc: number } | null {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const IST = 330 * 60_000;
  const DAY = 24 * 60 * 60 * 1000;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd) - IST;
  const toUtc = Date.UTC(ty, tm - 1, td) - IST + DAY;   // inclusive end date
  if (toUtc <= fromUtc) return null;
  // Cap at ~1 year to keep the per-day loop bounded.
  if (toUtc - fromUtc > 370 * DAY) return null;
  return { from, to, fromUtc, toUtc };
}

/**
 * GET /api/admin/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Arbitrary custom-range attendance matrix — same shape as /monthly, so
 * the client's range table reuses the same rendering logic.
 */
export async function getRangeAttendance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const adminUser = await User.findById(req.user!.id).select('organizationId');
    const orgId = adminUser?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const range = parseRangeQuery(req);
    if (!range) { res.status(400).json({ error: 'Provide from & to as YYYY-MM-DD, to ≥ from, within 1 year.' }); return; }

    let { employees, totalDays } = await buildAttendanceMatrix(orgId, range.fromUtc, range.toUtc);
    // Optional single-employee filter (owner ask, July 2026 — payroll
    // processing: "how was Om's attendance last month" for one person,
    // not the whole team dumped together).
    const userId = req.query.userId as string | undefined;
    if (userId) employees = employees.filter(e => String(e.user._id) === userId);

    res.json({ from: range.from, to: range.to, totalDays, employees });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/admin/attendance/range/summary   { from, to, userId? }
 *
 * AI-generated executive summary of attendance for the chosen range
 * (owner ask, July 2026). Feeds Gemini the per-employee rollup (not raw
 * session dumps — keeps the prompt small) — EXACTLY the same numbers the
 * table on screen shows, so the AI narrative and the visible data can
 * never disagree. Same graceful-degrade convention as the rest of
 * Robin's AI — if Gemini is unavailable, returns a deterministic
 * plain-text summary instead of failing the request.
 *
 * With `userId` set, scopes to ONE person and switches to a payroll-
 * framed prompt (attendance rate, hours, absences, punctuality, and an
 * explicit flag on anything that needs manual review before processing
 * salary) instead of the team-wide "who's slipping" framing.
 */
export async function getRangeAttendanceSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const adminUser = await User.findById(req.user!.id).select('organizationId');
    const orgId = adminUser?.organizationId;
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const from = String(req.body?.from || '');
    const to = String(req.body?.to || '');
    const userId = req.body?.userId ? String(req.body.userId) : undefined;
    const fakeReq = { query: { from, to } } as unknown as AuthRequest;
    const range = parseRangeQuery(fakeReq);
    if (!range) { res.status(400).json({ error: 'Provide from & to as YYYY-MM-DD, to ≥ from, within 1 year.' }); return; }

    let { employees, totalDays } = await buildAttendanceMatrix(orgId, range.fromUtc, range.toUtc);
    if (userId) {
      employees = employees.filter(e => String(e.user._id) === userId);
      if (employees.length === 0) { res.status(404).json({ error: 'Employee not found' }); return; }
    }
    const expectedDays = employees[0]
      ? Object.values(employees[0].days).filter((d: any) => d.status !== 'off').length
      : totalDays;

    const rows = employees.map(e => {
      const t = e.totals;
      const attendanceRate = expectedDays > 0 ? Math.round(((t.daysPresent + t.daysPartial) / expectedDays) * 100) : 0;
      const avgHours = (t.daysPresent + t.daysPartial) > 0
        ? (t.totalActiveMs / ((t.daysPresent + t.daysPartial) * 3_600_000)).toFixed(1)
        : '0';
      const avgStart = t.avgStartMins != null
        ? `${String(Math.floor(t.avgStartMins / 60)).padStart(2, '0')}:${String(t.avgStartMins % 60).padStart(2, '0')} IST`
        : 'n/a';
      return `${e.user.name || e.user.email} (${e.user.role}): attendance ${attendanceRate}%, ` +
        `full days ${t.daysPresent}, partial ${t.daysPartial}, absent ${t.daysAbsent}, leave ${t.daysLeave}, ` +
        `avg start ${avgStart}, avg hours/day worked ${avgHours}h, total break ${(t.totalBreakMs / 3_600_000).toFixed(1)}h`;
    }).join('\n');

    let summary: string;
    try {
      const system = userId
        ? 'You are a payroll/HR assistant for a small digital marketing agency. Write a short summary of ONE ' +
          'employee\'s attendance for the given date range, using ONLY the data provided, in plain prose (no ' +
          'headers, no bullets). Cover: overall attendance rate, full vs partial vs absent vs leave day counts, ' +
          'punctuality (average start time), average hours worked per day, and break usage. End with one explicit ' +
          'sentence flagging whether anything here needs manual review before processing salary (e.g. unexplained ' +
          'absences, chronic lateness, low hours) or stating it looks clean. 100-150 words.'
        : 'You are an operations analyst for a small digital marketing agency. Write a short, punchy executive ' +
          'summary of team attendance for the given date range, using ONLY the data provided. ' +
          'Cover: overall attendance health, who is most reliable/punctual, who is slipping (low attendance, late ' +
          'starts, high absence) and by how much, and any notable pattern (e.g. frequent partial days, heavy break ' +
          'usage). Be specific with names and numbers. 120-180 words. Plain prose, no headers, no bullet points.';
      const payload = `Date range: ${range.from} to ${range.to}\n\n` +
        `${userId ? 'Employee' : 'Per-employee'} attendance data:\n${rows}`;
      summary = (await callGemini(system, payload, 400)).trim();
    } catch {
      // Deterministic fallback — still useful, just less prose.
      if (userId && employees[0]) {
        const t = employees[0].totals;
        summary = `Attendance ${range.from} → ${range.to} for ${employees[0].user.name || employees[0].user.email}: ` +
          `${t.daysPresent} full days, ${t.daysPartial} partial, ${t.daysAbsent} absent, ${t.daysLeave} on leave. ` +
          `Total active time ${(t.totalActiveMs / 3_600_000).toFixed(1)}h, break ${(t.totalBreakMs / 3_600_000).toFixed(1)}h. ` +
          `(AI summary unavailable — showing computed highlights instead.)`;
      } else {
        const sorted = [...employees].sort((a, b) => b.totals.daysPresent - a.totals.daysPresent);
        const best = sorted[0], worst = sorted[sorted.length - 1];
        summary = `Attendance summary ${range.from} → ${range.to} (${employees.length} staff): ` +
          `${best?.user.name || '—'} led with ${best?.totals.daysPresent || 0} full days; ` +
          `${worst?.user.name || '—'} had the most gaps (${worst?.totals.daysAbsent || 0} absent, ${worst?.totals.daysPartial || 0} partial). ` +
          `Total logged break time across the team: ${employees.reduce((s, e) => s + e.totals.totalBreakMs, 0) / 3_600_000 | 0}h. ` +
          `(AI summary unavailable — showing computed highlights instead.)`;
      }
    }

    res.json({ from: range.from, to: range.to, summary });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// GET /api/admin/employees/:id/report?period=daily|weekly|monthly|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function getEmployeeReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    let period = (req.query.period as string) || 'daily';

    // Compute startDate based on server time
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0); // Default daily = today 00:00

    if (period === 'weekly') {
      const day = startDate.getDay();                              // 0 = Sun, 1 = Mon …
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1); // back to Monday
      startDate.setDate(diff);
    } else if (period === 'monthly') {
      startDate.setDate(1); // first of the month
    }

    // Custom date range (owner ask, July 2026 — "let me pick a custom
    // range for one employee, e.g. to process salary"). IST-anchored:
    // `from` maps to IST midnight, `to` maps to the END of that IST day.
    // Falls back to the preset behaviour above if from/to are missing
    // or malformed, so existing Daily/Weekly/Monthly callers are unaffected.
    const IST = 330 * 60_000;
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    let endDate: Date | null = null;
    if (fromStr && toStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) && /^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      const [fy, fm, fd] = fromStr.split('-').map(Number);
      const [ty, tm, td] = toStr.split('-').map(Number);
      const fromUtc = Date.UTC(fy, fm - 1, fd) - IST;
      const toUtc = Date.UTC(ty, tm - 1, td) - IST + 24 * 60 * 60 * 1000; // end of that IST day
      if (toUtc > fromUtc) {
        startDate.setTime(fromUtc);
        endDate = new Date(toUtc);
        period = 'custom';
      }
    }
    // effectiveNow is what every "up to now" computation below is bounded
    // by — real now for the preset periods, or the custom range's end for
    // a custom (possibly historical) window.
    const effectiveNow = endDate ? Math.min(Date.now(), endDate.getTime()) : Date.now();

    // Verify employee exists
    const employee = await User.findById(id).select('-passwordHash').lean();
    if (!employee) { res.status(404).json({ error: 'Employee not found' }); return; }

    // Activity log for the timeframe
    const activities = await ActivityLog.find({
      userId: id,
      createdAt: endDate ? { $gte: startDate, $lte: endDate } : { $gte: startDate },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Tasks assigned to user that were touched (created/updated/completed) within the timeframe
    const tasksTouchedInPeriod = await ProjectTask.find({
      assignedTo: id,
      $or: endDate ? [
        { createdAt:   { $gte: startDate, $lte: endDate } },
        { updatedAt:   { $gte: startDate, $lte: endDate } },
        { completedAt: { $gte: startDate, $lte: endDate } },
      ] : [
        { createdAt:   { $gte: startDate } },
        { updatedAt:   { $gte: startDate } },
        { completedAt: { $gte: startDate } },
      ],
    }).populate('projectId', 'name').sort({ updatedAt: -1 }).lean();

    // Tasks completed within the timeframe
    const completedTasks = await ProjectTask.find({
      assignedTo: id,
      status: 'done',
      completedAt: endDate ? { $gte: startDate, $lte: endDate } : { $gte: startDate },
    }).populate('projectId', 'name').sort({ completedAt: -1 }).lean();

    // Tasks currently ongoing (not bounded by period — overall pipeline)
    const ongoingTasks = await ProjectTask.find({
      assignedTo: id,
      status: { $in: ['pending', 'ongoing'] },
    }).populate('projectId', 'name').sort({ dueDate: 1 }).lean();

    // Tasks newly assigned to user inside the period
    const totalTasksAssignedInPeriod = await ProjectTask.countDocuments({
      assignedTo: id,
      createdAt: endDate ? { $gte: startDate, $lte: endDate } : { $gte: startDate },
    });

    // ── Session time aggregation (working / active / break hours) ──────────
    // Pull every session that overlaps the period: it either started inside
    // the window, or it's still open (no endTime) and was started before.
    const now = effectiveNow;
    const sessions = await Session.find({
      userId: id,
      $or: [
        { startTime: endDate ? { $gte: startDate, $lte: endDate } : { $gte: startDate } },  // started in period
        { endTime:   endDate ? { $gte: startDate, $lte: endDate } : { $gte: startDate } },  // ended in period
        { startTime: { $lt: startDate }, status: { $in: ['active', 'on_break'] } },         // still running from before
      ],
    }).lean();

    // Use the shared sessionTime service so heartbeat-clamped time flows
    // through reports too. A forgotten clock-out no longer adds phantom hours.
    let totalWorkedMs = 0;
    let totalBreakMs  = 0;
    for (const s of sessions) {
      const t = sessionTotals(s as any, startDate.getTime(), now);
      totalWorkedMs += t.workedMs;
      totalBreakMs  += t.breakMs;
    }
    const activeMs = Math.max(0, totalWorkedMs - totalBreakMs);

    // ── Task completion stats ───────────────────────────────────────────────
    // "Touched" tasks within the period are the realistic universe of work
    // they engaged with this period. Completion rate = done / touched.
    const totalTasksTouched   = tasksTouchedInPeriod.length;
    const completedInTouched  = tasksTouchedInPeriod.filter((t: any) => t.status === 'done').length;
    const completionRate      = totalTasksTouched > 0
      ? Math.round((completedInTouched / totalTasksTouched) * 100)
      : 0;

    // Status + priority breakdowns — useful for the "brief info" card
    const statusBreakdown   = { pending: 0, ongoing: 0, done: 0 } as Record<string, number>;
    const priorityBreakdown = { low: 0, medium: 0, high: 0, urgent: 0 } as Record<string, number>;
    for (const t of tasksTouchedInPeriod as any[]) {
      if (t.status   in statusBreakdown)   statusBreakdown[t.status]++;
      if (t.priority in priorityBreakdown) priorityBreakdown[t.priority]++;
    }

    // Overdue tasks among the user's overall ongoing pipeline
    const overdueCount = ongoingTasks.filter((t: any) =>
      t.dueDate && new Date(t.dueDate).getTime() < now
    ).length;

    // ── Attendance: per-day clock-in/out + averages over last 30 days ─────
    // We pull a wider window (30 days) for the *averages* so they're
    // statistically meaningful, but the per-day list is scoped to the
    // current report period.
    const periodSessions = sessions
      .filter(s => s.startTime)
      .map(s => ({
        _id: s._id,
        startTime: s.startTime,
        endTime: s.endTime || null,
        status: s.status,
        autoClosedAt: s.autoClosedAt || null,
      }))
      .sort((a, b) => new Date(a.startTime as any).getTime() - new Date(b.startTime as any).getTime());

    // Group per IST date — for each date, take the FIRST start and LAST end.
    const byDate = new Map<string, { firstStart: Date; lastEnd: Date | null; count: number }>();
    const istDateKey = (d: Date) => {
      const ist = new Date(d.getTime() + 330 * 60_000);
      return ist.toISOString().slice(0, 10);
    };
    for (const s of periodSessions) {
      const key = istDateKey(new Date(s.startTime as any));
      const slot = byDate.get(key);
      const start = new Date(s.startTime as any);
      const end = s.endTime ? new Date(s.endTime as any) : null;
      if (!slot) {
        byDate.set(key, { firstStart: start, lastEnd: end, count: 1 });
      } else {
        if (start < slot.firstStart) slot.firstStart = start;
        if (end && (!slot.lastEnd || end > slot.lastEnd)) slot.lastEnd = end;
        slot.count += 1;
      }
    }
    const dailyAttendance = Array.from(byDate.entries())
      .map(([dateKey, v]) => ({
        date: dateKey,
        firstStart: v.firstStart,
        lastEnd: v.lastEnd,
        sessionCount: v.count,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first

    // Compute typical start / end of day. Use the last 30 days of CLOSED
    // sessions (so we don't include incomplete days). Convert to "minutes
    // since IST midnight" for averaging, then format as HH:MM.
    const thirtyDaysAgo = new Date(now - 30 * 86400_000);
    const recentClosed = await Session.find({
      userId: id,
      startTime: endDate ? { $gte: thirtyDaysAgo, $lte: endDate } : { $gte: thirtyDaysAgo },
    }).select('startTime endTime').lean();

    const minutesIst = (d: Date) => {
      const ist = new Date(d.getTime() + 330 * 60_000);
      return ist.getUTCHours() * 60 + ist.getUTCMinutes();
    };
    const startMins: number[] = [];
    const endMins: number[] = [];
    // Group recent sessions per date and take first start / last end per day
    const recentByDate = new Map<string, { first: Date; last: Date | null }>();
    for (const s of recentClosed) {
      const start = new Date(s.startTime as any);
      const k = istDateKey(start);
      const slot = recentByDate.get(k);
      const end = s.endTime ? new Date(s.endTime as any) : null;
      if (!slot) recentByDate.set(k, { first: start, last: end });
      else {
        if (start < slot.first) slot.first = start;
        if (end && (!slot.last || end > slot.last)) slot.last = end;
      }
    }
    for (const v of recentByDate.values()) {
      startMins.push(minutesIst(v.first));
      if (v.last) endMins.push(minutesIst(v.last));
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const fmtHM = (m: number | null) => {
      if (m === null) return null;
      const h = Math.floor(m / 60);
      const mm = String(m % 60).padStart(2, '0');
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${mm} ${period}`;
    };
    const avgStartMin = avg(startMins);
    const avgEndMin   = avg(endMins);

    res.json({
      period,
      startDate,
      endDate,
      employee,
      stats: {
        // Tasks
        totalTasksDoneInPeriod:     completedTasks.length,
        totalTasksAssignedInPeriod,
        totalTasksOngoing:          ongoingTasks.length,
        activityCount:              activities.length,
        // Time (all in milliseconds; client formats to hours/minutes)
        totalWorkedMs,
        activeMs,
        totalBreakMs,
        sessionCount:               sessions.length,
      },
      completion: {
        totalTasksTouched,
        completedInTouched,
        completionRate,           // 0–100
        statusBreakdown,
        priorityBreakdown,
        overdueCount,
      },
      activities,
      tasks: {
        completed: completedTasks,
        ongoing:   ongoingTasks,
        touched:   tasksTouchedInPeriod,
      },
      attendance: {
        // Averages over the LAST 30 DAYS — separate window from the
        // report period so they're statistically stable.
        usualStartTime: fmtHM(avgStartMin),  // e.g. "9:42 AM"
        usualEndTime:   fmtHM(avgEndMin),    // e.g. "6:15 PM"
        sampleSize:     recentByDate.size,    // how many days the avg is based on
        // Per-day attendance for the REPORT PERIOD only.
        days: dailyAttendance,
      },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
