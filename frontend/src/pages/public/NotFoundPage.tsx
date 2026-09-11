import { Home, SearchX } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { PageContainer } from '@/components/ui/Layout';
import { EmptyState } from '@/components/ui/State';
import { useI18n } from '@/i18n';
import { useDocumentTitle } from '@/utils/motion';

/** 404 — the catch-all route. Sits inside PublicLayout so it keeps the site chrome. */
export default function NotFoundPage() {
  const { t } = useI18n();
  useDocumentTitle(t('page.notFound'));
  return (
    <PageContainer width="form" className="py-8 md:py-12">
      <EmptyState
        icon={SearchX}
        headingLevel={1}
        title={t('state.notFound')}
        body={t('state.notFoundBody')}
        action={
          <ButtonLink to="/" icon={Home}>
            {t('state.goHome')}
          </ButtonLink>
        }
      />
    </PageContainer>
  );
}
