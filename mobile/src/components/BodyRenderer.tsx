import { Image } from 'expo-image';
import { Fragment, type ReactNode } from 'react';
import { Linking, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { absoluteMediaUrl } from '@/api/client';
import type { TiptapNode } from '@/api/types';
import { useMotion } from '@/lib/motion';
import {
  BODY_FLOOR,
  FONT_SCALE,
  radius,
  readerType,
  space,
  type,
  type TypeVariant,
} from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { hasTelugu, T, type PaletteKey, type TLang } from '@/ui/Text';

/**
 * Tiptap/ProseMirror JSON → React Native.
 *
 * The native half of the renderer pair — the traversal mirrors
 * frontend/src/components/article/ArticleRenderer.tsx node for node, so both
 * surfaces read the same source-of-truth document (§1). Every node becomes a
 * real component; no HTML string ever executes.
 *
 * §4.1: every piece of copy goes through `<T scaled>`, so the reader's
 * A-/A/A+/A++ step scales headings, body, quotes and captions together while
 * Noto keeps its >= 1.65x line-height and the 17sp body floor.
 */

/** Everything the pure render functions need from the render pass. */
interface Ctx {
  styles: ReturnType<typeof useStyles>;
  /** Type step the current block's inline text is drawn at. */
  variant: TypeVariant;
  tone: PaletteKey;
  imageTransition: number;
  /** Vertical nudge that lines a list bullet up with its first line of text. */
  bulletTop: number;
}

/** Heading level → type step (Anek stays at its 1.5x line-height at every step). */
const HEADING: Record<number, TypeVariant> = { 2: 'headlineLg', 3: 'headlineMd', 4: 'headlineSm' };

/** The node's own text, for script detection — `<T>` cannot sniff element children. */
function plain(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plain).join('');
}

function langOf(node: TiptapNode): TLang {
  return hasTelugu(plain(node)) ? 'te' : 'auto';
}

function renderMarks(text: string, marks: TiptapNode['marks'], key: string, ctx: Ctx): ReactNode {
  if (!marks?.length) return <Fragment key={key}>{text}</Fragment>;
  const lang: TLang = hasTelugu(text) ? 'te' : 'auto';
  const common = { variant: ctx.variant, color: ctx.tone, scaled: true, lang } as const;

  return marks.reduce<ReactNode>(
    (acc, mark, i) => {
      const k = `${key}.m${i}`;
      switch (mark.type) {
        case 'bold':
          return (
            <T key={k} {...common} weight="bold">
              {acc}
            </T>
          );
        case 'italic':
          return (
            <T key={k} {...common} style={ctx.styles.italic}>
              {acc}
            </T>
          );
        case 'underline':
          return (
            <T key={k} {...common} style={ctx.styles.underline}>
              {acc}
            </T>
          );
        case 'strike':
          return (
            <T key={k} {...common} style={ctx.styles.strike}>
              {acc}
            </T>
          );
        case 'highlight':
          return (
            <T key={k} {...common} style={ctx.styles.mark}>
              {acc}
            </T>
          );
        case 'code':
          return (
            <T key={k} {...common} style={ctx.styles.codeInline}>
              {acc}
            </T>
          );
        case 'link': {
          const href = String(mark.attrs?.href ?? '');
          if (!href) return acc;
          return (
            <T
              key={k}
              {...common}
              color="brand"
              style={ctx.styles.underline}
              accessibilityRole="link"
              onPress={() => Linking.openURL(href).catch(() => undefined)}
            >
              {acc}
            </T>
          );
        }
        default:
          return acc;
      }
    },
    text as ReactNode,
  );
}

function inlineChildren(node: TiptapNode, key: string, ctx: Ctx): ReactNode[] {
  return (node.content ?? []).map((child, i) => {
    const k = `${key}.${i}`;
    if (child.type === 'text') return renderMarks(child.text ?? '', child.marks, k, ctx);
    if (child.type === 'hardBreak') return <Fragment key={k}>{'\n'}</Fragment>;
    return inlineChildren(child, k, ctx);
  });
}

/** A block whose children are inline text, drawn at `variant`. */
function block(
  node: TiptapNode,
  key: string,
  ctx: Ctx,
  variant: TypeVariant,
  tone: PaletteKey,
  weight: 'regular' | 'bold',
  style: StyleProp<TextStyle>,
  /** `header` gives a screen reader the landmark it navigates the story by. */
  role?: 'header',
): ReactNode {
  const inner: Ctx = { ...ctx, variant, tone };
  return (
    <T
      key={key}
      variant={variant}
      weight={weight}
      color={tone}
      scaled
      lang={langOf(node)}
      style={style}
      accessibilityRole={role}
    >
      {inlineChildren(node, key, inner)}
    </T>
  );
}

function children(node: TiptapNode, key: string, ctx: Ctx): ReactNode[] {
  return (node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`, ctx));
}

function renderNode(node: TiptapNode, key: string, ctx: Ctx): ReactNode {
  switch (node.type) {
    case 'doc':
      return <Fragment key={key}>{children(node, key, ctx)}</Fragment>;

    case 'paragraph':
      return block(node, key, ctx, 'body', 'ink', 'regular', ctx.styles.paragraph);

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4);
      return block(node, key, ctx, HEADING[level], 'ink', 'bold', ctx.styles.heading, 'header');
    }

    case 'bulletList':
    case 'orderedList':
      return (
        <View key={key} style={ctx.styles.list}>
          {(node.content ?? []).map((item, i) => (
            <View key={`${key}.${i}`} style={ctx.styles.item}>
              {node.type === 'orderedList' ? (
                <T variant="body" scaled color="muted" lang="en">
                  {`${i + 1}.`}
                </T>
              ) : (
                <View
                  style={[ctx.styles.dot, { marginTop: ctx.bulletTop }]}
                  aria-hidden
                />
              )}
              <View style={ctx.styles.itemBody}>{children(item, `${key}.${i}`, ctx)}</View>
            </View>
          ))}
        </View>
      );

    case 'listItem':
      // A list item reached on its own (a nested list, or a stray node).
      return (
        <View key={key} style={ctx.styles.itemBody}>
          {children(node, key, ctx)}
        </View>
      );

    case 'blockquote':
    case 'pullQuote':
      return (
        <View key={key} style={ctx.styles.quote}>
          {children(node, key, ctx)}
        </View>
      );

    case 'highlight':
      return (
        <View key={key} style={ctx.styles.highlight}>
          {children(node, key, ctx)}
        </View>
      );

    case 'code':
    case 'codeBlock':
      return (
        <View key={key} style={ctx.styles.codeBlock}>
          {block(node, key, ctx, 'bodySmall', 'inkSoft', 'regular', ctx.styles.codeText)}
        </View>
      );

    case 'horizontalRule':
      return <View key={key} style={ctx.styles.rule} />;

    case 'image': {
      const src = absoluteMediaUrl(String(node.attrs?.src ?? ''));
      if (!src) return null;
      const width = Number(node.attrs?.width) || 16;
      const height = Number(node.attrs?.height) || 9;
      // No alt = decorative: skipped by a screen reader rather than announced
      // as a nameless image. expo-image is not accessible by default, so the
      // flag has to be set for the alt to reach the tree at all.
      const alt = String(node.attrs?.alt ?? '') || undefined;
      return (
        <Image
          key={key}
          source={{ uri: src }}
          style={[ctx.styles.image, { aspectRatio: width / height }]}
          contentFit="cover"
          transition={ctx.imageTransition}
          accessible={alt !== undefined}
          accessibilityLabel={alt}
        />
      );
    }

    case 'figure':
      return (
        <View key={key} style={ctx.styles.figure}>
          {children(node, key, ctx)}
        </View>
      );

    case 'figcaption':
      return block(node, key, ctx, 'meta', 'muted', 'regular', ctx.styles.caption);

    case 'factBox':
      return (
        <View key={key} style={ctx.styles.factBox}>
          {children(node, key, ctx)}
        </View>
      );

    case 'text':
      // A stray inline node at block level — wrap it so it still shows.
      return (
        <T key={key} variant="body" scaled lang={langOf(node)}>
          {renderMarks(node.text ?? '', node.marks, key, ctx)}
        </T>
      );

    default:
      // Unknown block: render its children rather than dropping reader text.
      return <Fragment key={key}>{children(node, key, ctx)}</Fragment>;
  }
}

export function BodyRenderer({ doc }: { doc: TiptapNode | null }) {
  const fontStep = usePrefs((s) => s.fontStep);
  const styles = useStyles();
  const m = useMotion();
  if (!doc) return null;

  const line = readerType(type.body, FONT_SCALE[fontStep], BODY_FLOOR).lineHeight;
  const ctx: Ctx = {
    styles,
    variant: 'body',
    tone: 'ink',
    imageTransition: m.imageTransition,
    bulletTop: Math.round(line / 2) - 3,
  };
  return <View>{renderNode(doc, 'n', ctx)}</View>;
}

const useStyles = makeStyles((color) => ({
  paragraph: { marginBottom: space.md },
  heading: { marginTop: space.lg, marginBottom: space.sm },
  list: { marginBottom: space.md, gap: space.sm },
  item: { flexDirection: 'row', gap: space.md },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: color.ink },
  itemBody: { flex: 1 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: color.brand,
    backgroundColor: color.paperSub,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  highlight: {
    backgroundColor: color.highlight,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.md,
  },
  codeBlock: {
    backgroundColor: color.paperSub,
    borderLeftWidth: 3,
    borderLeftColor: color.ruleStrong,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    padding: space.md,
    marginBottom: space.md,
  },
  codeText: { marginBottom: 0 },
  codeInline: { backgroundColor: color.paperSub },
  mark: { backgroundColor: color.highlight },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.rule, marginVertical: space.xl },
  image: { width: '100%', borderRadius: radius.sm, backgroundColor: color.placeholder },
  figure: { marginVertical: space.md },
  caption: { marginTop: space.xs },
  factBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    borderRadius: radius.md,
    backgroundColor: color.paperSub,
    padding: space.lg,
    marginBottom: space.md,
  },
}));
