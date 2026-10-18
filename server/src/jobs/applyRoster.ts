import Organization from '../models/Organization';
import User from '../models/User';
import ActivityLog from '../models/ActivityLog';
import { deactivateMember } from '../services/teamRoster';

/**
 * applyRoster — Oct 2026. The owner's current team, applied ONCE per
 * ROSTER_VERSION at server start (a marker row stops it re-running, so later
 * edits made in Team & roles are never overwritten). Matching is by name; a
 * name that matches nobody or several people is skipped and logged, never
 * guessed. To change the team later, use Team & roles in Robin — or bump
 * ROSTER_VERSION after editing the list.
 *
 *   Priyanka ................ video team (UGC) — owns every UGC brand
 *   Amit Kamble ............. video team intern — helper on every Video SOP
 *   Shakshi ................. Meta Ads executive
 *   Chetan .................. Meta Ads intern
 *   Bhawna .................. removed (switched off, her clients reassigned)
 */
const ROSTER_VERSION = '2026-10-18b';
type Entry = { match: RegExp; who: string; addTeams?: string[]; removeTeams?: string[]; department?: string; remove?: boolean };
const ROSTER: Entry[] = [
  { match: /^priyanka(\s|$)/i,        who: 'Priyanka',    addTeams: ['influencer'], department: 'Video team (UGC)' },
  // Amit is an intern who works WITH Priyanka: helper on every Video SOP
  // (video_support), not a separate owner who gets brands auto-assigned.
  { match: /^amit\s+kamble(\s|$)/i,   who: 'Amit Kamble', addTeams: ['video_support'], removeTeams: ['influencer'], department: 'Video team intern' },
  { match: /^(shakshi|sakshi)(\s|$)/i, who: 'Shakshi',    addTeams: ['meta'],       department: 'Meta Ads Executive' },
  { match: /^chetan(\s|$)/i,          who: 'Chetan',      addTeams: ['meta'],       department: 'Meta Ads Intern' },
  { match: /^bhawna(\s|$)/i,          who: 'Bhawna',      remove: true },
];

export async function applyRoster(): Promise<void> {
  try {
    const orgs = await Organization.find({}).select('_id').lean();
    for (const org of orgs as any[]) {
      const done = await ActivityLog.exists({ organizationId: org._id, action: 'roster.applied', 'metadata.version': ROSTER_VERSION });
      if (done) continue;
      const notes: string[] = [];
      for (const e of ROSTER) {
        const found = await User.find({ organizationId: org._id, isActive: true, name: e.match, role: { $ne: 'client' } });
        if (found.length !== 1) { notes.push(`${e.who}: ${found.length ? 'several matches — skipped' : 'not found'}`); continue; }
        const u: any = found[0];
        if (e.remove) {
          const admin: any = await User.findOne({ organizationId: org._id, role: 'admin', isActive: true }).select('_id').lean();
          const { moved } = await deactivateMember(String(org._id), String(u._id), admin ? String(admin._id) : String(u._id));
          notes.push(`${u.name}: removed, ${moved.length} stage(s) reassigned`);
          continue;
        }
        u.teams = Array.from(new Set([...(u.teams || []), ...(e.addTeams || [])])).filter(t => !(e.removeTeams || []).includes(t));
        if (u.team && (e.removeTeams || []).includes(u.team)) u.team = '';
        if (!u.team && e.addTeams?.[0]) u.team = e.addTeams[0];
        if (e.department) u.department = e.department;
        if (u.role === 'workroom' || u.role === 'client') u.role = 'employee';
        await u.save();
        notes.push(`${u.name}: ${e.department}`);
      }
      await ActivityLog.create({ organizationId: org._id, action: 'roster.applied', entity: 'organization', metadata: { version: ROSTER_VERSION, notes } });
      console.log(`[roster] applied ${ROSTER_VERSION}: ${notes.join(' · ')}`);
    }
  } catch (e) {
    console.warn('[roster] apply failed', (e as Error).message);
  }
}
