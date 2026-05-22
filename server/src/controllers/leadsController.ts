import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import Lead from '../models/Lead';
import LeadNote from '../models/LeadNote';
import Deal from '../models/Deal';

/**
 * Leads — STRICT org isolation. Reads, updates, deletes always scoped by org.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

export async function listLeads(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
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
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['name', 'contact', 'email', 'company', 'source', 'estimatedValue', 'status', 'notes'];
    const body: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) body[k] = req.body[k];
    const lead = await Lead.create({ ...body, organizationId: orgId, assignedTo: req.user!.id });

    // Fire-and-forget AI scoring so the kanban shows hot/warm/cold + a
    // next-action suggestion within seconds of lead creation. We deliberately
    // don't `await` this — the create response goes back fast, and the score
    // populates shortly after via a background save.
    (async () => {
      try {
        const { scoreLead } = await import('../services/aiTriage');
        const noteText = Array.isArray((lead as any).notes) && (lead as any).notes.length
          ? (lead as any).notes.map((n: any) => n?.content || '').join('\n')
          : '';
        const ai = await scoreLead({
          name:           (lead as any).name,
          email:          (lead as any).email,
          phone:          (lead as any).contact,
          source:         (lead as any).source,
          stage:          (lead as any).stage,
          estimatedValue: (lead as any).estimatedValue,
          notes:          noteText,
          createdAt:      (lead as any).createdAt,
        });
        if (ai.aiUsed) {
          await Lead.findByIdAndUpdate(lead._id, {
            aiScore:      ai.score,
            aiReason:     ai.reason,
            aiNextAction: ai.nextAction,
            aiScoredAt:   new Date(),
          });
        }
      } catch (err) {
        // Non-fatal — lead is already saved. Just log.
        console.error('[ai-score-on-create] failed:', (err as Error).message);
      }
    })();

    res.status(201).json(lead);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const lead = await Lead.findOne({ _id: req.params.id, organizationId: orgId });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const notes = await LeadNote.find({ leadId: lead._id, organizationId: orgId }).sort({ createdAt: -1 });
    res.json({ ...lead.toObject(), notes });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['name', 'contact', 'email', 'company', 'source', 'estimatedValue', 'status', 'notes', 'assignedTo', 'currentStage'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      patch,
      { new: true },
    );
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json(lead);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const result = await Lead.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!result) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json({ message: 'Lead deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function addLeadNote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    // Verify the parent lead belongs to MY org before attaching a note.
    const parent = await Lead.findOne({ _id: req.params.id, organizationId: orgId }).select('_id').lean();
    if (!parent) { res.status(404).json({ error: 'Lead not found' }); return; }
    const { content } = req.body || {};
    if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }
    const note = await LeadNote.create({
      content: content.trim(),
      leadId: req.params.id,
      organizationId: orgId,
      authorId: req.user!.id,
    });
    res.status(201).json(note);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function convertLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { dealValue, serviceType, currency = 'INR' } = req.body || {};
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { status: 'converted' },
      { new: true },
    );
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const deal = await Deal.create({
      organizationId: orgId,
      leadId: lead._id,
      dealValue,
      serviceType,
      currency,
      status: 'open',
    });
    res.json({ lead, deal });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// ── Lead payment ──────────────────────────────────────────────────────
/**
 * POST /api/leads/:id/payment
 *
 * Body: { status: 'part_paid'|'full_paid'|'refunded', amount?: number, note?: string, total?: number }
 *
 * Records ONE payment event on a lead. Appends to paymentEvents[],
 * refreshes the denormalised paymentPaid / paymentStatus / paymentNote
 * so list views render the latest at-a-glance state without joining the
 * subarray. The `note` is the "what triggers the next payment" sentence
 * the sales rep writes ("client will pay balance 50% after store goes
 * live") — surfaces above the event history.
 */
export async function markLeadPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const lead = await Lead.findOne({ _id: req.params.id, organizationId: orgId });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    const status = String(req.body?.status || '');
    if (!['part_paid', 'full_paid', 'refunded'].includes(status)) {
      res.status(400).json({ error: 'status must be one of part_paid / full_paid / refunded' });
      return;
    }
    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: 'amount must be a non-negative number' });
      return;
    }
    const note  = String(req.body?.note  || '').slice(0, 500);
    const total = req.body?.total !== undefined ? Number(req.body.total) : null;

    (lead as any).paymentEvents.push({
      status, amount, note,
      by: req.user!.id,
      at: new Date(),
    });

    // Denormalised aggregates so list views can render at-a-glance state
    // without joining the subarray.
    if (status === 'refunded') {
      (lead as any).paymentPaid = Math.max(0, ((lead as any).paymentPaid || 0) - amount);
    } else {
      (lead as any).paymentPaid = ((lead as any).paymentPaid || 0) + amount;
    }
    if (total !== null && total > 0) (lead as any).paymentTotal = total;
    (lead as any).paymentStatus = status === 'refunded'
      ? 'refunded'
      : ((lead as any).paymentTotal > 0 && (lead as any).paymentPaid >= (lead as any).paymentTotal)
        ? 'full_paid'
        : status;
    if (note) (lead as any).paymentNote = note;

    await lead.save();
    res.json(lead);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
