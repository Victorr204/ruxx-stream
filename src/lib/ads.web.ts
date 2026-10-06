import type { AdShowStatus } from "./ads";

// Web platform stub: Metro resolves this file instead of ./ads.ts on web, so
// the native-only react-native-google-mobile-ads module never enters the web
// bundle (its index pulls in codegen components that crash SSR/export).
// The player falls back to the in-app AdOverlay for every break on web.

export type { AdShowStatus } from "./ads";

export function canUseNativeAds(): boolean {
  return false;
}

export async function showNativeInterstitial(_unitId: string): Promise<AdShowStatus> {
  return "unavailable";
}
