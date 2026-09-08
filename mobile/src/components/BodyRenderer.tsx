import { Image } from 'expo-image';
import { Fragment, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { absoluteMediaUrl } from '@/api/client';
import type { TiptapNode } from '@/api/types';
import { usePrefs } from '@/stores/prefs';
import { font, FONT_SCALE, type Palette } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';

/**
 * Tiptap/ProseMirror JSON → React Native.
 *
 * The native half of the renderer pair — the traversal mirrors
 * frontend/src/components/article/ArticleRenderer.tsx node for node, so both
 * surfaces read the same source-of-truth document (§1). Every node becomes a
 * real component; no HTML string ever executes.
 *
 * §4.1: Telugu body text scales with the reader's A-/A/A+/A++ choice and keeps
 * a >= 1.65× line-height at every step.
 */

/** Everything the pure render functions need from the render pass. */
interface Ctx {
  scale: number;
  styles: ReturnType<typeof useStyles>;
  color: Palette;
}

function textStyle(ctx: Ctx) {
  return {
    fontFamily: font.telugu,
    fontSize: 17 * ctx.scale,
    lineHeight: 29 * ctx.scale,
    color: ctx.color.ink,
  } as const;
}

function renderMarks(text: string, marks: TiptapNode['marks'], key: string, ctx: Ctx): ReactNode {
  if (!marks?.length) return <Fragment key={key}>{text}</Fragment>;

  return marks.reduce<ReactNode>(
    (acc, mark, i) => {
      const k = `${key}.m${i}`;
      switch (mark.type) {
        case 'bold':
          return (
            <Text key={k} style={{ fontFamily: font.teluguBold }}>
              {acc}
            </Text>
          );
        case 'italic':
          return (
            <Text key={k} style={{ fontStyle: 'italic' }}>
              {acc}
            </Text>
          );
        case 'underline':
          return (
            <Text key={k} style={{ textDecorationLine: 'underline' }}>
              {acc}
            </Text>
          );
        case 'strike':
          return (
            <Text key={k} style={{ textDecorationLine: 'line-through' }}>
              {acc}
            </Text>
          );
        case 'highlight':
          return (
            <Text key={k} style={{ backgroundColor: '#FBE9A9' }}>
              {acc}
            </Text>
          );
        case 'link': {
          const href = String(mark.attrs?.href ?? '');
          if (!href) return acc;
          return (
            <Text
              key={k}
              style={{ color: ctx.color.brand, textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL(href).catch(() => undefined)}
            >
              {acc}
            </Text>
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

function renderNode(node: TiptapNode, key: string, ctx: Ctx): ReactNode {
  switch (node.type) {
    case 'doc':
      return (
        <Fragment key={key}>
          {(node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`, ctx))}
        </Fragment>
      );

    case 'paragraph':
      return (
        <Text key={key} style={[textStyle(ctx), ctx.styles.paragraph]}>
          {inlineChildren(node, key, ctx)}
        </Text>
      );

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4);
      const sizes: Record<number, number> = { 2: 22, 3: 19, 4: 17 };
      return (
        <Text
          key={key}
          style={[
            ctx.styles.heading,
            { fontSize: sizes[level] * ctx.scale, lineHeight: sizes[level] * 1.5 * ctx.scale },
          ]}
        >
          {inlineChildren(node, key, ctx)}
        </Text>
      );
    }

    case 'bulletList':
    case 'orderedList':
      return (
        <View key={key} style={ctx.styles.list}>
          {(node.content ?? []).map((item, i) => (
            <View key={`${key}.${i}`} style={ctx.styles.listItem}>
              <Text style={[textStyle(ctx), ctx.styles.bullet]}>
                {node.type === 'orderedList' ? `${i + 1}.` : '•'}
              </Text>
              <View style={ctx.styles.listItemBody}>
                {(item.content ?? []).map((child, j) => renderNode(child, `${key}.${i}.${j}`, ctx))}
              </View>
            </View>
          ))}
        </View>
      );

    case 'blockquote':
    case 'pullQuote':
      return (
        <View key={key} style={ctx.styles.quote}>
          {(node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`, ctx))}
        </View>
      );

    case 'horizontalRule':
      return <View key={key} style={ctx.styles.rule} />;

    case 'image': {
      const src = absoluteMediaUrl(String(node.attrs?.src ?? ''));
      if (!src) return null;
      const width = Number(node.attrs?.width) || 16;
      const height = Number(node.attrs?.height) || 9;
      return (
        <Image
          key={key}
          source={{ uri: src }}
          style={[ctx.styles.image, { aspectRatio: width / height }]}
          contentFit="cover"
          transition={150}
          accessibilityLabel={String(node.attrs?.alt ?? '')}
        />
      );
    }

    case 'figure':
      return (
        <View key={key} style={ctx.styles.figure}>
          {(node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`, ctx))}
        </View>
      );

    case 'figcaption':
      return (
        <Text key={key} style={ctx.styles.caption}>
          {inlineChildren(node, key, ctx)}
        </Text>
      );

    case 'factBox':
      return (
        <View key={key} style={ctx.styles.factBox}>
          {(node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`, ctx))}
        </View>
      );

    case 'text':
      // A stray inline node at block level — wrap it so it still shows.
      return (
        <Text key={key} style={textStyle(ctx)}>
          {renderMarks(node.text ?? '', node.marks, key, ctx)}
        </Text>
      );

    default:
      // Unknown block: render its children rather than dropping reader text.
      return (
        <Fragment key={key}>
          {(node.content ?? []).map((child, i) => renderNode(child, `${key}.${i}`, ctx))}
        </Fragment>
      );
  }
}

export function BodyRenderer({ doc }: { doc: TiptapNode | null }) {
  const fontStep = usePrefs((s) => s.fontStep);
  const styles = useStyles();
  const color = useColors();
  if (!doc) return null;
  return <View>{renderNode(doc, 'n', { scale: FONT_SCALE[fontStep], styles, color })}</View>;
}

const useStyles = makeStyles((color) => ({
  paragraph: { marginBottom: 14 },
  heading: { fontFamily: font.teluguBold, color: color.ink, marginTop: 16, marginBottom: 8 },
  list: { marginBottom: 14, gap: 6 },
  listItem: { flexDirection: 'row', gap: 8 },
  bullet: { marginBottom: 0 },
  listItemBody: { flex: 1 },
  quote: {
    borderLeftWidth: 4,
    borderLeftColor: color.brand,
    backgroundColor: color.paperSub,
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  rule: { height: 1, backgroundColor: color.rule, marginVertical: 18 },
  image: { width: '100%', borderRadius: 4, backgroundColor: color.placeholder },
  figure: { marginVertical: 12 },
  caption: {
    fontFamily: font.telugu,
    fontSize: 12,
    lineHeight: 19,
    color: color.mutedLight,
    marginTop: 6,
  },
  factBox: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 8,
    backgroundColor: color.paperSub,
    padding: 12,
    marginBottom: 14,
  },
}));
