import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { prefersReducedMotion } from '@/utils/motion';

/**
 * Tabs — a WAI-ARIA tablist with one sliding underline.
 *
 *     <Tabs
 *       ariaLabel={t('ui.sections')}
 *       items={[{ key: 'all', label: t('ui.showAll'), count: 12 }, …]}
 *       value={tab}
 *       onChange={setTab}
 *     />
 *
 * Arrow keys / Home / End move and select (roving tabindex). The indicator is
 * measured with a ResizeObserver and only starts animating after first paint.
 * Panels are the caller's; pair them with `aria-labelledby`/`role="tabpanel"`.
 */

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
  icon?: LucideIcon;
  /** Script of the label when it is DB content; chrome labels inherit the UI language. */
  lang?: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md';
  ariaLabel: string;
  className?: string;
  /** Horizontal scroll instead of squeezing when the rail overflows. */
  scrollable?: boolean;
}

interface Indicator {
  left: number;
  width: number;
}

export function Tabs({ items, value, onChange, size = 'md', ariaLabel, className, scrollable }: TabsProps) {
  const s = useScript();
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [animate, setAnimate] = useState(false);
  // A stale `value` (filter that no longer exists) must not leave the tablist unreachable.
  const active = items.some((it) => it.key === value) ? value : items[0]?.key;

  // Measure the active tab before paint, and again whenever it or the rail resizes.
  useLayoutEffect(() => {
    const el = active === undefined ? undefined : tabRefs.current.get(active);
    const list = listRef.current;
    if (!el || !list) {
      setIndicator(null);
      return;
    }
    const measure = () => setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    measure();
    // Scroll the rail only (never the page — scrollIntoView would also move the
    // window), and only when the tab is actually out of view.
    if (scrollable) {
      const from = list.scrollLeft;
      const width = list.clientWidth;
      if (el.offsetLeft < from || el.offsetLeft + el.offsetWidth > from + width) {
        list.scrollTo({
          left: el.offsetLeft - (width - el.offsetWidth) / 2,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      }
    }
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(list);
    return () => ro.disconnect();
  }, [active, items, scrollable]);

  // Transitions switch on only after the first measurement has painted.
  useEffect(() => {
    if (indicator) setAnimate(true);
  }, [indicator]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((it) => it.key === active);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    const item = next === null ? undefined : items[next];
    if (!item) return;
    e.preventDefault();
    onChange(item.key);
    tabRefs.current.get(item.key)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex border-b border-rule',
        // py-1 keeps the 2px focus outline inside the scroll box (overflow-x clips y too).
        scrollable && 'overflow-x-auto no-scrollbar py-1',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.key === active;
        const telugu = item.lang ? item.lang.startsWith('te') : s.te;
        return (
          <button
            key={item.key}
            ref={(el) => {
              if (el) tabRefs.current.set(item.key, el);
              else tabRefs.current.delete(item.key);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cn(
              'flex min-h-tap shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold',
              'transition-[colors,transform,box-shadow] duration-base ease-standard active:scale-[.98]',
              size === 'sm' ? 'px-3' : 'px-4',
              telugu ? 'te text-te-body-xs' : cn('font-sans', size === 'sm' ? 'text-ui-sm' : 'text-ui'),
              selected ? 'text-brand' : 'text-muted hover:text-ink',
            )}
          >
            {item.icon && <Icon icon={item.icon} size="sm" />}
            <span lang={item.lang}>{item.label}</span>
            {item.count !== undefined && (
              <Badge tone={selected ? 'brand' : 'muted'} size="xs" lang="en" className="tabular-nums">
                {item.count}
              </Badge>
            )}
          </button>
        );
      })}
      {indicator && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-0 h-0.5 rounded-pill bg-brand',
            animate && 'transition-[left,width] duration-base ease-emphasized',
          )}
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
