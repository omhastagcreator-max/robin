import { Schema, model, Types } from 'mongoose';

/**
 * SopOverride — per-org customisation of the default SOP checklists.
 *
 * The defaults in lib/workflowTemplates.ts ship with Robin. When an admin
 * wants to add an item, remove one, or rename one for THEIR agency only,
 * they save an override here. The workflow controller checks this collection
 * first and falls back to defaults.
 *
 * One doc per (org, serviceType) — uniqueness enforced. Admin UI for
 * editing these can be added later without changing the model.
 *
 * The model exists today so future migrations don't have to think about
 * SOP customisation — the field is just empty until someone edits it.
 */
const SopOverrideSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
  serviceType:    { type: String, required: true },
  // If set, REPLACES the default checklist for this serviceType in this
  // org. An empty array means "this org has no checklist for this service"
  // — preserved as an intentional choice (vs. null = use defaults).
  checklist:      { type: [String], default: undefined },
  // If set, REPLACES the default label.
  label:          { type: String },
  updatedBy:      { type: String },
}, { timestamps: true });

SopOverrideSchema.index({ organizationId: 1, serviceType: 1 }, { unique: true });

export default model('SopOverride', SopOverrideSchema);
