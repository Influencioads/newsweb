import { useState } from 'react';
import { Bookmark, BookmarkCheck, Headphones, MessageCircle, Share2, Type } from 'lucide-react';

import { IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Dialog';
import { translate, useI18n } from '@/i18n';
import { FONT_STEPS, useReaderPrefs } from '@/stores/readerPrefs';
import type { StoryFormats } from '@/types/public';
import { cn } from '@/utils/cn';
import { useHideOnScroll } from '@/utils/motion';

/**
 * Reader toolbar — the article page's controls.
 *
 * - `ReadingProgress` 3px brand bar pinned under the header, scaled by `progress`.
 * - `FontSizeGroup`   inline A- / A / A+ / A++ chips (desktop, or anywhere inline).
 * - `FontSizeSheet`   the same chips in a bottom sheet with a live preview (mobile).
 * - `ReaderToolbar`   fixed bottom bar under md (hides on scroll-down), inline
 *                     flex row from md up: text size, listen, save, share, comments.
 *
 *     <ReadingProgress progress={scrolled} />
 *     <ReaderToolbar article={article} formats={formats} onShare={share} onListen={tts.toggle}
 *                    listening={tts.playing} saved={saved} onSave={toggleSave} onComments={openComments} />
 *
 * The bottom bar overlays content: the article page must reserve `pb-tap-lg`
 * (plus safe-area) under md so the last paragraph is not covered.
 */
export interface ReadingProgressProps {
  /** 0..1 fraction of the article scrolled. */
  progress: number;
}

export function ReadingProgress({ progress }: ReadingProgressProps) {
  const { t } = useI18n();
  const value = Math.min(1, Math.max(0, progress));
  return (
    <div
      role="progressbar"
      aria-label={t('ui.readingProgress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      style={{ top: 'var(--header-h)', transform: `scaleX(${value})` }}
      className="pointer-events-none fixed inset-x-0 z-header h-[3px] origin-left bg-brand transition-transform duration-fast ease-standard"
    />
  );
}

export interface FontSizeGroupProps {
  className?: string;
}

/** Four 44px chips bound to the persisted reader font step. */
export function FontSizeGroup({ className }: FontSizeGroupProps) {
  const { t } = useI18n();
  const fontStep = useReaderPrefs((s) => s.fontStep);
  const setFontStep = useReaderPrefs((s) => s.setFontStep);
  return (
    <div role="group" aria-label={t('reader.fontSize')} className={cn('flex items-center gap-1', className)}>
      {FONT_STEPS.map((step) => (
        <Chip
          key={step}
          as="button"
          lang="en"
          selected={fontStep === step}
          onClick={() => setFontStep(step)}
          className="tabular-nums"
        >
          {step}
        </Chip>
      ))}
    </div>
  );
}

export interface FontSizeSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Bottom sheet with the font-step chips and a live `.reader-body` preview. */
export function FontSizeSheet({ open, onClose }: FontSizeSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t('reader.fontSize')}>
      <FontSizeGroup className="flex-wrap" />
      {/* The preview is always a Telugu body sample — that is what the scale is
          for — so it stays lang="te" in both interface languages. */}
      <p lang="te" className="te reader-body mt-4 text-ink">
        {translate('reader.previewText', 'te')}
      </p>
    </Sheet>
  );
}

export interface ReaderToolbarProps {
  article: { short_id: string; like_count?: number; comment_count?: number };
  formats?: StoryFormats | null;
  onListen?: () => void;
  onShare: () => void;
  onComments?: () => void;
  listening?: boolean;
  saved?: boolean;
  onSave?: () => void;
  /** Overrides `article.comment_count` for the badge. */
  commentCount?: number;
}

export function ReaderToolbar({
  article,
  formats,
  onListen,
  onShare,
  onComments,
  listening,
  saved,
  onSave,
  commentCount,
}: ReaderToolbarProps) {
  const { t } = useI18n();
  const hidden = useHideOnScroll();
  const [fontOpen, setFontOpen] = useState(false);

  // Only a real handler or a confirmed audio format earns the control (§40: no fake buttons).
  const showListen = Boolean(onListen) || formats?.audio.available === true;
  const count = commentCount ?? article.comment_count ?? 0;

  const actions = (
    <>
      {showListen && (
        <IconButton
          icon={Headphones}
          label={t('reader.listen')}
          pressed={listening}
          disabled={!onListen}
          onClick={onListen}
        />
      )}
      {onSave && (
        <IconButton icon={saved ? BookmarkCheck : Bookmark} label={t('reader.bookmark')} pressed={saved} onClick={onSave} />
      )}
      <IconButton icon={Share2} label={t('reader.share')} onClick={onShare} />
      {onComments && <IconButton icon={MessageCircle} label={t('ui.comments')} badge={count} onClick={onComments} />}
    </>
  );

  return (
    <>
      {/* Under md: fixed bottom bar, slides away while scrolling down. It only
          translates off-screen, so focus-within brings it back the moment a
          keyboard user tabs into it. */}
      <div
        className={cn(
          'glass fixed inset-x-0 bottom-0 z-header border-t border-rule md:hidden',
          'transition-transform duration-base ease-standard focus-within:translate-y-0',
          hidden && 'translate-y-full',
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-page items-center justify-around px-2 py-1">
          <IconButton icon={Type} label={t('reader.fontSize')} onClick={() => setFontOpen(true)} />
          {actions}
        </div>
      </div>
      <FontSizeSheet open={fontOpen} onClose={() => setFontOpen(false)} />

      {/* md and up: inline row. */}
      <div className="hidden items-center gap-3 md:flex">
        <FontSizeGroup />
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
    </>
  );
}
