/**
 * Workflow templates — lean SOPs for the three services Hastag Creator
 * actually delivers.
 *
 *   1. shopify    — Shopify store build / setup. Most clients run on Shopify;
 *                   the rare custom-dev exception can be handled as a one-off.
 *   2. meta_ads   — Meta (Facebook + Instagram) ad management. Three stages:
 *                   account setup → awareness → sales.
 *   3. influencer — Influencer marketing. Four stages: find influencer →
 *                   ship product → finalise script → deliver videos.
 *
 * Dependency rules:
 *   - meta_ads can start once shopify is done (or the client confirms their
 *     own store + Pixel is ready — captured as a single checklist item
 *     rather than a separate service).
 *   - influencer is independent — runs in parallel with everything.
 *
 * Admin can override the label or checklist per-org via the SopOverride
 * model. These defaults ship out of the box.
 *
 * AI hook: same {team, dependsOn, checklist} shape so an orchestrator can
 * later auto-progress, summarise, or flag stalled services.
 */

export type ServiceType = 'shopify' | 'meta_ads' | 'influencer';

export interface ServiceTemplate {
  label:        string;
  shortLabel:   string;
  team:         string;
  dependsOn:    ServiceType[];
  checklist:    string[];
  color:        'blue' | 'pink' | 'purple' | 'teal' | 'emerald' | 'amber' | 'orange' | 'rose' | 'indigo' | 'slate';
}

export const SERVICE_TEMPLATES: Record<ServiceType, ServiceTemplate> = {
  shopify: {
    label: 'Shopify Store',
    shortLabel: 'Shopify',
    team: 'dev',
    dependsOn: [],
    color: 'emerald',
    checklist: [
      'Kickoff call — scope, products, theme, timeline',
      'Theme installed and brand colours/fonts applied',
      'Products + variants uploaded with images and copy',
      'Payment + shipping configured',
      'Pixel + GA4 installed and firing',
      'Test order placed end-to-end',
      'Store handed over to client',
    ],
  },
  meta_ads: {
    label: 'Meta Ads',
    shortLabel: 'Meta Ads',
    team: 'meta',
    // Shopify (or the equivalent handoff) needs to be done first so the
    // Pixel and product catalogue are ready.
    dependsOn: ['shopify'],
    color: 'blue',
    checklist: [
      'Account set up — BM access + Pixel verified',
      'Awareness — top-of-funnel campaigns live, audience built',
      'Sales — conversion campaigns live, tracking confirmed',
      'Weekly reporting cadence agreed',
    ],
  },
  influencer: {
    label: 'Influencer Marketing',
    shortLabel: 'Influencer',
    team: 'influencer',
    // Runs in parallel — doesn't wait for Shopify or Meta.
    dependsOn: [],
    color: 'amber',
    checklist: [
      'Find influencer — shortlist shared and one selected',
      'Product shipped to influencer',
      'Script finalised with influencer',
      'Videos delivered to client',
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
