/**
 * brandPulseCron — fires random brand-accountability questions.
 *
 * Owner ask (July 2026): "ask randomly about all the brands' progress
 * any time from all the employees and make them responsible to answer —
 * then only they can continue Robin." Regular + random: every 15-minute
 * tick inside IST work hours (10:30–18:30, Mon–Sat) rolls a dice per
 * org; when it hits, one clocked-in staff member gets one question about
 * one brand. Nobody can predict when — that's the accountability.
 *
 * Fairness / annoyance limits:
 *   · only users with an ACTIVE session (not on break / logged out)
 *   · max 1 pending pulse per user at any time
 *   · max 2 original asks per user per day (redirects don't count)
 *   · same brand not re-asked org-wide within 4 hours
 *
 * ── BRAND ROUTING (owner-provided, July 2026) ────────────────────────
 * Explicit map of which people own which brand, matched by name regex
 * (same trick as grantWorkroomManagerPermissions — emails/spellings
 * drift, first names don't). A person entry can restrict which question
 * kinds they get — e.g. Darpan is an ENGAGEMENT brand: Shakshi gets
 * Meta-ads/engagement questions, Priyanka gets script/content, Om gets
 * overall (no sales questions — owner said sales don't apply there).
 * Brands not in the table fall back to services[].assignedTo, then to
 * anyone — the skip → "who manages this?" flow catches mistakes and
 * routes the question onward.
 */
import Session from '../models/Session';
import User from '../models/User';
import ClientWorkflow from '../models/ClientWorkflow';
import BrandPulse from '../models/BrandPulse';
import Organization from '../models/Organization';
import { callGemini } from '../services/aiTriage';

const IST_OFFSET_MS = 330 * 60_000;
const FIRE_CHANCE = 0.35;              // per org per 15-min tick within work hours
const MAX_PER_USER_PER_DAY = 2;
const BRAND_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export type PulseKind =
  | 'sales_achieved' | 'target_status' | 'next_plan' | 'ad_performance'
  | 'blockers' | 'client_update' | 'engagement' | 'content_script';

export const QUESTION_BANK: Record<PulseKind, (brand: string) => string> = {
  sales_achieved: (b) => `What sales / results has ${b} achieved so far this week? Give numbers if you have them.`,
  target_status:  (b) => `Where is ${b} against its target right now — ahead, on track, or behind? By roughly how much?`,
  next_plan:      (b) => `What's the next planned move for ${b}? What ships in the next 2–3 days?`,
  ad_performance: (b) => `How are ${b}'s Meta ads performing right now (spend, leads / ROAS)? Anything that needs changing?`,
  blockers:       (b) => `What's blocking faster growth for ${b} right now, and what do you need to unblock it?`,
  client_update:  (b) => `When did we last update ${b}'s client, and what was communicated? When is the next touchpoint?`,
  engagement:     (b) => `How is ${b}'s engagement trending this week (reach, interactions, followers)? What's working, what's not?`,
  content_script: (b) => `What's the script / content status for ${b}? What's written, what's pending, and what goes out next?`,
};

const ALL_KINDS = Object.keys(QUESTION_BANK) as PulseKind[];

interface RoutePerson { name: RegExp; kinds?: PulseKind[] }
interface BrandRoute  { brand: RegExp; people: RoutePerson[] }

// Name regexes: sh?akshi covers Shakshi/Sakshi; bhaw?a?na covers
// Bhawana/Bhawna/Bhavna. ^om anchors so "Om" doesn't match e.g. "Somya".
const SHAKSHI  = /s(h?)akshi/i;
const OM       = /^om(\s|$|\.)/i;
const BHAWANA  = /bha[vw]a?na/i;
const NEERAJ   = /neeraj/i;
const PRIYANKA = /priyanka/i;

export const BRAND_ROUTING: BrandRoute[] = [
  { brand: /sroja/i,                people: [{ name: OM }] },
  // Vellore + History removed (Aug 2026 owner ask: "remove all the old
  // brand history, vellore from the whole robin") — both brands and all
  // their data were purged via server/src/scripts/purgeBrand.ts. Do not
  // re-add these routing entries unless the brands come back.
  // Darpan — engagement brand, not sales (owner rule):
  //   Shakshi → Meta ads + engagement · Priyanka → scripts/content ·
  //   Om → overall (everything except sales questions).
  { brand: /darpan/i, people: [
    { name: SHAKSHI,  kinds: ['ad_performance', 'engagement'] },
    { name: OM,       kinds: ['engagement', 'target_status', 'next_plan', 'blockers', 'client_update'] },
    { name: PRIYANKA, kinds: ['content_script'] },
  ]},
  { brand: /ghee/i,                 people: [{ name: NEERAJ }, { name: BHAWANA }, { name: OM }] },
  { brand: /oudfy/i,                people: [{ name: OM }, { name: BHAWANA }] },
  { brand: /height\s*ayura|ayura/i, people: [{ name: SHAKSHI }, { name: OM }] },
  { brand: /moto\s*casa/i,          people: [{ name: SHAKSHI }, { name: OM }] },
  { brand: /ardo/i,                 people: [{ name: SHAKSHI }, { name: OM }] },
  { brand: /bombay/i,               people: [{ name: SHAKSHI }] },
  { brand: /woodsify/i,             people: [{ name: SHAKSHI }] },
  { brand: /dufft/i,                people: [{ name: OM }] },
  // Polmouni has no explicit routing entry yet — falls back to
  // services[].assignedTo (Om, per bulkAddWebsiteClients.ts), then
  // "anyone" clocked in. Add an explicit entry here once the owner says
  // who should own Polmouni's pulse questions.
  //
  // Aug 2026 — owner ask: "the pop[up] should be for these brands only."
  // Pruned /dpk/i, /shrikanth/i, /bazaar|qatar/i — none of those three
  // are in the current 11-brand keep-list (see
  // server/src/scripts/keepOnlyBrands.ts) and don't correspond to any
  // live ClientWorkflow doc anymore. The pulse's brand pool is already
  // just "every live ClientWorkflow in the org" (see the ClientWorkflow.find
  // below), so removing their routing entries doesn't change WHICH brands
  // get asked about — it only removes dead routing rules for brands that
  // no longer exist, keeping this table honest about the current 11.
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const KIND_FOCUS: Record<PulseKind, string> = {
  sales_achieved: 'sales / revenue / leads actually achieved recently — demand concrete numbers',
  target_status:  'progress against the target — ahead / on track / behind, and by how much',
  next_plan:      'the concrete next moves shipping in the coming 2–3 days',
  ad_performance: 'Meta ads performance — spend, CPL / ROAS, what needs changing',
  blockers:       'what is blocking faster growth and what they need to unblock it',
  client_update:  'client communication — last update sent, what was said, next touchpoint',
  engagement:     'engagement — reach, interactions, follower growth, what content is working',
  content_script: 'script / content pipeline — what is written, pending, and going out next',
};

/**
 * AI-written question (owner ask, July 2026: "stop asking the stupid
 * repeated questions — use AI"). Gemini writes ONE fresh question using
 * real context: the person's recent answers about this brand (so it can
 * follow up — "last time you said X, did it happen?") and the last few
 * questions asked (so it never repeats). Falls back to the static
 * template bank whenever the AI is unavailable — pulses must fire
 * either way.
 */
async function generateQuestion(
  orgId: any, userId: string, brandId: any, brandName: string, kind: PulseKind,
): Promise<string> {
  try {
    const [lastAnswers, lastQuestions] = await Promise.all([
      BrandPulse.find({ organizationId: orgId, clientWorkflowId: brandId, status: 'answered' })
        .sort({ answeredAt: -1 }).limit(3).select('question answer userId answeredAt').lean(),
      BrandPulse.find({ organizationId: orgId, clientWorkflowId: brandId })
        .sort({ askedAt: -1 }).limit(5).select('question').lean(),
    ]);

    const answersCtx = lastAnswers.map(a =>
      `Q: ${a.question}\nA (${a.userId === userId ? 'THIS person' : 'a teammate'}, ${new Date(a.answeredAt || 0).toDateString()}): ${a.answer}`,
    ).join('\n---\n') || 'None yet.';
    const recentQs = lastQuestions.map(q => `- ${q.question}`).join('\n') || 'None yet.';

    const system =
      `You write ONE sharp spot-check question for a digital-marketing-agency teammate about a client brand. ` +
      `Rules: output ONLY the question text (1–2 sentences, max 220 chars), no preamble, no quotes. ` +
      `Be specific and direct — a question a good manager would ask in person. Ask for numbers where relevant. ` +
      `NEVER repeat or closely paraphrase any recent question listed. ` +
      `If a previous answer mentioned a plan or a number, FOLLOW UP on it (did it happen? did it move?).`;

    const payload =
      `Brand: ${brandName}\n` +
      `Focus area for this question: ${KIND_FOCUS[kind]}\n\n` +
      `Recent answers about this brand:\n${answersCtx}\n\n` +
      `Recent questions already asked (do NOT repeat these):\n${recentQs}`;

    const text = (await callGemini(system, payload, 200)).trim()
      .replace(/^["'`]+|["'`]+$/g, '').slice(0, 300);
    if (text.length >= 15) return text;
    throw new Error('too_short');
  } catch {
    return QUESTION_BANK[kind](brandName);   // graceful degrade — Robin convention
  }
}

export async function fireRandomPulse(orgId: any): Promise<boolean> {
  // 1. Clocked-in staff (active, fresh heartbeat, not on break).
  const cutoff = new Date(Date.now() - 3 * 60_000);
  const live = await Session.find({
    organizationId: orgId,
    status: 'active',
    lastHeartbeatAt: { $gte: cutoff },
  }).select('userId').lean();
  if (live.length === 0) return false;

  const staff = await User.find({
    organizationId: orgId,
    _id: { $in: live.map(s => s.userId) },
    role: { $in: ['employee', 'sales', 'workroom'] },
    isActive: true,
  }).select('_id name email').lean();
  if (staff.length === 0) return false;

  // 2. Eligibility: no pending pulse, under today's cap.
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const dayStart = new Date(Date.UTC(
    nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(),
  ) - IST_OFFSET_MS);
  const eligible: Array<{ id: string; name: string }> = [];
  for (const u of staff) {
    const uid = String(u._id);
    const pending = await BrandPulse.countDocuments({ organizationId: orgId, userId: uid, status: 'pending' });
    if (pending > 0) continue;
    const today = await BrandPulse.countDocuments({
      organizationId: orgId, userId: uid, askedAt: { $gte: dayStart }, hop: 0,
    });
    if (today >= MAX_PER_USER_PER_DAY) continue;
    eligible.push({ id: uid, name: u.name || u.email || '' });
  }
  if (eligible.length === 0) return false;

  // 3. Active brands not on cooldown.
  const cooldownAfter = new Date(Date.now() - BRAND_COOLDOWN_MS);
  const recentlyAsked = await BrandPulse.find({
    organizationId: orgId, askedAt: { $gte: cooldownAfter },
  }).select('clientWorkflowId').lean();
  const coolSet = new Set(recentlyAsked.map(p => String(p.clientWorkflowId)));

  const workflows = await ClientWorkflow.find({ organizationId: orgId })
    .select('clientName services.assignedTo services.status').lean();
  const fresh = workflows.filter(w => !coolSet.has(String(w._id)) && (w as any).clientName);
  if (fresh.length === 0) return false;

  // 4. Build (user, brand, allowedKinds) candidate pairs.
  const pairs: Array<{ userId: string; brand: any; kinds: PulseKind[] }> = [];
  for (const w of fresh) {
    const name = (w as any).clientName as string;
    const route = BRAND_ROUTING.find(r => r.brand.test(name));
    if (route) {
      for (const p of route.people) {
        for (const u of eligible) {
          if (p.name.test(u.name)) pairs.push({ userId: u.id, brand: w, kinds: p.kinds || ALL_KINDS });
        }
      }
    } else {
      // Not in the owner's table — fall back to service assignees, then anyone.
      const assignees = new Set(((w as any).services || [])
        .map((s: any) => String(s.assignedTo)).filter(Boolean));
      const assigned = eligible.filter(u => assignees.has(u.id));
      for (const u of (assigned.length ? assigned : eligible)) {
        pairs.push({ userId: u.id, brand: w, kinds: ALL_KINDS });
      }
    }
  }
  if (pairs.length === 0) return false;

  // 5. Fire one.
  const chosen = pick(pairs);
  const kind = pick(chosen.kinds);
  const brandName = (chosen.brand as any).clientName || 'this brand';
  const question = await generateQuestion(orgId, chosen.userId, chosen.brand._id, brandName, kind);
  await BrandPulse.create({
    organizationId: orgId,
    userId: chosen.userId,
    clientWorkflowId: chosen.brand._id,
    clientName: brandName,
    questionKind: kind,
    question,
    status: 'pending',
    hop: 0,
  });
  console.log(`[brand-pulse] asked user=${chosen.userId} brand="${brandName}" kind=${kind}`);
  return true;
}

export function startBrandPulseCron() {
  setInterval(async () => {
    try {
      const ist = new Date(Date.now() + IST_OFFSET_MS);
      const dow = ist.getUTCDay();
      const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (dow === 0) return;                                  // Sunday off
      if (mins < 10 * 60 + 30 || mins > 18 * 60 + 30) return; // 10:30–18:30 IST
      if (Math.random() > FIRE_CHANCE) return;                // random timing

      const orgs = await Organization.find({}).select('_id').lean();
      for (const org of orgs) {
        try { await fireRandomPulse(org._id); }
        catch (err) { console.error('[brand-pulse] org failed', (err as Error).message); }
      }
    } catch (err) { console.error('[brand-pulse] tick failed', (err as Error).message); }
  }, 15 * 60_000);
  console.log('[brand-pulse] armed — random asks 10:30–18:30 IST, Mon–Sat');
}
