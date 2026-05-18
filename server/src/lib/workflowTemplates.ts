/**
 * Workflow templates — default SOPs per service type.
 *
 * Each entry defines:
 *   - label, icon, color for the UI
 *   - team: which `team` slug the responsible employee belongs to (used
 *     to auto-pick an assignee when the workflow is created)
 *   - dependsOn: this service can't START until those services are 'done'.
 *     Empty = can start immediately, parallel with other independent ones.
 *   - checklist: ordered SOP items the assigned employee ticks off
 *
 * These are intentionally hardcoded for now — the agency owner can edit
 * this file as a code change, and we can layer a per-org override in
 * MongoDB later without breaking anything that depends on the schema.
 *
 * AI hook: the checklist + dependency graph here is the same shape that
 * an AI orchestrator would need to schedule work. When we add automation
 * later, it reads from this file too.
 */

export type ServiceType =
  | 'website_new'        // build new website
  | 'website_edit'       // edit existing site
  | 'website_handoff'    // share params, client builds it
  | 'meta_ads'
  | 'google_ads'
  | 'influencer'
  | 'ugc_video'
  | 'content'
  | 'design';

export interface ServiceTemplate {
  label:        string;
  shortLabel:   string;     // 1-2 words for compact UI
  team:         string;     // matches USER_TEAMS in client/src/lib/enums.ts
  dependsOn:    ServiceType[];
  checklist:    string[];   // ordered SOP items
  color:        'blue' | 'pink' | 'purple' | 'teal' | 'emerald' | 'amber' | 'orange' | 'rose' | 'indigo' | 'slate';
}

export const SERVICE_TEMPLATES: Record<ServiceType, ServiceTemplate> = {
  website_new: {
    label: 'New Website Build',
    shortLabel: 'Website',
    team: 'dev',
    dependsOn: [],
    color: 'emerald',
    checklist: [
      'Kickoff call with client + scope confirmed',
      'Wireframes drafted and approved',
      'Design mockups approved',
      'Frontend built and reviewed',
      'Backend / CMS integration done',
      'Content uploaded',
      'SEO basics (titles, meta, sitemap, robots)',
      'Mobile + cross-browser tested',
      'Domain + SSL configured',
      'Launched and client trained',
    ],
  },
  website_edit: {
    label: 'Website Edits',
    shortLabel: 'Web edits',
    team: 'dev',
    dependsOn: [],
    color: 'emerald',
    checklist: [
      'Edit list received from client',
      'Estimate shared and approved',
      'Edits implemented on staging',
      'Client review and feedback',
      'Pushed to production',
      'Post-launch QA',
    ],
  },
  website_handoff: {
    label: 'Website Parameters Only',
    shortLabel: 'Site brief',
    team: 'dev',
    dependsOn: [],
    color: 'slate',
    checklist: [
      'Pixel ID + GA4 credentials handed over',
      'Conversion events documented',
      'UTM convention shared',
      'Tracking spec PDF sent',
      'Client confirms they have what they need',
    ],
  },
  meta_ads: {
    label: 'Meta Ads',
    shortLabel: 'Meta',
    team: 'meta',
    // Meta needs the site / pixel to be set up before campaigns can run.
    dependsOn: ['website_new', 'website_edit', 'website_handoff'],
    color: 'blue',
    checklist: [
      'Ad account access + Pixel verified',
      'Conversion API set up (if applicable)',
      'Campaign structure planned + approved',
      'Creatives received (or briefed for UGC)',
      'First campaigns built and launched',
      'Day-1 spend + delivery sanity check',
      'Weekly reporting cadence agreed',
    ],
  },
  google_ads: {
    label: 'Google Ads',
    shortLabel: 'Google Ads',
    team: 'ads',
    dependsOn: ['website_new', 'website_edit', 'website_handoff'],
    color: 'pink',
    checklist: [
      'Account access + conversion tracking verified',
      'Keyword research done',
      'Ad groups + copy approved',
      'Campaigns launched',
      'Negative keywords seeded',
      'Weekly reporting cadence agreed',
    ],
  },
  influencer: {
    label: 'Influencer Marketing',
    shortLabel: 'Influencer',
    team: 'influencer',
    // Independent of dev — can start in parallel.
    dependsOn: [],
    color: 'amber',
    checklist: [
      'Brand brief locked',
      'Shortlist of influencers shared',
      'Influencers selected + contracts',
      'Content brief + props shipped',
      'Drafts received + approved',
      'Content posted',
      'Reach + engagement report shared',
    ],
  },
  ugc_video: {
    label: 'UGC Videos',
    shortLabel: 'UGC',
    team: 'content',
    dependsOn: [],
    color: 'purple',
    checklist: [
      'Hook + script directions agreed',
      'Talent assigned',
      'Drafts recorded',
      'Edits + variations done',
      'Final videos delivered',
      'Ad-ready variants exported',
    ],
  },
  content: {
    label: 'Content / Social',
    shortLabel: 'Content',
    team: 'content',
    dependsOn: [],
    color: 'purple',
    checklist: [
      'Content calendar approved',
      'Captions + creatives drafted',
      'Approved by client',
      'Scheduled or posted',
      'Engagement responded to',
    ],
  },
  design: {
    label: 'Design',
    shortLabel: 'Design',
    team: 'design',
    dependsOn: [],
    color: 'teal',
    checklist: [
      'Brief received',
      'First drafts shared',
      'Revisions integrated',
      'Final files delivered',
    ],
  },
};

export const SERVICE_TYPES = Object.keys(SERVICE_TEMPLATES) as ServiceType[];

/**
 * Returns the ServiceTypes a given service depends on, expanded to only
 * include those that are actually present in the workflow.
 */
export function blockingServices(
  serviceType: ServiceType,
  presentTypes: ServiceType[],
): ServiceType[] {
  const tpl = SERVICE_TEMPLATES[serviceType];
  if (!tpl) return [];
  return tpl.dependsOn.filter(d => presentTypes.includes(d));
}
