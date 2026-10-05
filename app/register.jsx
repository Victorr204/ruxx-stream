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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";
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

function Field({ label, icon, showToggle, showPassword, onTogglePassword, ...props }) {
  const [focused, setFocused] = useState(false);
  const { theme } = useTheme();

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: theme.subtitle }]}>{label}</Text>
      <View
        style={[
          styles.inputContainer,
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
          style={[styles.input, { color: theme.inputText }]}
          placeholderTextColor={theme.placeholder}
        />
        {showToggle && (
          <TouchableOpacity
            onPress={onTogglePassword}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.eyeBtn}
          >
            <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={theme.placeholder} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function Register() {
  const { theme } = useTheme();
  const signUp = useAuthStore((s) => s.signUp);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "error" });
  const [gotoLogin, setGotoLogin] = useState(false);

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
                  I agree to the <Text style={{ color: GOLD, fontWeight: "700" }}>Terms of Service</Text> and{" "}
                  <Text style={{ color: GOLD, fontWeight: "700" }}>Privacy Policy</Text>
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
});
