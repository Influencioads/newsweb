// Per-weight subpaths: the package roots require() every weight, which ships ~5 MB of unused TTFs.
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Fraunces_800ExtraBold } from '@expo-google-fonts/fraunces/800ExtraBold';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { NotoSansTelugu_400Regular } from '@expo-google-fonts/noto-sans-telugu/400Regular';
import { NotoSansTelugu_600SemiBold } from '@expo-google-fonts/noto-sans-telugu/600SemiBold';
import { NotoSansTelugu_700Bold } from '@expo-google-fonts/noto-sans-telugu/700Bold';
import { NotoSerifTelugu_700Bold } from '@expo-google-fonts/noto-serif-telugu/700Bold';
import { NotoSerifTelugu_800ExtraBold } from '@expo-google-fonts/noto-serif-telugu/800ExtraBold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Appearance, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ApiError } from '@/api/client';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { makeStyles, useColors, useThemeName } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';
import { T } from '@/ui/Text';
import { ToastHost } from '@/ui/Toast';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an auth/permission failure — it will not succeed.
        if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoSansTelugu_400Regular,
    NotoSansTelugu_600SemiBold,
    NotoSansTelugu_700Bold,
    NotoSerifTelugu_700Bold,
    NotoSerifTelugu_800ExtraBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Fraunces_600SemiBold,
    Fraunces_800ExtraBold,
  });
  const styles = useStyles();
  const bootstrap = useAuth((s) => s.bootstrap);
  const themePref = usePrefs((s) => s.theme);
  const color = useColors();
  const theme = useThemeName();
  const m = useMotion();
  const { t } = useI18n();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    // Native chrome (keyboard, alerts, system sheets) follows the reader's
    // choice; 'system' hands control back to the OS. Before the persisted
    // prefs hydrate the value is 'system', so this is a no-op until then.
    if (Platform.OS !== 'web') Appearance.setColorScheme(themePref === 'system' ? 'unspecified' : themePref);
  }, [themePref]);

  useEffect(() => {
    // Telugu glyphs clip in fallback fonts, so the splash holds until the real
    // faces are ready (§4.1 — never render Telugu in a substitute face). A
    // failed download still releases the splash rather than holding it forever.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          {/* Status-bar glyphs invert with the theme; a dark bar on a dark
            header is invisible. */}
          <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              animation: m.reduce ? 'none' : 'slide_from_right',
              headerStyle: { backgroundColor: color.paper },
              headerShadowVisible: false,
              headerTintColor: color.brand,
              // Through <T>: native headerTitleStyle drops lineHeight and the 1.3 font-scale cap.
              headerTitle: ({ children }) => (
                <T variant="headlineMd" weight="bold" numberOfLines={1}>
                  {children}
                </T>
              ),
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: color.canvas },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="article/[shortId]" options={{ title: t('screen.article') }} />
            <Stack.Screen name="section/[slug]" options={{ title: t('screen.section') }} />
            <Stack.Screen name="epaper/[date]" options={{ title: t('epaper.title') }} />
            <Stack.Screen name="my-epaper" options={{ title: t('epaper.myEpaper') }} />
            {/* The route draws its own ScreenHeader; the title still names it in the navigator. */}
            <Stack.Screen name="+not-found" options={{ title: t('state.notFound'), headerShown: false }} />
          </Stack>
          <ToastHost />
        </QueryClientProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const useStyles = makeStyles(() => ({
  root: { flex: 1 },
}));
