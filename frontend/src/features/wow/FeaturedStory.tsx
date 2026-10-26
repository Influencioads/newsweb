import { Link } from 'react-router-dom';
import { ArrowRight, Flame } from 'lucide-react';

import { GridCard } from '@/components/article/ArticleCard';
import { ShareButton } from '@/components/article/ShareSheet';
import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * Featured Story (pitch §2): a large 16:9 visual banner with a compelling
 * Telugu headline, its category, and Read / Share actions. On a desktop the
 * picture and the copy sit side by side so the banner stays wide without
 * pushing everything else below the fold; on a phone they stack.
 */
export function FeaturedStory({ article }: { article: ArticleCard }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const head = s.text(article.title_te, article.title_en);

  return (
    <article
      aria-labelledby="featured-story"
      className="grid overflow-hidden rounded-2xl border border-rule bg-surface lg:grid-cols-[1.45fr_1fr]"
    >
      <Link to={article.url} tabIndex={-1} aria-hidden className="block">
        <NewsImage
          media={article.hero}
          ratio="16/9"
          radius="none"
          priority
          sizes="(max-width: 1024px) 100vw, 720px"
        />
      </Link>
      <div className="flex min-w-0 flex-col justify-center gap-3 p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(s.body, 'rounded-pill bg-wow-deep px-3 py-0.5 text-meta font-bold text-on-wow')}>
            {te ? 'ఫీచర్డ్ స్టోరీ' : 'Featured Story'}
          </span>
          {article.category ? (
            <span className={cn(s.body, 'rounded-pill bg-brand-tint px-3 py-0.5 text-meta font-semibold text-brand')}>
              {s.pick(article.category.name_te, article.category.name_en)}
            </span>
          ) : null}
        </div>
        <h1 id="featured-story" lang={head.lang} className={cn(head.head, 'text-headline-lg font-bold text-ink md:text-headline-xl')}>
          <Link to={article.url} className="hover:text-brand">
            {head.text}
          </Link>
        </h1>
        {article.summary_te ? (
          <p lang="te" className="te te-clamp-3 text-te-body-sm text-ink-soft">
            {article.summary_te}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ButtonLink to={article.url} variant="primary" iconRight={ArrowRight}>
            {te ? 'చదవండి' : 'Read'}
          </ButtonLink>
          <ShareButton
            shortId={article.short_id}
            url={article.url}
            title={head.text}
            cardAvailable={false}
            variant="button"
          />
        </div>
      </div>
    </article>
  );
}

/** Trending articles (pitch §5): four cards and a link to the full list. */
export function TrendingArticles({ articles }: { articles: ArticleCard[] }) {
  const { language } = useI18n();
  if (!articles.length) return null;
  return (
    <section aria-labelledby="trending-articles">
      <SectionHeader
        title={
          <span id="trending-articles" className="inline-flex items-center gap-1.5">
            <Icon icon={Flame} size="md" className="text-wow-deep" />
            {language === 'te' ? 'ట్రెండింగ్ కథనాలు' : 'Trending Articles'}
          </span>
        }
        to="/trending"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {articles.slice(0, 4).map((article) => (
          <GridCard key={article.short_id} article={article} />
        ))}
      </div>
    </section>
  );
}
