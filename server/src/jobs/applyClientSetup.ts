import { Types } from 'mongoose';
import Organization from '../models/Organization';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import VideoSopRun from '../models/VideoSopRun';
import ActivityLog from '../models/ActivityLog';
import { SERVICE_TEMPLATES } from '../lib/workflowTemplates';
import { claimJob } from '../services/jobLock';
import { startRun, markDoneBefore, videoSupportIds, syncServiceChecklist, buildSteps } from '../services/videoSopEngine';

/**
 * applyClientSetup — Oct 2026, the owner's answers (18 Oct, 21:5x IST):
 *
 *   Active clients ... Oudfy, MotoCasa, ArdoWellness, Woodsify, Dufft, Early Flux
 *                      + the UGC brands below
 *   UGC brands ....... Koshnika, Meta Go, Dhobi Express, Tridosh Herbal → videos coming / editing
 *                      MAA → script sent / shipping
 *   Owner ............ Priyanka on every UGC brand; Amit Kamble (intern) helps on all
 *   Deadlines ........ restart from today for the remaining steps
 *
 * Every other client is ARCHIVED (hidden, never deleted — restore from
 * "Clean up clients"). Clients onboarded after ACTIVE_CUTOFF are never touched,
 * so a brand Rishi adds before this deploys stays live. Runs ONCE per
 * SETUP_VERSION (marker row), so later clean-ups made in the app are never undone.
 * Names match case/spacing/punctuation-insensitively; a UGC brand with no
 * match is created (name-only, like "Add client").
 */
const SETUP_VERSION = '2026-10-18';
const ACTIVE_CUTOFF = new Date('2026-10-18T22:00:00+05:30');
const ACTIVE = ['Oudfy', 'MotoCasa', 'ArdoWellness', 'Woodsify', 'Dufft', 'Early Flux'];
const UGC: { name: string; step: string }[] = [
  { name: 'Koshnika', step: 'first_draft' },
  { name: 'Meta Go', step: 'first_draft' },
  { name: 'Dhobi Express', step: 'first_draft' },
  { name: 'Tridosh Herbal', step: 'first_draft' },
  { name: 'MAA', step: 'script_sent' },
];
export const normName = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function applyClientSetup(): Promise<void> {
  try {
    const orgs = await Organization.find({}).select('_id').lean();
    for (const org of orgs as any[]) {
      const orgId = String(org._id);
      if (await ActivityLog.exists({ organizationId: org._id, action: 'clients.setup', 'metadata.version': SETUP_VERSION })) continue;
      // Oct 19 — only ONE booting instance may run this (see JobLock).
      if (!(await claimJob(`clients.setup:${SETUP_VERSION}:${orgId}`))) continue;
      const notes: string[] = [];
      const admin: any = await User.findOne({ organizationId: org._id, role: 'admin', isActive: true }).select('_id').lean();
      const actor = admin ? String(admin._id) : '';
      const owners = await User.find({ organizationId: org._id, isActive: true, name: /^priyanka(\s|$)/i }).select('_id name').lean();
      const owner: any = owners.length === 1 ? owners[0] : null;
      if (!owner) notes.push(`Priyanka: ${owners.length ? 'several matches' : 'not found'} — UGC brands left unassigned`);

      const keep = new Set([...ACTIVE, ...UGC.map(u => u.name)].map(normName));
      const all = await ClientWorkflow.find({ organizationId: org._id });
      // 1. Archive everything not on the active list (never touching new onboardings).
      let archived = 0;
      for (const wf of all as any[]) {
        if (keep.has(normName(wf.clientName))) continue;
        if ((wf.tags || []).includes('archived')) continue;
        const born = new Date(wf.onboardedAt || wf.createdAt || 0);
        if (born >= ACTIVE_CUTOFF) continue;
        wf.tags = Array.from(new Set([...(wf.tags || []), 'archived']));
        wf.set('archivedFromStatus', wf.operationalStatus);
        wf.operationalStatus = 'cancelled';
        wf.activity.push({ actorId: actor || 'system', action: 'archived', detail: 'Archived in client set-up (not on the active list, 18 Oct)' });
        await wf.save();
        await VideoSopRun.updateMany({ workflowId: wf._id, status: 'active' }, { $set: { status: 'cancelled' } });
        archived++;
      }
      notes.push(`${archived} client(s) archived`);
      // Active ones that were archived earlier come back.
      for (const wf of all as any[]) {
        if (!keep.has(normName(wf.clientName)) || !(wf.tags || []).includes('archived')) continue;
        wf.tags = wf.tags.filter((t: string) => t !== 'archived');
        wf.operationalStatus = 'in_progress';
        await wf.save();
        notes.push(`${wf.clientName}: restored`);
      }

      // 2. UGC brands: make sure they exist, Priyanka owns the UGC stage, SOP runs from the right step.
      const tpl: any = (SERVICE_TEMPLATES as any).influencer;
      for (const b of UGC) {
        let wf: any = (await ClientWorkflow.find({ organizationId: org._id })).find((w: any) => normName(w.clientName) === normName(b.name));
        if (!wf) {
          const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const cu: any = await User.create({ organizationId: org._id, email: `${slug}-${Date.now().toString(36)}@client.hastagcreator.com`,
            name: b.name, role: 'client', isActive: true, passwordHash: Math.random().toString(36) + Math.random().toString(36) });
          wf = await ClientWorkflow.create({
            organizationId: org._id, clientId: String(cu._id), clientName: b.name, createdBy: actor || String(cu._id),
            onboardedBy: actor, onboardedAt: new Date(), services: [],
            activity: [{ actorId: actor || 'system', action: 'created', detail: 'Added in client set-up (UGC brand, 18 Oct)' }],
          });
          notes.push(`${b.name}: created`);
        }
        let svc = (wf.services || []).find((s: any) => s.serviceType === 'influencer');
        if (!svc) {
          wf.services.push({ serviceType: 'influencer', label: tpl.label, status: 'in_progress', assignedTo: owner ? String(owner._id) : '',
            checklist: tpl.checklist.map((t: string) => ({ text: t, done: false })) });
          svc = wf.services[wf.services.length - 1];
        }
        if (owner) svc.assignedTo = String(owner._id);
        if (svc.status === 'pending' || svc.status === 'blocked') svc.status = 'in_progress';
        await wf.save();

        let run: any = await VideoSopRun.findOne({ organizationId: org._id, serviceId: svc._id });
        if (run && run.status !== 'active') {
          // Re-open the old run instead of deleting it — its log is kept (owner: "logs to be maintained").
          run.status = 'active'; run.completedAt = null;
          run.startedAt = new Date(); run.steps = buildSteps(run.startedAt);
          const n = markDoneBefore(run, b.step, new Date(), actor);
          run.log.push({ actorId: actor, actorName: 'Robin', action: 'restarted', detail: `Re-opened in client set-up at "${b.step}" (${n} earlier steps done before tracking)` });
        }
        if (!run) {
          run = await startRun(orgId, String(wf._id), String(svc._id), new Date(), actor);
          if (run) {
            const n = markDoneBefore(run, b.step, new Date(), actor);
            run.log.push({ actorId: actor, actorName: 'Robin', action: 'imported', detail: `Live brand — picked up at "${b.step}" (${n} earlier steps done before tracking); deadlines restart from today` });
          }
        }
        if (run) {
          if (owner) run.assignedTo = String(owner._id);
          run.helpers = await videoSupportIds(orgId, run.assignedTo);
          await run.save();
          await syncServiceChecklist(run, actor);
          notes.push(`${b.name}: SOP at ${b.step}`);
        }
      }
      await ActivityLog.create({ organizationId: org._id, action: 'clients.setup', entity: 'organization', metadata: { version: SETUP_VERSION, notes } });
      console.log(`[client-setup] ${SETUP_VERSION}: ${notes.join(' · ')}`);
      void Types;
    }
  } catch (e) {
    console.warn('[client-setup] failed', (e as Error).message);
  }
}
