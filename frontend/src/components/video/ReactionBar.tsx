import { useMutation } from '@tanstack/react-query';

import { useI18n } from '@/i18n';
import type { ReactionKind, ReactionSummary } from '@/types/public';

/**
 * The three-way sentiment bar ("మీ స్పందన ఏంటి?").
 *
 * Deliberately not a like: a like is endorsement, and nobody endorses a story
 * about a flood. Open to anonymous readers on purpose — a bar that required a
 * login would measure sign-ups rather than sentiment.
 *
 * Percentages are rounded per option and shown per option, never stacked, so
 * they need not total 100 and the display stays honest.
 */

const CHOICES: Array<{ kind: ReactionKind; glyph: string; te: string; en: string }> = [
  { kind: 'happy', glyph: '☺', te: 'సంతోషం', en: 'Happy' },
  { kind: 'sad', glyph: '☹', te: 'బాధ', en: 'Sad' },
  { kind: 'angry', glyph: '😠', te: 'కోపం', en: 'Angry' },
];

export function ReactionBar({
  summary, onChange, pending,
}: {
  summary: ReactionSummary;
  onChange: (kind: ReactionKind | null) => void;
  pending?: boolean;
}) {
  const { language } = useI18n();
  const te = language === 'te';

  return (
    <section className="mt-6 border-t border-rule pt-4">
      <h2 className={`${te ? 'th' : 'font-sans'} mb-2.5 text-[15px] font-bold text-ink`}>
        {te ? 'మీ స్పందన ఏంటి?' : 'How do you feel about this?'}
      </h2>
      <div className="grid grid-cols-3 gap-2.5">
        {CHOICES.map((choice) => {
          const mine = summary.mine === choice.kind;
          return (
            <button
              key={choice.kind}
              type="button"
              disabled={pending}
              aria-pressed={mine}
              // Tapping the chosen one again clears it — a reaction you cannot
              // take back is a trap, not a control.
              onClick={() => onChange(mine ? null : choice.kind)}
              className={`flex min-h-[46px] items-center justify-center gap-2 rounded-control border text-[13px] transition disabled:opacity-60 ${
                mine
                  ? 'border-brand bg-brand-tint font-bold text-brand'
                  : 'border-rule bg-white text-ink-soft hover:border-brand dark:bg-surface'
              }`}
            >
              <span aria-hidden className="text-[16px]">{choice.glyph}</span>
              <span className="sr-only">{te ? choice.te : choice.en}</span>
              <span className="font-sans tabular-nums">{summary.percent[choice.kind]}%</span>
            </button>
          );
        })}
      </div>
      {summary.total > 0 ? (
        <p className={`${te ? 'te' : 'font-sans'} mt-1.5 text-[11.5px] text-muted`}>
          {summary.total} {te ? 'మంది స్పందించారు' : 'people responded'}
        </p>
      ) : null}
    </section>
  );
}
