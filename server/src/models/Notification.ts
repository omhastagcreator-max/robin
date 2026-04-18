import { Schema, model, Types } from 'mongoose';

const NotificationSchema = new Schema({
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  recipientId: { type: String, required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  meta: {
    entityId: Types.ObjectId,
    entityType: String,
  },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

export default model('Notification', NotificationSchema);
