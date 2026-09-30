import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';
import type { ArticleOrigin } from '@/types/cms';

import { OriginCompare } from './OriginCompare';

vi.mock('@/features/cms/api', () => ({ fetchArticleOrigin: vi.fn() }));

const ORIGIN: ArticleOrigin = {
  article_id: 65,
  item_id: 12,
  source: { name: 'TV9 Telugu — AP', slug: 'tv9-ap', licence: 'rss_public', content_policy: 'excerpt_only', url: 'https://tv9.example/story' },
  original: {
    title: 'వారి శీర్షిక', summary: null, author: 'వారి ప్రతినిధి', published_at: null,
    image_url: null, text: 'వారి పాఠ్యం', held: true, fetched_live: false,
  },
  ours: { title_te: 'మా శీర్షిక', summary_te: null, body_plain: 'మా పాఠ్యం', word_count: 110, edited_since_import: false },
  rewrite: {
    title_te: 'మా శీర్షిక', summary_te: null, body_plain: 'మా పాఠ్యం', attribution_te: null,
    similarity_percent: 28, confidence: 0.9, unverified: false,
    engine: 'aimlapi', model: 'google/gemini-3-5-flash-lite', word_count: 110, created_at: '2026-09-11T00:00:00Z',
  },
  ai: null,
  photos: null,
};

/** What the editor has in the form right now — the right column's only source. */
const LIVE = { title: 'మా శీర్షిక', summary: '', body: 'మా పాఠ్యం' };

function renderPanel(ours: typeof LIVE = LIVE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OriginCompare articleId={65} ours={ours} />
    </QueryClientProvider>,
  );
}

/** jsdom does not implement summary's activation behaviour, so open it the way a click would. */
async function open(container: HTMLElement) {
  const details = container.querySelector('details') as HTMLDetailsElement;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  return details;
}

describe('OriginCompare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });

  it('does not ask for the original until the panel is opened', async () => {
    const { container } = renderPanel();
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue(ORIGIN);

    // The endpoint may read the publisher's page live — never on page load.
    expect(cmsApi.fetchArticleOrigin).not.toHaveBeenCalled();

    await open(container);
    await waitFor(() => expect(cmsApi.fetchArticleOrigin).toHaveBeenCalledWith(65));
    expect(await screen.findByText('వారి పాఠ్యం')).toBeInTheDocument();
    expect(screen.getByText('మా పాఠ్యం')).toBeInTheDocument();
    expect(screen.getByText(/similarity 28%/)).toBeInTheDocument();
    expect(screen.getByText(/google\/gemini-3-5-flash-lite/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the original/ })).toHaveAttribute('href', 'https://tv9.example/story');
  });

  // The three states are the whole point: an unexplained column reads as a bug.
  it('says the held copy is what the model saw', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue(ORIGIN);
    const { container } = renderPanel();
    await open(container);
    expect(await screen.findByText('held copy')).toBeInTheDocument();
    expect(screen.getByText(/this is what the model saw/)).toBeInTheDocument();
  });

  it('warns that a live re-read may have changed since the rewrite', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue({
      ...ORIGIN,
      original: { ...ORIGIN.original, held: false, fetched_live: true },
    });
    const { container } = renderPanel();
    await open(container);
    expect(await screen.findByText('read just now')).toBeInTheDocument();
    expect(screen.getByText(/may have edited it since/)).toBeInTheDocument();
  });

  it('sends the reviewer to the publisher when we hold nothing', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue({
      ...ORIGIN,
      original: { ...ORIGIN.original, text: null, held: false, fetched_live: false },
      rewrite: null,
    });
    const { container } = renderPanel();
    await open(container);
    expect(await screen.findByText('not held')).toBeInTheDocument();
    expect(screen.getByText(/open it and read it yourself/)).toBeInTheDocument();
    // No rewrite record is a state, not a blank: SYNDICATED was never rewritten.
    expect(screen.getByText('no rewrite on record')).toBeInTheDocument();
    expect(screen.queryByText(/similarity/)).toBeNull();
  });

  // …but not when there is nowhere to send them: no source URL is why the
  // backend could not fetch in the first place.
  it('does not tell the reviewer to open a page it cannot link to', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue({
      ...ORIGIN,
      source: { ...ORIGIN.source, url: null },
      original: { ...ORIGIN.original, text: null, held: false, fetched_live: false },
    });
    const { container } = renderPanel();
    await open(container);
    expect(await screen.findByText(/check this item in the ingest queue/)).toBeInTheDocument();
    expect(screen.queryByText(/open it and read it yourself/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open the original/ })).toBeNull();
  });

  // The whole point of moving the panel here: the reviewer compares what they
  // are about to approve, not what was last saved.
  it('shows the editor’s unsaved text, not the saved copy', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue(ORIGIN);
    const { container } = renderPanel({ title: 'మా కొత్త శీర్షిక', summary: '', body: 'ఇప్పుడే టైప్ చేసినది' });
    await open(container);
    expect(await screen.findByText('ఇప్పుడే టైప్ చేసినది')).toBeInTheDocument();
    expect(screen.queryByText('మా పాఠ్యం')).toBeNull();
    // Word count follows the live text, not the server's 110.
    expect(screen.getByText(/^3 words/)).toBeInTheDocument();
  });

  it('shows where the AI filed it and what it saw in each photo', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue({
      ...ORIGIN,
      ai: {
        category: { id: 3, name_te: 'రాజకీయం', name_en: 'Politics' },
        subcategory: null,
        district: { id: 7, name_te: 'గుంటూరు', name_en: 'Guntur' },
        mandal: { id: 70, name_te: 'మంగళగిరి', name_en: 'Mangalagiri' },
        tags: [{ name: 'పోలవరం', type: 'place' }],
        breaking: true,
        glyph_warning: true,
      },
      photos: {
        model: 'google/gemini-vision',
        candidates: [
          { url: 'https://tv9.example/a.jpg', verdict: 'watermark', reason: 'channel bug top right' },
          { url: 'https://tv9.example/b.jpg', verdict: 'clean', reason: 'plain street photo' },
        ],
        hero: 'crawled',
      },
    });
    const { container } = renderPanel();
    await open(container);
    expect(await screen.findByText('AI filed it as')).toBeInTheDocument();
    expect(screen.getByText('Politics')).toBeInTheDocument();
    expect(screen.getByText('Mangalagiri')).toBeInTheDocument();
    expect(screen.getByText('పోలవరం')).toBeInTheDocument();
    expect(screen.getByText('place')).toBeInTheDocument();
    expect(screen.getByText('AI suggests breaking')).toBeInTheDocument();
    expect(screen.getByText(/stray foreign letters/)).toBeInTheDocument();

    expect(screen.getByText('Photos checked')).toBeInTheDocument();
    expect(screen.getByText(/one of the publisher’s photos/)).toBeInTheDocument();
    expect(screen.getByText('watermark')).toBeInTheDocument();
    expect(screen.getByText('channel bug top right')).toBeInTheDocument();
    expect(screen.getByText('clean')).toBeInTheDocument();
    expect(container.querySelector('img[src="https://tv9.example/a.jpg"]')).not.toBeNull();
  });

  it('shows no AI sections for a story filed before the AI did', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue(ORIGIN);
    const { container } = renderPanel();
    await open(container);
    expect(await screen.findByText('held copy')).toBeInTheDocument();
    expect(screen.queryByText('AI filed it as')).toBeNull();
    expect(screen.queryByText('Photos checked')).toBeNull();
  });

  it('says so when the body is empty rather than showing a blank column', async () => {
    vi.mocked(cmsApi.fetchArticleOrigin).mockResolvedValue(ORIGIN);
    const { container } = renderPanel({ title: 'మా శీర్షిక', summary: '', body: '' });
    await open(container);
    expect(await screen.findByText('our text is empty')).toBeInTheDocument();
  });
});
