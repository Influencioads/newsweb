import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { attachEngine, usePlayer } from '@/stores/player';

/**
 * PlayerHost — rendered once, in the root layout, and never unmounted: it owns
 * the app's single expo-audio player, which is why a bulletin keeps playing
 * while the reader moves between screens.
 *
 * It renders nothing. It sets the audio session up once (plays through the
 * silent switch, keeps going in the background, takes audio focus — the last
 * is what lets the lock-screen controls attach), hands the player to the
 * store, and announces each new track to screen readers.
 *
 * The web build's server render skips it: expo-audio needs the browser's
 * `Audio`, which a server doesn't have. The client adds it once it has loaded.
 */
export function PlayerHost() {
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  return client ? <AudioEngine /> : null;
}

const noSubscribe = () => () => undefined;

function AudioEngine() {
  const player = useAudioPlayer(null);
  const { t } = useI18n();
  const title = usePlayer((s) => s.queue[s.index]?.title);
  const id = usePlayer((s) => s.queue[s.index]?.id);
  const nowPlaying = t('player.nowPlaying');

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);
  }, []);

  useEffect(() => attachEngine(player), [player]);

  useEffect(() => {
    if (id && title) AccessibilityInfo.announceForAccessibility(`${nowPlaying}: ${title}`);
  }, [id, title, nowPlaying]);

  return null;
}
