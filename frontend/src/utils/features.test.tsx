import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLanguage } from '@/i18n';
import { visibleAdminNav } from '@/layouts/adminNav';
import { ConvertPanel } from '@/pages/admin/editor/ConvertPanel';

vi.mock('@/utils/features', () => ({ AI_FEATURES: false }));
vi.mock('@/features/cms/api', () => ({
  generateArticleAudio: vi.fn(),
  generateArticleCard: vi.fn(),
}));

/** With the AI_FEATURES kill switch off, the automated-content screens are hidden. */
describe('AI_FEATURES off', () => {
  beforeEach(() => {
    act(() => useLanguage.setState({ language: 'en' }));
  });

  it('hides the AI, crawl and voice screens from the admin menu, even for a superuser', () => {
    const paths = visibleAdminNav(() => true).flatMap((g) => g.items.map((i) => i.to));
    for (const hidden of ['/admin/ai', '/admin/sources', '/admin/creative', '/admin/bulletins', '/admin/voice']) {
      expect(paths).not.toContain(hidden);
    }
    for (const kept of ['/admin/articles', '/admin/review', '/admin/taxonomy', '/admin/media', '/admin/epaper', '/admin/settings']) {
      expect(paths).toContain(kept);
    }
  });

  it('offers no voice conversion in the editor, but keeps the share image', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ConvertPanel articleId={42} voiceEnabled />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Convert to voice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Convert to image' })).toBeInTheDocument();
  });
});
