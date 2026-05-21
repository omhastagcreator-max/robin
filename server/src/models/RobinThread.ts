import { Schema, model, Types } from 'mongoose';

/**
 * RobinThread — per-employee persistent AI conversation.
 *
 * One thread per (organizationId, ownerId). The Robin Copilot drawer
 * loads this thread when a user opens it so they pick up where they
 * left off, on any route. Memory + per-user context + role-tuned
 * persona is what makes Robin AI feel like "my" assistant rather
 * than a generic chatbot per page.
 *
 * Each turn stores:
 *   - role: 'user' | 'assistant'
 *   - text: the message
 *   - route: where in Robin the user was when they sent it (so the
 *     assistant can reference earlier route context if needed)
 *   - aiUsed: did Gemini actually answer (true) or did we fall back (false)
 *   - at: timestamp
 *
 * History is capped at the last 200 turns per user — older turns are
 * trimmed on each append (see appendTurn() in services/robinThread.ts).
 * The server only ever sends the last MAX_CONTEXT_TURNS (default 20)
 * into the model so token cost stays bounded.
 */

export const TURN_ROLES = ['user', 'assistant', 'system'] as const;
export type TurnRole = typeof TURN_ROLES[number];

const TurnSchema = new Schema({
  role:   { type: String, enum: TURN_ROLES, required: true },
  text:   { type: String, required: true, maxlength: 8000 },
  route:  { type: String, default: '' },
  aiUsed: { type: Boolean, default: false },
  at:     { type: Date,    default: Date.now },
}, { _id: true });

const RobinThreadSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  // Stored as STRING (not ObjectId) so it matches everywhere else userIds
  // are used as strings in this codebase (notifications recipientId,
  // FocusList ownerId, etc.).
  ownerId:        { type: String, required: true, index: true },
  // Snapshot for the UI — we surface a "Conversation started X days ago"
  // label without joining User on every fetch.
  ownerName:      { type: String, default: '' },
  ownerRole:      { type: String, default: '' },
  // The optional pinned "system note" the rep can write for themselves
  // — e.g. "Always remind me to follow up Velloer on Wed". Injected
  // into every prompt so Robin remembers across sessions.
  pinnedNote:     { type: String, default: '', maxlength: 1000 },
  turns:          { type: [TurnSchema], default: [] },
}, { timestamps: true });

// One thread per (org, owner). Enforced at the DB level so a race during
// "first open" can't create two parallel threads.
RobinThreadSchema.index({ organizationId: 1, ownerId: 1 }, { unique: true });

export default model('RobinThread', RobinThreadSchema);
