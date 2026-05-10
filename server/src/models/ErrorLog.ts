import { Schema, model, Types } from 'mongoose';

/**
 * ErrorLog — every server error AND every client-side crash flows here.
 *
 * Source can be:
 *   - 'server'  — caught by the global Express error handler
 *   - 'client'  — POSTed by the React app (window.onerror, axios failures,
 *                 unhandledrejection handlers)
 *
 * Auto-expires after 30 days via TTL index — keeps the collection small
 * and stops it growing forever. Increase the TTL if you ever need long
 * history for compliance / forensics.
 */
const ErrorLogSchema = new Schema({
  source:         { type: String, enum: ['server', 'client'], required: true, index: true },
  level:          { type: String, enum: ['error', 'warning'], default: 'error' },
  message:        { type: String, required: true, maxlength: 2000 },
  stack:          { type: String, maxlength: 8000 },
  // Where it happened
  url:            { type: String, maxlength: 1000 },        // request path or page URL
  method:         { type: String, maxlength: 16 },          // HTTP method, server only
  statusCode:     { type: Number },                         // HTTP status, server only
  // Who saw it
  userId:         { type: String },
  userEmail:      { type: String },
  organizationId: { type: Types.ObjectId, ref: 'Organization', index: true },
  userAgent:      { type: String, maxlength: 500 },
  // Free-form context — feature flags, request body summary, etc.
  meta:           { type: Schema.Types.Mixed },
}, { timestamps: true });

// TTL: documents auto-delete 30 days after createdAt.
ErrorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
// Common queries
ErrorLogSchema.index({ source: 1, createdAt: -1 });
ErrorLogSchema.index({ organizationId: 1, createdAt: -1 });

export default model('ErrorLog', ErrorLogSchema);
