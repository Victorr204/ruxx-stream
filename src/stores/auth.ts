import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import type { Profile } from "../lib/types";

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
        options: { data: { display_name: name.trim() } },
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
      const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
      const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        ...(siteUrl ? { redirectTo: `${siteUrl}/` } : {}),
      });
      if (error) return friendlyAuthError(error.message);
      return null;
    } catch (e) {
      return friendlyAuthError(e instanceof Error ? e.message : "");
    }
  },

  signOut: async () => {
    try {
      await getSupabase().auth.signOut();
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
      set({ profile: (data as Profile) ?? null });
    } catch (e) {
      console.warn("[auth] profile load failed", e);
    }
  },
}));
