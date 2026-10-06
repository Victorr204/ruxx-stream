import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

// Single Supabase entry point for the whole app. Everything is guarded so the
// project still builds (and the landing page still renders) before real env
// vars are pasted into `.env` — see `.env.example`.

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured =
  supabaseUrl.startsWith("https://") && supabaseAnonKey.length > 0;

// Static web export renders routes in Node, where AsyncStorage's web
// implementation touches window.localStorage and crashes the build. Auth
// simply sees "no stored session" there — the client rehydrates in-browser.
const hasWindow = typeof window !== "undefined";
const staticRenderStorage = {
  getItem: (): Promise<string | null> => Promise.resolve(null),
  setItem: (): Promise<void> => Promise.resolve(),
  removeItem: (): Promise<void> => Promise.resolve(),
};

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: hasWindow ? AsyncStorage : staticRenderStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web" && hasWindow,
        flowType: "pkce",
      },
    })
  : null;

/** Throws a readable setup error instead of a network failure when the env
 *  vars were never set. Prefer this inside functions/async code. */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured: copy .env.example to .env and set " +
        "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}
