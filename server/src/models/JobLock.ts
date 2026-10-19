import { Schema, model } from 'mongoose';

/**
 * JobLock — Oct 19 2026. One row per one-time boot job (per org + version).
 * `_id` is the key, so two server instances booting at once (Render's
 * zero-downtime deploys overlap old + new) can't both run the same job:
 * the second insert fails on the duplicate _id. Before this, the 18 Oct
 * client set-up ran twice and created Koshnika / Dhobi Express / Tridosh
 * Herbal twice.
 */
const JobLockSchema = new Schema({
  _id:       { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

export default model('JobLock', JobLockSchema);
