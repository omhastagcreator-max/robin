import { Schema, model, Types } from 'mongoose';

/**
 * A stored credential / login / link belonging to a client.
 *
 * Used by employees to quickly look up things like a client's WordPress
 * admin login, Meta Ads account, social media credentials, etc.
 *
 * The password is encrypted at rest via AES-256-GCM (see lib/crypto.ts).
 */
const ClientCredentialSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  clientId:       { type: Types.ObjectId, ref: 'User' },
  projectId:      { type: Types.ObjectId, ref: 'Project' },

  title: { type: String, required: true, trim: true },
  type:  {
    type: String,
    enum: ['website', 'social', 'ad', 'email', 'api', 'hosting', 'analytics', 'other'],
    default: 'other',
  },

  url:      { type: String, trim: true },
  username: { type: String, trim: true },

  // Password is stored encrypted. The plaintext is never persisted.
  passwordEnc: { type: String },
  passwordIv:  { type: String },
  passwordTag: { type: String },

  notes:     { type: String, trim: true },

  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

ClientCredentialSchema.index({ organizationId: 1, clientId: 1 });
ClientCredentialSchema.index({ organizationId: 1, projectId: 1 });
ClientCredentialSchema.index({ organizationId: 1, title: 'text', url: 'text', username: 'text', notes: 'text' });

export default model('ClientCredential', ClientCredentialSchema);
