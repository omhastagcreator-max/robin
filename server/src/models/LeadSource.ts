import { Schema, model, Types } from 'mongoose';

/**
 * LeadSource — the configuration for one external lead-intake feed
 * connected to an organization. Right now we support `google-sheet`;
 * the schema leaves room for `meta-leadgen` later without migrating.
 *
 * Per-org, only ONE active feed of each kind today. Compound unique
 * index enforces it.
 */
const LeadSourceSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  kind:           { type: String, enum: ['google-sheet', 'meta-leadgen', 'csv'], required: true },

  // ── Google Sheets specifics ─────────────────────────────────────────
  spreadsheetId:  { type: String },                       // from sheet URL
  sheetName:      { type: String, default: 'Sheet1' },    // tab name
  // Column mapping — admin can override the defaults if their sheet uses
  // different headers. Keys are Robin lead fields, values are sheet
  // column names (case-insensitive match against the header row).
  columnMap:      {
    name:    { type: String, default: 'name' },
    phone:   { type: String, default: 'phone' },
    email:   { type: String, default: 'email' },
    company: { type: String, default: 'company' },
    source:  { type: String, default: 'source' },
    notes:   { type: String, default: 'notes' },
  },

  // ── Sync state ─────────────────────────────────────────────────────
  enabled:        { type: Boolean, default: true },
  lastSyncedAt:   { type: Date },
  lastError:      { type: String },
  totalImported:  { type: Number, default: 0 },
  // We track imported row signatures (phone+email) so re-syncing the same
  // sheet doesn't double-create. Capped via $slice on writes.
  importedKeys:   { type: [String], default: [] },

  createdBy:      { type: String },
}, { timestamps: true });

LeadSourceSchema.index({ organizationId: 1, kind: 1 }, { unique: true });

export default model('LeadSource', LeadSourceSchema);
