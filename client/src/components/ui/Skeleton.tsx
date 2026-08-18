/**
 * <Skeleton /> — loading placeholder. Robin's backend (Render free tier)
 * can take ~50s to wake from a cold start, so a blank page or a lone
 * spinner reads as "broken." A skeleton that mimics the shape of the
 * content that's about to arrive keeps the page feeling alive and
 * communicates "this is loading," not "this crashed."
 *
 * Use <Skeleton.Row /> / <Skeleton.Card /> for common shapes instead of
 * hand-rolling `animate-pulse` divs per page.
 */

interface Props {
  className?: string;
}

export function Skeleton({ className = '' }: Props) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

Skeleton.Row = function SkeletonRow({ count = 1 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-9 px-3 flex items-center gap-2.5 border-b border-border last:border-b-0">
          <Skeleton className="h-6 w-6 rounded-full shrink-0" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-16 ml-auto" />
        </div>
      ))}
    </>
  );
};

Skeleton.Card = function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-12 rounded-full ml-auto" />
      </div>
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-1.5 w-full rounded-full" />
    </div>
  );
};
