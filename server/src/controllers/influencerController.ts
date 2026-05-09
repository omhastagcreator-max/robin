import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Influencer from '../models/Influencer';
import User from '../models/User';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

// List — filter by category, platform, status
export async function listInfluencers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { category, platform, status, search } = req.query as any;
    const filter: any = { organizationId: orgId };
    if (category && category !== 'all') filter.category = category;
    if (platform && platform !== 'all') filter.platform = platform;
    if (status   && status   !== 'all') filter.status   = status;
    if (search) filter.$or = [
      { name:   new RegExp(search, 'i') },
      { handle: new RegExp(search, 'i') },
      { city:   new RegExp(search, 'i') },
    ];
    const data = await Influencer.find(filter).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Create
export async function createInfluencer(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const doc = await Influencer.create({ ...req.body, organizationId: orgId, addedBy: req.user!.id });
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Update — org-scoped, whitelisted fields only.
export async function updateInfluencer(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['name', 'handle', 'category', 'platform', 'status', 'city', 'phone', 'email',
                     'followers', 'engagementRate', 'ratePerPost', 'notes', 'avatarUrl', 'tags'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const doc = await Influencer.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Delete — org-scoped.
export async function deleteInfluencer(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await Influencer.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Stats by category
export async function influencerStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const agg = await Influencer.aggregate([
      { $match: { organizationId: orgId } },
      { $group: {
        _id:           '$category',
        count:         { $sum: 1 },
        totalFollowers:{ $sum: '$followers' },
        avgEngagement: { $avg: '$engagementRate' },
        avgRate:       { $avg: '$ratePerPost' },
      }},
      { $sort: { count: -1 } },
    ]);
    res.json(agg);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
