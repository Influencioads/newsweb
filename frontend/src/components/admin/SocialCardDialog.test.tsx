import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';

import { SocialCardDialog } from './SocialCardDialog';

vi.mock('@/features/cms/api', () => ({
  socialCardText: vi.fn(),
  makeSocialCard: vi.fn(),
}));

function renderDialog(props: { title?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SocialCardDialog
        open
        onClose={() => {}}
        articleId={42}
        title={props.title ?? 'అసెంబ్లీలో బడ్జెట్'}
        summary="రాష్ట్ర బడ్జెట్ ప్రవేశపెట్టారు."
        hasHero
        categoryName="రాజకీయం"
      />
    </QueryClientProvider>,
  );
}

const card = (photo: { media_id: number; url: string | null; ai_generated: boolean } | null = null) => ({
  available: true,
  reason: null,
  card: {
    url: '/media/cards/42-4x5.jpg',
    width: 1080,
    height: 1350,
    aspect: '4:5',
    template: 'panel',
    filename: 'toptelugunews-AbC123-4x5.jpg',
    warnings: ['headline_truncated'],
    photo,
  },
});

const field = (label: string) => screen.getByRole('textbox', { name: new RegExp(`^${label}`) });
const lastBody = () => vi.mocked(cmsApi.makeSocialCard).mock.lastCall?.[1];

describe('SocialCardDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });

  it('offers four sizes with 4:5 chosen, and calls nothing on open', () => {
    renderDialog();
    expect(screen.getAllByRole('radio', { name: /^(1:1|4:5|16:9|9:16)/ })).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /^4:5/ })).toBeChecked();
    expect(field('Headline')).toHaveValue('అసెంబ్లీలో బడ్జెట్');
    expect(field('Tag')).toHaveValue('రాజకీయం');
    expect(cmsApi.socialCardText).not.toHaveBeenCalled();
    expect(cmsApi.makeSocialCard).not.toHaveBeenCalled();
  });

  it('posts the chosen size, then offers the download', async () => {
    vi.mocked(cmsApi.makeSocialCard).mockResolvedValue(card());
    renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: /^16:9/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make card' }));

    await waitFor(() => expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(1));
    expect(lastBody()).toMatchObject({ aspect: '16:9', template: 'panel', photo: 'story', headline: 'అసెంబ్లీలో బడ్జెట్', tag: 'రాజకీయం' });
    expect(await screen.findByRole('img', { name: 'అసెంబ్లీలో బడ్జెట్' })).toHaveAttribute('src', '/media/cards/42-4x5.jpg');
    expect(screen.getByText('The headline was too long and was trimmed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();

    // A later change does not re-render on its own — it only marks the preview stale.
    await userEvent.click(screen.getByRole('radio', { name: /^1:1/ }));
    expect(screen.getByText(/Changes not applied yet/)).toBeInTheDocument();
    expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(1);
  });

  it('fills the text from the AI on request', async () => {
    vi.mocked(cmsApi.socialCardText).mockResolvedValue({ headline: 'బడ్జెట్ రూ.3 లక్షల కోట్లు', summary: 'రెండు వాక్యాలు.', tag: 'తాజా వార్తలు', engine: 'ai' });
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Write with AI' }));

    await waitFor(() => expect(field('Headline')).toHaveValue('బడ్జెట్ రూ.3 లక్షల కోట్లు'));
    expect(cmsApi.socialCardText).toHaveBeenCalledWith(42);
    expect(field('Summary')).toHaveValue('రెండు వాక్యాలు.');
    expect(field('Tag')).toHaveValue('తాజా వార్తలు');
  });

  it('holds the drawn AI picture and reuses it on the next render', async () => {
    vi.mocked(cmsApi.makeSocialCard).mockResolvedValue(card({ media_id: 77, url: '/media/77.jpg', ai_generated: true }));
    renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: /GPT Image 2.5/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make card' }));
    await waitFor(() => expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(1));
    expect(lastBody()).toMatchObject({ photo: 'ai', photo_media_id: null });

    await userEvent.type(field('Headline'), '!');
    await userEvent.click(await screen.findByRole('button', { name: 'Make card' }));
    await waitFor(() => expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(2));
    expect(lastBody()).toMatchObject({ photo: 'ai', photo_media_id: 77, headline: 'అసెంబ్లీలో బడ్జెట్!' });

    // Redraw drops the held picture and asks for a new one.
    await userEvent.click(await screen.findByRole('button', { name: 'Redraw picture' }));
    await waitFor(() => expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(3));
    expect(lastBody()).toMatchObject({ photo: 'ai', photo_media_id: null });
  });

  it('keeps a paid picture across a failed store and a look at the other photo modes', async () => {
    vi.mocked(cmsApi.makeSocialCard)
      .mockRejectedValueOnce(
        new ApiError(502, { code: 'STORAGE_ERROR', message_en: 'Storage failed.', message_te: 'నిల్వ విఫలమైంది.', details: { photo_media_id: 91 } }),
      )
      .mockResolvedValue(card({ media_id: 91, url: null, ai_generated: true }));
    renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: /GPT Image 2.5/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make card' }));
    await waitFor(() => expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('radio', { name: /^Story photo/ }));
    await userEvent.click(screen.getByRole('radio', { name: /GPT Image 2.5/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Make card' }));
    await waitFor(() => expect(cmsApi.makeSocialCard).toHaveBeenCalledTimes(2));
    expect(lastBody()).toMatchObject({ photo: 'ai', photo_media_id: 91 });
  });

  it('shows the reason when no card can be made', async () => {
    const reason = 'Telugu shaping is unavailable on this server.';
    vi.mocked(cmsApi.makeSocialCard).mockResolvedValue({ available: false, reason, card: null });
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Make card' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('shows a 422 refusal in place, and clips a long story headline to the card limit', async () => {
    vi.mocked(cmsApi.makeSocialCard).mockRejectedValue(
      new ApiError(422, { code: 'AI_IMAGE_REFUSED', message_en: 'Not for this topic.', message_te: 'ఈ అంశానికి చిత్రం గీయం.' }),
    );
    renderDialog({ title: 'అ'.repeat(300) });
    expect(field('Headline')).toHaveValue('అ'.repeat(160));

    await userEvent.click(screen.getByRole('button', { name: 'Make card' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ఈ అంశానికి చిత్రం గీయం.');
    expect(lastBody()?.headline).toHaveLength(160);
  });
});
