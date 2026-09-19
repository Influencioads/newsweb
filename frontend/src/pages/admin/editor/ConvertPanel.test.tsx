import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';

import { ConvertPanel } from './ConvertPanel';

vi.mock('@/features/cms/api', () => ({
  generateArticleAudio: vi.fn(),
  generateArticleCard: vi.fn(),
}));

function renderPanel(voiceEnabled = true) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConvertPanel articleId={42} voiceEnabled={voiceEnabled} />
    </QueryClientProvider>,
  );
}

const READY_AUDIO = {
  available: true,
  url: 'https://cdn.example.com/audio/42.mp3',
  mime: 'audio/mpeg',
  duration_sec: 96,
  voice: 'te-IN-Standard-A',
  provider: 'google',
  fallback: null,
  voice_enabled: true,
  global_voice_enabled: true,
  usage: { chars_this_month: 12345, monthly_budget: 500000 },
};

describe('ConvertPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });

  it('converts to voice and plays the result back', async () => {
    vi.mocked(cmsApi.generateArticleAudio).mockResolvedValue(READY_AUDIO);
    const view = renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Convert to voice' }));

    await waitFor(() => expect(cmsApi.generateArticleAudio).toHaveBeenCalledWith(42, false));
    expect(await screen.findByText(/Ready · 96s/)).toBeInTheDocument();
    // The editor hears it here rather than opening the public page to check.
    expect(view.container.querySelector('audio')).toHaveAttribute('src', READY_AUDIO.url);
    expect(screen.getByText(/12,345/)).toBeInTheDocument();
    // Regenerate only appears once there is something to replace.
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(cmsApi.generateArticleAudio).toHaveBeenLastCalledWith(42, true);
  });

  it('says why voice did nothing instead of appearing to do nothing', async () => {
    vi.mocked(cmsApi.generateArticleAudio).mockResolvedValue({
      ...READY_AUDIO,
      available: false,
      url: null,
      voice_enabled: true,
      global_voice_enabled: false,
    });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to voice' }));
    expect(await screen.findByText(/Voice is off in site settings/)).toBeInTheDocument();
  });

  it('converts to image and offers the link', async () => {
    vi.mocked(cmsApi.generateArticleCard).mockResolvedValue({
      available: true,
      url: 'https://cdn.example.com/share-cards/abc/1.png',
      reason: null,
    });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Convert to image' }));

    await waitFor(() => expect(cmsApi.generateArticleCard).toHaveBeenCalledWith(42, false));
    expect(await screen.findByRole('img', { name: 'Share image' })).toHaveAttribute('src', 'https://cdn.example.com/share-cards/abc/1.png');
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://cdn.example.com/share-cards/abc/1.png');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('renders an unavailable card as a quiet note, not an error', async () => {
    const reason = "This server's Pillow was built without Raqm, so Telugu cannot be shaped.";
    vi.mocked(cmsApi.generateArticleCard).mockResolvedValue({ available: false, url: null, reason });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Convert to image' }));

    // Inline, in the panel — a toast would read as "you did something wrong",
    // and on a Windows desk this is simply what the environment can do.
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Share image' })).toBeNull();
  });
});
