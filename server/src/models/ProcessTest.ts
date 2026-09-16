import { Schema, model, Types } from 'mongoose';

/**
 * ProcessTest + ProcessTestAttempt — the "Process Test" module (Sep 2026).
 *
 * A short multiple-choice test, optionally attached to a ProcessDoc, that
 * proves someone actually absorbed an SOP before running it on a live
 * client account.
 *
 * Correct answers live on the question subdoc, so EVERY read path that a
 * non-admin can reach must strip `correctIndex` before responding — see
 * processController.getTest. Getting that wrong turns the test into a
 * multiple-choice answer key, so it's enforced in one helper rather than
 * per-route.
 *
 * Attempts are append-only: a retake creates a new attempt rather than
 * overwriting the last one, so "passed on the third go" stays visible.
 */

const QuestionSchema = new Schema({
  question:     { type: String, required: true },
  options:      { type: [String], default: [] },    // 2–6 choices
  correctIndex: { type: Number, default: 0 },       // index into options — NEVER sent to takers
}, { _id: false });

const ProcessTestSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },

  title:       { type: String, required: true },
  description: { type: String, default: '' },
  // The SOP this test is about. Null = a standalone test.
  processDocId: { type: Types.ObjectId, ref: 'ProcessDoc', default: null, index: true },
  department: {
    type: String,
    enum: ['sales', 'development', 'meta', 'influencer', 'qa', 'general'],
    default: 'general',
  },

  questions: { type: [QuestionSchema], default: [] },
  // Percentage needed to pass. 70 = must get 70% of questions right.
  passMark:  { type: Number, default: 70, min: 1, max: 100 },

  archived:  { type: Boolean, default: false, index: true },
  createdBy: { type: String, default: '' },
}, { timestamps: true });

ProcessTestSchema.index({ organizationId: 1, archived: 1, createdAt: -1 });

export const ProcessTest = model('ProcessTest', ProcessTestSchema);

const ProcessTestAttemptSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  testId:   { type: Types.ObjectId, ref: 'ProcessTest', required: true, index: true },
  userId:   { type: String, required: true, index: true },
  userName: { type: String, default: '' },

  // answers[i] = the option index the taker picked for question i, or -1
  // if they left it blank.
  answers:      { type: [Number], default: [] },
  score:        { type: Number, default: 0 },   // percentage, 0–100
  correctCount: { type: Number, default: 0 },
  totalCount:   { type: Number, default: 0 },
  passed:       { type: Boolean, default: false, index: true },
}, { timestamps: true });

ProcessTestAttemptSchema.index({ organizationId: 1, testId: 1, userId: 1, createdAt: -1 });

export const ProcessTestAttempt = model('ProcessTestAttempt', ProcessTestAttemptSchema);
