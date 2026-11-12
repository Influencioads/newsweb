import { Mail } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { useSiteContent } from './siteContent';

/** Categories whose readers write to the My Village / Local Hero address. */
export const COMMUNITY_CATEGORIES = new Set(['my-village-story', 'local-hero']);

/**
 * "Write to us" with the right address, set in CMS → Site content → Contact:
 * `community` (info@) on My Village and Local Hero, `general` (contact@) on
 * the category pages.
 */
export function ContactEmail({ kind, className }: { kind: 'community' | 'general'; className?: string }) {
  const { language } = useI18n();
  const s = useScript();
  const { contact } = useSiteContent();
  const email = kind === 'community' ? contact.community_email : contact.contact_email;
  if (!email) return null;
  const te = language === 'te';
  return (
    <p className={cn(s.body, 'flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted', className)}>
      <Icon icon={Mail} size="sm" />
      <span>
        {kind === 'community'
          ? te
            ? 'మీ ఊరి కథ లేదా లోకల్ హీరో గురించి మాకు రాయండి:'
            : 'Write to us about your village or a local hero:'
          : te
            ? 'ఈ విభాగం గురించి సంప్రదించండి:'
            : 'Contact us about this section:'}
      </span>
      <a href={`mailto:${email}`} lang="en" className="font-sans font-semibold text-brand underline-offset-2 hover:underline">
        {email}
      </a>
    </p>
  );
}
