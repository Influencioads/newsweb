import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, MessageSquarePlus, RefreshCw, SendHorizontal, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { AssistantMessage } from '@/types/cms';
import { cn } from '@/utils/cn';
import { relativeTime } from '@/utils/time';

import { useL } from '../useL';
import { AssistantCardView, gone, T, useText } from './cards';
import { Markdown, scriptOf } from './markdown';

/**
 * Sanjaya (సంజయ) — the newsroom's assistant. A turn runs on the server (many
 * model calls, past any browser timeout): the POST queues it and the page
 * polls the conversation every 1.5 s while it is `running`. Whatever Sanjaya
 * writes lands in the review queue; anything outward (approve, publish, push)
 * is an action card a person confirms, and the existing route does the work.
 */

const EXAMPLES: Array<{ te: string; en: string }> = [
  {
    te: 'బిగ్ బిలియన్ డేస్ డీల్స్ క్రాల్ చేసి, ఒక్కోదానిలో 5 ఉత్పత్తులతో 5 కథనాలు రాసి రివ్యూకు పెట్టండి',
    en: 'Crawl Big Billion Days deals and write 5 articles with 5 products each for review',
  },
  { te: '3 నిమిషాల ఆడియో బులెటిన్ సిద్ధం చేయండి', en: 'Prepare a 3-minute audio bulletin' },
  { te: 'ఈ వారం విశ్లేషణ చూపించండి', en: "Show this week's analytics" },
  { te: 'ఈ నెల AI మీద ఎంత ఖర్చు చేశాం?', en: 'How much have we spent on AI this month?' },
  { te: 'గత గంటలోని టాప్ 10 వార్తలను తిరగరాయండి', en: 'Rewrite the top 10 stories from the last hour' },
  { te: 'రివ్యూ క్యూలో ఏమేం వేచి ఉన్నాయి?', en: "What's waiting in the review queue?" },
];

const MAX = 4000;
const LIST_KEY = ['cms', 'assistant', 'conversations'];
const convoKey = (id: number | null) => ['cms', 'assistant', 'conversation', id];

function Message({ m }: { m: AssistantMessage }) {
  const L = useL();
  const say = useText();
  const sc = scriptOf(m.text);
  const textCls = cn(sc.cls, sc.lang === 'te' ? 'text-te-body-xs' : 'text-ui', 'text-ink');
  if (m.role === 'user') {
    return (
      <li className="flex justify-end">
        <div lang={sc.lang} className={cn(textCls, 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-brand-tint px-4 py-2.5')}>
          <span className="sr-only">{L('మీరు: ', 'You: ')}</span>
          {m.text}
        </div>
      </li>
    );
  }
  return (
    <li className="min-w-0 space-y-3">
      <span className="sr-only">{L('సంజయ: ', 'Sanjaya: ')}</span>
      {m.tools.length > 0 ? (
        <ul aria-label={L('వాడిన పనిముట్లు', 'Tools used')} className="flex flex-wrap gap-1.5">
          {m.tools.map((tool, i) => (
            <li
              key={i}
              className="inline-flex items-center gap-1 rounded-pill border border-ai-border bg-ai-tint px-2.5 py-0.5 text-meta font-semibold text-ai-text"
            >
              <Icon icon={Wrench} size="xs" />
              <T text={say({ te: tool.label_te, en: tool.label_en }) || tool.name} />
            </li>
          ))}
        </ul>
      ) : null}
      {m.cards.map((card, i) => (
        <AssistantCardView key={i} id={`${m.id}:${i}`} card={card} />
      ))}
      {m.text ? (
        <div lang={sc.lang} className={textCls}>
          <Markdown text={m.text} />
        </div>
      ) : null}
    </li>
  );
}

export default function AssistantPage() {
  const L = useL();
  const say = useText();
  const s = useScript();
  const { t, language } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ['cms', 'assistant', 'status'], queryFn: cmsApi.fetchAssistantStatus });
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => cmsApi.fetchAssistantConversations() });
  const convo = useQuery({
    queryKey: convoKey(activeId),
    queryFn: () => cmsApi.fetchAssistantConversation(activeId as number),
    enabled: activeId !== null,
    refetchInterval: (q) => (!gone(q.state.error) && q.state.data?.status === 'running' ? 1500 : false),
  });

  const thread = activeId === null ? undefined : convo.data;
  const running = thread?.status === 'running';
  const [errTe = '', errEn = errTe] = thread?.error?.split('\n') ?? []; // agent._both: "te\nen"

  // The list is not a live region (opening a thread would read all of it out);
  // one sr-only line says when a turn this page watched ends.
  const [turn, setTurn] = useState({ id: activeId, running, said: '' });
  if (turn.id !== activeId || turn.running !== running) {
    const ended = turn.id === activeId && turn.running;
    const said = !ended ? '' : thread?.status === 'failed' ? L('జవాబు పూర్తి కాలేదు.', 'The reply did not finish.') : L('సంజయ జవాబిచ్చారు.', 'Sanjaya replied.');
    setTurn({ id: activeId, running, said });
  }
  // Unknown until /status answers: let the server refuse (422) rather than block.
  const ready = status.data?.ready !== false;

  const send = useMutation({
    mutationFn: (text: string) => cmsApi.sendAssistantMessage({ conversation_id: activeId, text }),
    onSuccess: (c, text) => {
      qc.setQueryData(convoKey(c.id), c);
      setActiveId(c.id);
      setDraft((d) => (d.trim() === text ? '' : d));
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => toast.error(e),
  });
  const busy = running || send.isPending;
  const submit = (text: string) => {
    const msg = text.trim();
    if (msg && !busy && ready) {
      setTurn((tn) => ({ ...tn, said: '' })); // a failed send must not re-announce the last reply
      send.mutate(msg);
    }
  };
  const working = L('సంజయ పని చేస్తోంది…', 'Sanjaya is working…');

  const remove = useMutation({
    mutationFn: (id: number) => cmsApi.deleteAssistantConversation(id),
    onSuccess: (_, id) => {
      if (id === activeId) setActiveId(null);
      qc.removeQueries({ queryKey: convoKey(id) });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success(t('state.deleted'));
    },
    onError: (e) => toast.error(e),
  });
  const askDelete = async (id: number, title: string) => {
    const ok = await confirm({
      title: L('ఈ సంభాషణను తొలగించాలా?', 'Delete this conversation?'),
      body: title,
      confirmLabel: L('తొలగించండి', 'Delete'),
      tone: 'danger',
    });
    if (ok) remove.mutate(id);
  };

  const messageCount = thread?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 0) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount, running]);

  const lastUserText = thread?.messages.filter((m) => m.role === 'user').at(-1)?.text;
  const items = list.data ?? [];
  const untitled = L('పేరు లేని సంభాషణ', 'Untitled conversation');

  return (
    <AdminPage
      title={L('సంజయ', 'Sanjaya')}
      subtitle={L(
        'మీ న్యూస్‌రూమ్ కళ్లు, చేతులు — విశ్లేషణ, పరిశోధన, కథనాలు, బులెటిన్లు; మనిషి ఆమోదించకుండా ఏదీ ప్రచురితం కాదు.',
        "Your newsroom's eyes and hands — analytics, research, articles, bulletins; nothing publishes without a person.",
      )}
      actions={
        <Button variant="secondary" icon={MessageSquarePlus} onClick={() => setActiveId(null)}>
          {L('కొత్త సంభాషణ', 'New chat')}
        </Button>
      }
    >
      {status.isError ? (
        <ErrorState compact error={status.error} onRetry={() => void status.refetch()} />
      ) : status.data && !status.data.ready ? (
        <div role="status" className="rounded-2xl border border-partial-border bg-partial-tint px-4 py-3">
          <T
            body
            className="text-ink"
            text={
              say({ te: status.data.reason_te ?? '', en: status.data.reason_en ?? '' }) ||
              L('సంజయ ఇప్పుడు అందుబాటులో లేదు.', 'Sanjaya is not available right now.')
            }
          />
        </div>
      ) : status.data && !status.data.research_enabled ? (
        <p className={cn(s.body, 'text-meta text-muted')}>
          {L(
            'వెబ్ పరిశోధన ఆఫ్‌లో ఉంది. సెట్టింగ్స్‌లో "AI వెబ్ పరిశోధన" ఆన్ చేస్తే సంజయ వెబ్‌లో వెతికి డీల్స్, పరిశోధన కథనాలు రాయగలదు.',
            'Web research is off. Turn on "AI web research" in Settings and Sanjaya can search the web and write deal and research stories.',
          )}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
        <aside className="min-w-0">
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls="sanjaya-chats"
            onClick={() => setListOpen((o) => !o)}
            className={cn(
              s.body,
              'flex min-h-tap w-full items-center justify-between gap-2 rounded-xl border border-rule bg-surface px-4 text-ui-sm font-semibold text-ink lg:hidden',
            )}
          >
            {L('సంభాషణలు', 'Conversations')} ({items.length})
            <Icon icon={ChevronDown} size="sm" className={cn('transition-transform', listOpen && 'rotate-180')} />
          </button>
          <div id="sanjaya-chats" className={cn(listOpen ? 'block' : 'hidden', 'mt-2 lg:mt-0 lg:block')}>
            <h2 className={cn(s.head, 'mb-2 hidden text-headline-xs font-bold text-ink lg:block')}>{L('సంభాషణలు', 'Conversations')}</h2>
            {list.isLoading ? (
              <p role="status" className={cn(s.body, 'text-meta text-muted')}>
                {t('state.loading')}
              </p>
            ) : list.isError ? (
              <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
            ) : items.length === 0 ? (
              <p className={cn(s.body, 'text-meta text-muted')}>{L('ఇంకా సంభాషణలు లేవు.', 'No conversations yet.')}</p>
            ) : (
              <ul className="space-y-1">
                {items.map((c) => {
                  const title = c.title || untitled;
                  const active = c.id === activeId;
                  return (
                    <li key={c.id} className={cn('flex items-center gap-1 rounded-xl', active && 'bg-brand-tint')}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setActiveId(c.id);
                          setListOpen(false);
                        }}
                        className="flex min-h-tap min-w-0 flex-1 flex-col items-start justify-center rounded-xl px-3 py-1.5 text-left hover:bg-rule-soft"
                      >
                        <T text={title} className="te-clamp-1 w-full text-ui-sm font-semibold text-ink" />
                        <span className={cn(s.body, 'text-meta text-muted')}>{relativeTime(c.updated_at, language)}</span>
                      </button>
                      <IconButton
                        icon={Trash2}
                        variant="ghost"
                        label={`${L('తొలగించండి', 'Delete')}: ${title}`}
                        onClick={() => void askDelete(c.id, title)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section aria-label={L('సంజయతో సంభాషణ', 'Conversation with Sanjaya')} className="flex min-w-0 flex-col gap-4">
          {activeId !== null && convo.isError ? (
            <ErrorState compact error={convo.error} onRetry={() => void convo.refetch()} />
          ) : activeId !== null && convo.isLoading ? (
            <p role="status" className={cn(s.body, 'text-meta text-muted')}>
              {t('state.loading')}
            </p>
          ) : messageCount === 0 && !send.isPending ? (
            <Card padding="lg">
              <div className="flex items-center gap-2 text-brand">
                <Icon icon={Sparkles} />
                <h2 className={cn(s.head, 'text-headline-sm font-bold text-ink')}>{L('సంజయను ఏదైనా అడగండి', 'Ask Sanjaya')}</h2>
              </div>
              <p className={cn(s.body, 'mt-1 text-ui-sm text-muted')}>
                {L(
                  'సంజయ రాసినవన్నీ రివ్యూ క్యూలోకే వెళ్తాయి. ఇలా మొదలుపెట్టండి:',
                  'Everything Sanjaya writes goes to the review queue. Try one of these:',
                )}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {EXAMPLES.map((ex) => {
                  const text = language === 'te' ? ex.te : ex.en;
                  return (
                    <li key={ex.en}>
                      <button
                        type="button"
                        disabled={!ready || busy}
                        onClick={() => submit(text)}
                        className={cn(
                          s.body,
                          'flex min-h-tap w-full items-center rounded-2xl border border-rule bg-surface px-4 py-2 text-left text-ui-sm text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60',
                        )}
                      >
                        {text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <p role="status" className="sr-only">
            {busy ? working : turn.said}
          </p>
          <ol aria-label={L('సందేశాలు', 'Messages')} className="space-y-5">
            {thread?.messages.map((m) => (
              <Message key={m.id} m={m} />
            ))}
            {busy ? (
              <li>
                <p className={cn(s.body, 'flex items-center gap-2 text-ui-sm text-muted')}>
                  <Icon icon={Loader2} size="sm" className="animate-spin motion-reduce:animate-none" />
                  {working}
                </p>
              </li>
            ) : null}
            {thread?.status === 'failed' ? (
              <li>
                <div className="rounded-2xl border border-breaking-border bg-breaking-tint px-4 py-3">
                  <p className={cn(s.body, 'text-ui-sm font-semibold text-breaking')}>{L('జవాబు పూర్తి కాలేదు.', 'The reply did not finish.')}</p>
                  {errTe ? <T text={say({ te: errTe, en: errEn })} className="text-meta text-ink" /> : null}
                  {lastUserText ? (
                    <Button size="sm" variant="secondary" icon={RefreshCw} className="mt-2" disabled={!ready} onClick={() => submit(lastUserText)}>
                      {t('state.retry')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ) : null}
          </ol>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(draft);
            }}
            className="sticky bottom-dock z-10 rounded-2xl border border-rule bg-surface p-3"
          >
            <Textarea
              aria-label={L('సంజయకు సందేశం', 'Message Sanjaya')}
              placeholder={L('ఉదా: ఈ వారం విశ్లేషణ చూపించండి', "e.g. Show this week's analytics")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Safari fires the IME-commit Enter after compositionend, as keyCode 229.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              disabled={!ready}
              autoGrow
              rows={2}
              counter={MAX}
              className="max-h-60 overflow-y-auto"
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className={cn(s.body, 'hidden text-meta text-muted sm:block')}>
                {L('Enter పంపుతుంది · Shift+Enter కొత్త లైన్', 'Enter sends · Shift+Enter for a new line')}
              </p>
              <Button type="submit" icon={SendHorizontal} pending={send.isPending} disabled={!ready || running || !draft.trim()} className="ms-auto">
                {L('పంపండి', 'Send')}
              </Button>
            </div>
          </form>
          {/* After the form, so scrolling here leaves the last message above the sticky composer, not under it. */}
          <div ref={endRef} className="scroll-mb-dock" />
        </section>
      </div>
      {dialog}
    </AdminPage>
  );
}
