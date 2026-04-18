import { Schema, model } from 'mongoose';

const ChatMessageSchema = new Schema({
  roomId:   { type: String, default: 'agency-global' },
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, required: true },
  content:  { type: String, required: true, maxlength: 2000 },
  type:     { type: String, enum: ['text', 'link', 'system'], default: 'text' },
  mentions: [{ type: String }], // user IDs mentioned
}, { timestamps: true });

ChatMessageSchema.index({ roomId: 1, createdAt: -1 });

export default model('ChatMessage', ChatMessageSchema);
