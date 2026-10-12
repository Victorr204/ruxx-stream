import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useAdsConfig } from "../stores/adsConfig";
import { useAuthStore } from "../stores/auth";
import { ADSENSE_BANNER_SLOT } from "../lib/adsense";
import AdSenseAd from "./AdSenseAd";

// Web banner: AdSense responsive unit instead of AdMob. Same gating as the
// native slot — premium users and banner_enabled=false see nothing. The slot
// id comes from the admin ad_units row (web_unit_id) with an env fallback.
export default function BannerAdSlot() {
  const loaded = useAdsConfig((s) => s.loaded);
  const load = useAdsConfig((s) => s.load);
  const bannerEnabled = useAdsConfig((s) => s.settings?.banner_enabled ?? false);
  const unitFor = useAdsConfig((s) => s.unitFor);
  const isPremium = useAuthStore((s) => s.profile?.is_premium ?? false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (isPremium || !bannerEnabled) return null;
  const slot = unitFor("banner") || ADSENSE_BANNER_SLOT;
  if (!slot) return null;

  return (
    <View style={styles.wrap}>
      <AdSenseAd slot={slot} format="auto" minHeight={60} style={{ maxWidth: 728 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", width: "100%" },
});
