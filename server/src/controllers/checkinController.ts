import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import DailyCheckin from '../models/DailyCheckin';
import ProjectTask from '../models/ProjectTask';
import ClientWorkflow from '../models/ClientWorkflow';
import User from '../models/User';

/**
 * checkinController — the daily 3-popup pulse.
 *
 *   GET  /api/checkin/today       → status for the logged-in user
 *   POST /api/checkin/morning     → submit morning checkin
 *   POST /api/checkin/midday      → submit midday checkin
 *   POST /api/checkin/end         → submit evening checkin
 *   GET  /api/checkin/admin/today → per-user table for admin/sales
 *
 * IST day key — single source of truth for "what counts as today".
 * Returned in YYYY-MM-DD form so all upserts target the same row.
 */

function istDayKey(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

async function getOrg(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

/* ───────────────────────────── GET today's status ────────────────────────── */

/**
 * Returns the user's checkin doc for today, plus the list of brands they
 * should answer the morning popup about (computed from their assignments
 * in ClientWorkflow.services[].assignedTo).
 *
 * Shape (client mirrors this in `useCheckin`):
 *   {
 *     dateIST: '2026-06-29',
 *     morning: { done, submittedAt, brands: [...], tasks: [...] },
 *     midday:  { done, submittedAt, blockers },
 *     evening: { done, submittedAt, tomorrowPlan },
 *     brandsForMorning: [{ clientWorkflowId, clientName, hasMeta }],
 *     yesterdayTomorrowPlan: ''     // pre-fill source for today's morning
 *   }
 */
export async function getMyCheckinToday(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId  = await getOrg(userId);
    if (!orgId) { res.json({ ok: true, empty: true }); return; }

    const dateIST = istDayKey();

    const [doc, brands, yesterday] = await Promise.all([
      DailyCheckin.findOne({ organizationId: orgId, userId, dateIST }).lean(),
      // Brands this user touches — services[] where assignedTo === userId.
      ClientWorkflow.find({
        organizationId: orgId,
        'services.assignedTo': userId,
      }).select('clientName services.serviceType services.assignedTo').lean(),
      // Yesterday's tomorrowPlan, if any.
      (() => {
        const yest = new Date(Date.now() + 330 * 60_000 - 86_400_000);
        const ykey = yest.toISOString().slice(0, 10);
        return DailyCheckin.findOne({
          organizationId: orgId, userId, dateIST: ykey,
        }).select('evening.tomorrowPlan').lean();
      })(),
    ]);

    const brandsForMorning = brands
      .filter(b => Array.isArray((b as any).services) && (b as any).services.some((s: any) => String(s.assignedTo) === String(userId)))
      .map(b => ({
        clientWorkflowId: String((b as any)._id),
        clientName: String((b as any).clientName || 'Brand'),
        hasMeta: ((b as any).services || []).some((s: any) =>
          String(s.assignedTo) === String(userId) &&
          /meta|fb|facebook|ads/i.test(s.serviceType || '')
        ),
      }));

    res.json({
      ok: true,
      dateIST,
      morning: doc?.morning || { done: false, submittedAt: null, brands: [], tasks: [] },
      midday:  doc?.midday  || { done: false, submittedAt: null, blockers: '' },
      evening: doc?.evening || { done: false, submittedAt: null, tomorrowPlan: '' },
      brandsForMorning,
      yesterdayTomorrowPlan: (yesterday as any)?.evening?.tomorrowPlan || '',
    });
  } catch (err: any) {
    console.error('[checkin] getMyCheckinToday error', err);
    res.status(500).json({ error: err.message || 'Failed to load checkin' });
  }
}

/* ─────────────────────────────── POST morning ────────────────────────────── */

interface MorningPayload {
  brands: Array<{
    clientWorkflowId: string;
    clientName?: string;
    metaStatus?: 'running' | 'paused' | 'off' | 'pending' | 'na';
    note?: string;
  }>;
  tasks: Array<{
    title: string;
    clientWorkflowId?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }>;
}

/**
 * Submit the morning checkin.
 *
 *   1. Upsert today's DailyCheckin doc — set morning.brands, morning.tasks,
 *      morning.submittedAt = now, morning.done = true.
 *   2. For each task, CREATE a ProjectTask with assignedTo = self,
 *      assignedBy = self, status = 'pending'. Stamp importedFrom =
 *      'daily-checkin:morning:<dateIST>' so re-submits don't duplicate.
 *   3. For each brand entry with a non-na metaStatus, append a one-line
 *      activity log to the workflow (visible on the brand workspace) AND
 *      stamp WorkflowActivity if available — but we keep it best-effort
 *      so a missing model doesn't crash the submit.
 *   4. Fire socket `data:changed` so admin's command center updates live.
 */
export async function submitMorning(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const userName = req.user!.name || 'Teammate';
    const orgId  = await getOrg(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization on user' }); return; }
    const dateIST = istDayKey();

    const body = (req.body || {}) as MorningPayload;
    const rawBrands = Array.isArray(body.brands) ? body.brands : [];
    const rawTasks  = Array.isArray(body.tasks)  ? body.tasks  : [];

    // Normalise + cap. Keep brand entries to whatever the user submitted;
    // tasks capped at 20 to stop a runaway client from creating 10k rows.
    const brands = rawBrands.slice(0, 50).map(b => ({
      clientWorkflowId: new mongoose.Types.ObjectId(String(b.clientWorkflowId)),
      clientName: String(b.clientName || '').slice(0, 120),
      metaStatus: (['running', 'paused', 'off', 'pending', 'na'] as const).includes(b.metaStatus as any)
        ? b.metaStatus!
        : 'na',
      note: String(b.note || '').slice(0, 280),
    }));

    const tasks = rawTasks
      .filter(t => t && typeof t.title === 'string' && t.title.trim().length > 0)
      .slice(0, 20)
      .map(t => ({
        title: t.title.trim().slice(0, 200),
        clientWorkflowId: t.clientWorkflowId ? new mongoose.Types.ObjectId(String(t.clientWorkflowId)) : null,
        priority: (['low', 'medium', 'high', 'urgent'] as const).includes(t.priority as any) ? t.priority! : 'medium',
      }));

    // Upsert checkin doc.
    const importTag = `daily-checkin:morning:${dateIST}:${userId}`;
    const existing = await DailyCheckin.findOne({ organizationId: orgId, userId, dateIST });

    // If morning was already submitted, treat this as a revision but DO NOT
    // create new ProjectTask rows for tasks that already exist (matched by
    // title + importTag). New tasks get created; existing ones are kept.
    const alreadyCreatedTitles = new Set(
      existing?.morning?.tasks?.map(t => (t as any).title) || []
    );

    const taskDocs: any[] = [];
    for (const t of tasks) {
      let projectTaskId: mongoose.Types.ObjectId | null = null;
      if (alreadyCreatedTitles.has(t.title)) {
        // re-use the existing task's mirror taskId if we can find it on the doc.
        const prev = existing?.morning?.tasks?.find((x: any) => x.title === t.title);
        projectTaskId = (prev as any)?.taskId || null;
      } else {
        const created = await ProjectTask.create({
          organizationId: orgId,
          assignedTo: userId,
          assignedBy: userId,
          title: t.title,
          clientWorkflowId: t.clientWorkflowId,
          priority: t.priority,
          status: 'pending',
          importedFrom: importTag,
        });
        projectTaskId = created._id as any;
      }
      taskDocs.push({ ...t, taskId: projectTaskId, morningStatus: 'planned' });
    }

    const updated = await DailyCheckin.findOneAndUpdate(
      { organizationId: orgId, userId, dateIST },
      {
        $set: {
          'morning.brands':       brands,
          'morning.tasks':        taskDocs,
          'morning.submittedAt':  new Date(),
          'morning.done':         true,
        },
        $setOnInsert: {
          organizationId: orgId,
          userId,
          dateIST,
        },
      },
      { upsert: true, new: true },
    );

    // Best-effort: write per-brand "Meta status" activity to the workflow's
    // activity log so the brand workspace shows today's morning state.
    // Failures here are swallowed — the checkin itself succeeded.
    try {
      for (const b of brands) {
        if (b.metaStatus === 'na' && !b.note) continue;
        const detailParts = [];
        if (b.metaStatus !== 'na') detailParts.push(`Meta: ${b.metaStatus}`);
        if (b.note) detailParts.push(b.note);
        await ClientWorkflow.updateOne(
          { _id: b.clientWorkflowId, organizationId: orgId },
          {
            $push: {
              activity: {
                at: new Date(),
                actorId: userId,
                actorName: userName,
                action: 'daily_checkin_morning',
                detail: detailParts.join(' · '),
              },
            },
            $set: { lastActivityAt: new Date(), lastActivitySummary: `Morning · ${detailParts.join(' · ')}`.slice(0, 200) },
          },
        );
      }
    } catch (_e) { /* swallow */ }

    // Realtime nudge — admin's command center & today-activity refresh.
    const io = req.app.get('io');
    if (io && orgId) {
      io.to(`org:${orgId}`).emit('data:changed', { entity: 'checkin', kind: 'morning_submitted' });
    }

    res.json({ ok: true, checkin: updated });
  } catch (err: any) {
    console.error('[checkin] submitMorning error', err);
    res.status(500).json({ error: err.message || 'Failed to submit morning checkin' });
  }
}

/* ─────────────────────────────── POST midday ─────────────────────────────── */

interface MiddayPayload {
  taskUpdates: Array<{
    taskId: string;                     // morning.tasks[].taskId (ProjectTask ID)
    status: 'done' | 'in_progress' | 'blocked' | 'not_started';
    note?: string;
  }>;
  blockers?: string;
}

/**
 * Submit the midday checkin. Requires the morning to be done first.
 * Updates each morning-task with its midday status + writes the same
 * status back to the underlying ProjectTask so the rest of Robin
 * stays consistent.
 */
export async function submitMidday(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId  = await getOrg(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization on user' }); return; }
    const dateIST = istDayKey();

    const body = (req.body || {}) as MiddayPayload;
    const updates = Array.isArray(body.taskUpdates) ? body.taskUpdates.slice(0, 50) : [];
    const blockers = String(body.blockers || '').slice(0, 600);

    const doc = await DailyCheckin.findOne({ organizationId: orgId, userId, dateIST });
    if (!doc?.morning?.done) {
      res.status(400).json({ error: 'Submit the morning checkin first.' });
      return;
    }

    // Patch each morning task's midday fields.
    const updateMap = new Map(updates.map(u => [String(u.taskId), u]));
    let touched = false;
    for (const t of doc.morning.tasks) {
      const tid = String((t as any).taskId || '');
      const u = updateMap.get(tid);
      if (!u) continue;
      (t as any).middayStatus = u.status;
      (t as any).middayNote   = String(u.note || '').slice(0, 280);
      touched = true;
      // Mirror to ProjectTask so the workroom inbox stays in sync.
      try {
        if (tid && (u.status === 'done' || u.status === 'in_progress' || u.status === 'blocked')) {
          const mapped =
            u.status === 'done' ? 'done' :
            u.status === 'blocked' ? 'blocked' :
            'ongoing';
          const patch: any = { status: mapped };
          if (mapped === 'done') {
            patch.completedAt = new Date();
            patch.actualCompletionAt = new Date();
          }
          await ProjectTask.updateOne({ _id: tid, organizationId: orgId }, { $set: patch });
        }
      } catch (_e) { /* swallow per-task mirror failures */ }
    }
    doc.markModified('morning.tasks');
    if (!touched) {
      // No-task-updates is fine — they might just be filing the blockers line.
    }
    doc.midday = {
      submittedAt: new Date(),
      done: true,
      blockers,
    } as any;
    await doc.save();

    const io = req.app.get('io');
    if (io && orgId) io.to(`org:${orgId}`).emit('data:changed', { entity: 'checkin', kind: 'midday_submitted' });

    res.json({ ok: true, checkin: doc });
  } catch (err: any) {
    console.error('[checkin] submitMidday error', err);
    res.status(500).json({ error: err.message || 'Failed to submit midday checkin' });
  }
}

/* ─────────────────────────────── POST evening ────────────────────────────── */

interface EveningPayload {
  taskUpdates: Array<{
    taskId: string;
    status: 'done' | 'in_progress' | 'rolled_over' | 'dropped';
    reason?: string;
  }>;
  tomorrowPlan?: string;
}

/**
 * Submit the evening checkin. Requires morning to be done. (Midday is
 * NOT required because in practice some short days never cross 2pm.)
 * Writes final status + reason for each task; mirrors to ProjectTask.
 */
export async function submitEvening(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const orgId  = await getOrg(userId);
    if (!orgId) { res.status(400).json({ error: 'No organization on user' }); return; }
    const dateIST = istDayKey();

    const body = (req.body || {}) as EveningPayload;
    const updates = Array.isArray(body.taskUpdates) ? body.taskUpdates.slice(0, 50) : [];
    const tomorrowPlan = String(body.tomorrowPlan || '').slice(0, 600);

    const doc = await DailyCheckin.findOne({ organizationId: orgId, userId, dateIST });
    if (!doc?.morning?.done) {
      res.status(400).json({ error: 'Submit the morning checkin first.' });
      return;
    }

    const updateMap = new Map(updates.map(u => [String(u.taskId), u]));
    for (const t of doc.morning.tasks) {
      const tid = String((t as any).taskId || '');
      const u = updateMap.get(tid);
      if (!u) continue;
      (t as any).eveningStatus = u.status;
      (t as any).eveningReason = String(u.reason || '').slice(0, 280);
      // Mirror to ProjectTask: done = done; rolled_over/in_progress = pending;
      // dropped = blocked + comment with the reason.
      try {
        if (!tid) continue;
        let mapped: string | null = null;
        if (u.status === 'done') mapped = 'done';
        else if (u.status === 'in_progress' || u.status === 'rolled_over') mapped = 'pending';
        else if (u.status === 'dropped') mapped = 'blocked';
        if (!mapped) continue;
        const patch: any = { status: mapped };
        if (mapped === 'done') {
          patch.completedAt = new Date();
          patch.actualCompletionAt = new Date();
        }
        await ProjectTask.updateOne({ _id: tid, organizationId: orgId }, { $set: patch });
        if (u.reason) {
          await ProjectTask.updateOne(
            { _id: tid, organizationId: orgId },
            { $push: { comments: { authorId: userId, content: `[End-of-day] ${u.reason}`.slice(0, 280) } } },
          );
        }
      } catch (_e) { /* swallow */ }
    }
    doc.markModified('morning.tasks');
    doc.evening = {
      submittedAt: new Date(),
      done: true,
      tomorrowPlan,
    } as any;
    await doc.save();

    const io = req.app.get('io');
    if (io && orgId) io.to(`org:${orgId}`).emit('data:changed', { entity: 'checkin', kind: 'evening_submitted' });

    res.json({ ok: true, checkin: doc });
  } catch (err: any) {
    console.error('[checkin] submitEvening error', err);
    res.status(500).json({ error: err.message || 'Failed to submit evening checkin' });
  }
}

/* ────────────────────── Admin: today's checkin report ─────────────────────── */

/**
 * One row per teammate showing whether they've done morning / midday /
 * evening today, plus the count of morning tasks + how many are still
 * outstanding. Admin / sales only — but the existing route gate enforces
 * that, so this controller just builds the list.
 */
export async function getAdminCheckinReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.id;
    const orgId = await getOrg(me);
    if (!orgId) { res.json({ ok: true, rows: [] }); return; }
    const dateIST = istDayKey();

    const [users, checkins] = await Promise.all([
      User.find({
        organizationId: orgId,
        isActive: true,
        role: { $in: ['admin', 'employee', 'sales', 'workroom'] },
      }).select('_id name email role team avatarUrl').lean(),
      DailyCheckin.find({ organizationId: orgId, dateIST }).lean(),
    ]);

    const byUser = new Map(checkins.map(c => [String(c.userId), c]));

    const rows = users.map(u => {
      const c = byUser.get(String(u._id));
      const tasks = c?.morning?.tasks || [];
      const taskCount = tasks.length;
      const doneCount = tasks.filter((t: any) => t.eveningStatus === 'done' || t.middayStatus === 'done').length;
      return {
        userId:       String(u._id),
        name:         u.name || u.email,
        email:        u.email,
        role:         u.role,
        team:         u.team || '',
        avatarUrl:    (u as any).avatarUrl || '',
        morningDone:  !!c?.morning?.done,
        middayDone:   !!c?.midday?.done,
        eveningDone:  !!c?.evening?.done,
        morningTasks: taskCount,
        doneTasks:    doneCount,
        leftTasks:    taskCount - doneCount,
        blockers:     c?.midday?.blockers || '',
        tomorrowPlan: c?.evening?.tomorrowPlan || '',
        tasks:        tasks.map((t: any) => ({
          title:        t.title,
          priority:     t.priority,
          middayStatus: t.middayStatus || '',
          eveningStatus: t.eveningStatus || '',
          eveningReason: t.eveningReason || '',
        })),
        brands: (c?.morning?.brands || []).map((b: any) => ({
          clientName: b.clientName,
          metaStatus: b.metaStatus,
          note:       b.note,
        })),
      };
    });

    res.json({ ok: true, dateIST, rows });
  } catch (err: any) {
    console.error('[checkin] getAdminCheckinReport error', err);
    res.status(500).json({ error: err.message || 'Failed to load report' });
  }
}
