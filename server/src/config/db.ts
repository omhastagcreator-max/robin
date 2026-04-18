import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[MongoDB] Connected to hastag_team database');
  } catch (err) {
    console.error('[MongoDB] Connection error:', err);
    process.exit(1);
  }
}
