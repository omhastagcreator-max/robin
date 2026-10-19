import Organization from '../models/Organization';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import VideoSopRun from '../models/VideoSopRun';
import WorkflowActivity from '../models/WorkflowActivity';
import ActivityLog from '../models/ActivityLog';
import { normName } from './applyClientSetup';
import { syncServiceChecklist } from '../services/videoSopEngine';
import { claimJob } from '../services/jobLock';

/**
 * mergeDuplicateClients — Oct 19 2026. The owner saw Koshnika, Dhobi Express
 * and Tridosh Herbal twice in the client bar: the 18 Oct set-up ran on two
 * booting instances at once and each created the missing UGC brands.
 *
 * Runs on every boot and is a no-op once there are no duplicates. For every
 * brand name (case / spacing / punctuation-insensitive) with more than one
 * live client:
 *   · KEEP the copy with the most real work on it (log lines, daily
 *     updates, video status, ticks); ties → the older one
 *   · copy over anything only the other copy has — video status if newer,
 *     daily updates, SOP steps done there, its client history
 *   · ARCHIVE the extra copy (tags archived + duplicate) — never deleted,
 *     its own log stays readable; its Video SOP run is cancelled
 * Each duplicate set is claimed once (JobLock), so two booting instances never both merge.
 */
const SETUP_DETAIL = /client set-up/i;

async function score(wf: any, runs: any[]): Promise<number> {
  let n = (wf.activity || []).filter((a: any) => !SETUP_DETAIL.test(a.detail || '')).length;
  if ((wf.activity || []).some((a: any) => a.action === 'created' && !SETUP_DETAIL.test(a.detail || ''))) n += 100; // added by a person
  for (const r of runs) {
    n += (r.log || []).filter((l: any) => !['imported', 'restarted', 'started'].includes(l.action)).length;
    n += (r.dailyUpdates || []).length * 3;
    if (r.videoProgress?.updatedAt) n += 5;
  }
  n += await WorkflowActivity.countDocuments({ workflowId: wf._id });
  return n;
}

export async function mergeDuplicateClients(): Promise<void> {
  try {
    const orgs = await Organization.find({}).select('_id').lean();
    for (const org of orgs as any[]) {
      const live = await ClientWorkflow.find({ organizationId: org._id, tags: { $ne: 'archived' } });
      const groups = new Map<string, any[]>();
      for (const wf of live as any[]) {
        const k = normName(wf.clientName);
        if (!k) continue;
        groups.set(k, [...(groups.get(k) || []), wf]);
      }
      for (const [, list] of groups) {
        if (list.length < 2) continue;
        // One instance per duplicate set — two booting servers must not each pick a different keeper.
        const lockKey = `clients.merge:${String(org._id)}:${list.map((w: any) => String(w._id)).sort().join(',')}`;
        if (!(await claimJob(lockKey))) continue;
        const scored: { wf: any; runs: any[]; s: number }[] = [];
        for (const wf of list) {
          const runs = await VideoSopRun.find({ workflowId: wf._id });
          scored.push({ wf, runs, s: await score(wf, runs) });
        }
        scored.sort((a, b) => (b.s - a.s)
          || (new Date(a.wf.createdAt || 0).getTime() - new Date(b.wf.createdAt || 0).getTime())
          || String(a.wf._id).localeCompare(String(b.wf._id)));
        const keep = scored[0];
        const keepRun: any = keep.runs.find(r => r.status === 'active') || keep.runs[0] || null;
        const admin: any = await User.findOne({ organizationId: org._id, role: 'admin', isActive: true }).select('_id').lean();
        const actor = admin ? String(admin._id) : 'system';

        for (const dup of scored.slice(1)) {
          const d = dup.wf;
          // 1. Carry over Video SOP work done on the extra copy.
          for (const r of dup.runs) {
            if (keepRun && String(keepRun._id) !== String(r._id)) {
              const kp = keepRun.videoProgress?.updatedAt ? new Date(keepRun.videoProgress.updatedAt).getTime() : 0;
              const dp = r.videoProgress?.updatedAt ? new Date(r.videoProgress.updatedAt).getTime() : 0;
              if (dp > kp) keepRun.set('videoProgress', JSON.parse(JSON.stringify(r.videoProgress)));
              const seen = new Set((keepRun.dailyUpdates || []).map((u: any) => `${u.dateIST}|${u.by}|${u.text}`));
              for (const u of r.dailyUpdates || []) if (!seen.has(`${u.dateIST}|${u.by}|${u.text}`)) keepRun.dailyUpdates.push(u.toObject ? u.toObject() : u);
              for (const st of r.steps || []) {
                const ks = (keepRun.steps || []).find((x: any) => x.key === st.key);
                if (!ks) continue;
                if (st.doneAt && !ks.doneAt) {
                  for (const f of ['doneAt', 'doneBy', 'link', 'note', 'late', 'afterGrace', 'lateReason', 'lateNote']) ks[f] = st[f];
                }
                (st.items || []).forEach((it: any, i: number) => { if (it.done && ks.items?.[i] && !ks.items[i].done) { ks.items[i].done = true; ks.items[i].doneAt = it.doneAt; ks.items[i].doneBy = it.doneBy; } });
              }
              for (const l of r.log || []) if (!['imported', 'restarted', 'started'].includes(l.action)) keepRun.log.push({ ...(l.toObject ? l.toObject() : l), detail: `${l.detail || ''} (from duplicate copy)`.trim() });
              keepRun.log.push({ actorId: actor, actorName: 'Robin', action: 'merged', detail: `Merged a duplicate "${d.clientName}" into this brand` });
              keepRun.markModified('steps');
              await keepRun.save();
              await syncServiceChecklist(keepRun, actor).catch(() => {});
            }
            if (r.status === 'active') {
              r.status = 'cancelled';
              r.log.push({ actorId: actor, actorName: 'Robin', action: 'cancelled', detail: 'Duplicate brand — merged into the other copy' });
              await r.save();
            }
          }
          // 2. Its client history now reads on the kept brand.
          await WorkflowActivity.updateMany({ workflowId: d._id }, { $set: { workflowId: keep.wf._id } });
          // 3. Archive the extra copy (never deleted).
          d.tags = Array.from(new Set([...(d.tags || []), 'archived', 'duplicate']));
          d.set('archivedFromStatus', d.operationalStatus);
          d.operationalStatus = 'cancelled';
          d.activity.push({ actorId: actor, action: 'archived', detail: `Duplicate of "${keep.wf.clientName}" — merged and archived (19 Oct)` });
          await d.save();
          // 4. Its placeholder client login goes quiet if nothing else uses it.
          if (d.clientId && String(d.clientId) !== String(keep.wf.clientId)) {
            const u: any = await User.findById(d.clientId).select('email role isActive');
            const usedElsewhere = await ClientWorkflow.exists({ clientId: d.clientId, _id: { $ne: d._id }, tags: { $ne: 'archived' } });
            if (u && u.role === 'client' && /@client\.hastagcreator\.com$/.test(u.email || '') && !usedElsewhere) { u.isActive = false; await u.save(); }
          }
          await ActivityLog.create({ organizationId: org._id, userId: actor, action: 'clients.merged_duplicate', entity: 'ClientWorkflow', entityId: String(d._id),
            metadata: { label: d.clientName, keptId: String(keep.wf._id), keptScore: keep.s, dupScore: dup.s } });
          console.log(`[client-merge] "${d.clientName}" ${d._id} → kept ${keep.wf._id}`);
        }
      }
    }
  } catch (e) {
    console.warn('[client-merge] failed', (e as Error).message);
  }
}
