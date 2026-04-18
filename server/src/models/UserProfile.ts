import { Schema, model, Types } from 'mongoose';

const UserProfileSchema = new Schema({
  supabaseId: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  name: { type: String, default: '' },
  phone: { type: String, default: '' },
  team: { type: String, default: '' },
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
  avatarUrl: { type: String, default: '' },
}, { timestamps: true });

export default model('UserProfile', UserProfileSchema);
