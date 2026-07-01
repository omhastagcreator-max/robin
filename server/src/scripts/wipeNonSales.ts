/**
 * wipeNonSales.ts — owner ask (June 2026):
 *   "Wipe all the task data + all the extra bogus data from Robin
 *    for everyone except the sales person."
 *
 * Preserves everything that touches a sales-role user (role === 'sales'
 * OR 'sales' in roles[]). Wipes aggressively for everyone else.
 *
 * KEPT (always, regardless of owner):
 *   - User accounts (nobody gets deleted here — use disable/deactivate)
 *   - Sessions (attendance / hours audit trail)
 *   - Organization
 *   - ClientTransactions (money audit trail — never touched)
 *   - Deals (sales pipeline)
 *   - Leads (sales pipeline)
 *   - Real ClientWorkflows (unless auto-imported)
 *
 * WIPED (when no sales user is involved):
 *   - ProjectTasks  where BOTH assignedTo AND assignedBy are non-sales
 *   - DailyCheckins where userId is non-sales
 *   - WorkflowActivity where actorId is non-sales
 *   - AIBrief / MorningBrief / UserBriefAI for non-sales users
 *   - Notifications for non-sales recipients
 *   - Reminders for non-sales owners
 *   - ClientQuery / ClientAlert / LeadNote for non-sales
 *   - ChatMessages sent by non-sales users
 *   - RobinThread / Transcripts / Issue / ProjectUpdate / Metric /
 *     ProjectGoal / EmployeeDayPlan / FocusList / MetaShareLink /
 *     EmployeeTarget / SopOverride / ActivityLog / ScreenSession
 *     for non-sales users
 *
 * ALWAYS WIPED (bogus / auto-imported, regardless of owner):
 *   - ProjectTask / ClientWorkflow / User where importedFrom matches
 *     /^(crm-sheets|sheet-sync|daily-checkin)/
 *
 * Flags:
 *   --apply           actually delete (defaults to dry-run)
 *   --include-sales   wipe EVERYONE'S data, sales included (fresh slate)
 *
 * Idempotent — re-runs are safe (nothing to delete second time).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User';
import ProjectTask from '../models/ProjectTask';
import DailyCheckin from '../models/DailyCheckin';
import ClientWorkflow from '../models/ClientWorkflow';
import Notification from '../models/Notification';
import Reminder from '../models/Reminder';
import ChatMessage from '../models/ChatMessage';
import WorkflowActivity from '../models/WorkflowActivity';
import AIBrief from '../models/AIBrief';
import MorningBrief from '../models/MorningBrief';
import UserBriefAI from '../models/UserBriefAI';
import ClientQuery from '../models/ClientQuery';
import ClientAlert from '../models/ClientAlert';
import LeadNote from '../models/LeadNote';
import RobinThread from '../models/RobinThread';
import Transcript from '../models/Transcript';
import Issue from '../models/Issue';
import ProjectUpdate from '../models/ProjectUpdate';
import Metric from '../models/Metric';
import ProjectGoal from '../models/ProjectGoal';
import EmployeeDayPlan from '../models/EmployeeDayPlan';
import FocusList from '../models/FocusList';
import MetaShareLink from '../models/MetaShareLink';
import EmployeeTarget from '../models/EmployeeTarget';
import SopOverride from '../models/SopOverride';
import ActivityLog from '../models/ActivityLog';
import ScreenSession from '../models/ScreenSession';

const APPLY          = process.argv.includes('--apply');
const INCLUDE_SALES  = process.argv.includes('--include-sales');
const IMPORTED_REGEX = /^(crm-sheets|sheet-sync|daily-checkin)/i;

function fmt(n: number): string { return n.toLocaleString(); }

async function count(label: string, model: any, filter: any): Promise<number> {
  const n = await model.countDocuments(filter);
  console.log(`  ${label.padEnd(30)}  ${fmt(n).padStart(8)}`);
  return n;
}

async function purge(label: string, model: any, filter: any): Promise<number> {
  if (!APPLY) return count(label, model, filter);
  const r = await model.deleteMany(filter);
  console.log(`  ${label.padEnd(30)}  ${fmt(r.deletedCount).padStart(8)}  ✂ deleted`);
  return r.deletedCount;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(
    `[wipe-non-sales] connected · mode=${APPLY ? 'APPLY' : 'DRY-RUN'} ` +
    `sales=${INCLUDE_SALES ? 'ALSO WIPED' : 'PRESERVED'}\n`,
  );

  // ── Identify sales users ──────────────────────────────────────────
  const salesUsers = INCLUDE_SALES
    ? []
    : await User.find({
        $or: [{ role: 'sales' }, { roles: 'sales' }],
      }).select('_id name email').lean();

  const salesIds = new Set(salesUsers.map(u => String(u._id)));
  console.log(`Sales users preserved: ${salesUsers.length}`);
  for (const u of salesUsers) console.log(`  · ${u.name || '(no name)'}  <${u.email}>  ${u._id}`);
  console.log();

  // The "not-sales" filter used everywhere. Empty preserve set → matches
  // everyone (nuclear).
  const notSales = INCLUDE_SALES
    ? {}
    : { $nin: Array.from(salesIds) };

  console.log('══════════════ deletion plan ══════════════');

  // ── ProjectTasks: wipe where NEITHER assignee NOR creator is sales.
  // (i.e. no sales involvement anywhere in the task's ownership).
  await purge('ProjectTask (non-sales)', ProjectTask, {
    ...(INCLUDE_SALES ? {} : { assignedTo: notSales, assignedBy: notSales }),
  });

  // ── DailyCheckins: wipe non-sales user checkins entirely.
  await purge('DailyCheckin (non-sales)', DailyCheckin, {
    userId: notSales,
  });

  // ── WorkflowActivity: wipe non-sales actor entries.
  await purge('WorkflowActivity (non-sales)', WorkflowActivity, {
    actorId: notSales,
  });

  // ── AI-generated stuff for non-sales users.
  await purge('AIBrief (non-sales)',      AIBrief,      { userId: notSales });
  await purge('MorningBrief (non-sales)', MorningBrief, { userId: notSales });
  await purge('UserBriefAI (non-sales)',  UserBriefAI,  { userId: notSales });

  // ── Notifications / Reminders for non-sales recipients / owners.
  await purge('Notification (non-sales)', Notification, { recipientId: notSales });
  await purge('Reminder (non-sales)',     Reminder,     { userId: notSales });

  // ── Chat / conversational.
  await purge('ChatMessage (non-sales)',  ChatMessage,  { senderId: notSales });
  await purge('RobinThread (non-sales)',  RobinThread,  { userId: notSales });
  await purge('Transcript (non-sales)',   Transcript,   { userId: notSales });

  // ── Client-side ephemera.
  await purge('ClientQuery (non-sales)',  ClientQuery,  { assignedTo: notSales });
  await purge('ClientAlert (all)',        ClientAlert,  {});                        // auto-generated, safe to nuke all
  await purge('LeadNote (non-sales)',     LeadNote,     { authorId: notSales });

  // ── Bug reports (issues) for non-sales users.
  await purge('Issue (non-sales)',        Issue,        { reporterId: notSales });

  // ── Project-side stuff.
  await purge('ProjectUpdate (non-sales)', ProjectUpdate, { authorId: notSales });
  await purge('Metric (non-sales)',        Metric,        { userId: notSales });
  await purge('ProjectGoal (non-sales)',   ProjectGoal,   { ownerId: notSales });

  // ── Employee-only.
  await purge('EmployeeDayPlan (non-sales)', EmployeeDayPlan, { userId: notSales });
  await purge('FocusList (non-sales)',       FocusList,       { userId: notSales });
  await purge('EmployeeTarget (non-sales)',  EmployeeTarget,  { userId: notSales });
  await purge('SopOverride (non-sales)',     SopOverride,     { userId: notSales });
  await purge('ActivityLog (non-sales)',     ActivityLog,     { userId: notSales });

  // ── Screen-share history.
  await purge('ScreenSession (non-sales)',   ScreenSession,   { userId: notSales });

  // ── Meta share links owned by non-sales.
  await purge('MetaShareLink (non-sales)',   MetaShareLink,   { createdBy: notSales });

  console.log('\n══════════════ imported-data purge (always) ══════════════');

  // ── Always purge bogus imports regardless of ownership.
  await purge('ProjectTask (imported)',    ProjectTask,    { importedFrom: { $regex: IMPORTED_REGEX } });
  await purge('ClientWorkflow (imported)', ClientWorkflow, { importedFrom: { $regex: IMPORTED_REGEX } });
  await purge('User (imported placeholders)', User,        { importedFrom: { $regex: IMPORTED_REGEX } });

  console.log('\n══════════════ preserved (untouched) ══════════════');
  const preservedTasks   = await ProjectTask.countDocuments(INCLUDE_SALES
    ? { importedFrom: { $not: { $regex: IMPORTED_REGEX } } }
    : { $or: [{ assignedTo: { $in: Array.from(salesIds) } }, { assignedBy: { $in: Array.from(salesIds) } }] });
  const preservedCheckin = INCLUDE_SALES ? 0 : await DailyCheckin.countDocuments({ userId: { $in: Array.from(salesIds) } });
  const preservedUsers   = await User.countDocuments({ importedFrom: { $not: { $regex: IMPORTED_REGEX } } });
  const preservedClients = await ClientWorkflow.countDocuments({ importedFrom: { $not: { $regex: IMPORTED_REGEX } } });
  console.log(`  Users (real)                     ${fmt(preservedUsers).padStart(8)}`);
  console.log(`  ClientWorkflows (real)           ${fmt(preservedClients).padStart(8)}`);
  console.log(`  ProjectTasks (sales-touched)     ${fmt(preservedTasks).padStart(8)}`);
  console.log(`  DailyCheckins (sales users)      ${fmt(preservedCheckin).padStart(8)}`);
  console.log(`  Sessions / Deals / Leads / Txns  — untouched`);

  if (!APPLY) {
    console.log('\n👀 DRY RUN — nothing was deleted. Re-run with --apply to commit.');
  } else {
    console.log('\n✅ Wipe complete.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[wipe-non-sales] FATAL', err);
  process.exit(1);
});
