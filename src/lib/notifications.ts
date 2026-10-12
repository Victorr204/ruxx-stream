import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router } from "expo-router";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { useAuthStore } from "../stores/auth";

// Push + local notifications. Native only (web has no notification story —
// every entry point no-ops there). The downloads store fires local
// notifications when a seal finishes; registerForPush() hands the Expo
// push token to the push_tokens table so the send-push edge function can
// fan announcements out to every device.
//
// expo-notifications throws while loading inside Expo Go (remote push was
// removed in SDK 53): the import dies halfway through evaluating the module,
// Metro keeps the half-built exports object, and callers then see
// `setNotificationHandler is not a function` / `AndroidImportance of
// undefined`. So on Android+Expo Go the module is never required at all and
// every entry point degrades to a no-op instead of taking the router down
// with a red-box import error. Run `npx expo run:android` (dev build) to get
// real push + local notifications.

type NotificationsModule = typeof import("expo-notifications");

const ANDROID_CHANNEL_ID = "ruxx-updates";

const isNative = Platform.OS !== "web";
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Push pipeline + local notifications are unusable on Android inside Expo Go. */
const notificationsSupported = isNative && !(isExpoGo && Platform.OS === "android");

let notificationsPromise: Promise<NotificationsModule | null> | undefined;

function loadNotifications(): Promise<NotificationsModule | null> {
  if (!notificationsPromise) {
    notificationsPromise = (async () => {
      if (!notificationsSupported) return null;
      try {
        const mod = await import("expo-notifications");
        // A module that throws mid-load never rejects here — it resolves to a
        // hollow exports object. Treat a missing API as "not available".
        if (typeof mod.setNotificationHandler !== "function" || !mod.AndroidImportance) {
          console.warn("[notifications] module incomplete in this environment; notifications disabled");
          return null;
        }
        // Foreground downloads still announce themselves — without a
        // handler expo-notifications swallows notifications while the
        // app is open.
        try {
          mod.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowBanner: true,
              shouldShowList: true,
              shouldPlaySound: false,
              shouldSetBadge: false,
            }),
          });
        } catch (e) {
          console.warn("[notifications] handler install failed", e);
        }
        return mod;
      } catch (e) {
        console.warn("[notifications] unavailable in this environment; notifications disabled", e);
        return null;
      }
    })();
  }
  return notificationsPromise;
}

if (isNative) {
  // Kick the lazy load off at startup so the notification handler is in
  // place before anything can fire; failures are captured in the loader.
  void loadNotifications();
}

async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Downloads & news",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 150],
    lightColor: "#e8b84a",
  });
}

/** Current permission state without prompting (false on web/TV-less devices). */
export async function notificationPermissionGranted(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return false;
    const status = await Notifications.getPermissionsAsync();
    return status.granted;
  } catch {
    return false;
  }
}

/** Request notification permission (creating the Android channel first). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return false;
    await ensureAndroidChannel(Notifications);
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch (e) {
    console.warn("[notifications] permission request failed", e);
    return false;
  }
}

async function savePushToken(token: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = getSupabase();
  const { data: authData } = await sb.auth.getUser();
  if (!authData.user) return;

  // Same device, different account: drop the old holder's row first so the
  // token's unique constraint can't reject the upsert. RLS exposes only the
  // caller's own rows, so the purge goes through the definer RPC.
  const { error: purgeError } = await sb.rpc("release_push_token", { p_token: token });
  if (purgeError) console.warn("[notifications] token purge failed", purgeError.message);

  const { error } = await sb
    .from("push_tokens")
    .upsert(
      {
        user_id: authData.user.id,
        token,
        platform: Platform.OS === "ios" ? "ios" : "android",
      },
      { onConflict: "user_id" }
    );
  if (error) console.warn("[notifications] token save failed", error.message);
}

/**
 * Ask for permission and persist the Expo push token for this account.
 * Returns the token, or null when unsupported/denied/unreachable.
 */
export async function registerForPush(): Promise<string | null> {
  if (!isNative) return null;
  if (isExpoGo) {
    // Expo Go stopped issuing push tokens in SDK 53 — nothing to register.
    console.warn("[notifications] push registration requires a dev build (npx expo run:android), not Expo Go");
    return null;
  }
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return null;

    const granted = await ensureNotificationPermission();
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse?.data;
    if (!token) return null;

    await savePushToken(token);
    return token;
  } catch (e) {
    // No EAS project yet (bare dev client) — push fan-out can wait.
    console.warn("[notifications] push registration failed", e);
    return null;
  }
}

/** Fire the local "download ready" notification (silent if permission was denied). */
export async function notifyDownloadReady(title: string): Promise<void> {
  if (!isNative) return;
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;
    await ensureAndroidChannel(Notifications);
    const status = await Notifications.getPermissionsAsync();
    if (!status.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Download ready",
        body: `"${title}" is saved and ready to watch offline.`,
        sound: false,
        data: { kind: "download_ready" },
      },
      trigger: null,
    });
  } catch (e) {
    console.warn("[notifications] local notification failed", e);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function navigateForNotification(data: Record<string, unknown> | null | undefined): void {
  // A tap while signed out stays on the auth screens — the payload can wait
  // for the next launch.
  if (!useAuthStore.getState().session) return;
  const movieId = typeof data?.movie_id === "string" ? data.movie_id : "";
  if (UUID_RE.test(movieId)) {
    router.push(`/player/${movieId}`);
    return;
  }
  if (data?.kind === "download_ready") {
    router.push("/downloads");
    return;
  }
  // Announcements (and anything payload-less) land on Home.
  router.push("/home");
}

// The cold-start response persists across the whole app session, so it may
// only be consumed once per launch — otherwise every re-mount re-navigates.
let coldStartHandled = false;

/**
 * Routes notification taps: call once the navigation stack is mounted (it
 * pushes routes, so it must not run during the splash/boot gate). Returns a
 * cleanup that detaches the listener.
 */
export function setupNotificationTaps(): () => void {
  if (!notificationsSupported) return () => {};
  let subscription: { remove: () => void } | undefined;
  void loadNotifications().then((mod) => {
    if (!mod) return;
    subscription = mod.addNotificationResponseReceivedListener((response) => {
      try {
        navigateForNotification(response?.notification?.request?.content?.data);
      } catch (e) {
        console.warn("[notifications] tap routing failed", e);
      }
    });
    if (!coldStartHandled) {
      coldStartHandled = true;
      void mod
        .getLastNotificationResponseAsync()
        .then((response) => {
          if (response) navigateForNotification(response.notification?.request?.content?.data);
        })
        .catch(() => {});
    }
  });
  return () => {
    subscription?.remove();
  };
}
