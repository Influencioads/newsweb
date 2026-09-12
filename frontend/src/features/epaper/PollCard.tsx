import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { HelpCircle, Share2 } from 'lucide-react';

import { useShareActions } from '@/components/article/ShareSheet';
import { IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useI18n, useScript } from '@/i18n';
import type { Poll } from '@/types/epaper';
import { cn } from '@/utils/cn';

import * as epaperApi from './api';

/**
 * The Big Question / poll card.
 *
 * Before the vote each option is a plain 44px row. After it — or once the poll
 * has closed — the same rows grow a result bar from 0 to their share, and stay
 * fully legible: a voted poll is a *result*, not a greyed-out form, so nothing
 * here dims the text it is asking the reader to read.
 */
export function PollCard({ poll, className }: { poll: Poll; className?: string }) {
  const { language } = useI18n();
  const s = useScript();
  const toast = useToast();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [current, setCurrent] = useState(poll);

  const vote = useMutation({
    mutationFn: (optionId: number) => epaperApi.votePoll(current.id, optionId),
    onSuccess: setCurrent,
    onError: (error) => toast.error(error),
  });

  const question = s.text(current.question_te, current.question_en);
  const kicker = current.is_big_question ? L('బిగ్ క్వశ్చన్', 'Big Question') : L('పోల్', 'Poll');
  // Results appear once this reader has voted, or once voting has closed.
  const show = current.has_voted || current.status !== 'ACTIVE';
  const locked = current.has_voted || vote.isPending;

  const share = useShareActions(String(current.id), `/polls/${current.id}`, question.text);

  return (
    <Card as="section" tone="surface" padding="lg" className={cn('rounded-2xl', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className={cn(s.body, 'flex items-center gap-1.5 font-bold text-brand', s.te ? 'text-meta' : 'text-eyebrow uppercase')}>
          <Icon icon={HelpCircle} size="sm" />
          {kicker}
        </p>
        <IconButton
          icon={Share2}
          label={L('పోల్ షేర్ చేయండి', 'Share this poll')}
          variant="ghost"
          onClick={() => void (share.canNative ? share.native() : share.copy())}
        />
      </div>

      <h2 lang={question.lang} className={cn(question.head, 'text-headline-md font-extrabold text-ink')}>
        {question.text}
      </h2>

      <div className="mt-4 flex flex-col gap-2" aria-busy={vote.isPending || undefined}>
        {current.options.map((option) => {
          const label = s.text(option.option_text_te, option.option_text_en);
          const picked = current.selected_option_id === option.id;
          return (
            <button
              key={option.id}
              type="button"
              // aria-disabled, not `disabled`: the row the reader just activated
              // would otherwise lose focus to <body> the instant it locks, and
              // the percentages it now shows would be unreachable by keyboard.
              aria-disabled={locked || undefined}
              aria-pressed={show ? picked : undefined}
              onClick={() => {
                if (!locked) vote.mutate(option.id);
              }}
              className={cn(
                'relative flex min-h-tap w-full items-center gap-3 rounded-xl border px-4 py-2 text-left',
                'transition-[colors,transform,box-shadow] duration-base ease-standard',
                picked ? 'border-brand text-brand' : 'border-rule text-ink',
                // Never dim a result: locked here means "already answered", not
                // "unavailable", and the percentages still have to be read.
                locked ? 'cursor-default' : 'hover:border-brand hover:text-brand active:scale-[.98]',
              )}
            >
              {show ? (
                <span aria-hidden className="absolute inset-0 overflow-hidden rounded-xl">
                  <span
                    className="block h-full bg-brand-tint transition-[width] duration-slow ease-standard"
                    style={{ width: `${option.percentage}%` }}
                  />
                </span>
              ) : null}
              <span lang={label.lang} className={cn(label.cls, 'relative z-10 text-te-body-xs font-semibold')}>
                {label.text}
              </span>
              {show ? (
                <span className="relative z-10 ml-auto flex shrink-0 items-baseline gap-2 font-sans tabular-nums">
                  <span className="text-meta text-muted">
                    {option.votes}{' '}
                    <span lang={language} className={s.body}>
                      {L('ఓట్లు', 'votes')}
                    </span>
                  </span>
                  <span className="text-ui font-bold text-ink">{option.percentage}%</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {show ? (
        // role="status" so the outcome is announced once the vote resolves.
        <p role="status" lang={language} className={cn(s.body, 'mt-3 text-meta text-muted')}>
          {current.total_votes} {L('ఓట్లు', 'votes')}
        </p>
      ) : null}
    </Card>
  );
}
