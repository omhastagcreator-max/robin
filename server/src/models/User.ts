import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type AppRole = 'admin' | 'employee' | 'client' | 'sales';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: AppRole;
  team?: string;
  phone?: string;
  avatarUrl?: string;
  organizationId?: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(plain: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash:   { type: String, required: true },
    name:           { type: String, default: '' },
    role:           { type: String, enum: ['admin', 'employee', 'client', 'sales'], default: 'employee' },
    team:           { type: String, default: '' },
    phone:          { type: String, default: '' },
    avatarUrl:      { type: String, default: '' },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

UserSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

export default mongoose.model<IUser>('User', UserSchema);
