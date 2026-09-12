import type { ReactNode } from 'react';

import { PageContainer, PageHeader, type PageContainerProps } from '@/components/ui/Layout';
import { useDocumentTitle } from '@/utils/motion';

/**
 * AdminPage — the root of every CMS screen: container + PageHeader (h1) +
 * document title. The AdminLayout topbar already carries the breadcrumb
 * (group › page), so pages do not render a second one. Children are
 * separated by the section rhythm: 28px mobile / 40px desktop.
 *
 *     <AdminPage title={t('admin.page.articles')} actions={<ButtonLink to="/admin/articles/new" …/>}>
 *       <DataTable … />
 *     </AdminPage>
 */
export interface AdminPageProps {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  width?: Exclude<PageContainerProps['width'], 'article'>;
  titleLang?: 'te' | 'en';
  children?: ReactNode;
}

export function AdminPage({ title, subtitle, eyebrow, actions, width = 'site', titleLang, children }: AdminPageProps) {
  useDocumentTitle(`${title} · CMS`);
  return (
    <PageContainer width={width} className="py-6 md:py-8">
      <PageHeader title={title} subtitle={subtitle} eyebrow={eyebrow} actions={actions} titleLang={titleLang} />
      <div className="space-y-7 md:space-y-10">{children}</div>
    </PageContainer>
  );
}
