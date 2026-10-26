import { Fragment, type ReactNode } from 'react';

import { linkClass } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

/**
 * Markdown-lite for Sanjaya's replies: paragraphs, "- " / "1. " lists,
 * **bold**, "# " headings (drawn bold) and bare http(s) links. Everything is
 * built as React elements, so whatever the model writes, "<script>" included,
 * reaches the page as text — never dangerouslySetInnerHTML.
 */

const TELUGU = /[ఀ-౿]/;

/** lang + font for text whose script we only learn by reading it (model output, tool labels). */
export function scriptOf(text: string): { lang: 'te' | 'en'; cls: 'te' | 'font-sans' } {
  return TELUGU.test(text) ? { lang: 'te', cls: 'te' } : { lang: 'en', cls: 'font-sans' };
}

/** Only http(s) and same-origin paths reach an href: a model can write `javascript:` as easily as a link. */
export function safeHref(url: string | null | undefined): string | undefined {
  return url && (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) ? url : undefined;
}

// Split keeps the captured tokens at odd indexes; bold wins over a link inside it.
const INLINE = /(\*\*[^*\n]+?\*\*|https?:\/\/[^\s<>"']+)/;
const TRAILING = /[.,;:!?)\]'"]+$/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith('**')) {
      return (
        <strong key={i} className="font-bold">
          {inline(part.slice(2, -2))}
        </strong>
      );
    }
    const url = part.replace(TRAILING, '');
    return (
      <Fragment key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'break-all')}>
          {url}
        </a>
        {part.slice(url.length)}
      </Fragment>
    );
  });
}

type Block = { kind: 'p' | 'ul' | 'ol'; items: string[]; start: number };

function parse(text: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      cur = null;
      continue;
    }
    const ul = /^[-*•]\s+(.+)$/.exec(line);
    const ol = /^(\d{1,3})[.)]\s+(.+)$/.exec(line);
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    const kind = ul ? 'ul' : ol ? 'ol' : 'p';
    const block: Block = cur && cur.kind === kind ? cur : { kind, items: [], start: Number(ol?.[1] ?? 1) };
    if (block !== cur) out.push(block);
    // "## **Top stories**" is common model output: drop its own ** before wrapping, or they show.
    block.items.push(ul?.[1] ?? ol?.[2] ?? (h ? `**${(h[1] ?? '').replace(/\*\*/g, '')}**` : line));
    cur = block;
  }
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('space-y-2 break-words', className)}>
      {parse(text).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.items.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 ps-5">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start} className="list-decimal space-y-1 ps-5">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
