import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { IconButton } from './Button';
import { Icon, type LucideIcon } from './Icon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { prefersReducedMotion } from '@/utils/motion';

/**
 * Chip — a pill-shaped filter / category token, and ChipRail — the horizontal
 * strip that holds a row of them.
 *
 * - `Chip`     44px pill; `as` picks <button> (aria-pressed), router <Link>
 *              (aria-current) or a plain <span>. `size="sm"` (36px) is ONLY
 *              honoured for `as="span"` — interactive chips never go below the
 *              tap floor. Pass `lang` for DB content (category names) so the
 *              font follows the text's script instead of the UI language.
 * - `ChipRail` overflow-x strip with snap, fading edges and edge-aware
 *              prev/next arrows (hover-capable pointers only, hidden at the
 *              ends). Arrow labels come from `ui.scrollLeft` / `ui.scrollRight`.
 *
 *     <ChipRail ariaLabel={t('ui.sections')}>
 *       <Chip selected={!active} onClick={() => setActive('')}>{t('ui.showAll')}</Chip>
 *       {tabs.map((tab) => (
 *         <Chip key={tab.slug} as="link" to={`/section/${tab.slug}`} {...s.forText(tab.name_te, tab.name_en)}>
 *           {pick(tab.name_te, tab.name_en)}
 *         </Chip>
 *       ))}
 *     </ChipRail>
 */
export interface ChipProps {
  selected?: boolean;
  /** `sm` = 36px, non-interactive (`as="span"`) only; interactive chips are always 44px. */
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  count?: number;
  as?: 'button' | 'link' | 'span';
  /** Route for `as="link"`. */
  to?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
  className?: string;
  /** Script of the label when it is DB content; defaults to the UI language. */
  lang?: string;
  disabled?: boolean;
}

const CHIP_BASE =
  'inline-flex shrink-0 snap-start items-center justify-center gap-1.5 whitespace-nowrap rounded-pill border ' +
  'text-ui-sm font-semibold select-none transition-[colors,transform,box-shadow] duration-base ease-standard';

export function Chip({
  selected = false,
  size = 'md',
  icon,
  count,
  as = 'button',
  to,
  onClick,
  children,
  className,
  lang,
  disabled,
}: ChipProps) {
  const s = useScript();
  const interactive = as !== 'span';
  const compact = !interactive && size === 'sm';
  const font = lang ? (lang.startsWith('te') ? 'te' : 'font-sans') : s.body;

  const cls = cn(
    CHIP_BASE,
    compact ? 'min-h-9 px-3' : 'min-h-tap min-w-tap px-4',
    selected ? 'border-brand bg-brand text-on-brand' : 'border-rule bg-surface text-ink',
    interactive && 'active:scale-[.98]',
    interactive && (selected ? 'hover:bg-brand-dark' : 'hover:border-brand hover:text-brand'),
    disabled && 'pointer-events-none opacity-60',
    font,
    className,
  );

  const content = (
    <>
      {icon && <Icon icon={icon} size="sm" />}
      <span>{children}</span>
      {count != null && (
        <span
          className={cn(
            'inline-flex min-w-5 items-center justify-center rounded-pill px-1.5 font-sans text-meta tabular-nums',
            selected ? 'bg-on-brand/20 text-on-brand' : 'bg-rule-soft text-muted',
          )}
        >
          {count}
        </span>
      )}
    </>
  );

  if (as === 'link' && to) {
    return (
      <Link
        to={to}
        lang={lang}
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        className={cls}
      >
        {content}
      </Link>
    );
  }
  if (as === 'span') {
    return (
      <span lang={lang} className={cls}>
        {content}
      </span>
    );
  }
  return (
    <button type="button" lang={lang} onClick={onClick} aria-pressed={selected} disabled={disabled} className={cls}>
      {content}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ChipRail
// ---------------------------------------------------------------------------

export interface ChipRailProps {
  /** Accessible name of the strip (it renders as role="group"). */
  ariaLabel: string;
  /** Scroll-snap chips to the leading edge. */
  snap?: boolean;
  /** Mask the edges when the strip overflows. */
  fadeEdges?: boolean;
  children: ReactNode;
  className?: string;
  /** Tailwind gap utility between chips; default `gap-2`. */
  itemGap?: string;
}

const EDGE_SLOP = 2;

export function ChipRail({ ariaLabel, snap = true, fadeEdges = true, children, className, itemGap }: ChipRailProps) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const prevBtn = useRef<HTMLButtonElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  // Direction of a keyboard-activated arrow that will vanish at the edge it
  // scrolls to, so focus can be handed to the opposite arrow (see below).
  const refocus = useRef<-1 | 1 | 0>(0);
  // start && end = nothing to scroll; also the SSR / pre-measure state.
  const [edges, setEdges] = useState({ start: true, end: true });
  const [hoverable] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  );

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const start = el.scrollLeft <= EDGE_SLOP;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - EDGE_SLOP;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = track.current;
    const content = inner.current;
    if (!el || !content) return;
    measure();
    // The arrows must disappear at the ends, so they follow the scroll
    // position; the ResizeObserver catches font loads and late-arriving chips.
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(content);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure]);

  // The arrow that reaches an edge unmounts; if it held focus, hand focus to the
  // other arrow once the edge state has flipped (the unmount is already done by
  // the time any effect runs, so the intent is recorded here in `nudge`).
  useEffect(() => {
    const dir = refocus.current;
    if (!dir) return;
    const gone = dir === 1 ? edges.end : edges.start;
    if (!gone) return;
    refocus.current = 0;
    (dir === 1 ? prevBtn.current : nextBtn.current)?.focus();
  }, [edges]);

  function nudge(direction: -1 | 1) {
    const el = track.current;
    if (!el) return;
    const step = direction * el.clientWidth * 0.8;
    const max = el.scrollWidth - el.clientWidth;
    const target = Math.min(max, Math.max(0, el.scrollLeft + step));
    const hitsEdge = direction === 1 ? target >= max - EDGE_SLOP : target <= EDGE_SLOP;
    const btn = direction === 1 ? nextBtn.current : prevBtn.current;
    refocus.current = hitsEdge && btn !== null && document.activeElement === btn ? direction : 0;
    el.scrollBy({ left: step, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  const overflowing = !(edges.start && edges.end);
  const arrows = hoverable && overflowing;
  const arrowCls = 'absolute top-1/2 z-10 -translate-y-1/2 shadow-card';

  return (
    <div className={cn('relative', className)}>
      <div
        ref={track}
        role="group"
        aria-label={ariaLabel}
        className={cn(
          'no-scrollbar scroll-touch overflow-x-auto',
          snap && 'snap-x',
          fadeEdges && overflowing && 'fade-edges',
        )}
      >
        {/* w-max so the inner box is as wide as its chips; its resize = content change. */}
        <div ref={inner} className={cn('flex w-max p-1', itemGap ?? 'gap-2')}>
          {children}
        </div>
      </div>

      {arrows && !edges.start && (
        <IconButton
          ref={prevBtn}
          icon={ChevronLeft}
          label={t('ui.scrollLeft')}
          variant="secondary"
          onClick={() => nudge(-1)}
          className={cn(arrowCls, 'left-0')}
        />
      )}
      {arrows && !edges.end && (
        <IconButton
          ref={nextBtn}
          icon={ChevronRight}
          label={t('ui.scrollRight')}
          variant="secondary"
          onClick={() => nudge(1)}
          className={cn(arrowCls, 'right-0')}
        />
      )}
    </div>
  );
}
