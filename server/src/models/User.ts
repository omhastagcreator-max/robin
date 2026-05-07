import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type AppRole = 'admin' | 'employee' | 'client' | 'sales';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: AppRole;
  roles: AppRole[];           // secondary/multiple roles
  team?: string;              // primary team
  teams: string[];            // multiple teams
  phone?: string;
  avatarUrl?: string;
  googleId?: string;
  organizationId?: mongoose.Types.ObjectId;
  department?: string;
  isActive: boolean;
  onCallSince?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash:   { type: String, required: true, select: false },
    name:           { type: String, default: '' },
    role:           { type: String, enum: ['admin', 'employee', 'client', 'sales'], default: 'employee' },
    roles:          { type: [String], default: [] },               // extra roles
    team:           { type: String, default: '' },
    teams:          { type: [String], default: [] },               // multiple teams
    phone:          { type: String, default: '' },
    avatarUrl:      { type: String, default: '' },
    googleId:       { type: String, default: '' },
    department:     { type: String, default: '' },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    isActive:       { type: Boolean, default: true },
    // On Call do-not-disturb — independent of clock-in state so admins
    // (who don't have Sessions) can flip it too.
    onCallSince:    { type: Date, default: null },
    // For client users — the Meta ad account they own. Used to map
    // /ads/meta share links to the right client.
    metaAdAccountId: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

// Auto-hash passwordHash if it was set/modified to a plain (non-bcrypt) value.
// Bcrypt hashes always start with "$2a$", "$2b$", or "$2y$" and are 60 chars.
UserSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  const v = this.passwordHash;
  if (!v) return next();
  // Skip if already a bcrypt hash
  if (/^\$2[aby]\$\d{2}\$/.test(v) && v.length >= 60) return next();
  this.passwordHash = await bcrypt.hash(v, 12);
  next();
});

export default mongoose.model<IUser>('User', UserSchema);
