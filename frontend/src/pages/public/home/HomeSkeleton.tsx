import { Skeleton, SkeletonCard } from '@/components/ui/State';

/**
 * Loading stand-in for the home page. It mirrors the real layout — chip rail,
 * then the lead / mid-column / rail grid — so nothing jumps when the payload
 * lands. Rendered through `QueryState`, which owns the `aria-busy` wrapper and
 * the polite "loading" status.
 *
 * No e-paper promo band: Home renders that only when the edition actually has
 * an e-paper, so reserving it here collapsed the band on every edition that
 * does not.
 */
export function HomeSkeleton() {
  return (
    <div className="space-y-7 md:space-y-10">
      {/* Trending chip rail. */}
      <div className="flex h-tap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="block" className="h-full w-32 rounded-pill" />
        ))}
      </div>

      {/* Front-page grid: lead + secondary | mid column | latest rail. */}
      <div className="grid gap-x-7 gap-y-7 lg:grid-cols-[1.5fr_1fr_0.8fr]">
        <div className="flex flex-col gap-4">
          <SkeletonCard variant="lead" />
          <SkeletonCard variant="row" />
          <SkeletonCard variant="row" />
        </div>
        <div className="flex flex-col gap-5">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} variant="compact" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} variant="compact" />
          ))}
        </div>
      </div>
    </div>
  );
}
