import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientTransaction from '../models/ClientTransaction';
import ClientAlert from '../models/ClientAlert';

/**
 * Transactions + Alerts — STRICT org isolation. Clients only see their own
 * transactions; admins see every transaction in their org. No global access.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listTransactions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
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
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    // Org-scope as belt-and-braces — clientId is unique but a future copy of
    // the model on another org should never be returned here.
    const txns = await ClientTransaction.find({
      clientId: req.user!.id,
      organizationId: orgId,
    }).sort({ date: -1 });
    res.json(txns);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['clientId', 'amount', 'currency', 'status', 'description', 'date', 'invoiceUrl', 'category'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const txn = await ClientTransaction.create({ ...body, organizationId: orgId });
    res.status(201).json(txn);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['amount', 'currency', 'status', 'description', 'date', 'invoiceUrl', 'category'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const txn = await ClientTransaction.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!txn) { res.status(404).json({ error: 'Transaction not found' }); return; }
    res.json(txn);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Alerts ────────────────────────────────────────────────────────────────

export async function myAlerts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const alerts = await ClientAlert.find({
      clientId: req.user!.id,
      organizationId: orgId,
    }).sort({ createdAt: -1 });
    res.json(alerts);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function readAlert(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Alerts can only be marked read by the client they belong to.
    const result = await ClientAlert.findOneAndUpdate(
      { _id: req.params.id, clientId: req.user!.id },
      { isRead: true },
    );
    if (!result) { res.status(404).json({ error: 'Alert not found' }); return; }
    res.json({ message: 'Alert marked as read' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createAlert(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['clientId', 'title', 'message', 'severity', 'link'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    if (!body.clientId || !body.title) {
      res.status(400).json({ error: 'clientId and title required' });
      return;
    }
    const alert = await ClientAlert.create({ ...body, organizationId: orgId });
    res.status(201).json(alert);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
