import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { CmsArticle, CmsMediaRef } from '@/types/cms';

import { AiHintBadges } from './AiHintBadges';

vi.mock('@/features/cms/api', () => ({ setBreaking: vi.fn() }));

const hero = (extra: Partial<CmsMediaRef>): CmsMediaRef => ({
  id: 9, url: '/media/h.webp', alt_te: null, credit: null, width: null, height: null, ...extra,
});

const story = (extra: Partial<CmsArticle> = {}) =>
  ({ id: 42, hero_media_id: 9, hero_media: hero({}), is_breaking: false, breaking_suggested: false, ...extra }) as CmsArticle;

function renderBadges(article: CmsArticle) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AiHintBadges article={article} />
    </QueryClientProvider>,
  );
}

const allow = (breaking: boolean) =>
  act(() => useAuth.setState({ can: (p) => breaking && p === 'article.breaking' }));

describe('AiHintBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
    allow(false);
  });

  it('says a story with no hero needs a photo', () => {
    renderBadges(story({ hero_media_id: null, hero_media: null }));
    expect(screen.getByText('needs photo')).toBeInTheDocument();
  });

  // Each rung of the crawl's photo ladder reads differently to the reviewer.
  it.each([
    [hero({ source_type: 'syndicated', checked: true }), 'no watermark found'],
    [hero({ source_type: 'syndicated', checked: false }), 'not scanned'],
    [hero({ source_type: 'public_domain' }), 'free-licence photo'],
    [hero({ source_type: 'own', ai_generated: true }), 'representative AI picture'],
  ])('names where the hero came from (%#)', (media, label) => {
    renderBadges(story({ hero_media: media }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('says nothing about a desk photo', () => {
    const { container } = renderBadges(story({ hero_media: hero({ source_type: 'own' }) }));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the breaking suggestion without the button to someone who cannot set it', () => {
    renderBadges(story({ breaking_suggested: true }));
    expect(screen.getByText('AI suggests breaking')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark breaking' })).toBeNull();
  });

  it('lets someone with the breaking authority mark it', async () => {
    allow(true);
    vi.mocked(cmsApi.setBreaking).mockResolvedValue(story({ is_breaking: true }));
    renderBadges(story({ breaking_suggested: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark breaking' }));
    await waitFor(() => expect(cmsApi.setBreaking).toHaveBeenCalledWith(42, expect.objectContaining({ minutes: expect.any(Number) })));
    // A mark, never a push: the story has not been approved.
    expect(vi.mocked(cmsApi.setBreaking).mock.lastCall?.[1]).not.toHaveProperty('repush');
  });

  it('drops the suggestion once the story is breaking', () => {
    allow(true);
    renderBadges(story({ breaking_suggested: true, is_breaking: true }));
    expect(screen.queryByText('AI suggests breaking')).toBeNull();
  });
});
