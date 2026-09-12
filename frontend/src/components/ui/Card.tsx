import { forwardRef, type ElementType, type HTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

/**
 * Card — the one bordered surface for grouped content (article tiles, panels,
 * settings groups, admin tables).
 *
 *     <Card padding="md">…</Card>
 *     <Card as="article" interactive tone="paper">…</Card>   // hover lift + focus-within ring
 *     <Card tone="ink">…</Card>                              // constant-dark promo panel
 *
 * `padding="none"` when the card carries its own edge-to-edge media.
 */
export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render; defaults to `div`. */
  as?: ElementType;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Corner radius. `cn` is plain clsx, so a `rounded-2xl` className cannot beat
   * the base `rounded-xl` — ask for the larger radius here instead.
   */
  radius?: 'xl' | '2xl';
  /** Hover lift, press feedback and a focus-within ring for cards that wrap a link. */
  interactive?: boolean;
  tone?: 'surface' | 'paper' | 'warm' | 'ink';
}

const PADDING: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 md:p-5',
  lg: 'p-5 md:p-6',
};

const TONE: Record<NonNullable<CardProps['tone']>, string> = {
  surface: 'border-rule bg-surface text-ink',
  paper: 'border-rule bg-paper text-ink',
  warm: 'border-rule bg-paper-warm text-ink',
  // border-transparent: `border-ink` would flip to near-white in dark mode while bg-ink stays deep.
  ink: 'border-transparent bg-ink text-on-ink',
};

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as: Tag = 'div', padding = 'md', radius = 'xl', interactive = false, tone = 'surface', className, ...rest },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cn(
        radius === '2xl' ? 'rounded-2xl' : 'rounded-xl',
        'border shadow-card',
        TONE[tone],
        PADDING[padding],
        interactive &&
          'transition-[colors,transform,box-shadow] duration-base ease-standard hover:-translate-y-0.5 hover:shadow-raised focus-within:ring-2 focus-within:ring-brand/20 active:scale-[.98]',
        className,
      )}
      {...rest}
    />
  );
});
