import { create } from "zustand";
import { Platform } from "react-native";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";

// Admin-managed ad configuration (ad_settings + ad_units rows). The player
// reads it to decide whether pre/mid-rolls are armed and which AdMob unit id
// to request. Fail-safe: if config can never load, settings stays null and
// ads stay disabled — content must never be blocked by ad plumbing.

export type AdPlacement = "pre_roll" | "mid_roll" | "banner" | "rewarded";

export type AdSettings = {
  pre_roll_enabled: boolean;
  mid_roll_enabled: boolean;
  banner_enabled: boolean;
  mid_roll_interval_seconds: number;
  fail_open: boolean;
};

type AdUnitRow = {
  placement: AdPlacement;
  android_unit_id: string | null;
  ios_unit_id: string | null;
  web_unit_id: string | null;
  tv_unit_id: string | null;
  enabled: boolean;
};

type AdsConfigState = {
  settings: AdSettings | null;
  units: Partial<Record<AdPlacement, AdUnitRow>>;
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  unitFor: (placement: AdPlacement) => string | null;
  isEnabled: (placement: AdPlacement) => boolean;
  intervalSeconds: () => number;
  failOpen: () => boolean;
};

export const useAdsConfig = create<AdsConfigState>((set, get) => ({
  settings: null,
  units: {},
  loaded: false,

  // force=true re-fetches (the admin console calls it after saving so the
  // very next player mount picks up new settings without an app restart).
  load: async (force = false) => {
    if (get().loaded && !force) return;
    if (!isSupabaseConfigured) {
      set({ loaded: true });
      return;
    }
    try {
      const sb = getSupabase();
      const [settingsResult, unitsResult] = await Promise.all([
        sb
          .from("ad_settings")
          .select(
            "pre_roll_enabled, mid_roll_enabled, banner_enabled, mid_roll_interval_seconds, fail_open"
          )
          .limit(1)
          .maybeSingle(),
        sb
          .from("ad_units")
          .select(
            "placement, android_unit_id, ios_unit_id, web_unit_id, tv_unit_id, enabled"
          ),
      ]);

      const units: Partial<Record<AdPlacement, AdUnitRow>> = {};
      for (const row of (unitsResult.data ?? []) as unknown as AdUnitRow[]) {
        units[row.placement] = row;
      }
      set({
        settings: (settingsResult.data as AdSettings | null) ?? null,
        units,
        loaded: true,
      });
    } catch (e) {
      console.warn("[ads] config load failed", e);
      set({ loaded: true });
    }
  },

  // Platform-appropriate unit id for a placement, or null when the placement
  // is disabled/unconfigured (=> no ad request, fall back per fail_open).
  unitFor: (placement) => {
    const row = get().units[placement];
    if (!row || !row.enabled) return null;
    if (Platform.OS === "web") return row.web_unit_id || null;
    if (Platform.isTV) return row.tv_unit_id || null;
    return (Platform.OS === "ios" ? row.ios_unit_id : row.android_unit_id) || null;
  },

  isEnabled: (placement) => {
    const settings = get().settings;
    if (!settings) return false;
    if (placement === "pre_roll") return settings.pre_roll_enabled;
    if (placement === "mid_roll") return settings.mid_roll_enabled;
    if (placement === "banner") return settings.banner_enabled;
    return true;
  },

  intervalSeconds: () => get().settings?.mid_roll_interval_seconds ?? 300,

  // fail_open=true (default): an ad failure resumes content immediately.
  // fail_open=false: show the in-app house overlay instead of skipping.
  failOpen: () => get().settings?.fail_open ?? true,
}));
