import { AppLayout } from '@/components/AppLayout';
import { IncentivesStrip } from '@/components/shared/IncentivesStrip';

/** Oct 2026 — dedicated sidebar tab for team incentives (always expanded). */
export default function IncentivesPage() {
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-3 p-4">
        <h1 className="text-lg font-semibold">Incentives</h1>
        <p className="text-[12px] text-muted-foreground">Who earned what this month. Visible to the whole team{''}.</p>
        <IncentivesStrip defaultOpen />
      </div>
    </AppLayout>
  );
}
