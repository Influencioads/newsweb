import { useEffect } from 'react';

import type { ArticleDetail } from '@/types/public';

/**
 * §10.3 — NewsArticle JSON-LD on every article page.
 *
 * Lifted out of ArticlePage unchanged except for one thing: the document title
 * is now `useDocumentTitle`'s job, so this hook only owns the structured data.
 */
export function useNewsArticleJsonLd(article: ArticleDetail | undefined): void {
  useEffect(() => {
    if (!article) return;
    const id = 'newsarticle-jsonld';
    document.getElementById(id)?.remove();

    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      // §10.3 — headline in the language the page is serving.
      headline: article.title_en || article.title_te,
      alternativeHeadline: article.title_en ? article.title_te : undefined,
      description: article.summary_te ?? undefined,
      inLanguage: 'te',
      datePublished: article.published_at ?? undefined,
      dateModified: article.updated_at ?? article.published_at ?? undefined,
      articleSection: article.category?.name_en ?? undefined,
      author: article.author
        ? {
            '@type': 'Person',
            name: article.author.name_te,
            url: article.author.author_slug
              ? `${window.location.origin}/author/${article.author.author_slug}`
              : undefined,
          }
        : undefined,
      publisher: {
        '@type': 'NewsMediaOrganization',
        name: 'టాప్ తెలుగు న్యూస్',
      },
      image: article.hero?.url ? [article.hero.url] : undefined,
      mainEntityOfPage: window.location.href,
    });
    document.head.appendChild(script);

    return () => document.getElementById(id)?.remove();
  }, [article]);
}
