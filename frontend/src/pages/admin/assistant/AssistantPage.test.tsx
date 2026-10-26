import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { AssistantConversation, AssistantJob, AssistantStatus } from '@/types/cms';

import AssistantPage from './AssistantPage';
import { AssistantCardView } from './cards';
import { Markdown, safeHref } from './markdown';

vi.mock('@/features/cms/api', () => ({
  fetchAssistantStatus: vi.fn(),
  fetchAssistantConversations: vi.fn(),
  fetchAssistantConversation: vi.fn(),
  sendAssistantMessage: vi.fn(),
  deleteAssistantConversation: vi.fn(),
  fetchAssistantJob: vi.fn(),
  transitionArticle: vi.fn(),
  sendCampaign: vi.fn(),
  publishBulletin: vi.fn(),
}));

const status: AssistantStatus = {
  name_en: 'Sanjaya',
  name_te: 'సంజయ',
  ready: true,
  reason_en: null,
  reason_te: null,
  ai_enabled: true,
  research_enabled: true,
  provider: 'aimlapi',
  model: 'gemini',
  tools: [],
};

const ASK = "Show this week's analytics";
const userMsg = { id: 1, role: 'user' as const, text: ASK, tools: [], cards: [], created_at: '2026-09-29T10:00:00Z' };
const convo = (over: Partial<AssistantConversation>): AssistantConversation => ({
  id: 5,
  title: ASK,
  status: 'idle',
  updated_at: '2026-09-29T10:00:00Z',
  error: null,
  messages: [userMsg],
  jobs: [],
  ...over,
});

function renderPage(ui: ReactNode = <AssistantPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const listed = (title: string, st: 'idle' | 'running' | 'failed' = 'idle') =>
  vi.mocked(cmsApi.fetchAssistantConversations).mockResolvedValue([{ id: 5, title, status: st, updated_at: '2026-09-29T10:00:00Z' }]);

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  act(() => useLanguage.setState({ language: 'en' }));
  act(() => useAuth.setState({ can: () => true, hasLevel: () => true }));
  useToastStore.setState({ toasts: [] });
  vi.mocked(cmsApi.fetchAssistantStatus).mockResolvedValue(status);
  vi.mocked(cmsApi.fetchAssistantConversations).mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AssistantPage', () => {

  it('opens on the empty state with six example prompts', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sanjaya' })).toBeInTheDocument();
    expect(await screen.findByText('No conversations yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Big Billion Days/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare a 3-minute audio bulletin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "What's waiting in the review queue?" })).toBeInTheDocument();
    expect(cmsApi.sendAssistantMessage).not.toHaveBeenCalled();
  });

  it('sends with Enter, polls while running, then draws tools, cards and text', async () => {
    vi.mocked(cmsApi.sendAssistantMessage).mockResolvedValue(convo({ status: 'running' }));
    vi.mocked(cmsApi.fetchAssistantConversation)
      .mockResolvedValueOnce(convo({ status: 'running' }))
      .mockResolvedValue(
        convo({
          messages: [
            userMsg,
            {
              id: 2,
              role: 'assistant',
              text: 'Here is the **week**.',
              tools: [{ name: 'audience_analytics', label_te: 'పాఠకుల విశ్లేషణ', label_en: 'Audience analytics' }],
              cards: [
                { type: 'stats', title: { te: 'ఈ వారం', en: 'This week' }, items: [{ label: 'Readers', value: 12500 }] },
                {
                  type: 'articles',
                  items: [{ id: 7, short_id: 'AbC123', title: 'అసెంబ్లీలో బడ్జెట్', workflow_state: 'SUBMITTED', note: 'Awaiting review' }],
                },
                { type: 'hologram' } as never,
              ],
              created_at: '2026-09-29T10:00:05Z',
            },
          ],
        }),
      );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderPage();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(screen.getByRole('textbox', { name: 'Message Sanjaya' }), `${ASK}{Enter}`);
    expect(cmsApi.sendAssistantMessage).toHaveBeenCalledWith({ conversation_id: null, text: ASK });
    const said = await screen.findByText('Sanjaya is working…', { selector: '[role=status]' });
    expect(said).toHaveClass('sr-only');
    // The message list itself is not live: opening a thread must not read all of it out.
    expect(screen.getByRole('list', { name: 'Messages' })).not.toHaveAttribute('aria-live');

    await tick(1600);
    await tick(1600);
    expect(await screen.findByText('week')).toHaveProperty('tagName', 'STRONG');
    expect(cmsApi.fetchAssistantConversation).toHaveBeenCalledTimes(2);
    expect(said).toHaveTextContent('Sanjaya replied.');
    // The scroll target sits after the sticky composer, so the reply is not left under it.
    const target = scroll.mock.contexts.at(-1) as Element;
    const form = screen.getByRole('textbox', { name: 'Message Sanjaya' }).closest('form') as HTMLFormElement;
    expect(form.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    scroll.mockRestore();
    // Idle stops the polling.
    await tick(5000);
    expect(cmsApi.fetchAssistantConversation).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByText('Sanjaya is working…')).toHaveLength(0);
    expect(screen.getByText('Audience analytics')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Readers')).toBeInTheDocument();
    expect(screen.getByText('12,500')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'అసెంబ్లీలో బడ్జెట్' })).toHaveAttribute('href', '/admin/articles/7/edit');
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
    // The composer is free again, and the draft was cleared.
    expect(screen.getByRole('textbox', { name: 'Message Sanjaya' })).toHaveValue('');
  });

  it('toasts an ApiError in the interface language', async () => {
    act(() => useLanguage.setState({ language: 'te' }));
    vi.mocked(cmsApi.sendAssistantMessage).mockRejectedValue(
      new ApiError(422, { code: 'AI_DISABLED', message_en: 'AI is switched off.', message_te: 'AI ఆఫ్‌లో ఉంది.' }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '3 నిమిషాల ఆడియో బులెటిన్ సిద్ధం చేయండి' }));
    expect(cmsApi.sendAssistantMessage).toHaveBeenCalledWith({ conversation_id: null, text: '3 నిమిషాల ఆడియో బులెటిన్ సిద్ధం చేయండి' });
    await waitFor(() => expect(useToastStore.getState().toasts.map((x) => x.message)).toContain('AI ఆఫ్‌లో ఉంది.'));
  });

  it('runs an action card only after the person confirms, through the existing client call', async () => {
    vi.mocked(cmsApi.fetchAssistantConversations).mockResolvedValue([
      { id: 5, title: 'Review queue', status: 'idle', updated_at: '2026-09-29T10:00:00Z' },
    ]);
    vi.mocked(cmsApi.transitionArticle).mockResolvedValue({} as never);
    vi.mocked(cmsApi.sendCampaign).mockResolvedValue({});
    vi.mocked(cmsApi.fetchAssistantConversation).mockResolvedValue(
      convo({
        messages: [
          {
            id: 2,
            role: 'assistant',
            text: '',
            tools: [],
            cards: [
              {
                type: 'action',
                action: 'approve_article',
                label: { te: 'ఆమోదించండి', en: 'Approve story' },
                summary: 'Approve the budget story?',
                params: { article_id: 7, title: 'Budget' },
              },
              {
                type: 'action',
                action: 'send_push',
                label: 'Send push',
                summary: 'Push the budget story to everyone.',
                params: { article_id: 7, short_id: 'AbC123', title_te: 'బడ్జెట్', body_te: '', audience: 'all', send_at: null },
              },
            ],
            created_at: '2026-09-29T10:00:05Z',
          },
        ],
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Review queue/ }));

    // Cancel first: nothing is called.
    await userEvent.click(await screen.findByRole('button', { name: 'Approve story' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(cmsApi.transitionArticle).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Approve story' }));
    expect(cmsApi.transitionArticle).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve story' }));
    await waitFor(() => expect(cmsApi.transitionArticle).toHaveBeenCalledWith(7, 'approve'));
    expect(await screen.findByText('Done.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send push' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send push' }));
    await waitFor(() =>
      expect(cmsApi.sendCampaign).toHaveBeenCalledWith({ title_te: 'బడ్జెట్', body_te: null, audience: 'all', short_id: 'AbC123', send_at: null }),
    );
    expect(cmsApi.publishBulletin).not.toHaveBeenCalled();

    // Leave the thread and come back: the push card stays done, so it cannot be sent twice.
    await waitFor(() => expect(screen.getAllByText('Done.')).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Review queue/ }));
    expect(await screen.findAllByText('Done.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Send push' })).not.toBeInTheDocument();
  });

  it('gates action buttons on the same permission and level as the route', async () => {
    listed('Actions');
    act(() => useAuth.setState({ can: (p) => p !== 'push.approve', hasLevel: (n) => n < 60 }));
    vi.mocked(cmsApi.fetchAssistantConversation).mockResolvedValue(
      convo({
        messages: [
          {
            id: 3,
            role: 'assistant',
            text: '',
            tools: [],
            cards: [
              { type: 'action', action: 'send_push', label: 'Send push', summary: 'Push it.', params: { article_id: 7, short_id: 'A', title_te: 'x', body_te: '', audience: 'all', send_at: null } },
              { type: 'action', action: 'publish_bulletin', label: 'Publish bulletin', summary: 'Publish it.', params: { bulletin_id: 4 } },
              { type: 'action', action: 'approve_article', label: 'Approve story', summary: 'Approve it.', params: { article_id: 7, title: 'B' } },
            ],
            created_at: '2026-09-29T10:00:05Z',
          },
        ],
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Actions/ }));
    expect(await screen.findByRole('button', { name: 'Send push' })).toBeDisabled(); // push.create is not enough
    expect(screen.getByRole('button', { name: 'Publish bulletin' })).toBeDisabled(); // voice.manage below level 60
    expect(screen.getByRole('button', { name: 'Approve story' })).toBeEnabled();
  });

  it('does not send while a turn is running, nor on an IME-commit Enter', async () => {
    listed('Busy', 'running');
    vi.mocked(cmsApi.fetchAssistantConversation).mockResolvedValue(convo({ status: 'running' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Busy/ }));
    const box = await screen.findByRole('textbox', { name: 'Message Sanjaya' });
    await screen.findByText('Sanjaya is working…', { selector: '[role=status]' });
    await userEvent.type(box, 'next one{Enter}');
    expect(box).toHaveValue('next one'); // typing ahead still works
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    // New chat (idle): an Enter that commits IME text is not a send.
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    await act(async () => {}); // mutate() calls the API a microtask later
    expect(cmsApi.sendAssistantMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(cmsApi.sendAssistantMessage).toHaveBeenCalledWith({ conversation_id: null, text: 'next one' }));
  });

  it('stops polling a thread that answers 404', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listed('Gone', 'running');
    vi.mocked(cmsApi.fetchAssistantConversation)
      .mockResolvedValueOnce(convo({ status: 'running' }))
      .mockRejectedValue(new ApiError(404, { code: 'NOT_FOUND', message_en: 'Not found.', message_te: 'దొరకలేదు.' }));
    renderPage();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: /^Gone/ }));
    await tick(1600);
    await waitFor(() => expect(cmsApi.fetchAssistantConversation).toHaveBeenCalledTimes(2));
    await tick(6000);
    expect(cmsApi.fetchAssistantConversation).toHaveBeenCalledTimes(2);
  });

  it('shows a failed turn in the interface language and retries the last message', async () => {
    listed('Broken', 'failed');
    vi.mocked(cmsApi.fetchAssistantConversation).mockResolvedValue(
      convo({ status: 'failed', error: 'సంజయ ఈ సమాధానం పూర్తి చేయలేకపోయారు.\nSanjaya could not finish this reply.' }),
    );
    vi.mocked(cmsApi.sendAssistantMessage).mockResolvedValue(convo({ status: 'running' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Broken/ }));
    expect(await screen.findByText('Sanjaya could not finish this reply.')).toHaveAttribute('lang', 'en');
    expect(screen.queryByText(/పూర్తి చేయలేకపోయారు/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(cmsApi.sendAssistantMessage).toHaveBeenCalledWith({ conversation_id: 5, text: ASK });
  });
});

describe('Job card', () => {
  const job = (over: Partial<AssistantJob>): AssistantJob =>
    ({ id: 9, kind: 'write_articles', title: 'Writing 5 articles', status: 'queued', progress: 0, step_text: null, result: null, error: null, created_at: null, started_at: null, finished_at: null, ...over });

  it('draws progress while it runs, then what it made, then stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(cmsApi.fetchAssistantJob)
      .mockResolvedValueOnce(job({ status: 'running', progress: 40, step_text: 'Article 2 of 5' }))
      .mockResolvedValue(job({ status: 'done', progress: 100, result: { summary: 'Wrote **5** articles.', cards: [] } }));
    renderPage(<AssistantCardView id="m1:0" card={{ type: 'job', job_id: 9 }} />);
    expect(await screen.findByRole('progressbar', { name: 'Writing 5 articles' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Article 2 of 5')).toBeInTheDocument();
    await tick(2100);
    expect(await screen.findByText('5')).toHaveProperty('tagName', 'STRONG');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await tick(6000);
    expect(cmsApi.fetchAssistantJob).toHaveBeenCalledTimes(2);
  });
});

describe('Markdown', () => {
  it('draws bold, lists and links, and leaves HTML as text', () => {
    const { container } = render(
      <Markdown text={'Hello **world**\n\n- one\n- two\n\n1. first\n\nSee https://example.com/x. <script>alert(1)</script>'} />,
    );
    expect(screen.getByText('world').tagName).toBe('STRONG');
    expect(container.querySelector('ul')?.children).toHaveLength(2);
    expect(container.querySelector('ol li')).toHaveTextContent('first');
    const link = screen.getByRole('link', { name: 'https://example.com/x' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
  });

  it('draws a heading that is already bold without stray asterisks', () => {
    const { container } = render(<Markdown text="## **Top stories**" />);
    expect(screen.getByText('Top stories').tagName).toBe('STRONG');
    expect(container).not.toHaveTextContent('*');
  });

  it('lets only http(s) and same-site paths into an href', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,x')).toBeUndefined();
    expect(safeHref('//evil.example/x')).toBeUndefined();
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('/media/a.mp3')).toBe('/media/a.mp3');
  });
});
