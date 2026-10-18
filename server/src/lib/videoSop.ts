/**
 * videoSop.ts — Oct 2026. The UGC / Video SOP ("VIDEO SOP - 12 OCT 2026"
 * sheet from the owner), encoded as data so it is enforced, not just
 * written down. Every new brand with a UGC Videos ('influencer') service
 * gets a VideoSopRun that walks these checkpoints in order.
 *
 * Clock: "Day N" in the sheet = startedAt + N × 24h (the sheet itself talks
 * in hours: "max 24hrs", "script in first 48 hrs", "shipping in first 72hr").
 *
 * Rules from the sheet, and where each lives:
 *   · every step marked by the assigned video-team person ...... controller (assignee-only)
 *   · strictly in order ........................................ controller (previous step must be done)
 *   · not done in time → reason from a dropdown, max 24h grace .. graceHours + LATE_REASONS
 *   · "notification at all stages: normal, aggressive, hyper" ... jobs/videoSopCron.ts
 *   · shipping to creators within first 72h, final grace as the
 *     last option, note for "third-world" reasons (product not
 *     launched / in manufacturing / delivery not possible) ...... step 'shipping'
 *   · final script max Day 3, no script after product shipped ... 'script_final' comes before 'shipping'
 *   · first video within 24h of Day 3 ........................... 'first_draft' due Day 4
 *   · final video in client group on Day 6 ...................... 'final_delivery' (Day 7 = last grace)
 *   · whole SOP inside Day 1 → Day 7; creator selection Day 2, grace to Day 3 (owner, 18 Oct)
 *
 * Changing the SOP later = edit this file. Step keys are stored on each
 * run, so renaming a title or item is safe; adding/removing items only
 * affects runs started after the change.
 */

export interface SopItem {
  text: string;
  /** Highlighted in the UI (orange row in the sheet). */
  important?: boolean;
}

export interface SopStepDef {
  key: string;
  /** Sheet grouping — STEP-1 … STEP-4. */
  phase: 1 | 2 | 3 | 4;
  title: string;
  /** Short line shown under the title. */
  hint: string;
  /** Deadline = startedAt + dueHours. */
  dueHours: number;
  /** Extra window after the deadline before the step counts as MISSED. 0 = hard deadline. */
  graceHours: number;
  /** Steps that must be done before this one can be marked (Day-2 work runs in parallel). */
  after: string[];
  items: SopItem[];
  /** Proof link required to complete (script doc, video link…). */
  linkLabel?: string;
  /** Free-text field label (e.g. courier / AWB for shipping). */
  noteLabel?: string;
  /** Step 1 captures the client brief as fields instead of tick-boxes. */
  briefFields?: boolean;
}

/**
 * Client brief. Sales (Rishi) fills these at onboarding — they pre-fill the
 * video team's Day-1 brief, which the video person confirms in the meeting.
 */
export const BRIEF_FIELDS: { key: string; label: string; required: boolean; placeholder: string; salesRequired?: boolean }[] = [
  { key: 'videos',          label: 'Number of videos',            required: true,  salesRequired: true, placeholder: 'e.g. 6' },
  { key: 'product',         label: 'Product',                     required: true,  salesRequired: true, placeholder: 'Which product(s) the videos are for' },
  { key: 'price',           label: 'Price',                       required: true,  salesRequired: true, placeholder: 'e.g. ₹1,499' },
  { key: 'offer',           label: 'Offer',                       required: true,  placeholder: 'e.g. Buy 1 get 1, 20% off launch' },
  { key: 'requirements',    label: "Client's requirements",       required: true,  salesRequired: true, placeholder: 'Style, platform (Reels/Ads), language, talking points, must-avoid' },
  { key: 'competitors',     label: 'Competitors',                 required: true,  placeholder: 'Brand names' },
  { key: 'competitorLinks', label: "Competitors' website links",  required: true,  placeholder: 'One link per line' },
  { key: 'referenceVideo',  label: 'Reference video (if any)',    required: false, placeholder: 'Link — leave blank if the client has none' },
];

/*
 * Timeline (owner, 18 Oct 2026 — everything inside Day 1 → Day 7):
 *   Day 1      client meeting · product USP · requirements fully understood · research
 *   Day 2      Draft-1 script (+ client changes the same day) · creator selection (grace → Day 3)
 *   Day 3 max  final script · script to creator · product shipped within 72h (final grace → Day 4)
 *   Day 3 → 4  first video within 24h of Day 3
 *   Day 6      edits done · final video in the video + brand group (last-option grace → Day 7)
 */
export const SOP_STEPS: SopStepDef[] = [
  {
    key: 'brief', phase: 1, title: 'Client meeting',
    hint: 'Day 1 · decide what they want, discuss the product USP, understand every requirement',
    dueHours: 24, graceHours: 0, after: [], briefFields: true,
    items: [
      { text: 'Meeting done with the client' },
      { text: 'Product USP discussed with the client', important: true },
      { text: "Client's requirements fully understood (videos, style, platform, language)", important: true },
    ],
  },
  {
    key: 'research', phase: 2, title: 'Research',
    hint: 'Day 1 · max 24h, reason needed if late',
    dueHours: 24, graceHours: 24, after: ['brief'],
    items: [
      { text: 'Shipping details shared to brand', important: true },
      { text: 'Proven hooks collected' },
      { text: "Competitors' videos searched" },
      { text: 'USP for videos — confirmed with the client too' },
    ],
  },
  {
    key: 'creator', phase: 2, title: 'Creator selection & finalisation',
    hint: 'Day 2 · grace up to Day 3 (reason needed if late)',
    dueHours: 48, graceHours: 24, after: ['research'],
    items: [
      { text: 'Creators shortlisted' },
      { text: 'Creator(s) finalised and confirmed' },
      { text: "Creators' shipping addresses collected" },
    ],
  },
  {
    key: 'script_d1', phase: 3, title: 'Script — Draft 1',
    hint: 'Day 2 · script in the first 48h, client changes on Day 2 too',
    dueHours: 48, graceHours: 24, after: ['research'],
    items: [
      { text: 'Draft 1 written' },
      { text: 'Reference hook attached with script' },
      { text: 'Reference CTA attached with script' },
      { text: 'Client changes on Draft 1 done (Day 2)' },
    ],
    linkLabel: 'Draft 1 script link',
  },
  {
    key: 'script_final', phase: 3, title: 'Script — Draft 2 (final)',
    hint: 'Day 3 max · no script changes after the product ships',
    dueHours: 72, graceHours: 0, after: ['script_d1'],
    items: [
      { text: 'Final script approved by the client' },
      { text: 'Reference hook attached with script' },
      { text: 'Reference CTA attached with script' },
    ],
    linkLabel: 'Final script link',
  },
  {
    key: 'script_sent', phase: 3, title: 'Script sent to creator',
    hint: 'Day 3',
    dueHours: 72, graceHours: 0, after: ['script_final', 'creator'],
    items: [{ text: 'Final script shared with every creator' }],
  },
  {
    key: 'shipping', phase: 3, title: 'Product shipped to creators',
    hint: 'Within 72h · final grace is the last option',
    dueHours: 72, graceHours: 24, after: ['script_final', 'creator'],
    items: [
      { text: 'Product dispatched to every creator', important: true },
    ],
    noteLabel: 'Courier / tracking (AWB) details',
  },
  {
    key: 'first_draft', phase: 4, title: '1st video draft received',
    hint: 'Day 3 → videos must start coming in the first 24h',
    dueHours: 96, graceHours: 24, after: ['script_sent', 'shipping'],
    items: [{ text: 'First video draft received from creator' }],
    linkLabel: '1st draft video link',
  },
  {
    key: 'edits', phase: 4, title: 'Video finalised & corrections done',
    hint: 'After the 1st draft · before Day 6',
    dueHours: 144, graceHours: 0, after: ['first_draft'],
    items: [
      { text: 'Corrections shared with creator / editor' },
      { text: 'Edited video checked and approved internally' },
    ],
  },
  {
    key: 'final_delivery', phase: 4, title: 'Final video in client group',
    hint: 'Day 6 · video + brand group · Day 7 is the last-option grace',
    dueHours: 144, graceHours: 24, after: ['edits'],
    items: [{ text: 'Final draft posted in the video + brand WhatsApp group' }],
    linkLabel: 'Final video link',
  },
];

export const SOP_STEP_BY_KEY = new Map(SOP_STEPS.map(s => [s.key, s]));

/** Dropdown reasons when a step is completed after its deadline. */
export const LATE_REASONS: { key: string; label: string }[] = [
  { key: 'client_delay',        label: 'Client delayed inputs / approval' },
  { key: 'client_changes',      label: 'Client asked for extra changes' },
  { key: 'creator_unavailable', label: 'Creator unavailable / backed out' },
  { key: 'product_not_launched', label: 'Product not launched yet' },
  { key: 'in_manufacturing',    label: 'Product still in manufacturing' },
  { key: 'delivery_not_possible', label: 'Delivery not possible to creator location' },
  { key: 'courier_delay',       label: 'Courier / shipping delay' },
  { key: 'internal_workload',   label: 'Internal workload / team delay' },
  { key: 'other',               label: 'Other — write the reason' },
];
export const LATE_REASON_KEYS = new Set(LATE_REASONS.map(r => r.key));

/** Checkpoints mirrored onto the brand's existing UGC service checklist (default template). */
export const SERVICE_CHECKLIST_SYNC: Record<string, number> = {
  creator: 0,         // 'Find influencer — shortlist shared and one selected'
  shipping: 1,        // 'Product shipped to influencer'
  script_final: 2,    // 'Script finalised with influencer'
  final_delivery: 3,  // 'Videos delivered to client'
};

/** SOP applies automatically to brands onboarded on/after this date (the sheet's date). */
export const SOP_EFFECTIVE_FROM = new Date('2026-10-12T00:00:00+05:30');

export const HOUR = 3_600_000;
