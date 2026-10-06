import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { getSupabase, isSupabaseConfigured } from "./supabase";

// Push + local notifications. Native only (web has no notification story —
// every entry point no-ops there). The downloads store fires local
// notifications when a seal finishes; registerForPush() hands the Expo
// push token to the push_tokens table so the send-push edge function can
// fan announcements out to every device.

const ANDROID_CHANNEL_ID = "ruxx-updates";

const isNative = Platform.OS !== "web";

if (isNative) {
  // Foreground downloads still announce themselves — without a handler
  // expo-notifications swallows notifications while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
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
    await ensureAndroidChannel();
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
  // token's unique constraint can't reject the upsert.
  const { error: purgeError } = await sb.from("push_tokens").delete().eq("token", token);
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
  try {
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
    await ensureAndroidChannel();
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
