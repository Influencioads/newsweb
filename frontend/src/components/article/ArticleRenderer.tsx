import { Fragment, type ReactNode } from 'react';

import { ImageCaption, NewsImage } from '@/components/media/NewsImage';
import type { MediaOut, TiptapNode } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * Tiptap/ProseMirror JSON -> React.
 *
 * §1 makes the JSON document the source of truth precisely so it can render
 * "natively on web AND app". This module is the web half of the
 * `packages/article-renderer` the Build Instructions describe: it holds **no**
 * web-specific assumptions in its traversal logic, so the same node-type switch
 * can be re-implemented against React Native primitives without touching the
 * data model.
 *
 * Never `dangerouslySetInnerHTML`. Every node becomes a real React element, so a
 * script tag a stringer pasted in from a website cannot execute even if it
 * somehow survived the backend sanitiser (§12.1 — defence in depth).
 *
 * Every block is Telugu body copy: `lang="te"`, the `te` font class and one of
 * the `.reader-*` sizes, so the A-/A/A+/A++ switcher resizes paragraphs,
 * headings, quotes and captions together. The output carries `.reader-column`
 * for the same reason.
 */

interface Props {
  doc: TiptapNode | null;
  className?: string;
}

/** Body copy: Telugu font + the scale the reader chose. */
const BODY = 'te reader-body text-ink';

function renderMarks(text: string, marks: TiptapNode['marks']): ReactNode {
  if (!marks?.length) return text;

  return marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong className="font-bold">{acc}</strong>;
      case 'italic':
        return <em className="italic">{acc}</em>;
      case 'underline':
        return <u>{acc}</u>;
      case 'strike':
        return <s>{acc}</s>;
      case 'code':
        // No size: code inherits the surrounding .reader-body, so it follows
        // the reader scale like everything else in the column.
        return <code className="rounded-xl bg-rule-soft px-1.5 py-0.5 font-mono">{acc}</code>;
      case 'highlight':
        return <mark className="rounded-xl bg-highlight px-1 text-ink">{acc}</mark>;
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        if (!href) return acc;
        const external = /^https?:\/\//i.test(href);
        return (
          <a
            href={href}
            className="text-brand underline underline-offset-4 transition-colors duration-base ease-standard hover:text-brand-dark"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
          >
            {acc}
          </a>
        );
      }
      default:
        return acc;
    }
  }, text);
}

/** A body image node as the MediaOut shape `NewsImage` / `ImageCaption` read. */
function nodeMedia(node: TiptapNode, src: string): MediaOut {
  const width = Number(node.attrs?.width) || null;
  const height = Number(node.attrs?.height) || null;
  return {
    id: 0,
    url: src,
    // The CMS embeds the responsive candidates into the node, so a body image
    // gets the same width negotiation as the hero.
    srcset: node.attrs?.srcset ? String(node.attrs.srcset) : null,
    alt_te: node.attrs?.alt ? String(node.attrs.alt) : null,
    caption_te: node.attrs?.caption ? String(node.attrs.caption) : null,
    credit: node.attrs?.credit ? String(node.attrs.credit) : null,
    license_label: null,
    source_url: null,
    width,
    height,
    blurhash: null,
    ai_generated: node.attrs?.ai_generated === true,
  };
}

function headingClass(level: number): string {
  if (level === 2) return 'reader-h2';
  if (level === 3) return 'reader-h3';
  return 'reader-small';
}

function renderNode(node: TiptapNode, key: string): ReactNode {
  const children = (node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`));

  switch (node.type) {
    case 'doc':
      return <Fragment key={key}>{children}</Fragment>;

    case 'text':
      return <Fragment key={key}>{renderMarks(node.text ?? '', node.marks)}</Fragment>;

    case 'paragraph':
      return (
        <p key={key} lang="te" className={cn(BODY, 'mb-5')}>
          {children}
        </p>
      );

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4);
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
      return (
        <Tag key={key} lang="te" className={cn('th mb-3 mt-8 font-bold text-ink', headingClass(level))}>
          {children}
        </Tag>
      );
    }

    case 'bulletList':
      return (
        <ul key={key} lang="te" className={cn(BODY, 'mb-5 list-disc pl-6 marker:text-brand')}>
          {children}
        </ul>
      );

    case 'orderedList':
      return (
        <ol key={key} lang="te" className={cn(BODY, 'mb-5 list-decimal pl-6 marker:font-semibold marker:text-brand')}>
          {children}
        </ol>
      );

    case 'listItem':
      return (
        <li key={key} className="mb-2 pl-1">
          {children}
        </li>
      );

    case 'blockquote':
    case 'pullQuote':
      return (
        <blockquote
          key={key}
          lang="te"
          className={cn(BODY, 'mb-5 rounded-r-xl border-l-4 border-brand bg-paper-sub py-3 pl-4 pr-3 text-ink-soft')}
        >
          {children}
        </blockquote>
      );

    case 'codeBlock':
      return (
        <pre key={key} className="mb-5 overflow-x-auto rounded-xl bg-ink p-4 font-mono text-ui-sm text-on-ink">
          <code>{children}</code>
        </pre>
      );

    case 'horizontalRule':
      return <hr key={key} className="my-8 border-rule" />;

    case 'hardBreak':
      return <br key={key} />;

    case 'image': {
      const src = String(node.attrs?.src ?? '');
      if (!src) return null;
      const media = nodeMedia(node, src);
      // Intrinsic ratio when the CMS recorded one, so the box reserves exactly
      // the right space and nothing is cropped (§10.3, CLS < 0.1).
      const ratio = media.width && media.height ? `${media.width}/${media.height}` : '16/9';
      return (
        <figure key={key} className="my-6">
          <NewsImage media={media} ratio={ratio} radius="2xl" sizes="(max-width: 768px) 100vw, 680px" />
          <ImageCaption media={media} />
        </figure>
      );
    }

    case 'figure':
      return (
        <figure key={key} className="my-6">
          {children}
        </figure>
      );

    case 'figcaption':
      // §12.5 — the credit travels with the picture, always visible.
      return (
        <figcaption key={key} lang="te" className="te reader-caption mt-2 text-muted">
          {children}
        </figcaption>
      );

    case 'factBox':
      return (
        <aside key={key} className="mb-5 rounded-xl border border-rule bg-paper-sub p-4 shadow-card">
          {children}
        </aside>
      );

    default:
      // Unknown block: render its children rather than dropping reader-visible text.
      return <Fragment key={key}>{children}</Fragment>;
  }
}

export function ArticleRenderer({ doc, className }: Props) {
  if (!doc) return null;
  return <div className={cn('reader-column', className)}>{renderNode(doc, 'n')}</div>;
}
