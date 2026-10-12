import { create } from "zustand";
import { Platform } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { clearBootSession } from "../../utils/bootSession";
import type { Profile } from "../lib/types";
import { isDesktopShell } from "../lib/platform";
import { useAdsConfig } from "./adsConfig";

// Auth state for the whole app: the session drives route guards in
// app/_layout.tsx, and the profile row (role, is_premium, display name)
// feeds the profile tab and admin checks.

export type SignUpResult =
  | { kind: "ok" }
  | { kind: "verify" }
  | { kind: "error"; message: string };

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  initialized: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>;
  sendPasswordReset: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

let authSubscription: { unsubscribe: () => void } | null = null;

// Auth email links must land somewhere a mail client can open. In the
// desktop shell the origin is app://app — which nothing outside the app
// can navigate to — so those links point at the website instead; native
// builds keep the ruxxstream:// deep link.
function authEmailRedirect(): string {
  if (Platform.OS !== "web") return "ruxxstream://reset-password";
  if (isDesktopShell()) {
    return `${process.env.EXPO_PUBLIC_SITE_URL || window.location.origin}/reset-password`;
  }
  return `${window.location.origin}/reset-password`;
}

function friendlyAuthError(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) {
    return "Can't connect. Check your internet connection and try again.";
  }
  if (msg.includes("rate limit") || msg.includes("too many") || msg.includes("429")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
    return "Incorrect email or password.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please verify your email before signing in.";
  }
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (msg.includes("password") && msg.includes("least")) {
    return "Password must be at least 8 characters.";
  }
  if (msg.includes("valid email")) {
    return "Please enter a valid email address.";
  }
  return message || "Something went wrong. Please try again.";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    if (!isSupabaseConfigured) {
      set({ initialized: true });
      return;
    }
    const supabase = getSupabase();

    try {
      const { data } = await supabase.auth.getSession();
      set({ session: data.session, initialized: true });
      if (data.session) await get().refreshProfile();
    } catch (e) {
      console.warn("[auth] getSession failed", e);
      set({ initialized: true });
    }

    if (!authSubscription) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        set({ session });
        if (session) {
          void get().refreshProfile();
        } else {
          set({ profile: null });
          // The boot gate stored a signed-in target; drop it so the landing
          // screen can't reroute a signed-out app into the guard loop.
          clearBootSession();
        }
      });
      authSubscription = data.subscription;
    }
  },

  signIn: async (email, password) => {
    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) return friendlyAuthError(error.message);
      return null;
    } catch (e) {
      return friendlyAuthError(e instanceof Error ? e.message : "");
    }
  },

  signUp: async (name, email, password) => {
    try {
      const { data, error } = await getSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: authEmailRedirect(),
        },
      });
      if (error) return { kind: "error", message: friendlyAuthError(error.message) };
      // No session back => email confirmation is on: the user must click the
      // link first. With auto-confirm enabled they are signed in right away.
      return data.session ? { kind: "ok" } : { kind: "verify" };
    } catch (e) {
      return {
        kind: "error",
        message: friendlyAuthError(e instanceof Error ? e.message : ""),
      };
    }
  },

  sendPasswordReset: async (email) => {
    try {
      const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authEmailRedirect(),
      });
      if (error) return friendlyAuthError(error.message);
      return null;
    } catch (e) {
      return friendlyAuthError(e instanceof Error ? e.message : "");
    }
  },

  signOut: async () => {
    try {
      // Purge the push token before the session dies so the server stops
      // sending announcements to a signed-out device.
      const sb = getSupabase();
      const { data: authData } = await sb.auth.getUser();
      if (authData.user) {
        await sb.from("push_tokens").delete().eq("user_id", authData.user.id);
      }
      // Drop in-memory downloads + ads config so the next account on this
      // device never inherits the previous user's state. The downloads store
      // is pulled in dynamically: a static import here would close the
      // auth -> downloads -> auth require cycle Metro warns about.
      const { useDownloadsStore } = await import("./downloads");
      useDownloadsStore.getState().reset();
      useAdsConfig.setState({ settings: null, units: {}, loaded: false });
      await sb.auth.signOut();
    } catch (e) {
      console.warn("[auth] signOut failed", e);
    }
    set({ session: null, profile: null });
  },

  refreshProfile: async () => {
    const { session } = get();
    if (!session) return;
    try {
      const { data, error } = await getSupabase()
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();
      if (error) {
        console.warn("[auth] profile load failed", error.message);
        return;
      }
      const row = (data as Profile | null) ?? null;
      // One-time (bank-transfer) premium expires on a deadline the server
      // enforces too (public.is_premium), but the row itself is only reset
      // by the next payment — normalize here so the UI never over-grants.
      if (row?.is_premium && row.premium_until && new Date(row.premium_until).getTime() <= Date.now()) {
        row.is_premium = false;
      }
      set({ profile: row });
    } catch (e) {
      console.warn("[auth] profile load failed", e);
    }
  },
}));
