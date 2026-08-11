import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientWorkflow from '../models/ClientWorkflow';
import ClientPerformanceEntry from '../models/ClientPerformanceEntry';
import User from '../models/User';
import { notifyDataChanged } from '../services/notify';

/**
 * Per-client performance calendar — Meta Ads spend / sales achieved /
 * sales target, logged at day, week, or month granularity (owner ask,
 * Aug 2026 — see ClientPerformanceEntry.ts docstring for the exact
 * period-key formats and why the three levels are independent, not
 * auto-summed).
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

const DAY_RE   = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE  = /^\d{4}-W\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ISO-8601 week → the Monday..Sunday UTC range it covers. */
function isoWeekRange(isoYear: number, week: number): { start: Date; end: Date } {
  const simple = new Date(Date.UTC(isoYear, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7; // Monday=1 .. Sunday=7
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - dow + 1);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

/** Validates periodKey against periodType and returns its [start, end] range. */
function computePeriodRange(periodType: string, periodKey: string): { start: Date; end: Date } | null {
  if (periodType === 'day') {
    if (!DAY_RE.test(periodKey)) return null;
    const start = new Date(`${periodKey}T00:00:00.000Z`);
    if (isNaN(start.getTime())) return null;
    const end = new Date(start); end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }
  if (periodType === 'week') {
    if (!WEEK_RE.test(periodKey)) return null;
    const [yStr, wStr] = periodKey.split('-W');
    const year = Number(yStr), week = Number(wStr);
    if (week < 1 || week > 53) return null;
    return isoWeekRange(year, week);
  }
  if (periodType === 'month') {
    if (!MONTH_RE.test(periodKey)) return null;
    const [yStr, mStr] = periodKey.split('-');
    const year = Number(yStr), month = Number(mStr); // 1-12
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const end   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // day 0 of next month = last day of this month
    return { start, end };
  }
  return null;
}

/**
 * GET /api/client-workflows/:id/performance?periodType=day&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns entries for one client at one granularity, optionally bounded
 * by a periodStart range so the calendar UI can fetch just one visible
 * month/quarter instead of the client's whole history.
 */
export async function getPerformance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).select('_id').lean();
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }

    const { periodType, from, to } = req.query as Record<string, string>;
    if (!['day', 'week', 'month'].includes(periodType || '')) {
      res.status(400).json({ error: 'periodType must be day, week, or month' });
      return;
    }

    const filter: any = { clientWorkflowId: wf._id, periodType };
    if (from || to) {
      filter.periodStart = {};
      if (from) { const f = new Date(from); if (!isNaN(f.getTime())) filter.periodStart.$gte = f; }
      if (to)   { const t = new Date(to);   if (!isNaN(t.getTime())) filter.periodStart.$lte = t; }
    }

    const rows = await ClientPerformanceEntry.find(filter).sort({ periodStart: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * PUT /api/client-workflows/:id/performance
 * Body: { periodType, periodKey, metaAdsSpend?, salesAchieved?, salesTarget?, notes? }
 * Upserts the single entry for this (client, periodType, periodKey) —
 * safe to call repeatedly as a rep edits the same day/week/month.
 */
export async function upsertPerformance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const wf = await ClientWorkflow.findOne({ _id: req.params.id, organizationId: orgId }).select('_id').lean();
    if (!wf) { res.status(404).json({ error: 'Client not found' }); return; }

    const { periodType, periodKey, metaAdsSpend, salesAchieved, salesTarget, notes } = req.body || {};
    if (!['day', 'week', 'month'].includes(periodType)) {
      res.status(400).json({ error: 'periodType must be day, week, or month' });
      return;
    }
    const range = computePeriodRange(periodType, periodKey);
    if (!range) {
      res.status(400).json({ error: `Invalid periodKey "${periodKey}" for periodType "${periodType}"` });
      return;
    }
    for (const [field, val] of [['metaAdsSpend', metaAdsSpend], ['salesAchieved', salesAchieved], ['salesTarget', salesTarget]] as const) {
      if (val !== undefined && (typeof val !== 'number' || val < 0 || isNaN(val))) {
        res.status(400).json({ error: `${field} must be a non-negative number` });
        return;
      }
    }

    const update: any = {
      organizationId: orgId,
      clientWorkflowId: wf._id,
      periodType, periodKey,
      periodStart: range.start,
      periodEnd: range.end,
      enteredBy: req.user!.id,
    };
    if (metaAdsSpend  !== undefined) update.metaAdsSpend  = metaAdsSpend;
    if (salesAchieved !== undefined) update.salesAchieved = salesAchieved;
    if (salesTarget   !== undefined) update.salesTarget   = salesTarget;
    if (notes         !== undefined) update.notes         = String(notes).slice(0, 500);

    const entry = await ClientPerformanceEntry.findOneAndUpdate(
      { clientWorkflowId: wf._id, periodType, periodKey },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    // Aug 2026 — "same data should sync across all roles": anyone else
    // looking at this client's performance calendar picks up the new
    // entry without waiting on a manual refresh.
    notifyDataChanged(req.app.get('io'), orgId, 'performance.updated', String(wf._id));
    res.json(entry);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
