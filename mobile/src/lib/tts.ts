import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';

import type { TiptapNode } from '@/api/types';

/**
 * Audio news (updated doc §16), v1: the platform's own Telugu voice via
 * expo-speech — Android and iOS both ship te-IN TTS. The §16 server pipeline
 * (generate once → cache → CDN) is the later upgrade; this hook is the player
 * surface either sits behind.
 */

export function extractPlainText(doc: TiptapNode | null): string {
  if (!doc) return '';
  const parts: string[] = [];

  function walk(node: TiptapNode): string {
    if (node.type === 'text') return node.text ?? '';
    const inner = (node.content ?? []).map(walk).join('');
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'pullQuote'].includes(node.type)) {
      if (inner.trim()) parts.push(inner.trim());
      return '';
    }
    return inner;
  }

  walk(doc);
  return parts.join('. ');
}

export function useTts(text: string): { speaking: boolean; toggle: () => void } {
  const [speaking, setSpeaking] = useState(false);

  // Leaving the screen must not leave a ghost narrator running.
  useEffect(
    () => () => {
      void Speech.stop();
    },
    [],
  );

  const toggle = useCallback(() => {
    if (speaking) {
      void Speech.stop();
      setSpeaking(false);
      return;
    }
    if (!text) return;
    setSpeaking(true);
    // expo-speech caps utterance length; speak in sentence-grouped chunks.
    const chunks = text.match(/[\s\S]{1,3500}(?:\.|$)/g) ?? [text];
    chunks.forEach((chunk, index) => {
      Speech.speak(chunk, {
        language: 'te-IN',
        rate: 0.95,
        onDone: index === chunks.length - 1 ? () => setSpeaking(false) : undefined,
        onError: () => setSpeaking(false),
      });
    });
  }, [speaking, text]);

  return { speaking, toggle };
}
