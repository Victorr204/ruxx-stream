import { useEffect, useState } from "react";
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
  Dimensions,
  StatusBar,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";
import { useTheme, GOLD, GOLD_GRADIENT } from "../context/ThemeContext";
import AppAlert from "../utils/AppAlert";
import { useAuthStore } from "../src/stores/auth";
import { getSupabase } from "../src/lib/supabase";
import { useIsDesktop } from "../src/hooks/useIsDesktop";
import Logos from "../assets/images/backlogo-transparent.png";

const { width } = Dimensions.get("window");

const DESKTOP_POINTS = [
  { icon: "flash-outline", text: "Start streaming in seconds" },
  { icon: "tv-outline", text: "Web, desktop & Android TV" },
  { icon: "download-outline", text: "Premium offline downloads" },
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

function Field({ label, icon, showToggle, showPassword, onTogglePassword, wide, ...props }) {
  const [focused, setFocused] = useState(false);
  const { theme } = useTheme();

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, wide && styles.dFieldLabel, { color: theme.subtitle }]}>{label}</Text>
      <View
        style={[
          styles.inputContainer,
          wide && styles.dInputContainer,
          { backgroundColor: theme.inputBackground, borderColor: focused ? GOLD : theme.inputBorder },
          focused && styles.inputFocused,
        ]}
      >
        <Ionicons name={icon} size={18} color={focused ? GOLD : theme.placeholder} />
        <TextInput
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[styles.input, wide && styles.dInput, { color: theme.inputText }]}
          placeholderTextColor={theme.placeholder}
        />
        {showToggle && (
          <TouchableOpacity
            onPress={onTogglePassword}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={wide ? styles.dEyeBtn : styles.eyeBtn}
          >
            <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={theme.placeholder} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function Register() {
  const { theme, resolved } = useTheme();
  const signUp = useAuthStore((s) => s.signUp);
  const isDesktop = useIsDesktop();
  const { width: windowWidth } = useWindowDimensions();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "error" });
  const [gotoLogin, setGotoLogin] = useState(false);
  const [awaitingVerify, setAwaitingVerify] = useState(false);
  const [resending, setResending] = useState(false);
  const [ctaHover, setCtaHover] = useState(false);
  const [linkHover, setLinkHover] = useState(false);
  const [resendHover, setResendHover] = useState(false);

  const showAlert = (title, message, type = "error") => setAlert({ visible: true, title, message, type });

  const closeAlert = () => {
    setAlert((a) => ({ ...a, visible: false }));
    // A signup that needs verification hands off to sign-in once acknowledged.
    if (gotoLogin) {
      setGotoLogin(false);
      try {
        router.replace("/login");
      } catch (_e) {}
    }
  };

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      showAlert("Missing Fields", "Please fill in your name, email and password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showAlert("Invalid Email", "Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      showAlert("Weak Password", "Your password must be at least 8 characters.");
      return;
    }
    if (!agreed) {
      showAlert("Agreement Required", "Please agree to the Terms of Service and Privacy Policy.");
      return;
    }

    setLoading(true);
    const result = await signUp(name, email, password);
    setLoading(false);

    if (result.kind === "error") {
      showAlert("Registration Failed", result.message);
      return;
    }
    if (result.kind === "verify") {
      setAwaitingVerify(true);
      setGotoLogin(true);
      showAlert(
        "Verify Your Email",
        "Account created. Check your inbox for a verification link, then sign in.",
        "success"
      );
      return;
    }
    try {
      router.replace("/home");
    } catch (_e) {
      // Auth guard may have already swapped the stack.
    }
  };

  const handleResend = async () => {
    if (resending || !email.trim()) {
      showAlert("Enter Your Email", "Type your email above, then tap resend.", "error");
      return;
    }
    setResending(true);
    try {
      const { error } = await getSupabase().auth.resend({ type: "signup", email: email.trim() });
      if (error) {
        showAlert("Resend Failed", error.message, "error");
      } else {
        showAlert("Email Sent", "We sent the verification link again — check your inbox.", "success");
      }
    } catch (e) {
      showAlert("Resend Failed", e instanceof Error ? e.message : "Please try again.", "error");
    } finally {
      setResending(false);
    }
  };

  // ── Desktop ──
  // Outside the tab shell these screens provide their own chrome: the
  // landing's dark hero backdrop + glow orbs, brand block on the left and a
  // centered form card on the right (stacked when width < 1280).
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
                <Text style={styles.dTag}>Create your free account and start streaming tonight.</Text>

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
                  <Text style={[styles.dCardTitle, { color: theme.text }]}>Create Account</Text>
                  <Text style={[styles.dCardSubtitle, { color: theme.subtitle }]}>Join ruxx stream today</Text>

                  <Field
                    wide
                    label="Full Name"
                    icon="person-outline"
                    placeholder="John Doe"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                  />

                  <Field
                    wide
                    label="Email"
                    icon="mail-outline"
                    placeholder="you@example.com"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                  />

                  <Field
                    wide
                    label="Password"
                    icon="lock-closed-outline"
                    placeholder="At least 8 characters"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    showToggle
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword((v) => !v)}
                  />

                  {/* Terms checkbox */}
                  <TouchableOpacity
                    style={styles.dCheckboxRow}
                    onPress={() => setAgreed((v) => !v)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.dCheckbox,
                        { borderColor: theme.inputBorder },
                        agreed && { backgroundColor: GOLD, borderColor: GOLD },
                      ]}
                    >
                      {agreed && <Ionicons name="checkmark" size={15} color="#111" />}
                    </View>
                    <Text style={[styles.dCheckboxText, { color: theme.subtitle }]}>
                      I agree to the{" "}
                      <Text
                        style={{ color: GOLD, fontWeight: "700" }}
                        onPress={() => router.push("/terms")}
                        accessibilityRole="link"
                      >
                        Terms of Service
                      </Text>{" "}
                      and{" "}
                      <Text
                        style={{ color: GOLD, fontWeight: "700" }}
                        onPress={() => router.push("/privacy")}
                        accessibilityRole="link"
                      >
                        Privacy Policy
                      </Text>
                    </Text>
                  </TouchableOpacity>

                  {/* Gold CTA */}
                  <TouchableOpacity
                    style={[
                      styles.dPrimaryBtn,
                      ctaHover && styles.dPrimaryHover,
                      (loading || !agreed) && styles.buttonDisabled,
                    ]}
                    onPress={handleRegister}
                    disabled={loading || !agreed}
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
                          <Text style={styles.dPrimaryText}>Create Account</Text>
                          <Ionicons name="arrow-forward" size={18} color="#111" />
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>

                  {awaitingVerify ? (
                    <View style={[styles.dResendCard, { borderColor: theme.inputBorder }]}>
                      <Text style={[styles.dResendText, { color: theme.subtitle }]}>
                        Didn&apos;t get the verification email?
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.dResendBtn,
                          resendHover && styles.dResendBtnHover,
                          { borderColor: GOLD, opacity: resending ? 0.6 : 1 },
                        ]}
                        onPress={handleResend}
                        disabled={resending}
                        activeOpacity={0.8}
                        onMouseEnter={() => setResendHover(true)}
                        onMouseLeave={() => setResendHover(false)}
                      >
                        {resending ? (
                          <ActivityIndicator size="small" color={GOLD} />
                        ) : (
                          <Text style={[styles.dResendBtnText, { color: GOLD }]}>
                            Resend verification email
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                <View style={styles.dLoginRow}>
                  <Text style={[styles.dLoginText, { color: theme.subtitle }]}>
                    Already have an account?{" "}
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.replace("/login")}
                    onMouseEnter={() => setLinkHover(true)}
                    onMouseLeave={() => setLinkHover(false)}
                  >
                    <Text style={[styles.dLoginLink, linkHover && styles.dLinkHover, { color: GOLD }]}>
                      Sign In
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.dFooter, { color: theme.placeholder }]}>
                  Operated by Ruxx Digital Services
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
              <Text style={styles.heroSubtitle}>Create your free account</Text>
            </Animated.View>
          </View>

          <AppAlert
            visible={alert.visible}
            title={alert.title}
            message={alert.message}
            type={alert.type}
            theme={theme}
            onClose={closeAlert}
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
              <Text style={[styles.cardTitle, { color: theme.text }]}>Create Account</Text>
              <Text style={[styles.cardSubtitle, { color: theme.subtitle }]}>Join ruxx stream today</Text>

              <Field
                label="Full Name"
                icon="person-outline"
                placeholder="John Doe"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
              />

              <Field
                label="Email"
                icon="mail-outline"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
              />

              <Field
                label="Password"
                icon="lock-closed-outline"
                placeholder="At least 8 characters"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                showToggle
                showPassword={showPassword}
                onTogglePassword={() => setShowPassword((v) => !v)}
              />

              {/* Terms checkbox */}
              <TouchableOpacity style={styles.checkboxRow} onPress={() => setAgreed((v) => !v)} activeOpacity={0.7}>
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: theme.inputBorder },
                    agreed && { backgroundColor: GOLD, borderColor: GOLD },
                  ]}
                >
                  {agreed && <Ionicons name="checkmark" size={14} color="#111" />}
                </View>
                <Text style={[styles.checkboxText, { color: theme.subtitle }]}>
                  I agree to the{" "}
                  <Text
                    style={{ color: GOLD, fontWeight: "700" }}
                    onPress={() => router.push("/terms")}
                    accessibilityRole="link"
                  >
                    Terms of Service
                  </Text>{" "}
                  and{" "}
                  <Text
                    style={{ color: GOLD, fontWeight: "700" }}
                    onPress={() => router.push("/privacy")}
                    accessibilityRole="link"
                  >
                    Privacy Policy
                  </Text>
                </Text>
              </TouchableOpacity>

              {/* Gold CTA */}
              <TouchableOpacity
                style={[styles.primaryBtn, (loading || !agreed) && styles.buttonDisabled]}
                onPress={handleRegister}
                disabled={loading || !agreed}
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
                      <Text style={styles.primaryBtnText}>Create Account</Text>
                      <Ionicons name="arrow-forward" size={18} color="#111" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {awaitingVerify ? (
                <View style={[styles.resendCard, { borderColor: theme.inputBorder }]}>
                  <Text style={[styles.resendText, { color: theme.subtitle }]}>
                    Didn&apos;t get the verification email?
                  </Text>
                  <TouchableOpacity
                    style={[styles.resendBtn, { borderColor: GOLD, opacity: resending ? 0.6 : 1 }]}
                    onPress={handleResend}
                    disabled={resending}
                    activeOpacity={0.8}
                  >
                    {resending ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <Text style={[styles.resendBtnText, { color: GOLD }]}>Resend verification email</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <Animated.View entering={FadeIn.delay(350).duration(500)} style={styles.loginRow} pointerEvents="box-none">
              <Text style={[styles.loginText, { color: theme.subtitle }]}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.replace("/login")}>
                <Text style={[styles.loginLink, { color: GOLD }]}>Sign In</Text>
              </TouchableOpacity>
            </Animated.View>

            <Text style={[styles.footer, { color: theme.placeholder }]}>Operated by Ruxx Digital Services</Text>
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
    height: Dimensions.get("window").height * 0.26,
    flexShrink: 0,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingBottom: 16,
  },
  heroInner: { alignItems: "center", paddingHorizontal: 24, zIndex: 2 },
  orb: { position: "absolute" },
  formScroll: { flex: 1, flexGrow: 1 },

  logoRing: {
    width: 80,
    height: 80,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  logo: { width: 68, height: 68, backgroundColor: "transparent" },

  brandName: { fontSize: 26, fontWeight: "900", color: "#fff", letterSpacing: -0.5, marginBottom: 4 },
  heroSubtitle: { fontSize: 13.5, color: "rgba(255,255,255,0.6)", fontWeight: "500", letterSpacing: 0.2 },

  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 20, paddingBottom: 32 },

  card: {
    borderRadius: 22,
    padding: 20,
    marginBottom: 16,
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
  cardSubtitle: { fontSize: 13.5, marginBottom: 16 },

  fieldBlock: { marginBottom: 0 },
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
    marginBottom: 12,
    height: 50,
  },
  inputFocused: {
    shadowColor: GOLD,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  input: { flex: 1, marginLeft: 10, height: 46, fontSize: 15, padding: 0 },
  eyeBtn: { padding: 4 },

  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxText: { flex: 1, fontSize: 13, lineHeight: 18 },

  primaryBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54 },
  primaryBtnText: { fontSize: 16.5, fontWeight: "800", color: "#111", letterSpacing: 0.2 },
  buttonDisabled: { opacity: 0.5 },

  loginRow: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  loginText: { fontSize: 14 },
  loginLink: { fontSize: 14, fontWeight: "800" },

  footer: { fontSize: 11, textAlign: "center", marginTop: 14 },

  resendCard: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    gap: 10,
    alignItems: "center",
  },
  resendText: { fontSize: 12.5, textAlign: "center" },
  resendBtn: {
    borderWidth: 1.5,
    borderRadius: 11,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  resendBtnText: { fontSize: 13, fontWeight: "800" },

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

  dFieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginLeft: 2,
    letterSpacing: 0.2,
    textTransform: "none",
  },
  dInputContainer: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    marginBottom: 24,
    height: 52,
  },
  dInput: { flex: 1, marginLeft: 12, height: 50, fontSize: 15, padding: 0 },
  dEyeBtn: { padding: 6 },

  dCheckboxRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 22 },
  dCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dCheckboxText: { flex: 1, fontSize: 14, lineHeight: 20 },

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

  dLoginRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 24 },
  dLoginText: { fontSize: 15 },
  dLoginLink: { fontSize: 15, fontWeight: "800" },
  dLinkHover: { textDecorationLine: "underline" },

  dFooter: { fontSize: 13, textAlign: "center", marginTop: 16 },

  dResendCard: {
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    gap: 12,
    alignItems: "center",
  },
  dResendText: { fontSize: 13.5, textAlign: "center" },
  dResendBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dResendBtnHover: { backgroundColor: "rgba(232,184,74,0.08)" },
  dResendBtnText: { fontSize: 14, fontWeight: "800" },
});
