import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GOLD } from "../../context/ThemeContext";
import AdSenseAd from "./AdSenseAd";

// Full-screen in-app ad break used when AdMob can't serve: web, TV, missing
// unit ids, or a failed request with fail_open=false. Mimics a real break:
// countdown, then a skip button after the first few seconds. On web the card
// area can carry a real AdSense display unit (adsenseSlot).

const DEFAULT_DURATION_SECONDS = 12;
const SKIP_AFTER_SECONDS = 5;

export type AdOverlayProps = {
  placement: "pre_roll" | "mid_roll";
  durationSeconds?: number;
  onFinished: (status: "completed" | "skipped") => void;
  /** Opens the Premium sheet — wired by the player so the CTA sells. */
  onPremium?: () => void;
  /** AdSense slot id (web only) — renders a live display unit above the card. */
  adsenseSlot?: string;
};

export function AdOverlay({ placement, durationSeconds, onFinished, onPremium, adsenseSlot }: AdOverlayProps) {
  const total = durationSeconds ?? DEFAULT_DURATION_SECONDS;
  const [remaining, setRemaining] = useState(total);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  const finish = (status: "completed" | "skipped") => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedRef.current(status);
  };

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    const deadline = setTimeout(() => finish("completed"), total * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(deadline);
    };
  }, [total]);

  const canSkip = total - remaining >= SKIP_AFTER_SECONDS;

  return (
    <View style={styles.root} accessibilityRole="summary" accessibilityLabel="Advertisement">
      <Text style={styles.label}>
        {placement === "pre_roll" ? "AD · BEFORE PLAY" : "AD · BREAK"}
      </Text>

      {adsenseSlot ? (
        <View style={styles.adUnitWrap}>
          <AdSenseAd slot={adsenseSlot} format="rectangle" minHeight={250} style={styles.adUnit} />
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>ruxx</Text>
        </View>
        <Text style={styles.headline}>Stream without interruptions</Text>
        <Text style={styles.sub}>
          Premium removes every ad and unlocks offline downloads.
        </Text>
        {onPremium ? (
          <TouchableOpacity
            style={styles.ctaPill}
            onPress={onPremium}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Go Premium"
          >
            <Ionicons name="sparkles" size={13} color="#0a0a0a" />
            <Text style={styles.ctaText}>Go Premium</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.ctaPill}>
            <Ionicons name="sparkles" size={13} color="#0a0a0a" />
            <Text style={styles.ctaText}>Go Premium</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        {canSkip ? (
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => finish("skipped")}
            accessibilityRole="button"
            accessibilityLabel="Skip ad"
          >
            <Text style={styles.skipText}>Skip ad</Text>
            <Ionicons name="play-skip-forward" size={15} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.skipPlaceholder} />
        )}
        <Text style={styles.countdown}>{remaining}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#050505",
    zIndex: 40,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  label: {
    position: "absolute",
    top: 54,
    alignSelf: "center",
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  adUnitWrap: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    marginBottom: 14,
  },
  adUnit: { width: "100%", borderRadius: 12, overflow: "hidden" },
  card: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 30,
    paddingHorizontal: 26,
    borderRadius: 22,
    backgroundColor: "rgba(20,20,20,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxWidth: 380,
    width: "100%",
  },
  logoBadge: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "#0a0a0a", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  headline: { color: "#fff", fontSize: 19, fontWeight: "800", textAlign: "center" },
  sub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13.5,
    textAlign: "center",
    lineHeight: 19,
  },
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: GOLD,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    marginTop: 4,
  },
  ctaText: { color: "#0a0a0a", fontSize: 14, fontWeight: "800" },
  footer: {
    position: "absolute",
    bottom: 46,
    left: 24,
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skipText: { color: "#fff", fontSize: 13.5, fontWeight: "700" },
  skipPlaceholder: { width: 96 },
  countdown: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "700" },
});
