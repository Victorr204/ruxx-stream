import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as NativeSplash from "expo-splash-screen";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import ErrorBoundary from "../utils/ErrorBoundary";
import AppSplash from "../utils/AppSplash";
import { setBootSession } from "../utils/bootSession";
import { useAuthStore } from "../src/stores/auth";
import { useDownloadsStore } from "../src/stores/downloads";

// Keep the native splash up until the JS AppSplash has painted, so the dark
// logo screen reads as one continuous splash (same pattern as ruxx prepaid).
NativeSplash.preventAutoHideAsync().catch(() => {});

const MIN_SPLASH_MS = 2000;

// What the very first screen should be, decided once while the splash is up.
// Signed-in users skip the landing entirely; everyone else starts there.
async function resolveBoot(): Promise<{ targetUrl: string }> {
  const session = useAuthStore.getState().session;
  return { targetUrl: session ? "/home" : "/" };
}

function AppWrapper() {
  const { theme, resolved } = useTheme();
  const [checking, setChecking] = useState(true);
  // Session drives Stack.Protected: (tabs) needs one, login/register don't.
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    const start = Date.now();

    const init = async () => {
      NativeSplash.hideAsync().catch(() => {});

      // Restore the Supabase session (AsyncStorage-backed) before deciding
      // the first screen, so a warm start never flashes the landing.
      await useAuthStore.getState().initialize();

      // Warm the offline manifest so the player can trust getLocalUri();
      // never blocks boot (the downloads tab re-calls it, idempotent).
      useDownloadsStore
        .getState()
        .initialize()
        .catch((error) => console.warn("[downloads] init failed", error));

      const { targetUrl } = await resolveBoot();
      setBootSession({ targetUrl });

      const elapsed = Date.now() - start;
      setTimeout(() => setChecking(false), Math.max(0, MIN_SPLASH_MS - elapsed));
    };

    // A rejection would strand the app on the black AppSplash forever.
    init().catch((error) => {
      console.error("[boot] init failed", error);
      setChecking(false);
    });
  }, []);

  if (checking) return <AppSplash />;

  return (
    <>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />

        {/* Signed-in area: tabs (home / search / downloads / profile). */}
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="admin" />
        </Stack.Protected>

        {/* Guest area: hidden while a session is live. */}
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppWrapper />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
