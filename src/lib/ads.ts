import { Platform } from "react-native";

// Native AdMob interstitial bridge. Loaded lazily via require so web and TV
// bundles never touch the native module; those platforms use the house
// AdOverlay component instead (see canUseNativeAds).

export type AdShowStatus = "completed" | "skipped" | "failed" | "unavailable";

export function canUseNativeAds(): boolean {
  return Platform.OS !== "web" && !Platform.isTV;
}

type InterstitialHandle = {
  addAdEventListener: (type: string, listener: (payload?: unknown) => void) => () => void;
  load: () => void;
  show: () => Promise<void>;
  destroy?: () => void;
};

type AdMobModule = {
  InterstitialAd: {
    createForAdRequest: (unitId: string, options?: Record<string, unknown>) => InterstitialHandle;
  };
  AdEventType: { LOADED: string; ERROR: string; OPENED: string; CLOSED: string };
};

let cachedModule: AdMobModule | null | undefined;

function loadAdsModule(): AdMobModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // Lazy native module: web/TV bundles never reach this line.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("react-native-google-mobile-ads") as AdMobModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

const LOAD_TIMEOUT_MS = 12000;

/**
 * Show one interstitial and resolve how it ended:
 * - "completed": ad was closed (finished or user closed it at the end)
 * - "failed": error, no fill, or never loaded in time
 * - "unavailable": platform/unit/module not usable — caller decides fallback
 *
 * Callers treat "failed"/"unavailable" via the ad_settings.fail_open policy.
 */
export async function showNativeInterstitial(unitId: string): Promise<AdShowStatus> {
  if (!unitId || !canUseNativeAds()) return "unavailable";
  const ads = loadAdsModule();
  if (!ads) return "unavailable";

  return new Promise<AdShowStatus>((resolve) => {
    let settled = false;
    let ad: InterstitialHandle;
    try {
      ad = ads.InterstitialAd.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: true,
      });
    } catch (e) {
      console.warn("[ads] createForAdRequest failed", e);
      resolve("failed");
      return;
    }

    const unsubscribers: (() => void)[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (status: AdShowStatus) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch {
          // listener already detached
        }
      }
      try {
        ad.destroy?.();
      } catch {
        // ad already destroyed
      }
      resolve(status);
    };

    unsubscribers.push(
      ad.addAdEventListener(ads.AdEventType.LOADED, () => {
        ad.show().catch((e) => {
          console.warn("[ads] show failed", e);
          finish("failed");
        });
      })
    );
    unsubscribers.push(ad.addAdEventListener(ads.AdEventType.CLOSED, () => finish("completed")));
    unsubscribers.push(ad.addAdEventListener(ads.AdEventType.ERROR, () => finish("failed")));

    timeout = setTimeout(() => finish("failed"), LOAD_TIMEOUT_MS);
    ad.load();
  });
}
