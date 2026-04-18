import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientTransaction from '../models/ClientTransaction';
import ClientAlert from '../models/ClientAlert';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function listTransactions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { clientId, status } = req.query;
    const query: any = { organizationId: orgId };
    if (clientId) query.clientId = clientId;
    if (status)   query.status = status;
    const txns = await ClientTransaction.find(query).sort({ date: -1 });
    res.json(txns);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function myTransactions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const txns = await ClientTransaction.find({ clientId: req.user!.id }).sort({ date: -1 });
    res.json(txns);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const txn = await ClientTransaction.create({ ...req.body, organizationId: orgId });
    res.status(201).json(txn);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const txn = await ClientTransaction.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!txn) { res.status(404).json({ error: 'Transaction not found' }); return; }
    res.json(txn);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// Alerts
export async function myAlerts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const alerts = await ClientAlert.find({ clientId: req.user!.id }).sort({ createdAt: -1 });
    res.json(alerts);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function readAlert(req: AuthRequest, res: Response): Promise<void> {
  try {
    await ClientAlert.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ message: 'Alert marked as read' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createAlert(req: AuthRequest, res: Response): Promise<void> {
  try {
    const alert = await ClientAlert.create(req.body);
    res.status(201).json(alert);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
