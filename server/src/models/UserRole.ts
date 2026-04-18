import { Schema, model, Types } from 'mongoose';

const UserRoleSchema = new Schema({
  supabaseId: { type: String, required: true, unique: true },
  role: { type: String, required: true, enum: ['admin', 'employee', 'client', 'sales', 'inactive'] },
  organizationId: { type: Types.ObjectId, ref: 'Organization' },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

export default model('UserRole', UserRoleSchema);
