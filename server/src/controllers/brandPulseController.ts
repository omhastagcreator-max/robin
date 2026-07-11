import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import BrandPulse from '../models/BrandPulse';
import User from '../models/User';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

/**
 * GET /api/brand-pulse/pending
 * The oldest unanswered pulse for the caller, or null. The client polls
 * this and throws up the blocking modal whenever one exists.
 */
export async function getMyPendingPulse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const pulse = await BrandPulse.findOne({ userId: req.user!.id, status: 'pending' })
      .sort({ askedAt: 1 }).lean();
    res.json(pulse || null);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/brand-pulse/:id/answer   { answer }
 * Minimum 10 characters — one-word filler defeats the purpose.
 */
export async function answerPulse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const answer = String(req.body?.answer || '').trim();
    if (answer.length < 10) {
      res.status(400).json({ error: 'Give a real answer (at least 10 characters).' });
      return;
    }
    const pulse = await BrandPulse.findOne({ _id: req.params.id, userId: req.user!.id, status: 'pending' });
    if (!pulse) { res.status(404).json({ error: 'No such pending question' }); return; }
    pulse.status = 'answered';
    pulse.answer = answer.slice(0, 2000);
    pulse.answeredAt = new Date();
    await pulse.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/brand-pulse/:id/redirect   { toUserId }
 *
 * "I don't manage this brand — X does." Marks this pulse redirected and
 * creates a fresh pending pulse for X with the same question, so the
 * accountability follows the ownership. Hops capped at 2: after two
 * redirects the holder must answer what they know — a question that
 * ping-pongs forever means nobody owns the brand, which is exactly the
 * signal the report should surface, not hide.
 */
export async function redirectPulse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const toUserId = String(req.body?.toUserId || '');
    if (!toUserId) { res.status(400).json({ error: 'Pick the teammate who manages this brand.' }); return; }
    if (toUserId === req.user!.id) { res.status(400).json({ error: "That's you — answer the question instead." }); return; }

    const pulse = await BrandPulse.findOne({ _id: req.params.id, userId: req.user!.id, status: 'pending' });
    if (!pulse) { res.status(404).json({ error: 'No such pending question' }); return; }
    if ((pulse.hop || 0) >= 2) {
      res.status(400).json({ error: 'This question was already passed on twice — answer what you know, even partially.' });
      return;
    }

    const orgId = await getOrgId(req.user!.id);
    const target = await User.findOne({
      _id: toUserId, organizationId: orgId, isActive: true,
      role: { $in: ['employee', 'sales', 'workroom', 'admin'] },
    }).select('_id name');
    if (!target) { res.status(404).json({ error: 'Teammate not found' }); return; }

    pulse.status = 'redirected';
    pulse.redirectedTo = toUserId;
    pulse.answeredAt = new Date();
    await pulse.save();

    await BrandPulse.create({
      organizationId: pulse.organizationId,
      userId: toUserId,
      clientWorkflowId: pulse.clientWorkflowId,
      clientName: pulse.clientName,
      questionKind: pulse.questionKind,
      question: pulse.question,
      status: 'pending',
      redirectedFrom: req.user!.id,
      hop: (pulse.hop || 0) + 1,
    });
    res.json({ ok: true, redirectedTo: target.name });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * GET /api/brand-pulse/admin/report?days=14
 *
 * The report the whole system exists for. Two aggregations over the
 * requested window (default 14 days):
 *
 *   byEmployee — asked / answered / redirected counts, avg response
 *     minutes, and each person's answers (accountability view)
 *   byBrand    — latest answers per brand (brand-intelligence view)
 *
 * Gate: admin / sales / canManageWorkroom (routes/brandPulse.ts).
 */
export async function getPulseReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || 14), 10) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pulses = await BrandPulse.find({ organizationId: orgId, askedAt: { $gte: since } })
      .sort({ askedAt: -1 }).lean();

    const userIds = [...new Set(pulses.flatMap(p => [p.userId, p.redirectedFrom, p.redirectedTo].filter(Boolean)))];
    const users = await User.find({ _id: { $in: userIds } }).select('name email').lean();
    const nameOf = new Map(users.map(u => [String(u._id), u.name || u.email]));

    const items = pulses.map(p => ({
      id: String(p._id),
      clientName: p.clientName,
      questionKind: p.questionKind,
      question: p.question,
      status: p.status,
      answer: p.answer || '',
      askedTo: nameOf.get(String(p.userId)) || 'Unknown',
      askedToId: String(p.userId),
      redirectedFrom: p.redirectedFrom ? (nameOf.get(String(p.redirectedFrom)) || 'Unknown') : null,
      redirectedTo: p.redirectedTo ? (nameOf.get(String(p.redirectedTo)) || 'Unknown') : null,
      askedAt: p.askedAt,
      answeredAt: p.answeredAt,
      responseMins: p.answeredAt && p.askedAt
        ? Math.round((new Date(p.answeredAt).getTime() - new Date(p.askedAt).getTime()) / 60_000)
        : null,
    }));

    // Per-employee accountability rollup.
    const byEmployee = new Map<string, {
      userId: string; name: string;
      asked: number; answered: number; redirected: number; pending: number;
      avgResponseMins: number | null; _respSum: number; _respN: number;
    }>();
    for (const it of items) {
      const e = byEmployee.get(it.askedToId) || {
        userId: it.askedToId, name: it.askedTo,
        asked: 0, answered: 0, redirected: 0, pending: 0,
        avgResponseMins: null, _respSum: 0, _respN: 0,
      };
      e.asked++;
      if (it.status === 'answered') {
        e.answered++;
        if (it.responseMins !== null) { e._respSum += it.responseMins; e._respN++; }
      }
      if (it.status === 'redirected') e.redirected++;
      if (it.status === 'pending') e.pending++;
      byEmployee.set(it.askedToId, e);
    }
    const employees = [...byEmployee.values()].map(e => ({
      userId: e.userId, name: e.name,
      asked: e.asked, answered: e.answered, redirected: e.redirected, pending: e.pending,
      answerRate: e.asked > 0 ? Math.round((e.answered / e.asked) * 100) : 0,
      avgResponseMins: e._respN > 0 ? Math.round(e._respSum / e._respN) : null,
    })).sort((a, b) => b.answerRate - a.answerRate);

    // Per-brand latest intel (most recent answered pulse per brand).
    const byBrand = new Map<string, { clientName: string; latest: typeof items[number] | null; asked: number; answered: number }>();
    for (const it of items) {
      const b = byBrand.get(it.clientName) || { clientName: it.clientName, latest: null, asked: 0, answered: 0 };
      b.asked++;
      if (it.status === 'answered') {
        b.answered++;
        if (!b.latest) b.latest = it;   // items are newest-first
      }
      byBrand.set(it.clientName, b);
    }

    res.json({
      days,
      employees,
      brands: [...byBrand.values()].sort((a, b) => a.clientName.localeCompare(b.clientName)),
      recent: items.slice(0, 100),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
