import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Dot, Pause, Play, Zap } from 'lucide-react';

import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * BreakingTicker — the red band under the nav (not sticky). Polls the cached
 * breaking endpoint every 25 s (§10.1) and renders nothing when it is empty.
 *
 * The track holds two visual copies so the loop is seamless; the second is
 * aria-hidden with its links out of the tab order, so a keyboard user meets
 * each headline once. Speed is ~70 px/s from the measured width (never under
 * 20 s a lap). Pause/Play toggles `.marquee-paused`; hover pauses via CSS.
 * Keyboard focus and reduced motion drop the animation and let `.marquee-clip`
 * scroll instead, so every headline stays reachable (index.css).
 */

const PX_PER_SECOND = 70;
const MIN_DURATION = 20;

export function BreakingTicker() {
  const { t, pick } = useI18n();
  const s = useScript();
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(40);
  const track = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['public', 'breaking'],
    queryFn: publicApi.fetchBreaking,
    refetchInterval: 25_000,
    staleTime: 20_000,
  });
  const items = data ?? [];

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    // One lap = half the track (two copies).
    const fit = () => setDuration(Math.max(MIN_DURATION, el.offsetWidth / 2 / PX_PER_SECOND));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  if (!items.length) return null;

  const copy = (hidden: boolean) =>
    items.map((item) => {
      const f = s.forText(item.title_te, item.title_en);
      return (
        <span key={item.short_id} className="flex items-center">
          <Link
            to={item.url}
            lang={f.lang}
            tabIndex={hidden ? -1 : undefined}
            className={cn(
              f.cls,
              'flex min-h-tap items-center font-medium hover:underline focus-visible:outline-on-brand',
              f.telugu ? 'text-te-body-xs' : 'text-ui',
            )}
          >
            {pick(item.title_te, item.title_en)}
          </Link>
          <Icon icon={Dot} size="md" className="mx-1 text-on-brand/70" />
        </span>
      );
    });

  return (
    <div className={cn('bg-breaking text-on-brand', paused && 'marquee-paused')}>
      <PageContainer width="site" className="flex items-center gap-2">
        <span
          className={cn(
            s.body,
            'flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill bg-brand-deep px-3 text-ui-sm font-bold',
          )}
        >
          <Icon icon={Zap} size="sm" />
          {t('home.breaking')}
        </span>

        {/* Pause comes before the headlines in DOM order (WCAG 2.2.2: reachable
            without tabbing through every link) and `order-last` keeps it at
            the right edge. Label + icon swap with the state; no aria-pressed,
            so it never reads "Play ticker, pressed". */}
        <IconButton
          icon={paused ? Play : Pause}
          label={paused ? t('ui.tickerPlay') : t('ui.tickerPause')}
          variant="inverse"
          onClick={() => setPaused((p) => !p)}
          className="order-last"
        />

        {/* .marquee-clip clips while animating and becomes a scroll container
            on focus-within / reduced motion (index.css). */}
        <div aria-live="off" className="marquee-clip no-scrollbar scroll-touch min-w-0 flex-1">
          <div
            ref={track}
            className="animate-marquee items-center"
            style={{ '--marquee-duration': `${duration}s` } as CSSProperties}
          >
            <div className="flex items-center">{copy(false)}</div>
            <div aria-hidden className="flex items-center">
              {copy(true)}
            </div>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
