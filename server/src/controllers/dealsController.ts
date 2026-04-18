import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Deal from '../models/Deal';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function listDeals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const deals = await Deal.find({ organizationId: orgId }).sort({ createdAt: -1 });
    res.json(deals);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createDeal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const deal = await Deal.create({ ...req.body, organizationId: orgId });
    res.status(201).json(deal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateDeal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const deal = await Deal.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!deal) { res.status(404).json({ error: 'Deal not found' }); return; }
    res.json(deal);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteDeal(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Deal.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deal deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
