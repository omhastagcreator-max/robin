import { Schema, model, Types } from 'mongoose';

/**
 * ChatMessage — group chat for "agency-global" room (and future scoped rooms).
 *
 * IMPORTANT: every message is org-scoped. Reads MUST filter by
 * organizationId or different agencies will see each other's chat.
 */
const ChatMessageSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization', required: true, index: true },
  roomId:   { type: String, default: 'agency-global' },
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, required: true },
  content:  { type: String, required: true, maxlength: 2000 },
  type:     { type: String, enum: ['text', 'link', 'system'], default: 'text' },
  mentions: [{ type: String }], // user IDs mentioned
}, { timestamps: true });

// Compound index — the hot query is "messages in this org's room, latest first".
ChatMessageSchema.index({ organizationId: 1, roomId: 1, createdAt: -1 });

export default model('ChatMessage', ChatMessageSchema);
