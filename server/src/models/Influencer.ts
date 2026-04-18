import mongoose, { Document, Schema } from 'mongoose';

export type Platform = 'instagram' | 'youtube' | 'twitter' | 'linkedin' | 'threads' | 'other';
export type InfluencerStatus = 'prospect' | 'approached' | 'active' | 'paused' | 'blacklisted';
export type InfluencerCategory =
  | 'fashion' | 'beauty' | 'food' | 'lifestyle' | 'fitness' | 'travel'
  | 'tech' | 'education' | 'entertainment' | 'parenting' | 'business' | 'photography' | 'other';

export interface IInfluencer extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  handle: string;                 // @handle
  platform: Platform;
  category: InfluencerCategory;
  followers: number;              // raw number
  engagementRate: number;         // percentage e.g. 3.5
  ratePerPost?: number;           // in INR
  email?: string;
  phone?: string;
  city?: string;
  status: InfluencerStatus;
  notes?: string;
  profileUrl?: string;
  lastWorkedOn?: Date;
  tags: string[];
  addedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InfluencerSchema = new Schema<IInfluencer>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name:           { type: String, required: true, trim: true },
    handle:         { type: String, default: '' },
    platform:       { type: String, enum: ['instagram','youtube','twitter','linkedin','threads','other'], default: 'instagram' },
    category:       { type: String, enum: ['fashion','beauty','food','lifestyle','fitness','travel','tech','education','entertainment','parenting','business','photography','other'], required: true },
    followers:      { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
    ratePerPost:    { type: Number, default: 0 },
    email:          { type: String, default: '' },
    phone:          { type: String, default: '' },
    city:           { type: String, default: '' },
    status:         { type: String, enum: ['prospect','approached','active','paused','blacklisted'], default: 'prospect' },
    notes:          { type: String, default: '' },
    profileUrl:     { type: String, default: '' },
    lastWorkedOn:   { type: Date },
    tags:           { type: [String], default: [] },
    addedBy:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IInfluencer>('Influencer', InfluencerSchema);
