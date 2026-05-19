import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type AppRole = 'admin' | 'employee' | 'client' | 'sales' | 'workroom';

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
  metaAdAccountId?: string | null;   // for client users — links them to one Meta ad account
  /**
   * Permission flag — when true, this user can create new 'workroom'-role
   * teammates without being an admin. Used to delegate basic onboarding of
   * huddle-only staff (floor support, junior agents) to a senior employee
   * (e.g. Om the developer) without giving them full admin access.
   *
   * Default false. Admin-only to flip.
   */
  canManageWorkroom?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash:   { type: String, required: true, select: false },
    name:           { type: String, default: '' },
    // 'workroom' = bare-minimum employee — only sees the huddle/Workroom
    // (used for floor/support staff who join calls but don't manage tasks).
    role:           { type: String, enum: ['admin', 'employee', 'client', 'sales', 'workroom'], default: 'employee' },
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
    // Delegated permission: can this employee onboard 'workroom'-role
    // teammates? Admins always can; this flag lets us grant the ability
    // to a trusted non-admin (e.g. Om) without giving them full admin.
    canManageWorkroom: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Auto-hash passwordHash if it was set/modified to a plain (non-bcrypt) value.
// Bcrypt hashes always start with "$2a$", "$2b$", or "$2y$" and are 60 chars.
// `this: IUser` annotation needed because Mongoose's pre-save inference
// otherwise treats fields with `select: false` as possibly absent.
UserSchema.pre('save', async function (this: IUser, next) {
  if (!this.isModified('passwordHash')) return next();
  const v = this.passwordHash;
  if (!v) return next();
  // Skip if already a bcrypt hash
  if (/^\$2[aby]\$\d{2}\$/.test(v) && v.length >= 60) return next();
  this.passwordHash = await bcrypt.hash(v, 12);
  next();
});

export default mongoose.model<IUser>('User', UserSchema);
