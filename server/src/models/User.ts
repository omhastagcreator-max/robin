import mongoose, { Document, Schema } from 'mongoose';

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
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
