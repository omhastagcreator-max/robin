/**
 * UgcBriefFields — Oct 2026 (owner: "Rishi should enter the details of the
 * client and number of videos required"). Shown in every onboarding form
 * when UGC Videos is selected. The server rejects a UGC onboarding without
 * videos / product / price / requirements, and these values pre-fill the
 * video team's Day-1 brief in the Video SOP.
 */
export interface UgcBrief {
  videos: string; product: string; price: string; offer: string; requirements: string;
  competitors: string; competitorLinks: string; referenceVideo: string; contactName: string; contactPhone: string;
}
export const emptyUgcBrief = (): UgcBrief => ({
  videos: '', product: '', price: '', offer: '', requirements: '', competitors: '', competitorLinks: '', referenceVideo: '', contactName: '', contactPhone: '',
});
export function ugcBriefMissing(b: UgcBrief): string[] {
  const m: string[] = [];
  if (!(Number(b.videos) >= 1)) m.push('number of videos');
  if (!b.product.trim()) m.push('product');
  if (!b.price.trim()) m.push('price');
  if (!b.requirements.trim()) m.push("client's requirements");
  return m;
}

export function UgcBriefFields({ value, onChange }: { value: UgcBrief; onChange: (v: UgcBrief) => void }) {
  const set = (k: keyof UgcBrief) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const cls = 'w-full text-sm px-2.5 py-2 border border-input rounded-lg bg-background';
  const lab = 'block text-[11.5px] font-semibold text-muted-foreground';
  return (
    <div className="border border-rose-500/30 rounded-xl p-3 bg-rose-500/5 space-y-2.5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide">Video brief for the video team</p>
        <p className="text-[11px] text-muted-foreground">Required — this starts the video team's tasks (Day 1 → Day 7) and pre-fills the client meeting brief.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={lab}>Number of videos *<input type="number" min={1} value={value.videos} onChange={set('videos')} placeholder="e.g. 6" className={cls + ' mt-1'} /></label>
        <label className={lab}>Product *<input value={value.product} onChange={set('product')} placeholder="Which product(s)" className={cls + ' mt-1'} /></label>
        <label className={lab}>Price *<input value={value.price} onChange={set('price')} placeholder="e.g. ₹1,499" className={cls + ' mt-1'} /></label>
        <label className={lab}>Offer<input value={value.offer} onChange={set('offer')} placeholder="e.g. Buy 1 get 1" className={cls + ' mt-1'} /></label>
        <label className={lab + ' col-span-2'}>Client's requirements *
          <textarea rows={2} value={value.requirements} onChange={set('requirements')} placeholder="Style, platform (Reels / ads), language, key points, must-avoid" className={cls + ' mt-1 resize-none'} />
        </label>
        <label className={lab}>Competitors<input value={value.competitors} onChange={set('competitors')} placeholder="Brand names" className={cls + ' mt-1'} /></label>
        <label className={lab}>Competitor links<input value={value.competitorLinks} onChange={set('competitorLinks')} placeholder="Websites / Instagram" className={cls + ' mt-1'} /></label>
        <label className={lab}>Reference video<input value={value.referenceVideo} onChange={set('referenceVideo')} placeholder="Link, if the client has one" className={cls + ' mt-1'} /></label>
        <label className={lab}>Client contact (name / WhatsApp)
          <div className="flex gap-1.5 mt-1"><input value={value.contactName} onChange={set('contactName')} placeholder="Name" className={cls} /><input value={value.contactPhone} onChange={set('contactPhone')} placeholder="Number" className={cls} /></div>
        </label>
      </div>
    </div>
  );
}
