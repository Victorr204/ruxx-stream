import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { canUseNativeAds, ensureAdsInitialized } from "../lib/ads";
import { useAdsConfig } from "../stores/adsConfig";
import { useAuthStore } from "../stores/auth";

type BannerProps = {
  unitId: string;
  size: string;
  requestOptions?: Record<string, unknown>;
};

type BannerModule = {
  BannerAd: ComponentType<BannerProps>;
  BannerAdSize: Record<string, string>;
};

let cachedBanner: BannerModule | null | undefined;

function loadBannerModule(): BannerModule | null {
  if (cachedBanner !== undefined) return cachedBanner;
  try {
    // Lazy native module: web/TV bundles never reach this line.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedBanner = require("react-native-google-mobile-ads") as BannerModule;
  } catch {
    cachedBanner = null;
  }
  if (!cachedBanner) cachedBanner = null;
  return cachedBanner;
}

export default function BannerAdSlot() {
  const loaded = useAdsConfig((s) => s.loaded);
  const load = useAdsConfig((s) => s.load);
  const bannerEnabled = useAdsConfig((s) => s.settings?.banner_enabled ?? false);
  const unitFor = useAdsConfig((s) => s.unitFor);
  const isPremium = useAuthStore((s) => s.profile?.is_premium ?? false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (!canUseNativeAds()) return;
    void ensureAdsInitialized().then(() => setReady(true));
  }, []);

  if (isPremium || !ready || !bannerEnabled) return null;
  const unitId = unitFor("banner");
  if (!unitId) return null;
  const module = loadBannerModule();
  if (!module?.BannerAd) return null;
  const size =
    module.BannerAdSize?.ANCHORED_ADAPTIVE_BANNER ?? module.BannerAdSize?.BANNER ?? "ANCHORED_ADAPTIVE_BANNER";
  const Banner = module.BannerAd;
  return (
    <View style={styles.wrap}>
      <Banner unitId={unitId} size={size} requestOptions={{ requestNonPersonalizedAdsOnly: true }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
});
