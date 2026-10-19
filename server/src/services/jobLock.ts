import JobLock from '../models/JobLock';

/** Claim a one-time job. true = this process won and should run it. */
export async function claimJob(key: string): Promise<boolean> {
  try { await JobLock.create({ _id: key }); return true; }
  catch (e: any) {
    if (e?.code === 11000 || /duplicate key/i.test(String(e?.message))) return false;
    throw e;
  }
}
