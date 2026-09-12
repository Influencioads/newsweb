import { BookOpen, Download, FilePlus2, Newspaper, Radio, Share2 } from 'lucide-react';

import { API_BASE } from '@/api/client';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useI18n, useScript } from '@/i18n';
import type { EpaperTeaser } from '@/types/public';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/time';

/**
 * E-paper promo panel on the home page — the dark card that sells the two
 * ways to consume today's edition (read it, hear it) plus the share, PDF and
 * "make your own" paths.
 *
 * Every control is a 44px Button/ButtonLink on the ink surface (`inverse` is
 * the ghost look on a constant-dark panel), and every label comes from the
 * string table: this block used to be the only English-only surface on the
 * page.
 */
export function EpaperPromo({ epaper }: { epaper: EpaperTeaser }) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const date = epaper.pub_date;
  const ghost = 'border border-on-ink/30';

  /** Native share where it exists, clipboard everywhere else. */
  async function share(): Promise<void> {
    const url = `${window.location.origin}/epaper/${date}/page/1`;
    // `navigator.share` is typed as always present, so the capability is probed
    // through a boolean — testing it inline would narrow the else branch away.
    const canNative = 'share' in navigator;
    if (canNative) {
      try {
        await navigator.share({ title: t('epaper.promoToday'), url });
      } catch {
        // The reader dismissed the share sheet; nothing to report.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('ui.copied'));
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <Card tone="ink" padding="lg" className="rounded-2xl">
      <p
        className={cn(
          'flex items-center gap-2 font-semibold text-muted-inverse',
          s.te ? 'te text-meta' : 'font-sans text-eyebrow uppercase',
        )}
      >
        <Icon icon={Newspaper} size="sm" />
        {t('epaper.promoEyebrow')}
      </p>
      <h2 className={cn(s.head, 'mt-2 text-headline-lg font-extrabold text-on-ink')}>{t('epaper.promoTitle')}</h2>
      <p className="mt-2 text-meta text-muted-inverse">
        <span className="font-sans tabular-nums">{formatDate(date, language)}</span>
        <span aria-hidden> · </span>
        <span className={cn(s.body, 'tabular-nums')}>
          {epaper.page_count} {t('ui.pages')}
        </span>
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink to={`/epaper/${date}`} icon={BookOpen}>
          {t('epaper.read')}
        </ButtonLink>
        <ButtonLink to={`/epaper/${date}#radio`} variant="inverse" icon={Radio} className={ghost}>
          {t('epaper.listen')}
        </ButtonLink>
        <Button variant="inverse" icon={Share2} onClick={() => void share()} className={ghost}>
          {t('epaper.sharePage')}
        </Button>
        <ButtonLink
          to={`${API_BASE}/epaper/${date}/pdf`}
          external
          download
          variant="inverse"
          icon={Download}
          className={ghost}
        >
          {t('epaper.download')}
        </ButtonLink>
        <ButtonLink to="/my-epaper" variant="inverse" icon={FilePlus2} className={ghost}>
          {t('epaper.createMine')}
        </ButtonLink>
      </div>
    </Card>
  );
}
