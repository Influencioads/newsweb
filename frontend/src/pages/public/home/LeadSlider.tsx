import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { LeadCard } from '@/components/article/ArticleCard';
import { IconButton } from '@/components/ui/Button';
import { useI18n } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';
import { prefersReducedMotion } from '@/utils/motion';

const ADVANCE_MS = 6000;

/** Scroll the track to slide `i`, wrapping at both ends. */
function slideTo(track: HTMLElement | null, i: number, count: number) {
  if (!track) return;
  const left = (((i % count) + count) % count) * track.clientWidth;
  track.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** Move `by` slides from where the track actually is — read from the DOM, not
 * from state, which lags a scroll event behind. */
function slideBy(track: HTMLElement | null, by: number, count: number) {
  if (track) slideTo(track, Math.round(track.scrollLeft / track.clientWidth) + by, count);
}

/**
 * The home page's first story, as a slider of the top stories (lead first).
 *
 * Native scroll-snap does the swiping; the arrows and dots only scroll the
 * track, and the slide shown is read back from the scroll position, so a
 * swipe and a click never disagree. It moves on by itself every 6 s — never
 * under reduced motion, and never while the reader's pointer or focus is in it.
 */
export function LeadSlider({ articles }: { articles: ArticleCard[] }) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [held, setHeld] = useState(false);
  const count = articles.length;

  useEffect(() => {
    if (held || count < 2 || prefersReducedMotion()) return;
    const id = window.setTimeout(() => slideBy(track.current, 1, count), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [shown, held, count]);

  if (!articles[0]) return null;
  if (count < 2) return <LeadCard article={articles[0]} featured />;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('home.topStories')}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
      }}
    >
      <div
        ref={track}
        onScroll={(e) => setShown(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto pb-1"
      >
        {articles.map((article, i) => (
          <div
            key={article.short_id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${count}`}
            className="grid w-full shrink-0 snap-start"
          >
            <LeadCard article={article} featured priority={i === 0} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-2">
        <IconButton icon={ChevronLeft} label={t('ui.previous')} variant="secondary" iconSize="sm" onClick={() => slideBy(track.current, -1, count)} />
        <div className="flex items-center">
          {articles.map((article, i) => (
            <button
              key={article.short_id}
              type="button"
              aria-label={`${i + 1} / ${count}`}
              aria-current={i === shown ? 'true' : undefined}
              onClick={() => slideTo(track.current, i, count)}
              className="flex min-h-tap items-center px-1.5"
            >
              <span
                aria-hidden
                className={cn(
                  'block h-2 rounded-pill transition-all duration-base ease-standard',
                  i === shown ? 'w-6 bg-brand' : 'w-2 bg-rule-strong',
                )}
              />
            </button>
          ))}
        </div>
        <IconButton icon={ChevronRight} label={t('ui.next')} variant="secondary" iconSize="sm" onClick={() => slideBy(track.current, 1, count)} />
      </div>
    </section>
  );
}
