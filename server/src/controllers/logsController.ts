import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ActivityLog from '../models/ActivityLog';
import WorkflowActivity from '../models/WorkflowActivity';
import ClientWorkflow from '../models/ClientWorkflow';
import VideoSopRun from '../models/VideoSopRun';
import Session from '../models/Session';

/**
 * logsController — Oct 2026 (owner: "logs to be maintained"). ONE timeline of
 * every permanent record in Robin, for admin + managers (Rahul):
 *   login       sign-ins / first app-open of the day
 *   attendance  clock in / out, breaks (from work sessions)
 *   client      CRM changes, status updates, notes, client updates, opens, archive / restore
 *   video       Video SOP steps, daily updates, video counts, reminders
 *   team        members added / changed / removed, access, roster
 *   leave       leave applied / reviewed
 *   deletion    anything deleted, with who / when / a snapshot
 *   vault       credential access
 * GET /api/oversight/logs?from=&to=&userId=&client=&type=&q=&before=&limit=&format=csv
 * Nothing here is ever trimmed — sources are kept forever.
 */
const IST = 330 * 60_000;
type Row = { at: string; type: string; who: string; whoId: string; client: string; what: string; detail: string };

function typeOf(action: string): string {
  if (action.startsWith('auth.')) return 'login';
  if (action.startsWith('deleted.')) return 'deletion';
  if (action.startsWith('member.') || action.startsWith('roster.') || action.startsWith('oversight.')) return 'team';
  if (action.startsWith('leave')) return 'leave';
  if (action.startsWith('client') || action.startsWith('clients.')) return 'client';
  if (/credential|vault/.test(action)) return 'vault';
  return 'other';
}
function describe(a: any): string {
  const m = a.metadata || {};
  switch (a.action) {
    case 'auth.login': return `Signed in${m.method === 'google' ? ' with Google' : ''}`;
    case 'auth.resume': return 'Opened Robin (first time today)';
    case 'client.opened': return `Opened client ${m.label || ''}`.trim();
    case 'member.added': return `Added team member ${m.label || ''}`.trim();
    case 'member.updated': return `Changed team member ${m.label || ''}`.trim();
    case 'member.removed': return `Removed team member ${m.label || ''}`.trim();
    case 'oversight.access_granted': return `Gave Team Oversight access to ${m.label || ''}`.trim();
    case 'oversight.access_revoked': return `Removed Team Oversight access from ${m.label || ''}`.trim();
    case 'clients.cleanup': return `Client clean-up: ${m.label || ''}`;
    case 'clients.setup': return `Client set-up applied (${m.version || ''})`;
    case 'roster.applied': return `Team roster applied (${m.version || ''})`;
  }
  if (a.action.startsWith('deleted.')) return `Deleted ${a.action.slice(8).replace(/_/g, ' ')}: ${m.label || ''}`;
  return String(a.action).replace(/[._]/g, ' ');
}

async function collect(orgId: string, fromMs: number, toMs: number): Promise<Row[]> {
  const from = new Date(fromMs), to = new Date(toMs);
  const orgObj = new mongoose.Types.ObjectId(orgId);
  const [acts, wfActs, sopLogs, sessions, users, wfs, deletedClients] = await Promise.all([
    ActivityLog.find({ organizationId: orgObj, createdAt: { $gte: from, $lt: to } }).sort({ createdAt: -1 }).limit(20000).lean(),
    WorkflowActivity.find({ organizationId: orgObj, createdAt: { $gte: from, $lt: to } }).sort({ createdAt: -1 }).limit(20000)
      .select('workflowId action serviceType actorId actorName comment before after createdAt').lean(),
    VideoSopRun.aggregate([
      { $match: { organizationId: orgObj } }, { $unwind: '$log' },
      { $match: { 'log.at': { $gte: from, $lt: to } } },
      { $project: { clientName: 1, log: 1 } }, { $limit: 20000 },
    ]),
    Session.find({ organizationId: orgObj, $or: [{ startTime: { $gte: from, $lt: to } }, { endTime: { $gte: from, $lt: to } }] }).lean(),
    User.find({ organizationId: orgObj }).select('_id name').lean(),
    ClientWorkflow.find({ organizationId: orgObj }).select('_id clientName').lean(),
    ActivityLog.find({ organizationId: orgObj, action: 'deleted.client' }).select('entityId metadata').lean(),
  ]);
  const name = new Map(users.map((u: any) => [String(u._id), u.name || '']));
  const client = new Map(wfs.map((w: any) => [String(w._id), w.clientName || '']));
  for (const d of deletedClients as any[]) if (d.entityId && !client.has(String(d.entityId))) client.set(String(d.entityId), `${d.metadata?.label || 'Client'} (deleted)`);
  const rows: Row[] = [];
  const inRange = (d: any) => { const t = new Date(d).getTime(); return t >= fromMs && t < toMs; };

  for (const a of acts as any[]) {
    const isClient = a.entity === 'client_workflow' || a.action === 'deleted.client';
    rows.push({ at: new Date(a.createdAt).toISOString(), type: typeOf(a.action), whoId: String(a.userId || ''), who: name.get(String(a.userId)) || (a.userId ? 'Someone' : 'Robin'),
      client: isClient ? (a.metadata?.label || client.get(String(a.entityId)) || '') : '',
      what: describe(a),
      detail: a.metadata?.snapshot ? JSON.stringify(a.metadata.snapshot).slice(0, 400) : (a.metadata?.notes ? [].concat(a.metadata.notes).join(' · ') : (a.metadata?.device || a.metadata?.userAgent ? String(a.metadata.userAgent || '').slice(0, 120) : '')) });
  }
  for (const w of wfActs as any[]) {
    const ugc = /^UGC /.test(w.comment || '');
    const status = (w.before?.status !== undefined || w.after?.status !== undefined) ? `changed status "${w.before?.status || '—'}" → "${w.after?.status || '—'}"` : String(w.action || '').replace(/_/g, ' ');
    rows.push({ at: new Date(w.createdAt).toISOString(), type: ugc ? 'video' : 'client', whoId: String(w.actorId || ''), who: name.get(String(w.actorId)) || w.actorName || 'Someone',
      client: client.get(String(w.workflowId)) || '(deleted client)', what: ugc ? 'Video SOP' : status,
      detail: `${w.comment || ''}${w.after?.nextTask ? ` · Next: ${w.after.nextTask}` : ''}` });
  }
  for (const r of sopLogs as any[]) {
    const l = r.log;
    if (/^(step_done|step_done_late|daily_update|progress)$/.test(l.action)) continue;   // already in the client log (mirrored)
    rows.push({ at: new Date(l.at).toISOString(), type: l.action.startsWith('notified') ? 'reminder' : 'video', whoId: String(l.actorId || ''),
      who: name.get(String(l.actorId)) || l.actorName || 'Robin', client: r.clientName || '', what: `Video SOP: ${String(l.action).replace(/_/g, ' ')}`, detail: l.detail || '' });
  }
  for (const s of sessions as any[]) {
    const uid = String(s.userId), who = name.get(uid) || 'Someone';
    if (inRange(s.startTime)) rows.push({ at: new Date(s.startTime).toISOString(), type: 'attendance', whoId: uid, who, client: '', what: 'Clocked in', detail: '' });
    if (s.endTime && inRange(s.endTime)) rows.push({ at: new Date(s.endTime).toISOString(), type: 'attendance', whoId: uid, who, client: '', what: s.autoClosedAt ? 'Auto clocked-out (forgot to log out)' : 'Clocked out', detail: '' });
    for (const b of s.breakEvents || []) {
      if (b.startedAt && inRange(b.startedAt)) rows.push({ at: new Date(b.startedAt).toISOString(), type: 'attendance', whoId: uid, who, client: '', what: 'Started break', detail: '' });
      if (b.endedAt && inRange(b.endedAt)) rows.push({ at: new Date(b.endedAt).toISOString(), type: 'attendance', whoId: uid, who, client: '', what: 'Back from break',
        detail: b.startedAt ? `${Math.round((new Date(b.endedAt).getTime() - new Date(b.startedAt).getTime()) / 60000)} min` : '' });
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return rows;
}

const csvCell = (v: string) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

export async function getLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const me: any = await User.findById(req.user!.id).select('organizationId').lean();
    const orgId = String(me?.organizationId || '');
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
    const fromStr = String(req.query.from || today), toStr = String(req.query.to || fromStr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) { res.status(400).json({ error: 'Dates must be YYYY-MM-DD' }); return; }
    const fromMs = Date.parse(fromStr + 'T00:00:00Z') - IST;
    const toMs = Date.parse(toStr + 'T00:00:00Z') - IST + 86_400_000;
    if (toMs - fromMs > 93 * 86_400_000) { res.status(400).json({ error: 'Pick at most about 3 months at a time' }); return; }
    let rows = await collect(orgId, fromMs, toMs);
    const { userId, client, type, q } = req.query as Record<string, string>;
    if (userId) rows = rows.filter(r => r.whoId === userId);
    if (type && type !== 'all') rows = rows.filter(r => r.type === type);
    if (client) { const c = client.toLowerCase(); rows = rows.filter(r => r.client.toLowerCase().includes(c)); }
    if (q) { const n = q.toLowerCase(); rows = rows.filter(r => `${r.who} ${r.client} ${r.what} ${r.detail}`.toLowerCase().includes(n)); }
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.type] = (counts[r.type] || 0) + 1;

    if (req.query.format === 'csv') {
      const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const body = ['When (IST),Type,Who,Client,What,Detail', ...rows.map(r => [fmt(r.at), r.type, r.who, r.client, r.what, r.detail].map(csvCell).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="robin-logs-${fromStr}_to_${toStr}.csv"`);
      res.send('﻿' + body);
      return;
    }
    const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 200));
    const before = req.query.before ? String(req.query.before) : '';
    const page = before ? rows.filter(r => r.at < before) : rows;
    res.json({ total: rows.length, counts, rows: page.slice(0, limit), nextBefore: page.length > limit ? page[limit - 1].at : null });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
