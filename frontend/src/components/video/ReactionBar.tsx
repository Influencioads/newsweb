import { Angry, Frown, Smile } from 'lucide-react';

import { Chip } from '@/components/ui/Chip';
import type { LucideIcon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import type { ReactionKind, ReactionSummary } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * The three-way sentiment bar ("మీ స్పందన ఏంటి?").
 *
 * Deliberately not a like: a like is endorsement, and nobody endorses a story
 * about a flood. Open to anonymous readers on purpose — a bar that required a
 * login would measure sign-ups rather than sentiment.
 *
 * Percentages are rounded per option and shown per option, never stacked, so
 * they need not total 100 and the display stays honest. Each option carries its
 * own token-coloured share bar under a 44px Chip; the bar is aria-hidden
 * because the percentage already rides on the chip's accessible name.
 *
 * The face is a lucide icon, not a glyph: an emoji renders as a different
 * drawing on every platform and a Unicode dingbat as a tofu box on some.
 *
 * Presentational on purpose — the caller owns the mutation, so the optimistic
 * write goes into its query cache (see `optimisticReaction`) and one failed
 * request rolls back one cache entry rather than a second copy of the state.
 */

const CHOICES: Array<{ kind: ReactionKind; icon: LucideIcon; te: string; en: string }> = [
  { kind: 'happy', icon: Smile, te: 'సంతోషం', en: 'Happy' },
  { kind: 'sad', icon: Frown, te: 'బాధ', en: 'Sad' },
  { kind: 'angry', icon: Angry, te: 'కోపం', en: 'Angry' },
];

/**
 * The summary as the server will report it once `next` lands — the optimistic
 * cache write. Re-derives every percentage from the adjusted counts so the bars
 * stay consistent with the numbers beside them.
 */
export function optimisticReaction(summary: ReactionSummary, next: ReactionKind | null): ReactionSummary {
  const counts = { ...summary.counts };
  if (summary.mine) counts[summary.mine] = Math.max(0, counts[summary.mine] - 1);
  if (next) counts[next] += 1;
  const total = counts.happy + counts.sad + counts.angry;
  const share = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  return {
    total,
    counts,
    percent: { happy: share(counts.happy), sad: share(counts.sad), angry: share(counts.angry) },
    mine: next,
  };
}

export function ReactionBar({
  summary,
  onChange,
  pending,
}: {
  summary: ReactionSummary;
  onChange: (kind: ReactionKind | null) => void;
  pending?: boolean;
}) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';

  return (
    <section className="border-t border-rule pt-6">
      <h2 lang={language} className={cn(s.head, 'mb-3 text-headline-xs font-bold text-ink')}>
        {te ? 'మీ స్పందన ఏంటి?' : 'How do you feel about this?'}
      </h2>

      {/* One column under 360px: three nowrap Telugu chips do not fit a 320px
          phone, and a clipped "సంతోషం" is worse than a stacked list. */}
      <ul className="grid grid-cols-1 gap-2.5 xs:grid-cols-3">
        {CHOICES.map((choice) => {
          const mine = summary.mine === choice.kind;
          const percent = summary.percent[choice.kind];
          return (
            <li key={choice.kind}>
              <Chip
                icon={choice.icon}
                selected={mine}
                disabled={pending}
                lang={language}
                // Tapping the chosen one again clears it — a reaction you cannot
                // take back is a trap, not a control.
                onClick={() => onChange(mine ? null : choice.kind)}
                className="w-full"
              >
                {te ? choice.te : choice.en}
                <span className="sr-only">
                  {' — '}
                  {percent}% ({summary.counts[choice.kind]})
                </span>
              </Chip>

              <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-pill bg-rule-soft">
                <span
                  className={cn(
                    'block h-full rounded-pill transition-[width] duration-base ease-standard',
                    mine ? 'bg-brand' : 'bg-rule-strong',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </span>
              <p aria-hidden className="mt-1 text-center font-sans text-meta tabular-nums text-muted">
                {percent}% · {summary.counts[choice.kind]}
              </p>
            </li>
          );
        })}
      </ul>

      {summary.total > 0 ? (
        <p lang={language} className={cn(s.body, 'mt-3 text-meta text-muted')}>
          <span className="font-sans tabular-nums">{summary.total}</span>{' '}
          {te ? 'మంది స్పందించారు' : 'people responded'}
        </p>
      ) : null}
    </section>
  );
}
