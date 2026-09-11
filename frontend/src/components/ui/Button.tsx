import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { Icon, type LucideIcon } from './Icon';
import { useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Button family — every clickable control that carries a label.
 *
 * - `Button`          native <button>; variants primary/secondary/ghost/danger/link.
 * - `ButtonLink`      same look, renders a router <Link> (or <a> when `external`).
 * - `IconButton`      44/48px square, icon only, `label` is mandatory (aria-label),
 *                     optional `badge` bubble and `pressed` (aria-pressed) state.
 * - `IconButtonLink`  IconButton as a router <Link>.
 *
 * All sizes meet the 44px tap floor (lg = 48). `pending` sets aria-busy +
 * disabled and swaps the icon for a spinner (or adds one when there is no
 * icon) — the label always stays readable.
 *
 *     <Button icon={Save} pending={mutation.isPending}>{t('ui.save')}</Button>
 *     <ButtonLink to="/search" variant="secondary" iconRight={ChevronRight}>…</ButtonLink>
 *     <IconButton icon={Bell} label={t('ui.notifications')} badge={unread} />
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonVisualProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** aria-busy + disabled + spinner in place of the icon. */
  pending?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Stretch to the container width. */
  full?: boolean;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVisualProps {}

const BASE =
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold select-none ' +
  'transition-[colors,transform,box-shadow] duration-base ease-standard active:scale-[.98]';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-dark',
  secondary: 'bg-surface border border-rule text-ink hover:border-brand hover:text-brand',
  ghost: 'text-ink hover:bg-rule-soft',
  danger: 'bg-breaking text-on-brand hover:bg-breaking/90',
  link: 'text-brand underline-offset-4 hover:underline',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-tap min-w-tap px-3 text-ui-sm',
  md: 'min-h-tap min-w-tap px-4 text-ui',
  lg: 'min-h-tap-lg min-w-tap px-5 text-ui',
};

function buttonClass(
  { variant = 'primary', size = 'md', full, pending }: ButtonVisualProps,
  disabled: boolean | undefined,
  className: string | undefined,
  font: string,
): string {
  return cn(
    BASE,
    VARIANT[variant],
    SIZE[size],
    variant === 'link' && 'px-1',
    full && 'w-full',
    (disabled || pending) && 'pointer-events-none opacity-60',
    font,
    className,
  );
}

/** Icon / label / spinner layout shared by Button and ButtonLink. */
function Content({
  icon,
  iconRight,
  pending,
  size = 'md',
  children,
}: Pick<ButtonVisualProps, 'icon' | 'iconRight' | 'pending' | 'size'> & { children?: ReactNode }) {
  const iconSize = size === 'lg' ? 'md' : 'sm';
  const spinner = <Icon icon={Loader2} size={iconSize} className="animate-spin" />;
  // The spinner replaces the leading icon, else the trailing one, else it is
  // added in front — the label is never hidden while the button is busy.
  const leading = icon ? (pending ? spinner : <Icon icon={icon} size={iconSize} />) : pending && !iconRight ? spinner : null;
  return (
    <>
      {leading}
      {children != null && <span>{children}</span>}
      {iconRight && (pending && !icon ? spinner : <Icon icon={iconRight} size={iconSize} />)}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, pending, icon, iconRight, full, className, disabled, type = 'button', children, ...rest },
  ref,
) {
  const s = useScript();
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass({ variant, size, full, pending }, disabled, className, s.body)}
      {...rest}
    >
      <Content icon={icon} iconRight={iconRight} pending={pending} size={size}>
        {children}
      </Content>
    </button>
  );
});

export type ButtonLinkProps = ButtonVisualProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'download'> & {
    to: string;
    /** Plain <a target="_blank"> instead of a router Link. */
    external?: boolean;
    download?: boolean;
  };

export function ButtonLink({
  variant,
  size,
  pending,
  icon,
  iconRight,
  full,
  className,
  to,
  external,
  download,
  children,
  onClick,
  ...rest
}: ButtonLinkProps) {
  const s = useScript();
  const shared = {
    className: buttonClass({ variant, size, full, pending }, undefined, className, s.body),
    'aria-busy': pending || undefined,
    'aria-disabled': pending || undefined,
    // pointer-events-none stops the mouse; these stop Tab + Enter.
    tabIndex: pending ? -1 : undefined,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (pending) {
        e.preventDefault();
        return;
      }
      onClick?.(e);
    },
    download: download || undefined,
    ...rest,
  };
  const content = (
    <Content icon={icon} iconRight={iconRight} pending={pending} size={size}>
      {children}
    </Content>
  );
  return external ? (
    <a href={to} target="_blank" rel="noopener noreferrer" {...shared}>
      {content}
    </a>
  ) : (
    <Link to={to} {...shared}>
      {content}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonVisualProps {
  icon: LucideIcon;
  /** Accessible name — required, there is no visible text. */
  label: string;
  size?: 44 | 48;
  /** Toggle state; renders aria-pressed and the tinted look. */
  pressed?: boolean;
  variant?: Exclude<ButtonVariant, 'link'>;
  /** Count bubble, top-right. Hidden for null / 0 / ''. Numbers over 99 show "99+". */
  badge?: number | string | null;
  iconSize?: 'sm' | 'md' | 'lg';
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, IconButtonVisualProps {}

function iconButtonClass(
  { size = 44, pressed, variant = 'ghost' }: IconButtonVisualProps,
  disabled: boolean | undefined,
  className: string | undefined,
): string {
  return cn(
    BASE,
    'shrink-0 p-0',
    size === 48 ? 'h-tap-lg w-tap-lg' : 'h-tap w-tap',
    VARIANT[variant],
    pressed && (variant === 'ghost' || variant === 'secondary') && 'bg-brand-tint text-brand border-brand',
    disabled && 'pointer-events-none opacity-60',
    className,
  );
}

/** Badge text as rendered, or null when hidden (null / 0 / ''). */
function badgeText(badge: IconButtonVisualProps['badge']): string | null {
  if (badge == null || badge === 0 || badge === '') return null;
  return typeof badge === 'number' && badge > 99 ? '99+' : String(badge);
}

/** Accessible name — the bubble is aria-hidden, so the count rides on the label. */
function iconButtonName(label: string, badge: IconButtonVisualProps['badge']): string {
  const text = badgeText(badge);
  return text === null ? label : `${label} (${text})`;
}

function IconButtonContent({ icon, iconSize = 'md', badge }: Pick<IconButtonVisualProps, 'icon' | 'iconSize' | 'badge'>) {
  const text = badgeText(badge);
  return (
    <>
      <Icon icon={icon} size={iconSize} />
      {text !== null && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-pill bg-breaking px-1 font-sans text-meta font-bold tabular-nums text-on-brand"
        >
          {text}
        </span>
      )}
    </>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size, pressed, variant, badge, iconSize, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-label={iconButtonName(label, badge)}
      title={label}
      aria-pressed={pressed}
      className={iconButtonClass({ icon, label, size, pressed, variant }, disabled, className)}
      {...rest}
    >
      <IconButtonContent icon={icon} iconSize={iconSize} badge={badge} />
    </button>
  );
});

export type IconButtonLinkProps = IconButtonVisualProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    to: string;
    /** Plain <a target="_blank"> instead of a router Link. */
    external?: boolean;
  };

export function IconButtonLink({
  icon,
  label,
  size,
  pressed,
  variant,
  badge,
  iconSize,
  className,
  to,
  external,
  ...rest
}: IconButtonLinkProps) {
  const shared = {
    'aria-label': iconButtonName(label, badge),
    title: label,
    'aria-current': pressed ? ('page' as const) : undefined,
    className: iconButtonClass({ icon, label, size, pressed, variant }, undefined, className),
    ...rest,
  };
  const content = <IconButtonContent icon={icon} iconSize={iconSize} badge={badge} />;
  return external ? (
    <a href={to} target="_blank" rel="noopener noreferrer" {...shared}>
      {content}
    </a>
  ) : (
    <Link to={to} {...shared}>
      {content}
    </Link>
  );
}
