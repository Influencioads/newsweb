import {
  AnekTelugu_700Bold,
  AnekTelugu_800ExtraBold,
} from "@expo-google-fonts/anek-telugu";
import {
  NotoSansTelugu_400Regular,
  NotoSansTelugu_600SemiBold,
  NotoSansTelugu_700Bold,
  useFonts,
} from "@expo-google-fonts/noto-sans-telugu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ApiError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useColors, useThemeName } from "@/lib/useTheme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an auth/permission failure — it will not succeed.
        if (
          error instanceof ApiError &&
          [401, 403, 404, 422].includes(error.status)
        )
          return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    NotoSansTelugu_400Regular,
    NotoSansTelugu_600SemiBold,
    NotoSansTelugu_700Bold,
    AnekTelugu_700Bold,
    AnekTelugu_800ExtraBold,
  });
  const bootstrap = useAuth((s) => s.bootstrap);
  const color = useColors();
  const theme = useThemeName();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    // Telugu glyphs clip in fallback fonts, so the splash holds until the real
    // faces are ready (§4.1 — never render Telugu in a substitute face).
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        {/* Status-bar glyphs invert with the theme; a dark bar on a dark
          header is invisible. */}
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: color.paper },
            headerTintColor: color.brand,
            headerTitleStyle: {
              fontFamily: "AnekTelugu_700Bold",
              color: color.brand,
            },
            contentStyle: { backgroundColor: color.canvas },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="article/[shortId]" options={{ title: "" }} />
          <Stack.Screen name="section/[slug]" options={{ title: "" }} />
          <Stack.Screen name="epaper/[date]" options={{ title: "E-Paper" }} />
          <Stack.Screen name="my-epaper" options={{ title: "My E-Paper" }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
