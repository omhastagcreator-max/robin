import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientQuery from '../models/ClientQuery';
import User from '../models/User';
import Notification from '../models/Notification';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

// Client creates a query
export async function createQuery(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const query = await ClientQuery.create({ ...req.body, clientId: req.user!.id, organizationId: orgId });
    // Notify admins
    const admins = await User.find({ organizationId: orgId, role: 'admin' }).select('_id');
    await Notification.insertMany(admins.map(a => ({
      userId: String(a._id),
      title: `New client query: ${query.title}`,
      message: query.description,
      type: 'info',
    })));
    res.status(201).json(query);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// List queries — client sees own, admin/team sees all
export async function listQueries(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const filter: any = { organizationId: orgId };
    if (req.user!.role === 'client') filter.clientId = req.user!.id;
    const queries = await ClientQuery.find(filter).sort({ createdAt: -1 });
    res.json(queries);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Reply to query
export async function replyQuery(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { content } = req.body;
    const query = await ClientQuery.findByIdAndUpdate(
      req.params.id,
      { $push: { replies: { authorId: req.user!.id, authorName: req.user!.name, content } }, status: 'in_progress' },
      { new: true }
    );
    if (!query) { res.status(404).json({ error: 'Query not found' }); return; }
    // Notify client
    await Notification.create({ userId: query.clientId, title: 'Reply to your query', message: content, type: 'info' });
    res.json(query);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Update status
export async function updateQueryStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const query = await ClientQuery.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(query);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Sales: send payment due notification to client
export async function sendPaymentAlert(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId, amount, dueDate, description } = req.body;
    await Notification.create({
      userId: clientId,
      title: `Payment Due: ₹${Number(amount).toLocaleString('en-IN')}`,
      message: `${description || 'Invoice payment is due'}${dueDate ? ` — Due by ${new Date(dueDate).toLocaleDateString('en-IN')}` : ''}`,
      type: 'warning',
    });
    res.json({ message: 'Payment alert sent to client' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
