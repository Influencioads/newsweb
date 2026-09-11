import type { LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Icon — the single way to render a lucide glyph in the app.
 *
 * Fixes the size ladder (xs 14 / sm 16 / md 20 / lg 24) and stroke (1.75) so
 * icons look identical everywhere, and handles the a11y contract: decorative by
 * default (`aria-hidden`), or an image with a name when `label` is given.
 *
 *     <Icon icon={ChevronRight} size="sm" />
 *     <Icon icon={Bell} label={t('ui.notifications')} />
 */
export type { LucideIcon };

export type IconSize = 'xs' | 'sm' | 'md' | 'lg';

export interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** Accessible name. Omit for decorative icons (they get `aria-hidden`). */
  label?: string;
  className?: string;
  strokeWidth?: number;
}

const SIZE_PX: Record<IconSize, number> = { xs: 14, sm: 16, md: 20, lg: 24 };

export function Icon({ icon: Glyph, size = 'md', label, className, strokeWidth = 1.75 }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <Glyph
      size={SIZE_PX[size]}
      strokeWidth={strokeWidth}
      focusable="false"
      className={cn('shrink-0', className)}
      {...a11y}
    />
  );
}
