import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';
import type { CmsArticle } from '@/types/cms';

import { DeleteArticleButton } from './Articles';

vi.mock('@/features/cms/api', () => ({ deleteArticle: vi.fn() }));

const ARTICLE = { id: 7, title_te: 'పరీక్ష కథనం', title_en: null } as unknown as CmsArticle;

function renderButton(perms: PermissionKey[]) {
  act(() => useAuth.setState({ can: (p: PermissionKey) => perms.includes(p) }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <DeleteArticleButton article={ARTICLE} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DeleteArticleButton', () => {
  const realCan = useAuth.getState().can;
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });
  afterEach(() => act(() => useAuth.setState({ can: realCan })));

  it('is not shown without article.delete', () => {
    renderButton(['article.edit', 'article.unpublish']);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('asks first, and deletes only on confirm', async () => {
    vi.mocked(cmsApi.deleteArticle).mockResolvedValue({ id: 7, deleted: true });
    const user = userEvent.setup();
    renderButton(['article.delete']);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this article?')).toBeInTheDocument();
    expect(screen.getByText(/stays in the database and can be restored/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cmsApi.deleteArticle).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete');
    await user.click(confirm!);
    await waitFor(() => expect(cmsApi.deleteArticle).toHaveBeenCalledWith(7));
  });
});
