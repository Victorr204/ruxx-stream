import { Platform } from "react-native";

// Google AdSense config for the web app. Native keeps using AdMob; web loads
// the AdSense script (see app/+html.tsx) and renders <ins> units through
// AdSenseAd. Slot ids can come from the admin ad_units rows (web_unit_id) —
// the env vars here are fallbacks so ads work before any admin setup.

export const ADSENSE_CLIENT =
  process.env.EXPO_PUBLIC_ADSENSE_CLIENT || "ca-pub-9942550938838021";

export const ADSENSE_BANNER_SLOT = process.env.EXPO_PUBLIC_ADSENSE_BANNER_SLOT || "";

export const ADSENSE_INTERSTITIAL_SLOT =
  process.env.EXPO_PUBLIC_ADSENSE_INTERSTITIAL_SLOT || "";

export function adsenseAvailable(): boolean {
  return Platform.OS === "web" && !!ADSENSE_CLIENT;
}

type AdsenseWindow = Window & { adsbygoogle?: unknown[] };

/** Queue one ad unit for the AdSense loader (no-op during SSR). */
export function pushAdsenseAd(): void {
  if (typeof window === "undefined") return;
  const w = window as AdsenseWindow;
  w.adsbygoogle = w.adsbygoogle || [];
  try {
    w.adsbygoogle.push({});
  } catch (e) {
    console.warn("[adsense] push failed", e);
  }
}
