import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
  StatusBar,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInDown,
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { useTheme, GOLD, GOLD_GRADIENT } from "../context/ThemeContext";
import AppAlert from "../utils/AppAlert";
import { useAuthStore } from "../src/stores/auth";
import { useIsDesktop } from "../src/hooks/useIsDesktop";
import Logos from "../assets/images/backlogo-transparent.png";

const { width } = Dimensions.get("window");

const DESKTOP_POINTS = [
  { icon: "film-outline", text: "Movies, series & documentaries" },
  { icon: "tv-outline", text: "Web, desktop & Android TV" },
  { icon: "shield-checkmark-outline", text: "Private, encrypted streaming" },
];

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

export default function Login() {
  const { theme, resolved } = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const isDesktop = useIsDesktop();
  const { width: windowWidth } = useWindowDimensions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "info" });
  const [ctaHover, setCtaHover] = useState(false);
  const [linkHover, setLinkHover] = useState(false);

  const showAlert = (title, message, type = "error") =>
    setAlert({ visible: true, title, message, type });

  const closeAlert = () => setAlert((a) => ({ ...a, visible: false }));

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert("Missing Details", "Please enter your email and password.", "error");
      return;
    }
    if (!isValidEmail(email)) {
      showAlert("Invalid Email", "Please enter a valid email address.", "error");
      return;
    }

    setLoading(true);
    const failure = await signIn(email, password);
    setLoading(false);

    if (failure) {
      showAlert("Sign In Failed", failure, "error");
      return;
    }
    try {
      router.replace("/home");
    } catch (_e) {
      // The auth guard may have already swapped the stack for us.
    }
  };

  const handleForgotPassword = async () => {
    if (!isValidEmail(email)) {
      showAlert("Check Your Email", "Enter your email address first, then tap Forgot password?", "error");
      return;
    }
    setResetting(true);
    const failure = await sendPasswordReset(email);
    setResetting(false);

    if (failure) {
      showAlert("Reset Failed", failure, "error");
      return;
    }
    showAlert(
      "Check Your Email",
      "A password reset link is on its way. Open it to choose a new password.",
      "success"
    );
  };

  // ── Desktop ──
  // These screens render outside the tab shell, so on wide windows they get
  // their own chrome: the landing's dark hero backdrop + glow orbs, with the
  // brand block beside a centered form card (stacked when width < 1280).
  if (isDesktop) {
    const twoCol = windowWidth >= 1280;

    return (
      <View style={styles.dRoot}>
        <StatusBar barStyle={resolved === "dark" ? "light-content" : "dark-content"} />
        <LinearGradient
          colors={["#0a0a0a", "#16120a", "#0a0a0a"]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <GlowOrb color={GOLD} size={520} top={-200} left={-170} delay={0} />
        <GlowOrb color="#3b82f6" size={400} top={160} right={-190} delay={700} />
        <GlowOrb color="#8b5cf6" size={320} bottom={-90} left={windowWidth * 0.5} delay={1400} />

        {/* ── Alert ── */}
        <AppAlert
          visible={alert.visible}
          title={alert.title}
          message={alert.message}
          type={alert.type}
          theme={theme}
          onClose={closeAlert}
        />

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={styles.dScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.dLayout, !twoCol && styles.dLayoutStacked]}>
              {/* ── Left: brand ── */}
              <Animated.View
                entering={FadeInDown.duration(600)}
                style={[styles.dBrandCol, !twoCol && styles.dBrandColStacked]}
              >
                <View style={styles.dLogoRing}>
                  <Image source={Logos} style={styles.dLogo} resizeMode="contain" />
                </View>
                <Text style={styles.dBrand}>ruxx stream</Text>
                <Text style={styles.dTag}>Welcome back — sign in to continue.</Text>

                <View style={styles.dPoints}>
                  {DESKTOP_POINTS.map((p) => (
                    <View key={p.text} style={styles.dPointRow}>
                      <View style={styles.dPointIcon}>
                        <Ionicons name={p.icon} size={16} color={GOLD} />
                      </View>
                      <Text style={styles.dPointText}>{p.text}</Text>
                    </View>
                  ))}
                </View>
              </Animated.View>

              {/* ── Right: form card ── */}
              <Animated.View
                entering={FadeInDown.delay(150).duration(600)}
                style={[styles.dCardCol, !twoCol && styles.dCardColStacked]}
              >
                <View style={[styles.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <Text style={[styles.dCardTitle, { color: theme.text }]}>Sign In</Text>
                  <Text style={[styles.dCardSubtitle, { color: theme.subtitle }]}>Enter your credentials</Text>

                  {/* Email */}
                  <Text style={[styles.dFieldLabel, { color: theme.subtitle }]}>Email</Text>
                  <View
                    style={[
                      styles.dInputContainer,
                      {
                        backgroundColor: theme.inputBackground,
                        borderColor: emailFocused ? GOLD : theme.inputBorder,
                      },
                      emailFocused && styles.inputFocused,
                    ]}
                  >
                    <Ionicons name="mail-outline" size={18} color={emailFocused ? GOLD : theme.placeholder} />
                    <TextInput
                      placeholder="you@example.com"
                      value={email}
                      onChangeText={setEmail}
                      style={[styles.dInput, { color: theme.inputText }]}
                      placeholderTextColor={theme.placeholder}
                      autoCapitalize="none"
                      autoComplete="email"
                      keyboardType="email-address"
                      returnKeyType="next"
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                    />
                  </View>

                  {/* Password */}
                  <Text style={[styles.dFieldLabel, { color: theme.subtitle }]}>Password</Text>
                  <View
                    style={[
                      styles.dInputContainer,
                      {
                        backgroundColor: theme.inputBackground,
                        borderColor: passwordFocused ? GOLD : theme.inputBorder,
                      },
                      passwordFocused && styles.inputFocused,
                    ]}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color={passwordFocused ? GOLD : theme.placeholder}
                    />
                    <TextInput
                      placeholder="••••••••"
                      value={password}
                      onChangeText={setPassword}
                      style={[styles.dInput, { color: theme.inputText }]}
                      placeholderTextColor={theme.placeholder}
                      secureTextEntry={!showPassword}
                      autoComplete="current-password"
                      returnKeyType="done"
                      onSubmitEditing={handleLogin}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword((v) => !v)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.dEyeBtn}
                    >
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color={theme.placeholder}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Forgot password */}
                  <TouchableOpacity onPress={handleForgotPassword} style={styles.dForgotRow} disabled={resetting}>
                    <Text style={[styles.dForgotText, { color: GOLD }]}>
                      {resetting ? "Sending reset link…" : "Forgot password?"}
                    </Text>
                  </TouchableOpacity>

                  {/* Gold CTA */}
                  <TouchableOpacity
                    style={[styles.dPrimaryBtn, ctaHover && styles.dPrimaryHover, loading && styles.buttonDisabled]}
                    onPress={handleLogin}
                    disabled={loading}
                    activeOpacity={0.88}
                    onMouseEnter={() => setCtaHover(true)}
                    onMouseLeave={() => setCtaHover(false)}
                  >
                    <LinearGradient
                      colors={ctaHover ? ["#f7d67e", "#f0c75e", "#e2b23f"] : GOLD_GRADIENT}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.dPrimaryGrad}
                    >
                      {loading ? (
                        <ActivityIndicator color="#111" />
                      ) : (
                        <>
                          <Text style={styles.dPrimaryText}>Sign In</Text>
                          <Ionicons name="arrow-forward" size={18} color="#111" />
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>

                <View style={styles.dRegisterRow}>
                  <Text style={[styles.dRegisterText, { color: theme.subtitle }]}>
                    Don&apos;t have an account?{" "}
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.replace("/register")}
                    onMouseEnter={() => setLinkHover(true)}
                    onMouseLeave={() => setLinkHover(false)}
                  >
                    <Text
                      style={[styles.dRegisterLink, linkHover && styles.dLinkHover, { color: GOLD }]}
                    >
                      Create one
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.dFooter, { color: theme.placeholder }]}>
                  Protected with end-to-end encryption
                </Text>
              </Animated.View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={resolved === "dark" ? "light-content" : "dark-content"} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView style={styles.flex} edges={["top", "left", "right", "bottom"]}>
          {/* ── Branded hero ── */}
          <View style={styles.hero} pointerEvents="box-none">
            <LinearGradient
              colors={["#0a0a0a", "#16120a", "#0a0a0a"]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
            <GlowOrb color={GOLD} size={220} top={-70} left={-50} delay={0} />
            <GlowOrb color="#3b82f6" size={170} top={30} right={-60} delay={700} />
            <GlowOrb color="#8b5cf6" size={140} bottom={-40} left={width * 0.25} delay={1400} />

            <Animated.View entering={FadeInDown.duration(600)} style={styles.heroInner} pointerEvents="none">
              <View style={styles.logoRing}>
                <Image source={Logos} style={styles.logo} resizeMode="contain" />
              </View>
              <Text style={styles.brandName}>ruxx stream</Text>
              <Text style={styles.heroSubtitle}>Welcome back — sign in to continue</Text>
            </Animated.View>
          </View>

          {/* ── Alert ── */}
          <AppAlert
            visible={alert.visible}
            title={alert.title}
            message={alert.message}
            type={alert.type}
            theme={theme}
            onClose={() => setAlert((a) => ({ ...a, visible: false }))}
          />

          {/* ── Form sheet ── */}
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Sign In</Text>
              <Text style={[styles.cardSubtitle, { color: theme.subtitle }]}>Enter your credentials</Text>

              {/* Email */}
              <Text style={[styles.fieldLabel, { color: theme.subtitle }]}>Email</Text>
              <View
                style={[
                  styles.inputContainer,
                  { backgroundColor: theme.inputBackground, borderColor: emailFocused ? GOLD : theme.inputBorder },
                  emailFocused && styles.inputFocused,
                ]}
              >
                <Ionicons name="mail-outline" size={18} color={emailFocused ? GOLD : theme.placeholder} />
                <TextInput
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  style={[styles.input, { color: theme.inputText }]}
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>

              {/* Password */}
              <Text style={[styles.fieldLabel, { color: theme.subtitle }]}>Password</Text>
              <View
                style={[
                  styles.inputContainer,
                  { backgroundColor: theme.inputBackground, borderColor: passwordFocused ? GOLD : theme.inputBorder },
                  passwordFocused && styles.inputFocused,
                ]}
              >
                <Ionicons name="lock-closed-outline" size={18} color={passwordFocused ? GOLD : theme.placeholder} />
                <TextInput
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  style={[styles.input, { color: theme.inputText }]}
                  placeholderTextColor={theme.placeholder}
                  secureTextEntry={!showPassword}
                  autoComplete="current-password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={theme.placeholder}
                  />
                </TouchableOpacity>
              </View>

              {/* Forgot password */}
              <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotRow} disabled={resetting}>
                <Text style={[styles.forgotText, { color: GOLD }]}>
                  {resetting ? "Sending reset link…" : "Forgot password?"}
                </Text>
              </TouchableOpacity>

              {/* Gold CTA */}
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.88}
              >
                <LinearGradient
                  colors={GOLD_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryBtnGrad}
                >
                  {loading ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <>
                      <Text style={styles.primaryBtnText}>Sign In</Text>
                      <Ionicons name="arrow-forward" size={18} color="#111" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <Animated.View entering={FadeIn.delay(400).duration(500)} style={styles.registerRow} pointerEvents="box-none">
              <Text style={[styles.registerText, { color: theme.subtitle }]}>Don&apos;t have an account? </Text>
              <TouchableOpacity onPress={() => router.replace("/register")}>
                <Text style={[styles.registerLink, { color: GOLD }]}>Create one</Text>
              </TouchableOpacity>
            </Animated.View>

            <Text style={[styles.footer, { color: theme.placeholder }]}>
              Protected with end-to-end encryption
            </Text>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1 },

  hero: {
    height: Dimensions.get("window").height * 0.3,
    flexShrink: 0,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingBottom: 20,
  },
  heroInner: { alignItems: "center", paddingHorizontal: 24, zIndex: 2 },
  orb: { position: "absolute" },
  formScroll: { flex: 1, flexGrow: 1 },

  logoRing: {
    width: 88,
    height: 88,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  logo: { width: 74, height: 74, backgroundColor: "transparent" },

  brandName: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 13.5,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "500",
    letterSpacing: 0.2,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 22,
    paddingBottom: 36,
  },

  card: {
    borderRadius: 22,
    padding: 22,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    zIndex: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  cardTitle: { fontSize: 22, fontWeight: "800", marginBottom: 2 },
  cardSubtitle: { fontSize: 13.5, marginBottom: 18 },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    marginLeft: 2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
    height: 52,
    position: "relative",
    zIndex: 2,
  },
  inputFocused: {
    shadowColor: GOLD,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  input: {
    flex: 1,
    marginLeft: 10,
    height: 48,
    fontSize: 15,
    padding: 0,
  },
  eyeBtn: { padding: 4, zIndex: 3 },

  forgotRow: { alignItems: "flex-end", marginBottom: 18, marginTop: -2 },
  forgotText: { fontSize: 13, fontWeight: "700" },

  primaryBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
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
  primaryBtnText: { fontSize: 16.5, fontWeight: "800", color: "#111", letterSpacing: 0.2 },
  buttonDisabled: { opacity: 0.6 },

  registerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  registerText: { fontSize: 14 },
  registerLink: { fontSize: 14, fontWeight: "800" },

  footer: { fontSize: 11, textAlign: "center", marginTop: 14 },

  /* ── Desktop ── */
  dRoot: { flex: 1, overflow: "hidden", backgroundColor: "#0a0a0a" },
  dScroll: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    paddingHorizontal: 64,
    paddingVertical: 48,
    justifyContent: "center",
  },
  dLayout: { flexDirection: "row", alignItems: "center", gap: 80 },
  dLayoutStacked: { flexDirection: "column", gap: 40 },
  dBrandCol: { flex: 1.1, maxWidth: 560, alignItems: "flex-start" },
  dBrandColStacked: { flex: 0, maxWidth: 520, alignSelf: "center" },
  dCardCol: { flex: 1, minWidth: 0, maxWidth: 460, alignSelf: "center" },
  dCardColStacked: { flex: 0, alignSelf: "center" },

  dLogoRing: {
    width: 92,
    height: 92,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.5)",
    backgroundColor: "rgba(232,184,74,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 26,
    shadowColor: GOLD,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  dLogo: { width: 64, height: 64, backgroundColor: "transparent" },
  dBrand: {
    fontSize: 46,
    lineHeight: 52,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -1.6,
    marginBottom: 10,
  },
  dTag: {
    fontSize: 17,
    lineHeight: 26,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "500",
    letterSpacing: 0.1,
    marginBottom: 30,
  },
  dPoints: { gap: 14 },
  dPointRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dPointIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: "rgba(232,184,74,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  dPointText: { fontSize: 14.5, color: "rgba(255,255,255,0.75)", fontWeight: "600" },

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
  dCardTitle: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginBottom: 6 },
  dCardSubtitle: { fontSize: 15, marginBottom: 28 },

  dFieldLabel: { fontSize: 13, fontWeight: "600", marginBottom: 8, marginLeft: 2, letterSpacing: 0.2 },
  dInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
    height: 52,
  },
  dInput: { flex: 1, marginLeft: 12, height: 50, fontSize: 15, padding: 0 },
  dEyeBtn: { padding: 6 },

  dForgotRow: { alignItems: "flex-end", marginTop: -8, marginBottom: 24 },
  dForgotText: { fontSize: 13.5, fontWeight: "700" },

  dPrimaryBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  dPrimaryHover: { shadowOpacity: 0.75, shadowRadius: 30 },
  dPrimaryGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
  },
  dPrimaryText: { fontSize: 16, fontWeight: "800", color: "#111", letterSpacing: 0.2 },

  dRegisterRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 24 },
  dRegisterText: { fontSize: 15 },
  dRegisterLink: { fontSize: 15, fontWeight: "800" },
  dLinkHover: { textDecorationLine: "underline" },

  dFooter: { fontSize: 13, textAlign: "center", marginTop: 16 },
});
