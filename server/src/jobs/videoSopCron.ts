import Organization from '../models/Organization';
import User from '../models/User';
import VideoSopRun from '../models/VideoSopRun';
import { notify } from '../services/notify';
import { computeRunState, ensureRunsForOrg, stepTitle, hasUpdateToday, istDateKey, DAILY_UPDATE_FROM_HOUR } from '../services/videoSopEngine';
import { HOUR } from '../lib/videoSop';

/**
 * videoSopCron — Oct 2026. "Notification at all stages: normal, aggressive
 * and hyper aggressive" (Video SOP sheet).
 *
 *   NORMAL      a step is due within 6h          → assigned person, once per step
 *   AGGRESSIVE  a step is past its deadline but
 *               still inside its grace window     → assigned person, every 2h
 *   HYPER       a step is MISSED (grace over), or
 *               the brand has no video person     → assigned person + admin +
 *                                                    managers (Rahul), every hour
 *
 * One notification per brand per tick (lists every late step) so a stalled
 * brand doesn't fire nine separate alerts. Sends only 08:00–23:00 IST.
 * A level going UP always sends immediately (within those hours).
 */

let io: any = null;
export function setVideoSopIo(s: any) { io = s; }

const TICK_MS = 15 * 60_000;
const REPEAT_MS: Record<string, number> = { aggressive: 2 * HOUR, hyper: 1 * HOUR };
const RANK: Record<string, number> = { '': 0, normal: 1, aggressive: 2, hyper: 3 };

function istHour(now: number) { return new Date(now + 330 * 60_000).getUTCHours(); }
const fmt = (d: Date) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

async function managersOf(orgId: any): Promise<string[]> {
  const m = await User.find({ organizationId: orgId, isActive: true, $or: [{ role: 'admin' }, { roles: 'admin' }, { canViewOversight: true }] }).select('_id').lean();
  return m.map((u: any) => String(u._id));
}

export async function videoSopTick(now = Date.now()): Promise<number> {
  const h = istHour(now);
  if (h < 8 || h >= 23) return 0;
  let sent = 0;
  const orgs = await Organization.find({}).select('_id').lean();
  for (const org of orgs) {
    try { await ensureRunsForOrg(String(org._id)); } catch (e) { console.warn('[video-sop] ensureRuns failed', (e as Error).message); }
  }
  const runs = await VideoSopRun.find({ status: 'active' });
  for (const run of runs) {
    const st = computeRunState(run.toObject(), now);
    const missed = st.steps.filter((s: any) => s.state === 'missed');
    const overdue = st.steps.filter((s: any) => s.state === 'overdue');
    const soon = st.steps.filter((s: any) => s.state === 'due_soon' && !run.normalSentFor.includes(s.key));
    const orgId = String(run.organizationId);
    const link = { type: 'video_sop', entityType: 'video_sop', entityId: String(run._id) };

    let level: '' | 'normal' | 'aggressive' | 'hyper' = '';
    if (missed.length || !run.assignedTo) level = 'hyper';
    else if (overdue.length) level = 'aggressive';
    else if (soon.length) level = 'normal';
    if (!level) continue;

    const last = run.lastNotifyLevel || '';
    const lastAt = run.lastNotifyAt ? new Date(run.lastNotifyAt).getTime() : 0;
    const levelUp = RANK[level] > RANK[last];
    if (level !== 'normal' && !levelUp && now - lastAt < REPEAT_MS[level]) continue;

    if (level === 'normal') {
      const s: any = soon[0];
      await notify({ io, organizationId: orgId, userId: run.assignedTo, includeActor: true, ...link,
        title: `⏰ ${run.clientName}: "${stepTitle(s.key)}" due ${fmt(s.dueAt)}`,
        body: `Day ${st.dayNumber} of 7. Tick it in My tasks once done.` });
      run.normalSentFor.push(...soon.map((x: any) => x.key));
    } else if (level === 'aggressive') {
      const names = overdue.map((s: any) => `"${stepTitle(s.key)}" (grace ends ${fmt(s.graceUntil)})`).join(', ');
      await notify({ io, organizationId: orgId, userId: run.assignedTo, includeActor: true, ...link,
        title: `🚨 OVERDUE — ${run.clientName}`,
        body: `${names}. Finish it now and give the delay reason — after the grace window it goes to Rahul & admin as MISSED.` });
    } else {
      const recipients = new Set(await managersOf(run.organizationId));
      if (run.assignedTo) recipients.add(run.assignedTo);
      const body = !run.assignedTo
        ? 'No video-team person is assigned, so nobody is doing these tasks. Assign someone in Video tasks now.'
        : `MISSED: ${missed.map((s: any) => `"${stepTitle(s.key)}" (was due ${fmt(s.dueAt)})`).join(', ')}. Day ${st.dayNumber} of 7.`;
      await notify({ io, organizationId: orgId, userIds: Array.from(recipients), includeActor: true, ...link,
        title: `🔥 ${run.clientName}: ${run.assignedTo ? 'deadline MISSED' : 'video tasks have no owner'}`, body });
    }
    run.lastNotifyLevel = level;
    run.lastNotifyAt = new Date(now);
    run.log.push({ actorId: '', actorName: 'Robin', action: `notified_${level}`, detail: `${level} reminder sent` });
    await run.save();
    sent++;
  }
  sent += await dailyUpdateChase(now);
  if (sent) console.log(`[video-sop] sent ${sent} SOP reminders`);
  return sent;
}

/**
 * Daily update drive ("day need to update for each step"):
 *   17:00 IST  — owner gets a direct order: post today's update for <brand> now
 *   19:30 IST  — one digest to admin + managers listing every brand with no
 *                update today and who owns it
 * The in-app must-answer popup (VideoSopDailyGate) does the rest.
 */
async function dailyUpdateChase(now: number): Promise<number> {
  const ist = new Date(now + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins < DAILY_UPDATE_FROM_HOUR * 60) return 0;
  const today = istDateKey(now);
  let n = 0;
  const runs = await VideoSopRun.find({ status: 'active' });
  const missingByOrg = new Map<string, string[]>();
  const owners = await User.find({ _id: { $in: runs.map(r => r.assignedTo).filter(Boolean) } }).select('name').lean();
  const ownerName = new Map(owners.map((u: any) => [String(u._id), u.name]));
  for (const run of runs) {
    if (hasUpdateToday(run.toObject(), now)) continue;
    const st = computeRunState(run.toObject(), now);
    const step = st.currentStep ? stepTitle(st.currentStep) : '';
    if (run.assignedTo && run.dailyChasedFor !== today) {
      await notify({ io, organizationId: String(run.organizationId), userId: run.assignedTo, includeActor: true,
        type: 'video_sop', entityType: 'video_sop', entityId: String(run._id),
        title: `📝 Post today's update: ${run.clientName}`,
        body: `Step: "${step}". Write what you did today on it — or mark it done. This is required before you log out.` });
      run.dailyChasedFor = today;
      await run.save();
      n++;
    }
    if (mins >= 19 * 60 + 30 && run.dailyEscalatedFor !== today) {
      const org = String(run.organizationId);
      const list = missingByOrg.get(org) || [];
      list.push(`${run.clientName} (${ownerName.get(run.assignedTo) || 'no owner'} · ${step})`);
      missingByOrg.set(org, list);
      run.dailyEscalatedFor = today;
      await run.save();
    }
  }
  for (const [org, list] of missingByOrg) {
    await notify({ io, organizationId: org, userIds: await managersOf(org), includeActor: true, type: 'video_sop.daily_missing',
      title: `⚠️ ${list.length} brand${list.length > 1 ? 's' : ''} with no video update today`, body: list.join(' · ') });
    n++;
  }
  return n;
}

export function startVideoSopCron() {
  const run = () => videoSopTick().catch(err => console.error('[video-sop] tick failed:', (err as Error).message));
  setTimeout(run, 90_000);
  setInterval(run, TICK_MS);
  console.log('[video-sop] started (every 15 min — normal / aggressive / hyper escalation)');
}
