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
import Logos from "../assets/images/backlogo-transparent.png";

const { width } = Dimensions.get("window");

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
  const { theme } = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "info" });

  const showAlert = (title, message, type = "error") =>
    setAlert({ visible: true, title, message, type });

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

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" />
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
});
