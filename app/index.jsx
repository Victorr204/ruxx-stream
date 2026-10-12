import { useEffect, useLayoutEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Dimensions,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Logos from "../assets/images/backlogo-transparent.png";
import { useTheme } from "../context/ThemeContext";
import { useIsDesktop } from "../src/hooks/useIsDesktop";
import { getBootSession } from "../utils/bootSession";
import { useAuthStore } from "../src/stores/auth";

const { width } = Dimensions.get("window");

const SERVICES = [
  { icon: "film", label: "Movies", color: "#3b82f6" },
  { icon: "tv", label: "Series", color: "#8b5cf6" },
  { icon: "download", label: "Offline", color: "#f59e0b" },
];

const HIGHLIGHTS = [
  {
    icon: "flash-outline",
    color: "#f59e0b",
    title: "Instant Streaming",
    desc: "Press play and watch in seconds",
  },
  {
    icon: "time-outline",
    color: "#22c55e",
    title: "Pick Up Anywhere",
    desc: "Your progress syncs across every screen",
  },
  {
    icon: "shield-checkmark-outline",
    color: "#3b82f6",
    title: "Premium Downloads",
    desc: "Ad-free, encrypted offline viewing",
  },
];

function GlowOrb({ color, size, top, left, right, bottom, delay }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
  }, [delay, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.16 + pulse.value * 0.12,
    transform: [{ scale: 1 + pulse.value * 0.14 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orb,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, top, left, right, bottom },
        style,
      ]}
    />
  );
}

export default function Landing() {
  const { theme, resolved } = useTheme();
  const isDesktop = useIsDesktop();

  // Returning users can still open on "/" when the launch URL prefetch wins
  // over the boot gate's initialRouteName — hand off to the screen the boot
  // gate picked (login / home …) before this ever paints.
  // First launches target "/", so the landing stays put. The stored target
  // only applies while the session that produced it is still alive: after a
  // sign-out (or expiry) rerouting to /home would just bounce off the guard.
  const session = useAuthStore((s) => s.session);
  const bootTarget = session ? getBootSession()?.targetUrl ?? "/home" : null;
  const rerouting = !!bootTarget && bootTarget !== "/";

  useLayoutEffect(() => {
    if (!rerouting) return;
    try {
      router.replace(bootTarget);
    } catch (_e) {}
  }, [rerouting, bootTarget]);

  // Safety net: if the layout-effect replace didn't take (navigator still
  // settling), try again rather than leaving the user on a blank frame.
  useEffect(() => {
    if (!rerouting) return undefined;
    const t = setTimeout(() => {
      try {
        router.replace(bootTarget);
      } catch (_e) {}
    }, 500);
    return () => clearTimeout(t);
  }, [rerouting, bootTarget]);

  const brandGold = "#e8b84a";

  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [shimmer]);

  const logoShineStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + shimmer.value * 0.35,
  }));

  // Never paint the landing on a warm start — the boot gate already picked
  // the real first screen, showing this first just adds a dead frame.
  if (rerouting) return null;

  // Desktop gets its own composition: the mobile stack (hero → card row →
  // CTA) reads as a phone screen stretched to 1440px, so on wide windows it
  // becomes a two-column hero inside a max-width container.
  if (isDesktop) return <DesktopLanding />;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={resolved === "dark" ? "light-content" : "dark-content"} />

      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <LinearGradient
            colors={["#0a0a0a", "#16120a", "#0a0a0a"]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
          <GlowOrb color="#e8b84a" size={260} top={-80} left={-60} delay={0} />
          <GlowOrb color="#3b82f6" size={200} top={40} right={-70} delay={800} />
          <GlowOrb color="#8b5cf6" size={160} bottom={-40} left={width * 0.3} delay={1600} />

          <Animated.View entering={FadeInDown.delay(100).duration(700)} style={styles.heroInner}>
            <Animated.View style={[styles.logoRing, logoShineStyle]}>
              <Image source={Logos} style={styles.logo} resizeMode="contain" />
            </Animated.View>

            <Animated.Text entering={FadeInDown.delay(250).duration(600)} style={styles.brandName}>
              ruxx stream
            </Animated.Text>
            <Animated.Text entering={FadeInDown.delay(400).duration(600)} style={styles.brandTag}>
              Movies, Series &amp; Blockbusters — Streamed Instantly
            </Animated.Text>

            {/* Service preview chips */}
            <Animated.View entering={FadeInDown.delay(550).duration(600)} style={styles.chipRow}>
              {SERVICES.map((s) => (
                <View key={s.label} style={[styles.chip, { borderColor: `${s.color}55`, backgroundColor: `${s.color}14` }]}>
                  <Ionicons name={s.icon} size={13} color={s.color} />
                  <Text style={[styles.chipText, { color: s.color }]}>{s.label}</Text>
                </View>
              ))}
            </Animated.View>
          </Animated.View>
        </View>

        {/* ── Content ── */}
        <View style={[styles.content, { backgroundColor: theme.background }]}>
          {/* Highlight cards - compact horizontal */}
          <Animated.View entering={FadeInUp.delay(700).duration(600)} style={styles.highlights}>
            {HIGHLIGHTS.map((h, i) => (
              <Animated.View
                key={h.title}
                entering={FadeInUp.delay(700 + i * 100).duration(500)}
                style={[styles.hlCard, { backgroundColor: theme.card }]}
              >
                <View style={[styles.hlIcon, { backgroundColor: `${h.color}18` }]}>
                  <Ionicons name={h.icon} size={18} color={h.color} />
                </View>
                <Text style={[styles.hlTitle, { color: theme.text }]}>{h.title}</Text>
              </Animated.View>
            ))}
          </Animated.View>

          {/* What is ruxx stream */}
          <Animated.View entering={FadeInUp.delay(900).duration(600)} style={[styles.aboutNote, { backgroundColor: theme.card }]}>
            <Ionicons name="information-circle-outline" size={14} color={theme.primary} />
            <Text style={[styles.aboutText, { color: theme.subtitle }]}>
              ruxx stream is a movie streaming platform for films, series &amp; documentaries across mobile, web and
              Android TV. Operated by Ruxx Digital Services.
            </Text>
          </Animated.View>

          {/* Supported platforms strip */}
          <Animated.View entering={FadeInUp.delay(1100).duration(600)}>
            <Text style={[styles.networksLabel, { color: theme.placeholder }]}>
              Watch on every screen you own
            </Text>
            <View style={[styles.networksRow, { backgroundColor: theme.card }]}>
              {["Android", "iOS", "Web", "Android TV"].map((n) => (
                <View key={n} style={styles.networkPill}>
                  <Text style={[styles.networkText, { color: theme.text }]}>{n}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* CTAs */}
          <Animated.View entering={FadeInUp.delay(1300).duration(600)} style={styles.ctaBlock}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/register")}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Get started"
            >
              <LinearGradient
                colors={["#f0c75e", "#e8b84a", "#d4a030"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtnGrad}
              >
                <Text style={styles.primaryBtnText}>Start Watching</Text>
                <Ionicons name="arrow-forward" size={18} color="#111" />
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/login")}
              style={styles.secondaryBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              <Text style={[styles.secondaryText, { color: theme.subtitle }]}>
                Already have an account?{" "}
              </Text>
              <Text style={[styles.secondaryLink, { color: brandGold }]}>Sign In</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.Text entering={FadeIn.delay(1600).duration(600)} style={[styles.footer, { color: theme.placeholder }]}>
            By continuing you agree to our{" "}
            <Text style={styles.footerLink} onPress={() => router.push("/terms")} accessibilityRole="link">
              Terms
            </Text>
            {" & "}
            <Text style={styles.footerLink} onPress={() => router.push("/privacy")} accessibilityRole="link">
              Privacy Policy
            </Text>
          </Animated.Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },

  hero: {
    minHeight: Dimensions.get("window").height * 0.44,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  heroInner: { alignItems: "center", paddingHorizontal: 24, zIndex: 2 },
  orb: { position: "absolute" },

  logoRing: {
    width: 110,
    height: 110,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    shadowColor: "#e8b84a",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  logo: { width: 96, height: 96, backgroundColor: "transparent" },

  brandName: {
    fontSize: 34,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  brandTag: {
    fontSize: 14.5,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "500",
    marginBottom: 18,
    letterSpacing: 0.2,
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 11.5, fontWeight: "700" },

  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    justifyContent: "space-between",
    paddingBottom: 40,
  },

  highlights: { flexDirection: "row", gap: 8, paddingHorizontal: 4 },
  hlCard: {
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    padding: 10,
    minWidth: 90,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  hlIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  hlTitle: { fontSize: 11, fontWeight: "700", textAlign: "center" },

  networksLabel: { fontSize: 11.5, textAlign: "center", marginBottom: 8, fontWeight: "500" },
  aboutNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  aboutText: { flex: 1, fontSize: 11.5, lineHeight: 16 },
  networksRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  networkPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(128,128,128,0.1)",
  },
  networkText: { fontSize: 12, fontWeight: "700" },

  ctaBlock: { marginTop: 16, gap: 12 },
  primaryBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#e8b84a",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "800", color: "#111", letterSpacing: 0.2 },

  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 14 },
  secondaryLink: { fontSize: 14, fontWeight: "700" },

  footer: { fontSize: 11, textAlign: "center", marginTop: 4 },
  footerLink: { color: "#e8b84a", fontWeight: "700" },

  /* Desktop landing */
  dRoot: { flex: 1, overflow: "hidden", backgroundColor: "#0a0a0a" },
  dScroll: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    paddingHorizontal: 64,
    paddingTop: 56,
    paddingBottom: 40,
    justifyContent: "space-between",
  },
  dHero: { flexDirection: "row", alignItems: "center", gap: 72 },
  dLeft: { flex: 1.15, maxWidth: 620 },
  dRight: { flex: 1, gap: 12, minWidth: 0 },

  dLogoRing: {
    width: 86,
    height: 86,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.5)",
    backgroundColor: "rgba(232,184,74,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 26,
    shadowColor: "#e8b84a",
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  dLogo: { width: 60, height: 60 },

  dBrand: {
    fontSize: 62,
    lineHeight: 66,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -2.2,
    marginBottom: 12,
  },
  dTag: {
    fontSize: 18,
    lineHeight: 27,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "500",
    maxWidth: 520,
    marginBottom: 26,
    letterSpacing: 0.1,
  },

  dChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 36 },
  dChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1,
  },
  dChipText: { fontSize: 12.5, fontWeight: "700", letterSpacing: 0.3 },

  dCta: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 24 },
  dPrimary: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#e8b84a",
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  dPrimaryGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 58, paddingHorizontal: 34 },
  dPrimaryText: { fontSize: 16.5, fontWeight: "800", color: "#111", letterSpacing: 0.2 },
  dSecondary: {
    height: 58,
    paddingHorizontal: 28,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dSecondaryText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.82)" },

  dLegal: { fontSize: 12.5, color: "rgba(255,255,255,0.42)" },
  dLegalLink: { color: "#e8b84a", fontWeight: "700" },

  dCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  dCardIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dCardBody: { flex: 1 },
  dCardTitle: { fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: -0.1 },
  dCardDesc: { fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.55)", marginTop: 3 },

  dAbout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(232,184,74,0.25)",
    backgroundColor: "rgba(232,184,74,0.06)",
  },
  dAboutText: { flex: 1, fontSize: 13, lineHeight: 19.5, color: "rgba(255,255,255,0.68)" },

  dStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
    flexWrap: "wrap",
    marginTop: 56,
    paddingTop: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  dStripLabel: {
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.5)",
  },
  dStripPills: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" },
  dPill: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  dPillText: { fontSize: 12.5, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
});

/* ── Desktop landing ──────────────────────────────────────────────────
   Two columns inside a max-width container: brand + CTAs on the left,
   the value props on the right, platforms pinned to the bottom. Mobile
   keeps the stacked composition above untouched.                     */
function DesktopLanding() {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [shimmer]);

  const shineStyle = useAnimatedStyle(() => ({
    opacity: 0.7 + shimmer.value * 0.3,
  }));

  return (
    <View style={styles.dRoot}>
      <LinearGradient
        colors={["#0a0a0a", "#171208", "#0a0a0a"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <GlowOrb color="#e8b84a" size={520} top={-200} left={-170} delay={0} />
      <GlowOrb color="#3b82f6" size={400} top={150} right={-190} delay={800} />
      <GlowOrb color="#8b5cf6" size={320} bottom={-90} left={540} delay={1600} />

      <ScrollView contentContainerStyle={styles.dScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.dHero}>
          {/* ── Left: brand + actions ── */}
          <Animated.View entering={FadeInDown.duration(700)} style={styles.dLeft}>
            <Animated.View style={[styles.dLogoRing, shineStyle]}>
              <Image source={Logos} style={styles.dLogo} resizeMode="contain" />
            </Animated.View>

            <Animated.Text entering={FadeInDown.delay(150).duration(600)} style={styles.dBrand}>
              ruxx stream
            </Animated.Text>
            <Animated.Text entering={FadeInDown.delay(300).duration(600)} style={styles.dTag}>
              Movies, Series &amp; Blockbusters — streamed instantly, on every screen you own.
            </Animated.Text>

            <Animated.View entering={FadeInDown.delay(450).duration(600)} style={styles.dChipRow}>
              {SERVICES.map((s) => (
                <View
                  key={s.label}
                  style={[styles.dChip, { borderColor: `${s.color}55`, backgroundColor: `${s.color}14` }]}
                >
                  <Ionicons name={s.icon} size={14} color={s.color} />
                  <Text style={[styles.dChipText, { color: s.color }]}>{s.label}</Text>
                </View>
              ))}
            </Animated.View>

            <Animated.View entering={FadeInUp.delay(620).duration(600)} style={styles.dCta}>
              <TouchableOpacity
                style={styles.dPrimary}
                onPress={() => router.push("/register")}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel="Get started"
              >
                <LinearGradient
                  colors={["#f0c75e", "#e8b84a", "#d4a030"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.dPrimaryGrad}
                >
                  <Text style={styles.dPrimaryText}>Start Watching</Text>
                  <Ionicons name="arrow-forward" size={18} color="#111" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dSecondary}
                onPress={() => router.push("/login")}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={styles.dSecondaryText}>I already have an account</Text>
              </TouchableOpacity>
            </Animated.View>

            <Animated.Text entering={FadeIn.delay(900).duration(600)} style={styles.dLegal}>
              By continuing you agree to our{" "}
              <Text style={styles.dLegalLink} onPress={() => router.push("/terms")} accessibilityRole="link">
                Terms
              </Text>
              {" & "}
              <Text style={styles.dLegalLink} onPress={() => router.push("/privacy")} accessibilityRole="link">
                Privacy Policy
              </Text>
            </Animated.Text>
          </Animated.View>

          {/* ── Right: what you get ── */}
          <Animated.View entering={FadeInUp.delay(360).duration(700)} style={styles.dRight}>
            {HIGHLIGHTS.map((h) => (
              <View key={h.title} style={styles.dCard}>
                <View style={[styles.dCardIcon, { backgroundColor: `${h.color}1f` }]}>
                  <Ionicons name={h.icon} size={20} color={h.color} />
                </View>
                <View style={styles.dCardBody}>
                  <Text style={styles.dCardTitle}>{h.title}</Text>
                  <Text style={styles.dCardDesc}>{h.desc}</Text>
                </View>
              </View>
            ))}

            <View style={styles.dAbout}>
              <Ionicons name="information-circle-outline" size={16} color="#e8b84a" />
              <Text style={styles.dAboutText}>
                ruxx stream is a movie streaming platform for films, series &amp; documentaries across mobile, web,
                desktop and Android TV. Operated by Ruxx Digital Services.
              </Text>
            </View>
          </Animated.View>
        </View>

        {/* ── Bottom strip ── */}
        <Animated.View entering={FadeIn.delay(1150).duration(600)} style={styles.dStrip}>
          <Text style={styles.dStripLabel}>Watch on every screen you own</Text>
          <View style={styles.dStripPills}>
            {["Windows", "macOS", "Android", "iOS", "Web", "Android TV"].map((n) => (
              <View key={n} style={styles.dPill}>
                <Text style={styles.dPillText}>{n}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
