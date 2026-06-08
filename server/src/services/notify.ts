import Notification from '../models/Notification';
import User from '../models/User';

/**
 * notify — single entry point for sending in-app notifications.
 *
 * Why this exists: previously every controller called Notification.create()
 * directly + maybe emitted a socket event, often forgetting the socket
 * part. This helper does both:
 *
 *   1. Persists a Notification doc (so the bell + /notifications page see it
 *      even after a refresh).
 *   2. Emits 'notification:new' on the recipient's user-room socket so the
 *      AppLayout's live badge + toast fires immediately.
 *
 * Best-effort throughout — failure to persist or emit never throws (don't
 * want a notification bug taking down a real mutation).
 *
 * Recipient targeting:
 *   - userId (string): a single person
 *   - userIds (string[]): explicit list
 *   - role (string): everyone with that role in the org (e.g. all admins)
 *
 * AI hook: the action + entityType + entityId fields are deliberately
 * structured so an automation worker can later subscribe to certain
 * event types and react (e.g. when 5 tasks are reassigned to one person
 * in a day, surface an alert to admin).
 */

export interface NotifyInput {
  io?: any;                     // socket.io server instance (req.app.get('io'))
  organizationId: string;
  title: string;
  body: string;
  /** Free-form action label — e.g. 'workflow.assigned', 'task.assigned'. */
  type: string;
  /** Optional entity link the UI can deep-link into. */
  entityId?: string;
  entityType?: 'workflow' | 'task' | 'leave' | 'meeting' | 'lead' | 'schedule' | 'note' | string;
  // Pick one of these to address the notification:
  userId?: string;
  userIds?: string[];
  role?: 'admin' | 'employee' | 'sales' | 'client';
  // If true, also include the actor themselves. Default: exclude (the
  // person who triggered the action shouldn't get notified about it).
  includeActor?: boolean;
  actorId?: string;             // who triggered the event
}

/**
 * notifyDataChanged — emit a lightweight 'data:changed' socket event
 * so connected clients can refresh their dashboards in near-real-time.
 *
 * This is intentionally a fire-and-forget broadcast, NOT a persisted
 * notification. The bell stays clean. Listeners on the client
 * (WorkroomHome, CommandCenter) debounce a refresh on receiving it.
 *
 * Scoped to one org room.
 */
export function notifyDataChanged(io: any, organizationId: string, kind: string, entityId?: string): void {
  try {
    if (!io || !organizationId) return;
    io.to(`org:${organizationId}`).emit('data:changed', { kind, entity: entityId });
  } catch { /* socket layer hiccup — fine, polling will catch up */ }
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    let recipients: string[] = [];
    if (input.userId)       recipients.push(input.userId);
    if (input.userIds)      recipients.push(...input.userIds);
    if (input.role) {
      const users = await User.find({
        organizationId: input.organizationId,
        role: input.role,
        isActive: true,
      }).select('_id').lean();
      recipients.push(...users.map(u => String(u._id)));
    }
    // Dedupe + exclude actor unless explicitly included.
    recipients = Array.from(new Set(recipients));
    if (input.actorId && !input.includeActor) {
      recipients = recipients.filter(r => r !== input.actorId);
    }
    if (recipients.length === 0) return;

    // Persist
    const docs = recipients.map(r => ({
      organizationId: input.organizationId,
      recipientId: r,
      type: input.type,
      title: input.title,
      body: input.body,
      meta: input.entityId ? { entityId: input.entityId, entityType: input.entityType } : undefined,
    }));
    await Notification.insertMany(docs, { ordered: false });

    // Emit live to each recipient's user room so the AppLayout badge +
    // toast fires immediately. Best-effort — never throw.
    if (input.io) {
      for (const r of recipients) {
        try {
          input.io.to(`user:${r}`).emit('notification:new', {
            title: input.title,
            body: input.body,
            type: input.type,
            entityId: input.entityId,
            entityType: input.entityType,
          });
        } catch { /* socket layer hiccup — DB has the record */ }
      }
    }
  } catch {
    // Logging the error to itself would risk recursion. Console only.
    console.warn('[notify] failed to deliver notification', input.type);
  }
}
