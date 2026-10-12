import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme, GOLD } from "../context/ThemeContext";
import AppAlert from "../utils/AppAlert";
import { getSupabase } from "../src/lib/supabase";
import { useAuthStore } from "../src/stores/auth";
import { useIsDesktop } from "../src/hooks/useIsDesktop";
import Logos from "../assets/images/backlogo-transparent.png";

function GlowOrb({ color, size, top, left, right, bottom, delay }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
  }, [delay, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.1 + pulse.value * 0.14,
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

export default function ResetPassword() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const isDesktop = useIsDesktop();
  const code = typeof params.code === "string" ? params.code : "";
  const oauthError =
    typeof params.error_description === "string"
      ? params.error_description
      : typeof params.error === "string"
        ? params.error
        : "";

  const [phase, setPhase] = useState(code ? "exchanging" : oauthError ? "failed" : "form");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "info" });
  const [ctaHover, setCtaHover] = useState(false);
  const [backHover, setBackHover] = useState(false);

  const showAlert = useCallback((title, message, type = "info") => {
    setAlert({ visible: true, title, message, type });
  }, []);

  useEffect(() => {
    if (!code) return undefined;
    let cancelled = false;
    getSupabase()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          setPhase("failed");
          showAlert("Link Expired", "This reset link is no longer valid — request a new one.", "error");
          return;
        }
        setPhase("form");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("failed");
        showAlert("Link Expired", "This reset link is no longer valid — request a new one.", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [code, showAlert]);

  const handleSave = async () => {
    if (busy) return;
    if (password.length < 8) {
      showAlert("Weak Password", "Your password must be at least 8 characters.", "error");
      return;
    }
    if (password !== confirm) {
      showAlert("Passwords Don't Match", "Type the same password in both fields.", "error");
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) {
        showAlert("Reset Failed", error.message, "error");
        return;
      }
      await refreshProfile();
      showAlert("Password Updated", "You're signed in with your new password.", "success");
      try {
        router.replace("/profile");
      } catch (_e) {
        // Guard already redirected.
      }
    } catch (e) {
      showAlert("Reset Failed", e instanceof Error ? e.message : "Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const goLogin = () => {
    try {
      router.replace("/login");
    } catch (_e) {
      // Guard already redirected.
    }
  };

  // ── Desktop ──
  // Outside the tab shell these screens provide their own chrome. This one is
  // a short form, so it uses the compact composition: the landing's dark hero
  // backdrop + glow orbs with the brand mark above a centered card.
  if (isDesktop) {
    return (
      <View style={styles.dRoot}>
        <LinearGradient
          colors={["#0a0a0a", "#16120a", "#0a0a0a"]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <GlowOrb color={GOLD} size={520} top={-200} left={-170} delay={0} />
        <GlowOrb color="#3b82f6" size={400} top={160} right={-190} delay={700} />
        <GlowOrb color="#8b5cf6" size={320} bottom={-90} left={420} delay={1400} />

        <AppAlert
          visible={alert.visible}
          title={alert.title}
          message={alert.message}
          type={alert.type}
          theme={theme}
          onClose={() => setAlert((a) => ({ ...a, visible: false }))}
        />

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={styles.dScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.duration(600)} style={styles.dBrand}>
              <View style={styles.dLogoRing}>
                <Image source={Logos} style={styles.dLogo} resizeMode="contain" />
              </View>
              <Text style={styles.dBrandName}>ruxx stream</Text>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.delay(150).duration(600)}
              style={[styles.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            >
              <View style={styles.dHeaderBlock}>
                <View style={[styles.dKeyRing, { borderColor: GOLD }]}>
                  <Ionicons name="key-outline" size={22} color={GOLD} />
                </View>
                <Text style={[styles.dTitle, { color: theme.text }]}>Reset password</Text>
                <Text style={[styles.dSubtitle, { color: theme.subtitle }]}>
                  {phase === "exchanging"
                    ? "Verifying your reset link…"
                    : phase === "failed"
                      ? "We couldn't use that reset link."
                      : "Choose a new password for your account."}
                </Text>
              </View>

              {phase === "exchanging" ? (
                <ActivityIndicator color={GOLD} size="large" style={styles.dSpinner} />
              ) : null}

              {phase === "failed" ? (
                <View style={styles.dFailedBlock}>
                  <Ionicons name="alert-circle-outline" size={30} color="#e5675f" />
                  <Text style={[styles.dFailedText, { color: theme.subtitle }]}>
                    {oauthError || "The link may have already been used or has expired."}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.dPrimaryBtn,
                      { backgroundColor: GOLD },
                      backHover && styles.dPrimaryBtnHover,
                    ]}
                    onPress={goLogin}
                    activeOpacity={0.85}
                    onMouseEnter={() => setBackHover(true)}
                    onMouseLeave={() => setBackHover(false)}
                  >
                    <Text style={styles.dPrimaryBtnText}>Back to sign in</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {phase === "form" ? (
                <View style={styles.dForm}>
                  <View>
                    <Text style={[styles.dLabel, { color: theme.subtitle }]}>New password</Text>
                    <View
                      style={[
                        styles.dInputContainer,
                        { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder },
                      ]}
                    >
                      <TextInput
                        style={[styles.dInput, { color: theme.inputText }]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="At least 8 characters"
                        placeholderTextColor={theme.placeholder}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword((show) => !show)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                        style={styles.dEyeBtn}
                      >
                        <Ionicons
                          name={showPassword ? "eye-off-outline" : "eye-outline"}
                          size={18}
                          color={theme.placeholder}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View>
                    <Text style={[styles.dLabel, { color: theme.subtitle }]}>Confirm password</Text>
                    <View
                      style={[
                        styles.dInputContainer,
                        { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder },
                      ]}
                    >
                      <TextInput
                        style={[styles.dInput, { color: theme.inputText }]}
                        value={confirm}
                        onChangeText={setConfirm}
                        placeholder="Type it again"
                        placeholderTextColor={theme.placeholder}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.dPrimaryBtn,
                      { backgroundColor: GOLD },
                      ctaHover && styles.dPrimaryBtnHover,
                      busy && styles.buttonDisabled,
                    ]}
                    onPress={handleSave}
                    disabled={busy}
                    activeOpacity={0.85}
                    onMouseEnter={() => setCtaHover(true)}
                    onMouseLeave={() => setCtaHover(false)}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#111" />
                    ) : (
                      <Text style={styles.dPrimaryBtnText}>Save new password</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.inputBackground, color: theme.inputText, borderColor: theme.inputBorder },
  ];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerBlock}>
            <View style={[styles.logoRing, { borderColor: GOLD }]}>
              <Ionicons name="key-outline" size={22} color={GOLD} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Reset password</Text>
            <Text style={[styles.subtitle, { color: theme.subtitle }]}>
              {phase === "exchanging"
                ? "Verifying your reset link…"
                : phase === "failed"
                  ? "We couldn't use that reset link."
                  : "Choose a new password for your account."}
            </Text>
          </View>

          {phase === "exchanging" ? (
            <ActivityIndicator color={GOLD} size="large" />
          ) : null}

          {phase === "failed" ? (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <Ionicons name="alert-circle-outline" size={28} color="#e5675f" />
              <Text style={[styles.failedText, { color: theme.subtitle }]}>
                {oauthError || "The link may have already been used or has expired."}
              </Text>
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: GOLD }]} onPress={goLogin} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Back to sign in</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {phase === "form" ? (
            <View style={{ gap: 14 }}>
              <View>
                <Text style={[styles.label, { color: theme.placeholder }]}>New password</Text>
                <View style={[inputStyle, styles.pwRow]}>
                  <TextInput
                    style={styles.pwInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 8 characters"
                    placeholderTextColor={theme.placeholder}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((show) => !show)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                  >
                    <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={theme.placeholder} />
                  </TouchableOpacity>
                </View>
              </View>

              <View>
                <Text style={[styles.label, { color: theme.placeholder }]}>Confirm password</Text>
                <TextInput
                  style={inputStyle}
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Type it again"
                  placeholderTextColor={theme.placeholder}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: GOLD, opacity: busy ? 0.6 : 1 }]}
                onPress={handleSave}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#111" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save new password</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 22 },

  headerBlock: { alignItems: "center", gap: 8 },
  logoRing: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  title: { fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { fontSize: 13.5, textAlign: "center", maxWidth: 320, lineHeight: 19 },

  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 12,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  failedText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  label: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  input: {
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 50,
    fontSize: 15,
  },
  pwRow: { flexDirection: "row", alignItems: "center", paddingRight: 14 },
  pwInput: { flex: 1, fontSize: 15, height: 48 },

  primaryBtn: {
    borderRadius: 13,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 15, fontWeight: "900", color: "#111" },

  /* ── Desktop ── */
  flex: { flex: 1 },
  orb: { position: "absolute" },

  dRoot: { flex: 1, overflow: "hidden", backgroundColor: "#0a0a0a" },
  dScroll: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    justifyContent: "center",
    paddingVertical: 48,
    paddingHorizontal: 32,
  },

  dBrand: { alignItems: "center", marginBottom: 28 },
  dLogoRing: {
    width: 84,
    height: 84,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.5)",
    backgroundColor: "rgba(232,184,74,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    shadowColor: GOLD,
    shadowOpacity: 0.5,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  dLogo: { width: 58, height: 58, backgroundColor: "transparent" },
  dBrandName: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -0.6,
  },

  dCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 32,
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  dHeaderBlock: { alignItems: "center", gap: 8, marginBottom: 26 },
  dKeyRing: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  dTitle: { fontSize: 26, fontWeight: "900", letterSpacing: -0.4 },
  dSubtitle: { fontSize: 15, textAlign: "center", maxWidth: 340, lineHeight: 21 },

  dSpinner: { marginVertical: 18 },
  dFailedBlock: { alignItems: "center", gap: 12 },
  dFailedText: { fontSize: 14.5, textAlign: "center", lineHeight: 21 },

  dForm: { gap: 22 },
  dLabel: { fontSize: 13, fontWeight: "600", marginBottom: 8, marginLeft: 2, letterSpacing: 0.2 },
  dInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 52,
  },
  dInput: { flex: 1, fontSize: 15, height: 50, padding: 0 },
  dEyeBtn: { padding: 6 },

  dPrimaryBtn: {
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  dPrimaryBtnHover: { shadowOpacity: 0.7, shadowRadius: 26 },
  dPrimaryBtnText: { fontSize: 15.5, fontWeight: "900", color: "#111" },
  buttonDisabled: { opacity: 0.6 },
});
