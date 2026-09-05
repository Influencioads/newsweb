import { useCallback, useEffect, useRef, useState } from 'react';

import type { TiptapNode } from '@/types/public';

/**
 * Audio news (updated doc §16) — v1 speaks on the reader's own device via the
 * Web Speech API with the te-IN voice, which costs nothing and needs no
 * backend. The §16 server pipeline (generate once → cache → CDN) remains the
 * upgrade path once a Telugu TTS provider is chosen; this hook is the player
 * surface either implementation sits behind.
 *
 * Voice availability is genuinely uneven (Chrome/Android ships Telugu, many
 * desktops do not), so the state machine includes `unavailable` and the UI
 * downgrades honestly instead of playing English-accented mojibake.
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

export type TtsState = 'idle' | 'speaking' | 'paused' | 'unavailable';

function hasTeluguVoice(): boolean {
  return window.speechSynthesis
    .getVoices()
    .some((voice) => voice.lang.toLowerCase().startsWith('te'));
}

export function useTts(text: string): {
  state: TtsState;
  toggle: () => void;
  stop: () => void;
} {
  const [state, setState] = useState<TtsState>(() =>
    typeof window !== 'undefined' && 'speechSynthesis' in window ? 'idle' : 'unavailable',
  );
  const [voiceReady, setVoiceReady] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoiceReady(hasTeluguVoice());
    update();
    // Chrome populates the voice list asynchronously.
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  useEffect(() => {
    if (state === 'idle' && 'speechSynthesis' in window && !voiceReady) {
      // Voices resolved and none speaks Telugu — say so rather than mangle it.
      const timer = window.setTimeout(() => {
        if (window.speechSynthesis.getVoices().length > 0 && !hasTeluguVoice()) {
          setState('unavailable');
        }
      }, 1500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [state, voiceReady]);

  // Leaving the page must not leave a ghost narrator running.
  useEffect(
    () => () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setState(voiceReady ? 'idle' : 'unavailable');
  }, [voiceReady]);

  const toggle = useCallback(() => {
    if (state === 'unavailable' || !text) return;
    const synth = window.speechSynthesis;

    if (state === 'speaking') {
      synth.pause();
      setState('paused');
      return;
    }
    if (state === 'paused') {
      synth.resume();
      setState('speaking');
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'te-IN';
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('te'));
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.onend = () => setState('idle');
    utterance.onerror = () => setState('idle');
    utteranceRef.current = utterance;
    synth.speak(utterance);
    setState('speaking');
  }, [state, text]);

  return { state, toggle, stop };
}
