import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { inputClass } from '@/components/admin/FormControls';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { ArticleType } from '@/types/cms';

/**
 * §7 / §25 — one queue for everything awaiting a decision.
 *
 * Desk copy, reader submissions and AI drafts previously lived in three
 * different screens, which made "what is waiting on me?" an unanswerable
 * question. Here they share a list and are separated by §23's article type.
 */

const TYPES: Array<{ key: ArticleType | ''; te: string; en: string }> = [
  { key: '', te: 'అన్నీ', en: 'All' },
  { key: 'NORMAL', te: 'డెస్క్', en: 'Desk' },
  { key: 'REPORTER', te: 'రిపోర్టర్', en: 'Reporter' },
  { key: 'USER_SUBMITTED', te: 'పాఠకులు', en: 'Reader' },
  { key: 'AI_DRAFT', te: 'AI', en: 'AI' },
  { key: 'BREAKING_NEWS', te: 'బ్రేకింగ్', en: 'Breaking' },
];

const TYPE_TONE: Record<string, string> = {
  NORMAL: 'bg-canvas text-ink-soft',
  REPORTER: 'bg-canvas text-ink-soft',
  USER_SUBMITTED: 'bg-partial/15 text-partial',
  AI_SUGGESTED: 'bg-ai-tint text-ai',
  AI_DRAFT: 'bg-ai-tint text-ai',
  BREAKING_NEWS: 'bg-breaking-tint text-breaking',
};

export default function PendingArticlesPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const [type, setType] = useState<ArticleType | ''>('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [fromDate, setFromDate] = useState('');

  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });
  const queue = useQuery({
    queryKey: ['cms', 'pending', type, search, categoryId, districtId, fromDate],
    queryFn: () => cmsApi.fetchPendingArticles({
      article_type: type || undefined,
      search: search || undefined,
      category_id: categoryId || undefined,
      district_id: districtId || undefined,
      from_date: fromDate ? new Date(fromDate).toISOString() : undefined,
      limit: 100,
    }),
  });

  const districts = options.data?.districts ?? [];
  const categories = options.data?.categories ?? [];
  const districtName = (id: number | null) =>
    districts.find((d) => d.id === id)?.[en ? 'name_en' : 'name_te'] ?? '—';
  const categoryName = (id: number | null) =>
    categories.find((c) => c.id === id)?.[en ? 'name_en' : 'name_te'] ?? '—';

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <h1 className="th text-[25px] font-extrabold text-ink">
          {en ? 'Pending articles' : 'పెండింగ్ కథనాలు'}
        </h1>
        <p className="te mt-1 text-[12px] text-muted">
          {en
            ? 'Everything awaiting review, whatever produced it.'
            : 'ఏది తయారు చేసినా — సమీక్ష కోసం ఎదురుచూస్తున్న అన్ని కథనాలు.'}
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button key={t.key || 'all'} type="button" onClick={() => setType(t.key)}
            aria-pressed={type === t.key}
            className={`te min-h-[32px] rounded-chip border px-3 text-[12.5px] font-semibold ${
              type === t.key ? 'border-brand bg-brand text-white' : 'border-rule bg-white text-ink dark:bg-surface'
            }`}>
            {en ? t.en : t.te}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={en ? 'Search headline or ID' : 'శీర్షిక లేదా ఐడీ'} className={inputClass} />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          <option value="">{en ? 'Any category' : 'ఏ విభాగమైనా'}</option>
          {categories.filter((c) => c.parent_id == null).map((c) => (
            <option key={c.id} value={c.id}>{en ? c.name_en : c.name_te}</option>
          ))}
        </select>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={inputClass}>
          <option value="">{en ? 'Any district' : 'ఏ జిల్లా అయినా'}</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>{en ? d.name_en : d.name_te}</option>
          ))}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputClass} />
      </div>

      <div className="overflow-x-auto rounded-card border border-rule bg-white shadow-card dark:bg-surface">
        <table className="w-full min-w-[820px] text-left">
          <thead className="bg-paper font-sans text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2.5">{en ? 'Headline' : 'శీర్షిక'}</th>
              <th className="px-3 py-2.5">{en ? 'Source' : 'మూలం'}</th>
              <th className="px-3 py-2.5">{en ? 'Category' : 'విభాగం'}</th>
              <th className="px-3 py-2.5">{en ? 'District' : 'జిల్లా'}</th>
              <th className="px-3 py-2.5">{en ? 'State' : 'స్థితి'}</th>
              <th className="px-3 py-2.5">{en ? 'Waiting since' : 'ఎప్పటినుంచి'}</th>
            </tr>
          </thead>
          <tbody>
            {(queue.data?.articles ?? []).map((a) => (
              <tr key={a.id} className="border-t border-rule-soft">
                <td className="max-w-[360px] px-3 py-3">
                  <Link to={`/admin/articles/${a.id}/edit`} className="te text-[13.5px] font-semibold text-ink hover:text-brand">
                    {a.title_te}
                  </Link>
                  <span className="ml-1.5 font-mono text-[10.5px] text-muted">{a.short_id}</span>
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-chip px-2 py-0.5 font-sans text-[10.5px] font-bold ${TYPE_TONE[a.article_type] ?? ''}`}>
                    {a.article_type.replace('_', ' ')}
                  </span>
                </td>
                <td className="te px-3 py-3 text-[12.5px] text-ink-soft">{categoryName(a.category_id)}</td>
                <td className="te px-3 py-3 text-[12.5px] text-ink-soft">{districtName(a.district_id)}</td>
                <td className="px-3 py-3 font-sans text-[11.5px] text-muted">{a.workflow_state}</td>
                <td className="px-3 py-3 font-sans text-[11.5px] text-muted">
                  {new Date(a.updated_at).toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {queue.isLoading ? <p className="te p-6 text-center text-muted">{en ? 'Loading…' : 'లోడ్ అవుతోంది…'}</p> : null}
        {queue.data && queue.data.articles.length === 0 ? (
          <p className="te p-6 text-center text-muted">{en ? 'Nothing waiting. ✓' : 'ఏమీ పెండింగ్‌లో లేదు. ✓'}</p>
        ) : null}
      </div>
    </main>
  );
}
