import { Fragment, type ReactNode } from 'react';

import type { TiptapNode } from '@/types/public';

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
 */

interface Props {
  doc: TiptapNode | null;
  className?: string;
}

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
        return (
          <code className="rounded bg-rule-soft px-1 py-0.5 font-mono text-[0.9em]">{acc}</code>
        );
      case 'highlight':
        return <mark className="bg-highlight px-0.5">{acc}</mark>;
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        if (!href) return acc;
        const external = /^https?:\/\//i.test(href);
        return (
          <a
            href={href}
            className="text-brand underline underline-offset-2 hover:text-brand-dark"
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

function renderNode(node: TiptapNode, key: string): ReactNode {
  const children = (node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`));

  switch (node.type) {
    case 'doc':
      return <Fragment key={key}>{children}</Fragment>;

    case 'text':
      return <Fragment key={key}>{renderMarks(node.text ?? '', node.marks)}</Fragment>;

    case 'paragraph':
      // `reader-body` scales with the A-/A/A+/A++ switcher and carries lh 1.7 —
      // §4.1 requires >= 1.65x for Telugu.
      return (
        <p key={key} className="te reader-body mb-4 text-ink">
          {children}
        </p>
      );

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4);
      const sizes: Record<number, string> = {
        2: 'text-[24px]',
        3: 'text-[20px]',
        4: 'text-[18px]',
      };
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
      return (
        <Tag key={key} className={`th mb-3 mt-6 font-bold text-ink ${sizes[level]}`}>
          {children}
        </Tag>
      );
    }

    case 'bulletList':
      return (
        <ul key={key} className="te reader-body mb-4 list-disc pl-6 text-ink">
          {children}
        </ul>
      );

    case 'orderedList':
      return (
        <ol key={key} className="te reader-body mb-4 list-decimal pl-6 text-ink">
          {children}
        </ol>
      );

    case 'listItem':
      return (
        <li key={key} className="mb-1.5">
          {children}
        </li>
      );

    case 'blockquote':
    case 'pullQuote':
      return (
        <blockquote
          key={key}
          className="te reader-body mb-4 border-l-4 border-brand bg-paper py-2 pl-4 text-ink-soft"
        >
          {children}
        </blockquote>
      );

    case 'codeBlock':
      return (
        <pre
          key={key}
          className="mb-4 overflow-x-auto rounded-control bg-ink p-3 font-mono text-[13px] text-white"
        >
          <code>{children}</code>
        </pre>
      );

    case 'horizontalRule':
      return <hr key={key} className="my-6 border-rule" />;

    case 'hardBreak':
      return <br key={key} />;

    case 'image': {
      const src = String(node.attrs?.src ?? '');
      if (!src) return null;
      const alt = String(node.attrs?.alt ?? '');
      const width = Number(node.attrs?.width) || undefined;
      const height = Number(node.attrs?.height) || undefined;
      // The CMS embeds the responsive candidates into the node, so an inline
      // body image gets the same width negotiation as the hero rather than
      // always pulling the 1600px rendition.
      const srcSet = node.attrs?.srcset ? String(node.attrs.srcset) : undefined;
      const sizes = node.attrs?.sizes ? String(node.attrs.sizes) : '100vw';
      return (
        <img
          key={key}
          src={src}
          {...(srcSet ? { srcSet } : {})}
          sizes={sizes}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          // Intrinsic size reserves the box before load — §10.3 CLS < 0.1.
          className="mb-0 h-auto w-full rounded-[4px]"
        />
      );
    }

    case 'figure':
      return (
        <figure key={key} className="my-5">
          {children}
        </figure>
      );

    case 'figcaption':
      // §12.5 — the credit travels with the picture, always visible.
      return (
        <figcaption key={key} className="te mt-1.5 text-[12px] leading-telugu text-muted-light">
          {children}
        </figcaption>
      );

    case 'factBox':
      return (
        <aside
          key={key}
          className="mb-4 rounded-control border border-rule bg-paper-sub p-4"
        >
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
  return <div className={className}>{renderNode(doc, 'n')}</div>;
}
