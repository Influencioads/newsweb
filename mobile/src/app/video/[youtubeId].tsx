import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { color } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

/**
 * Video player (§15, YouTube links only): the privacy-enhanced embed inside a
 * WebView. Autoplay here is fine — the reader explicitly tapped the card.
 */
export default function VideoPlayerScreen() {
  const styles = useStyles();
  const { youtubeId, title } = useLocalSearchParams<{ youtubeId: string; title?: string }>();

  return (
    <>
      <Stack.Screen options={{ title: title ?? '' }} />
      <View style={styles.container}>
        <WebView
          source={{
            uri: `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&playsinline=1`,
          }}
          style={styles.player}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
        />
      </View>
    </>
  );
}

const useStyles = makeStyles((color) => ({
  container: { flex: 1, backgroundColor: '#000' },
  player: { flex: 1, backgroundColor: '#000' },
}));
