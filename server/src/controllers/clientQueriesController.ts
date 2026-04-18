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
    const admins = await User.find({ organizationId: orgId, role: 'admin' }).select('_id');
    await Notification.insertMany(admins.map(a => ({
      recipientId: String(a._id),
      title: `New client query: ${query.title}`,
      body: query.description,
      type: 'info',
    })));
    res.status(201).json(query);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// List queries
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
    await Notification.create({ recipientId: String(query.clientId), title: 'Reply to your query', body: content, type: 'info' });
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
    const { clientId, clientName, amount, dueDate, note, description } = req.body;
    const bodyText = note || description || 'Invoice payment is due';
    const dueStr = dueDate
      ? new Date(dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';

    // Resolve targetUserId — try clientId first, then look up by name
    let targetUserId = clientId;
    if (!targetUserId && clientName) {
      const found = await User.findOne({ name: new RegExp(clientName, 'i') });
      if (found) targetUserId = String(found._id);
    }

    if (!targetUserId) {
      res.status(400).json({ error: 'Could not resolve a client to notify' });
      return;
    }

    const notif = await Notification.create({
      recipientId: targetUserId,
      title:       `💰 Payment Due: ₹${Number(amount || 0).toLocaleString('en-IN')}`,
      body:        `${bodyText}${dueStr ? ` — Due by ${dueStr}` : ''}`,
      type:        'warning',
    });

    // Real-time push via Socket.io
    const io = (req as any).app.get('io');
    if (io) {
      io.to(`user:${targetUserId}`).emit('notification:new', {
        _id:   notif._id,
        title: notif.title,
        body:  notif.body,
        type:  'warning',
      });
    }

    res.json({ message: 'Payment alert sent' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
