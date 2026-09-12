import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Pencil, Search } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { WorkflowPill } from '@/components/admin/StatusPill';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { IconButtonLink } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleType, CmsArticle } from '@/types/cms';
import { cn } from '@/utils/cn';
import { relativeTime } from '@/utils/time';

import { WorkflowActions } from './Articles';
import { useL } from './useL';

/**
 * §7 / §25 — one queue for everything awaiting a decision.
 *
 * Desk copy, reader submissions and AI drafts previously lived in three
 * different screens, which made "what is waiting on me?" an unanswerable
 * question. Here they share a list and are separated by §23's article type;
 * the workflow transitions (with confirmation on reject) are the same ones
 * the Articles list offers.
 */

const TYPES: Array<{ key: ArticleType | ''; te: string; en: string }> = [
  { key: '', te: 'అన్నీ', en: 'All' },
  { key: 'NORMAL', te: 'డెస్క్', en: 'Desk' },
  { key: 'REPORTER', te: 'రిపోర్టర్', en: 'Reporter' },
  { key: 'USER_SUBMITTED', te: 'పాఠకులు', en: 'Reader' },
  { key: 'AI_DRAFT', te: 'AI', en: 'AI' },
  { key: 'BREAKING_NEWS', te: 'బ్రేకింగ్', en: 'Breaking' },
];

const TYPE_TONE: Record<string, BadgeTone> = {
  NORMAL: 'district',
  REPORTER: 'district',
  USER_SUBMITTED: 'partial',
  AI_SUGGESTED: 'ai',
  AI_DRAFT: 'ai',
  BREAKING_NEWS: 'breaking',
};

export default function PendingArticlesPage() {
  const { language, t, pick } = useI18n();
  const s = useScript();
  const en = language === 'en';
  const L = useL();
  const navigate = useNavigate();
  const [type, setType] = useState<ArticleType | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [fromDate, setFromDate] = useState('');

  // Debounce the headline box (as Articles does) so a query is not fired per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });
  const queue = useQuery({
    queryKey: ['cms', 'pending', type, q, categoryId, districtId, fromDate],
    queryFn: () =>
      cmsApi.fetchPendingArticles({
        article_type: type || undefined,
        search: q || undefined,
        category_id: categoryId || undefined,
        district_id: districtId || undefined,
        from_date: fromDate ? new Date(fromDate).toISOString() : undefined,
        limit: 100,
      }),
  });

  const districts = options.data?.districts ?? [];
  const categories = options.data?.categories ?? [];
  /** Bilingual taxonomy name with the Telugu fallback, tagged with the script actually shown. */
  const nameCell = (row: { name_te: string; name_en: string | null } | undefined) => {
    if (!row) return '—';
    const n = s.text(row.name_te, row.name_en);
    return (
      <span lang={n.lang} className={n.cls}>
        {n.text}
      </span>
    );
  };

  const columns: DataTableColumn<CmsArticle>[] = [
    {
      key: 'title',
      header: L('శీర్షిక', 'Headline'),
      render: (a) => {
        const title = s.text(a.title_te, a.title_en);
        return (
          <>
            <Link
              to={`/admin/articles/${a.id}/edit`}
              lang={title.lang}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                title.cls,
                'block font-semibold text-ink transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand',
                title.telugu && 'text-te-body-sm',
              )}
            >
              {title.text}
            </Link>
            <span lang="en" className="mt-0.5 block font-mono text-meta text-muted">
              {a.short_id}
            </span>
          </>
        );
      },
    },
    {
      key: 'source',
      header: L('మూలం', 'Source'),
      nowrap: true,
      render: (a) => (
        <Badge tone={TYPE_TONE[a.article_type] ?? 'muted'} size="xs" lang="en">
          {a.article_type.replace('_', ' ')}
        </Badge>
      ),
    },
    { key: 'category', header: L('విభాగం', 'Category'), hideBelow: 'lg', render: (a) => nameCell(categories.find((c) => c.id === a.category_id)) },
    { key: 'district', header: L('జిల్లా', 'District'), hideBelow: 'lg', render: (a) => nameCell(districts.find((d) => d.id === a.district_id)) },
    { key: 'state', header: L('స్థితి', 'State'), nowrap: true, render: (a) => <WorkflowPill status={a.workflow_state} /> },
    {
      key: 'since',
      header: L('ఎప్పటినుంచి', 'Waiting since'),
      hideBelow: 'md',
      nowrap: true,
      render: (a) => (
        <time dateTime={a.updated_at} title={new Date(a.updated_at).toLocaleString('en-IN')} className="text-muted">
          {relativeTime(a.updated_at, language)}
        </time>
      ),
    },
  ];

  return (
    <AdminPage
      title={t('admin.page.pending')}
      subtitle={L('ఏది తయారు చేసినా — సమీక్ష కోసం ఎదురుచూస్తున్న అన్ని కథనాలు.', 'Everything awaiting review, whatever produced it.')}
    >
      <div className="space-y-3">
        <ChipRail ariaLabel={L('మూలం', 'Source')}>
          {TYPES.map((item) => (
            <Chip key={item.key || 'all'} selected={type === item.key} onClick={() => setType(item.key)}>
              {en ? item.en : item.te}
            </Chip>
          ))}
        </ChipRail>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            type="search"
            leading={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L('శీర్షిక లేదా ఐడీ', 'Search headline or ID')}
            aria-label={t('ui.search')}
          />
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={L('విభాగం', 'Category')}>
            <option value="">{L('ఏ విభాగమైనా', 'Any category')}</option>
            {categories
              .filter((c) => c.parent_id == null)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.name_te, c.name_en)}
                </option>
              ))}
          </Select>
          <Select value={districtId} onChange={(e) => setDistrictId(e.target.value)} aria-label={L('జిల్లా', 'District')}>
            <option value="">{L('ఏ జిల్లా అయినా', 'Any district')}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {pick(d.name_te, d.name_en)}
              </option>
            ))}
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label={L('ఎప్పటినుంచి', 'Waiting since')} />
        </div>
      </div>

      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : (
        <DataTable
          rows={queue.data?.articles ?? []}
          columns={columns}
          rowKey={(a) => a.id}
          loading={queue.isLoading}
          caption={t('admin.page.pending')}
          onRowClick={(a) => navigate(`/admin/articles/${a.id}/edit`)}
          empty={<EmptyState icon={CheckCircle2} title={L('ఏమీ పెండింగ్‌లో లేదు.', 'Nothing waiting.')} compact />}
          rowActions={(a) => (
            <>
              <WorkflowActions article={a} />
              <IconButtonLink to={`/admin/articles/${a.id}/edit`} icon={Pencil} label={t('ui.edit')} />
            </>
          )}
        />
      )}
    </AdminPage>
  );
}
