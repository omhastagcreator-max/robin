import ActivityLog from '../models/ActivityLog';

/**
 * auditDelete — Oct 2026 (owner: "logs to be maintained"). Every time a
 * business record is deleted, keep a permanent row saying WHO deleted WHAT and
 * WHEN, with a small snapshot of the record, so nothing silently disappears
 * from history. Shows in Activity logs (/admin/logs). Fire-and-forget — an
 * audit hiccup must never block the delete itself.
 */
const SNAPSHOT_KEYS = ['name', 'title', 'clientName', 'company', 'phone', 'email', 'status', 'stage', 'amount', 'value', 'dealValue',
  'label', 'platform', 'username', 'url', 'dueDate', 'date', 'startTime', 'assignedTo', 'priority', 'reason', 'notes', 'description'];

export function auditDelete(req: any, entity: string, doc: any, extra: Record<string, unknown> = {}): void {
  try {
    if (!doc) return;
    const d = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const snapshot: Record<string, unknown> = {};
    for (const k of SNAPSHOT_KEYS) if (d[k] !== undefined && d[k] !== null && d[k] !== '') snapshot[k] = typeof d[k] === 'string' ? String(d[k]).slice(0, 300) : d[k];
    // Never copy secrets out of the vault into the log.
    delete (snapshot as any).password;
    const label = String(d.clientName || d.name || d.title || d.label || d.company || entity).slice(0, 120);
    ActivityLog.create({
      organizationId: d.organizationId || req.user?.organizationId,
      userId: req.user?.id,
      action: `deleted.${entity}`,
      entity,
      entityId: d._id,
      metadata: { label, snapshot, ...extra },
    }).catch((e: Error) => console.warn('[audit] delete log failed', e.message));
  } catch { /* never block the delete */ }
}
