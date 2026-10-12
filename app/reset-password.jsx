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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme, GOLD } from "../context/ThemeContext";
import AppAlert from "../utils/AppAlert";
import { getSupabase } from "../src/lib/supabase";
import { useAuthStore } from "../src/stores/auth";

export default function ResetPassword() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
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
});
