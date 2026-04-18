import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Lead from '../models/Lead';
import LeadNote from '../models/LeadNote';
import Deal from '../models/Deal';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

export async function listLeads(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { status, source } = req.query;
    const query: any = { organizationId: orgId };
    if (status) query.status = status;
    if (source) query.source = source;
    const leads = await Lead.find(query).sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const lead = await Lead.create({ ...req.body, organizationId: orgId, assignedTo: req.user!.id });
    res.status(201).json(lead);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const notes = await LeadNote.find({ leadId: lead._id }).sort({ createdAt: -1 });
    res.json({ ...lead.toObject(), notes });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json(lead);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ message: 'Lead deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function addLeadNote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const note = await LeadNote.create({ ...req.body, leadId: req.params.id, organizationId: orgId, authorId: req.user!.id });
    res.status(201).json(note);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function convertLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { dealValue, serviceType, currency = 'INR' } = req.body;
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status: 'converted' }, { new: true });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const deal = await Deal.create({ organizationId: orgId, leadId: lead._id, dealValue, serviceType, currency, status: 'open' });
    res.json({ lead, deal });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
