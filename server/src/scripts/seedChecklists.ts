/**
 * seedChecklists.ts — backfill default SOP checklists on every service
 * line of every existing ClientWorkflow whose checklist is empty.
 *
 * Why this exists: earlier import runs created services with an empty
 * `checklist: []` because the script didn't reference workflowTemplates.
 * That made the StageWorkspacePage show "No checklist configured for
 * this stage yet" — confusing, because Robin SHIPS default per-service
 * SOPs (see server/src/lib/workflowTemplates.ts).
 *
 * This script:
 *   1. Loads every ClientWorkflow.
 *   2. For each service line with an empty checklist, populates the
 *      default checklist from SERVICE_TEMPLATES[serviceType].
 *   3. Leaves services that already have ticked items alone — we
 *      never want to wipe real progress.
 *
 * Idempotent: a second run does nothing because populated checklists
 * are skipped.
 */

import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ClientWorkflow from '../models/ClientWorkflow';
import { SERVICE_TEMPLATES, type ServiceType } from '../lib/workflowTemplates';

(async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI missing in .env — aborting.'); process.exit(1); }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const workflows = await ClientWorkflow.find();
  let touchedWorkflows = 0;
  let seededServices  = 0;
  for (const wf of workflows) {
    let dirty = false;
    for (const svc of (wf.services as any[])) {
      if ((svc.checklist || []).length > 0) continue;     // don't clobber existing work
      const tpl = SERVICE_TEMPLATES[svc.serviceType as ServiceType];
      if (!tpl) continue;
      svc.checklist = tpl.checklist.map(text => ({ text, done: false }));
      seededServices++;
      dirty = true;
    }
    if (dirty) {
      await wf.save();
      touchedWorkflows++;
    }
  }
  console.log(`Seeded ${seededServices} service checklists across ${touchedWorkflows} workflows.`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
