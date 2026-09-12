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
 * they need not total 100 and the display stays honest.
 *
 * The face is a lucide icon, not a glyph: an emoji renders as a different
 * drawing on every platform and a Unicode dingbat as a tofu box on some.
 */

const CHOICES: Array<{ kind: ReactionKind; icon: LucideIcon; te: string; en: string }> = [
  { kind: 'happy', icon: Smile, te: 'సంతోషం', en: 'Happy' },
  { kind: 'sad', icon: Frown, te: 'బాధ', en: 'Sad' },
  { kind: 'angry', icon: Angry, te: 'కోపం', en: 'Angry' },
];

export function ReactionBar({
  summary, onChange, pending,
}: {
  summary: ReactionSummary;
  onChange: (kind: ReactionKind | null) => void;
  pending?: boolean;
}) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';

  return (
    <section className="mt-6 border-t border-rule pt-4">
      <h2 lang={language} className={cn(s.head, 'mb-2.5 text-headline-xs font-bold text-ink')}>
        {te ? 'మీ స్పందన ఏంటి?' : 'How do you feel about this?'}
      </h2>
      <div className="grid grid-cols-3 gap-2.5">
        {CHOICES.map((choice) => {
          const mine = summary.mine === choice.kind;
          return (
            <Chip
              key={choice.kind}
              icon={choice.icon}
              selected={mine}
              disabled={pending}
              lang={language}
              // Tapping the chosen one again clears it — a reaction you cannot
              // take back is a trap, not a control.
              onClick={() => onChange(mine ? null : choice.kind)}
              className="w-full"
            >
              <span className="sr-only">{te ? choice.te : choice.en} — </span>
              <span className="font-sans tabular-nums">{summary.percent[choice.kind]}%</span>
            </Chip>
          );
        })}
      </div>
      {summary.total > 0 ? (
        <p lang={language} className={cn(s.body, 'mt-1.5 text-meta text-muted')}>
          {summary.total} {te ? 'మంది స్పందించారు' : 'people responded'}
        </p>
      ) : null}
    </section>
  );
}
