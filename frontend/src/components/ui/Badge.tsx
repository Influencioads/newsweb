import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { STATUS_TONES, statusEntry, type StatusRegistry } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Badge — a non-interactive pill: kicker ("బ్రేకింగ్"), label, or status.
 *
 * Tone picks the token pair; size `xs` is the 12.5px chrome floor for dense
 * tables, `sm` the default. Pass `lang` when the text is DB content in a known
 * script (`s.forText(...).lang`) so the font and screen-reader voice follow.
 * For anything clickable use Chip instead — badges are not hit targets.
 *
 *     <Badge tone="breaking">{t('ui.breaking')}</Badge>
 *     <Badge tone="district" size="xs" icon={MapPin} lang="te">{district.name_te}</Badge>
 *     <StatusPill status={article.workflow_state} />
 */
export type BadgeTone =
  | 'brand'
  | 'breaking'
  | 'exclusive'
  | 'ai'
  | 'success'
  | 'info'
  | 'partial'
  | 'muted'
  | 'district';

export type BadgeSize = 'xs' | 'sm';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  /** Script of `children` when it is DB content; defaults to the interface language. */
  lang?: string;
}

const TONE: Record<BadgeTone, string> = {
  brand: 'bg-brand-tint text-brand',
  breaking: 'bg-breaking text-on-brand',
  exclusive: 'bg-exclusive-tint text-exclusive-text border border-exclusive-border',
  ai: 'bg-ai-tint text-ai-text border border-ai-border',
  success: 'bg-success-tint text-success',
  info: 'bg-info-tint text-info',
  partial: 'bg-partial-tint text-partial',
  muted: 'bg-rule-soft text-muted',
  district: 'bg-paper-sub text-ink-soft',
};

const SIZE: Record<BadgeSize, string> = {
  xs: 'text-meta px-2 py-0.5 gap-1',
  sm: 'text-ui-sm px-2.5 py-1 gap-1.5',
};

export function Badge({ tone = 'muted', size = 'sm', icon, children, className, lang }: BadgeProps) {
  const s = useScript();
  const telugu = lang ? lang.startsWith('te') : s.te; // BCP-47 subtags (te-IN) count too
  return (
    <span
      lang={lang}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-pill font-semibold',
        telugu ? 'te' : 'font-sans',
        TONE[tone],
        SIZE[size],
        className,
      )}
    >
      {icon ? <Icon icon={icon} size="xs" /> : null}
      {children}
    </span>
  );
}

export interface StatusPillProps {
  status: string;
  /** Domain registry (BULLETIN_STATUS, KYC_STATUS, …); defaults to the merged STATUS_TONES. */
  registry?: StatusRegistry;
  size?: BadgeSize;
  className?: string;
}

/**
 * StatusPill — Badge driven by the status registry in features/cms/status.ts.
 * Unknown statuses render muted with the raw value so nothing is ever blank.
 */
export function StatusPill({ status, registry = STATUS_TONES, size = 'xs', className }: StatusPillProps) {
  const { language } = useI18n();
  const entry = statusEntry(status, registry);
  if (!entry) {
    return (
      <Badge tone="muted" size={size} lang="en" className={className}>
        {status.replaceAll('_', ' ')}
      </Badge>
    );
  }
  return (
    <Badge tone={entry.tone} size={size} lang={language} className={className}>
      {language === 'te' ? entry.te : entry.en}
    </Badge>
  );
}
