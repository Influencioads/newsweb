import { cn } from '@/utils/cn';

/**
 * Wordmark — the newspaper-style masthead title: WOW · logo · INDIA on one
 * line, the way a broadsheet sets its name either side of a crest. The crest
 * is the WowIndian logo itself; the words are live type in Fraunces Black caps
 * (already loaded for headlines), so they stay crisp at every size.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      lang="en"
      className={cn(
        'flex items-center gap-2 whitespace-nowrap font-serif font-black uppercase leading-none text-ink md:gap-3',
        'text-wordmark-sm md:text-wordmark',
        className,
      )}
      // Fraunces at its display optical size, without the soft / wonky forms.
      style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}
    >
      <span>Wow</span>
      <img
        src="/wow-indian-logo.webp"
        alt=""
        width={960}
        height={260}
        className="h-[1.5em] w-auto shrink-0"
      />
      <span>India</span>
    </span>
  );
}
