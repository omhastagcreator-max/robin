import { Types } from 'mongoose';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ActivityLog from '../models/ActivityLog';
import { SERVICE_TEMPLATES } from '../lib/workflowTemplates';

/**
 * teamRoster — Oct 2026. One place that knows how to take someone OFF the
 * team, so the Team & roles page, the admin "remove" button and the one-time
 * roster update all behave the same:
 *   · account switched off (isActive=false) — never deleted, history kept
 *   · every open client stage they owned moves to the least-busy active
 *     teammate on that stage's team (Video SOP runs follow the stage owner)
 *   · anything with no teammate on that team is left unassigned, which the
 *     board shows as "Unassigned" and the Video SOP escalates to managers
 */
export async function deactivateMember(orgId: string, userId: string, actorId: string): Promise<{ moved: { client: string; stage: string; to: string }[] }> {
  const u: any = await User.findOne({ _id: userId, organizationId: orgId });
  if (!u) throw new Error('User not found');
  u.isActive = false;
  await u.save();

  const moved: { client: string; stage: string; to: string }[] = [];
  const wfs = await ClientWorkflow.find({ organizationId: orgId, 'services.assignedTo': String(userId) });
  const load = new Map<string, number>();
  const all = await ClientWorkflow.find({ organizationId: orgId }).select('services').lean();
  for (const w of all as any[]) for (const s of w.services || []) if (s.assignedTo && s.status !== 'done') load.set(s.assignedTo, (load.get(s.assignedTo) || 0) + 1);

  for (const wf of wfs as any[]) {
    let changed = false;
    for (const s of wf.services) {
      if (s.assignedTo !== String(userId) || s.status === 'done') continue;
      const team = (SERVICE_TEMPLATES as any)[s.serviceType]?.team || '';
      const mates = await User.find({ organizationId: orgId, isActive: true, _id: { $ne: userId },
        role: { $in: ['employee', 'sales', 'admin'] }, $or: [{ team }, { teams: team }] }).select('_id name').lean();
      mates.sort((a: any, b: any) => (load.get(String(a._id)) || 0) - (load.get(String(b._id)) || 0));
      const to: any = mates[0];
      s.assignedTo = to ? String(to._id) : '';
      if (to) load.set(String(to._id), (load.get(String(to._id)) || 0) + 1);
      wf.activity.push({ actorId, action: 'service_reassigned', serviceType: s.serviceType,
        detail: `${s.label}: ${u.name} left the team → ${to ? to.name : 'unassigned (needs an owner)'}` });
      moved.push({ client: wf.clientName, stage: s.label, to: to ? to.name : 'Unassigned' });
      changed = true;
    }
    if (changed) await wf.save();
  }
  await ActivityLog.create({ organizationId: new Types.ObjectId(orgId), userId: actorId, action: 'member.removed', entity: 'user', entityId: u._id,
    metadata: { label: `${u.name} · ${moved.length} stage(s) reassigned` } }).catch(() => {});
  return { moved };
}
