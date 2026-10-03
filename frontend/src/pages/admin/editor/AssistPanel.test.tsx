import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';

import { AssistPanel, type AssistPanelProps } from './AssistPanel';

vi.mock('@/features/cms/api', () => ({ aiAssist: vi.fn(), aiHeadlines: vi.fn() }));

const handlers = () => ({
  onTitle: vi.fn(),
  onSummary: vi.fn(),
  onCategorySlug: vi.fn(),
  onTags: vi.fn(),
  onSeo: vi.fn(),
});

function renderPanel(props: Partial<AssistPanelProps> = {}) {
  const h = { ...handlers(), ...props };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssistPanel title="పాత శీర్షిక" body="కథనం పాఠ్యం" summary="సారాంశం" {...h} />
    </QueryClientProvider>,
  );
  return h;
}

const HOOK = 'రైతులకు సాయం.. ఎవరికి, ఎప్పటి నుంచంటే?';

const IDEAS = {
  available: true,
  engine: 'aimlapi',
  story_type: 'governance',
  options: [
    { text: 'రైతులకు రూ.5 వేల సాయం విడుదల', device: 'straight', label_te: '' },
    { text: HOOK, device: 'withheld_answer', label_te: 'దాచిన జవాబు (…ఎప్పుడంటే?)' },
  ],
  seo_title: 'రైతు సాయం: రూ.5 వేలు విడుదల',
  seo_description: 'రాష్ట్ర ప్రభుత్వం రైతులకు రూ.5 వేల సాయం విడుదల చేసింది. ఖాతాల్లో జమ వచ్చే వారం.',
};

describe('AssistPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });

  it('lists headline ideas with their device and applies one to the title', async () => {
    vi.mocked(cmsApi.aiHeadlines).mockResolvedValue(IDEAS);
    const h = renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Headline ideas' }));

    // The form's live text goes up, standfirst included: numbers are checked against it.
    expect(cmsApi.aiHeadlines).toHaveBeenCalledWith({ title_te: 'పాత శీర్షిక', body_plain: 'కథనం పాఠ్యం', summary_te: 'సారాంశం' });
    expect(await screen.findByText(HOOK)).toHaveAttribute('lang', 'te');
    expect(screen.getByText('దాచిన జవాబు (…ఎప్పుడంటే?)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `Apply: ${HOOK}` }));
    expect(h.onTitle).toHaveBeenCalledWith(HOOK);

    await userEvent.click(screen.getByRole('button', { name: 'Apply SEO' }));
    expect(h.onSeo).toHaveBeenCalledWith({ seo_title: IDEAS.seo_title, seo_description: IDEAS.seo_description });
  });

  it('shows why there are no ideas when AI is off', async () => {
    vi.mocked(cmsApi.aiHeadlines).mockResolvedValue({ available: false, reason: 'AI writing is switched off in settings.' });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Headline ideas' }));

    expect(await screen.findByText('AI writing is switched off in settings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument();
  });

  it('renders the house-style checklist from assist, block and warn apart', async () => {
    vi.mocked(cmsApi.aiAssist).mockResolvedValue({
      engine: 'heuristic',
      duplicates: [],
      suggested_tags: [],
      suggested_category: null,
      summary_te: '',
      seo: { seo_title: '', seo_description: '' },
      story_type: 'crime',
      style_issues: [
        { code: 'headline_too_long', severity: 'block', message: 'Headline is 112 characters; the limit is 100.' },
        { code: 'latin_heavy', severity: 'warn', message: 'Too many English words: 6 per 100 (limit 1.5).' },
      ],
    });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Get suggestions' }));

    await waitFor(() => expect(screen.getByText('Style check:')).toBeInTheDocument());
    expect(screen.getByText('Headline is 112 characters; the limit is 100.')).toHaveClass('text-breaking');
    expect(screen.getByText('Too many English words: 6 per 100 (limit 1.5).')).toHaveClass('text-partial');
    expect(screen.getByText('Must fix')).toBeInTheDocument();
    expect(screen.getByText('Check')).toBeInTheDocument();
  });
});
