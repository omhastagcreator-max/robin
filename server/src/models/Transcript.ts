import { Schema, model, Types } from 'mongoose';

/**
 * Transcript — a line of speech from one teammate during a huddle.
 *
 * Why one-line-per-document instead of one-document-per-meeting:
 *   1. Live ingestion: lines stream in continuously while the huddle is live.
 *      Appending to a single big doc means re-writing the whole doc every
 *      few seconds — bad. One row per line lets us insertMany() in batches.
 *   2. Deletion granularity: under DPDP/GDPR an employee may ask to delete
 *      only their lines. Per-line rows make that one query.
 *   3. Queries are easy: "Om's lines today" = find by userId + dateKey.
 *
 * `dateKey` is a YYYY-MM-DD IST string so end-of-day jobs can filter
 * efficiently and humans can read the value at a glance.
 *
 * `roomId` is the LiveKit room identifier so we can cluster transcripts by
 * meeting if you ever run multiple rooms (we currently use one global room).
 *
 * `confidence` (0..1) is what the browser STT reports — handy for trimming
 * low-quality lines before we feed them to Claude later.
 */
const TranscriptSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  userId:         { type: String, required: true, index: true },
  speakerName:    { type: String },              // cached so we don't have to join with users
  roomId:         { type: String, required: true },
  dateKey:        { type: String, required: true, index: true }, // "2026-05-04"
  text:           { type: String, required: true },
  confidence:     { type: Number },              // 0..1 from Web Speech API
  startedAt:      { type: Date,   required: true },
  endedAt:        { type: Date },
  source:         { type: String, default: 'web-speech' },
  language:       { type: String, default: 'en-IN' },
}, { timestamps: { createdAt: true, updatedAt: false } });

// Common queries we'll run:
//   - "all transcripts for this org on this date" (end-of-day cron)
//   - "all transcripts for this user on this date" (per-user brief)
TranscriptSchema.index({ organizationId: 1, dateKey: 1, startedAt: 1 });
TranscriptSchema.index({ userId: 1, dateKey: 1, startedAt: 1 });

export default model('Transcript', TranscriptSchema);
