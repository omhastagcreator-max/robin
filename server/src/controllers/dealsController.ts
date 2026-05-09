import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Deal from '../models/Deal';

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listDeals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const deals = await Deal.find({ organizationId: orgId }).sort({ createdAt: -1 });
    res.json(deals);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createDeal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['leadId', 'dealValue', 'serviceType', 'currency', 'status', 'notes', 'closedAt'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const deal = await Deal.create({ ...body, organizationId: orgId });
    res.status(201).json(deal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateDeal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['dealValue', 'serviceType', 'currency', 'status', 'notes', 'closedAt'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const deal = await Deal.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!deal) { res.status(404).json({ error: 'Deal not found' }); return; }
    res.json(deal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteDeal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await Deal.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Deal not found' }); return; }
    res.json({ message: 'Deal deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
