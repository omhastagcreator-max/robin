import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import FocusList from '../models/FocusList';
import { notify } from '../services/notify';

/**
 * FocusList — weekly "needs my attention" lists for sales reps.
 *
 * Each rep owns one FocusList per week. Items can reference a Lead or a
 * Client User; teammates are assigned via `assignedTo` and notified
 * immediately. Org-scoped throughout.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

/** Monday of the given date in server timezone, YYYY-MM-DD. */
function mondayKey(d: Date = new Date()): string {
  const x = new Date(d);
  const day = x.getDay();           // 0 = Sun … 6 = Sat
  const diff = (day + 6) % 7;        // back up to Monday
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().split('T')[0];
}

/**
 * GET /api/focus-list  ?weekStart=YYYY-MM-DD&ownerId=...&mine=1
 *
 * Returns one or more focus lists. By default, sales sees the org-wide
 * current-week lists (so the whole sales team can see priorities); pass
 * `mine=1` to scope to just the caller.
 */
export async function listFocusLists(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const weekStart = (req.query.weekStart as string) || mondayKey();
    const q: Record<string, unknown> = { organizationId: orgId, weekStart };
    if (req.query.mine === '1') q.ownerId = req.user!.id;
    else if (req.query.ownerId)  q.ownerId = req.query.ownerId;
    const lists = await FocusList.find(q).sort({ updatedAt: -1 });
    res.json(lists);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/focus-list
 *   { weekStart? }
 *
 * Idempotent — get-or-create the caller's focus list for the given week.
 * Returns the FocusList doc.
 */
export async function getOrCreateMyFocusList(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const weekStart = req.body?.weekStart || mondayKey();
    let list = await FocusList.findOne({
      organizationId: orgId,
      ownerId: req.user!.id,
      weekStart,
    });
    if (!list) {
      list = await FocusList.create({
        organizationId: orgId,
        ownerId: req.user!.id,
        weekStart,
        items: [],
      });
    }
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/focus-list/:id/items
 *   { leadId? | clientUserId?, label, subLabel?, urgency?, note?, assignedTo?[] }
 *
 * Add a new focus item. If `assignedTo` is non-empty, fires a notification
 * to each assignee.
 */
export async function addFocusItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { leadId, clientUserId, label, subLabel, urgency, note } = req.body || {};
    const assignedTo: string[] = Array.isArray(req.body?.assignedTo)
      ? req.body.assignedTo.filter((x: any) => typeof x === 'string')
      : [];
    if (!label || (!leadId && !clientUserId)) {
      res.status(400).json({ error: 'label and one of leadId/clientUserId required' });
      return;
    }
    const list = await FocusList.findOne({ _id: req.params.id, organizationId: orgId, ownerId: req.user!.id });
    if (!list) { res.status(404).json({ error: 'Focus list not found' }); return; }
    list.items.push({
      leadId:       leadId       || null,
      clientUserId: clientUserId || null,
      label,
      subLabel:     subLabel || '',
      urgency:      urgency  || 'high',
      note:         note     || '',
      assignedTo,
      assignedAt:   new Date(),
      doneAt:       null,
    } as any);
    await list.save();
    const newItem = list.items[list.items.length - 1] as any;

    // Fire-and-forget notifications to assignees, if any. Best-effort.
    if (assignedTo.length > 0) {
      try {
        const actorName = (await User.findById(req.user!.id).select('name email').lean())?.name || 'A teammate';
        const urgencyLabel = (urgency || 'high').toUpperCase();
        await notify({
          io: req.app.get('io'),
          organizationId: orgId,
          userIds: assignedTo,
          actorId: req.user!.id,
          type: 'focus_assignment',
          title: `${urgencyLabel} priority: ${label}`,
          body: `${actorName} assigned you to a Focus This Week item${note ? ': ' + note : '.'}`,
          entityId: String(newItem._id),
          entityType: 'focus_item',
        });
      } catch (e) { console.warn('[focus-list] assign notify failed', (e as Error).message); }
    }

    res.status(201).json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * PUT /api/focus-list/:id/items/:itemId
 *   { urgency?, note?, doneAt?, label?, subLabel? }
 *
 * Update an existing item. Assignment changes go through assignFocusItem
 * so notifications fire on additions only (not on edits).
 */
export async function updateFocusItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const list = await FocusList.findOne({ _id: req.params.id, organizationId: orgId, ownerId: req.user!.id });
    if (!list) { res.status(404).json({ error: 'Focus list not found' }); return; }
    const item: any = (list.items as any).id(req.params.itemId);
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
    const { urgency, note, doneAt, label, subLabel } = req.body || {};
    if (urgency  !== undefined) item.urgency  = urgency;
    if (note     !== undefined) item.note     = note;
    if (label    !== undefined) item.label    = label;
    if (subLabel !== undefined) item.subLabel = subLabel;
    if (doneAt   !== undefined) item.doneAt   = doneAt ? new Date(doneAt) : null;
    await list.save();
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * POST /api/focus-list/:id/items/:itemId/assign
 *   { assignedTo: string[] }   // FULL replacement list of assignees
 *
 * Replaces the assignee list. Notifications are sent to the *delta* —
 * i.e. only people who weren't already assigned. Removing someone does
 * NOT notify them.
 */
export async function assignFocusItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const list = await FocusList.findOne({ _id: req.params.id, organizationId: orgId, ownerId: req.user!.id });
    if (!list) { res.status(404).json({ error: 'Focus list not found' }); return; }
    const item: any = (list.items as any).id(req.params.itemId);
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
    const incoming: string[] = Array.isArray(req.body?.assignedTo)
      ? req.body.assignedTo.filter((x: any) => typeof x === 'string')
      : [];
    const prev = new Set<string>(item.assignedTo || []);
    const added = incoming.filter(id => !prev.has(id));
    item.assignedTo = incoming;
    item.assignedAt = new Date();
    await list.save();

    if (added.length > 0) {
      try {
        const actorName = (await User.findById(req.user!.id).select('name email').lean())?.name || 'A teammate';
        await notify({
          io: req.app.get('io'),
          organizationId: orgId,
          userIds: added,
          actorId: req.user!.id,
          type: 'focus_assignment',
          title: `${String(item.urgency || 'high').toUpperCase()} priority: ${item.label}`,
          body: `${actorName} assigned you to a Focus This Week item${item.note ? ': ' + item.note : '.'}`,
          entityId: String(item._id),
          entityType: 'focus_item',
        });
      } catch (e) { console.warn('[focus-list] assign notify failed', (e as Error).message); }
    }

    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * DELETE /api/focus-list/:id/items/:itemId
 *
 * Removes a focus item entirely (no soft-delete — the rep doesn't need
 * the history, "mark done" is what they want for clearing).
 */
export async function removeFocusItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const list = await FocusList.findOne({ _id: req.params.id, organizationId: orgId, ownerId: req.user!.id });
    if (!list) { res.status(404).json({ error: 'Focus list not found' }); return; }
    const item: any = (list.items as any).id(req.params.itemId);
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
    item.deleteOne();
    await list.save();
    res.json(list);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
