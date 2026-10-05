import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as NativeSplash from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import ErrorBoundary from "../utils/ErrorBoundary";
import AppSplash from "../utils/AppSplash";
import { setBootSession } from "../utils/bootSession";

// Keep the native splash up until the JS AppSplash has painted, so the dark
// logo screen reads as one continuous splash (same pattern as ruxx prepaid).
NativeSplash.preventAutoHideAsync().catch(() => {});

const MIN_SPLASH_MS = 2000;

// What the very first screen should be, decided once while the splash is up.
// Returning visitors with a live session get handed to their home screen by
// the landing page's rerouting logic; everyone else stays on the landing.
async function resolveBoot(_firstLaunch: boolean): Promise<{ targetUrl: string }> {
  return { targetUrl: "/" };
}

function AppWrapper() {
  const { theme } = useTheme();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const start = Date.now();

    const init = async () => {
      NativeSplash.hideAsync().catch(() => {});

      let firstLaunch = false;
      try {
        const seen = await AsyncStorage.getItem("hasSeenLanding");
        if (!seen) {
          firstLaunch = true;
          await AsyncStorage.setItem("hasSeenLanding", "true");
        }
      } catch {
        firstLaunch = true;
      }

      // First screen decision: signed-in users are handed off by the landing
      // screen (see app/index.jsx rerouting) as soon as the session resolves.
      const { targetUrl } = await resolveBoot(firstLaunch);
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
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
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
