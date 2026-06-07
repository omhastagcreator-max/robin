import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import ProjectTask from '../models/ProjectTask';

/**
 * Global entity search — GET /api/search?q=<query>
 *
 * Quickly searches across brands, tasks, and employees by name/title
 * fragment. Designed for the topbar's Cmd-K search; the user types,
 * server returns top hits with a link each.
 *
 * Limits:
 *   - 5 results per kind, 15 total max.
 *   - Query trimmed to 64 chars.
 *   - Case-insensitive prefix-or-contains match via regex.
 *
 * The Copilot endpoint (/api/copilot/ask) answers fuller questions
 * via Gemini; THIS endpoint is the instant "jump to entity" tool —
 * no AI call, just MongoDB regex.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function search(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const q = String(req.query.q || '').trim().slice(0, 64);
    if (q.length < 2) { res.json({ brands: [], tasks: [], employees: [] }); return; }
    const rx = new RegExp(escapeRe(q), 'i');

    const [brands, tasks, employees] = await Promise.all([
      ClientWorkflow.find({
        organizationId: orgId,
        $or: [{ clientName: rx }, { clientEmail: rx }, { clientPhone: rx }],
      }).select('_id clientName healthLevel priority').limit(5).lean(),
      ProjectTask.find({
        organizationId: orgId,
        title: rx,
      }).select('_id title status priority clientWorkflowId').limit(5).lean(),
      User.find({
        organizationId: orgId,
        isActive: true,
        $or: [{ name: rx }, { email: rx }],
        role: { $in: ['admin', 'sales', 'employee', 'workroom'] },
      }).select('_id name email role avatarUrl').limit(5).lean(),
    ]);

    res.json({
      brands: brands.map(b => ({
        id: String(b._id),
        name: b.clientName || '',
        healthLevel: b.healthLevel || 'green',
        priority: b.priority || 'medium',
        link: `/clients/pipeline/${b._id}`,
      })),
      tasks: tasks.map(t => ({
        id: String(t._id),
        title: t.title,
        status: t.status,
        priority: t.priority || 'medium',
        link: t.clientWorkflowId ? `/clients/pipeline/${t.clientWorkflowId}` : '/tasks',
      })),
      employees: employees.map(u => ({
        id: String(u._id),
        name: u.name || u.email || '',
        role: u.role,
        avatarUrl: u.avatarUrl,
        link: '/team',
      })),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
