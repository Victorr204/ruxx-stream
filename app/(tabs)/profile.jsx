import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTheme, GOLD, GOLD_GRADIENT } from "../../context/ThemeContext";
import AppAlert from "../../utils/AppAlert";
import { useAuthStore } from "../../src/stores/auth";
import { getSupabase } from "../../src/lib/supabase";
import { checkoutRedirectUrl, startCheckout } from "../../src/lib/api";

function initialsFor(name, email) {
  const source = (name || email || "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function StatCard({ label, value }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: theme.card }]}>
      <Text style={[styles.statValue, { color: GOLD }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.subtitle }]}>{label}</Text>
    </View>
  );
}

function Row({ icon, label, value, onPress, right, danger }) {
  const { theme } = useTheme();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: danger ? "rgba(239,68,68,0.12)" : "rgba(232,184,74,0.10)" }]}>
        <Ionicons name={icon} size={17} color={danger ? "#ef4444" : GOLD} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, { color: danger ? "#ef4444" : theme.text }]}>{label}</Text>
        {value ? (
          <Text style={[styles.rowValue, { color: theme.subtitle }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={17} color={theme.placeholder} /> : null)}
    </>
  );

  if (!onPress) return <View style={[styles.row, { backgroundColor: theme.card }]}>{content}</View>;

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: theme.card }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {content}
    </TouchableOpacity>
  );
}

export default function Profile() {
  const { theme } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "info" });

  const showAlert = (title, message, type = "info") => setAlert({ visible: true, title, message, type });

  const announcePremium = () =>
    showAlert("Welcome to Premium", "Ad-free streaming and offline downloads are unlocked.", "success");

  const handleUpgrade = async () => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const result = await startCheckout();
      if (!result.url) {
        if (result.reason === "not-configured") {
          showAlert(
            "Premium is Coming Soon",
            "The Premium plan will unlock ad-free streaming and offline downloads. Stay tuned!",
            "info"
          );
        } else if (result.reason === "already-premium") {
          await refreshProfile();
          announcePremium();
        } else {
          showAlert("Checkout Failed", result.message || "Please try again later.", "error");
        }
        return;
      }

      const redirectUrl = checkoutRedirectUrl();
      const outcome = await WebBrowser.openAuthSessionAsync(result.url, redirectUrl);
      await refreshProfile();
      if (useAuthStore.getState().profile?.is_premium) {
        announcePremium();
        return;
      }
      if (outcome.type === "success") {
        // The Stripe webhook may land just after the redirect — poll briefly.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await refreshProfile();
          if (useAuthStore.getState().profile?.is_premium) {
            announcePremium();
            return;
          }
        }
        showAlert(
          "Payment Processing",
          "Your payment is being confirmed. Premium activates within a minute — reopen Profile to see it.",
          "info"
        );
      }
    } catch (e) {
      showAlert("Checkout Failed", e instanceof Error ? e.message : "Please try again later.", "error");
    } finally {
      setUpgrading(false);
    }
  };

  const displayName = profile?.display_name || session?.user?.user_metadata?.display_name || "";
  const email = session?.user?.email ?? "";
  const isPremium = profile?.is_premium ?? false;
  const isAdmin = profile?.role === "admin";
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "—";

  const startEditing = () => {
    setDraftName(displayName);
    setEditing(true);
  };

  const saveName = async () => {
    if (!draftName.trim()) {
      showAlert("Name Required", "Please enter a display name.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await getSupabase()
        .from("profiles")
        .update({ display_name: draftName.trim() })
        .eq("id", session.user.id);
      if (error) {
        showAlert("Update Failed", error.message);
        return;
      }
      await refreshProfile();
      setEditing(false);
      showAlert("Saved", "Your display name has been updated.", "success");
    } catch (e) {
      showAlert("Update Failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    setBusy(true);
    const failure = await sendPasswordReset(email);
    setBusy(false);
    if (failure) {
      showAlert("Reset Failed", failure);
      return;
    }
    showAlert("Check Your Email", "A password reset link is on its way to your inbox.", "success");
  };

  const handleSignOut = async () => {
    await signOut();
    try {
      router.replace("/login");
    } catch (_e) {
      // Guard already redirected.
    }
  };

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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.Text entering={FadeInDown.duration(400)} style={[styles.header, { color: theme.text }]}>
          Profile
        </Animated.Text>

        {/* ── Identity card ── */}
        <Animated.View entering={FadeInDown.delay(80).duration(450)} style={[styles.identity, { backgroundColor: theme.card }]}>
          <LinearGradient
            colors={isPremium ? GOLD_GRADIENT : ["rgba(232,184,74,0.35)", "rgba(232,184,74,0.12)"]}
            style={styles.avatarRing}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={[styles.avatar, { backgroundColor: theme.background }]}>
              <Text style={[styles.avatarText, { color: GOLD }]}>{initialsFor(displayName, email)}</Text>
            </View>
          </LinearGradient>

          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {displayName || "Movie fan"}
          </Text>
          <Text style={[styles.email, { color: theme.subtitle }]} numberOfLines={1}>
            {email}
          </Text>

          <View
            style={[
              styles.planChip,
              isPremium
                ? { backgroundColor: GOLD }
                : { backgroundColor: "rgba(255,255,255,0.08)", borderColor: theme.inputBorder, borderWidth: 1 },
            ]}
          >
            <Ionicons name={isPremium ? "star" : "sparkles-outline"} size={12} color={isPremium ? "#111" : theme.subtitle} />
            <Text style={[styles.planText, { color: isPremium ? "#111" : theme.subtitle }]}>
              {isPremium ? "Premium" : "Free plan"}
            </Text>
          </View>

          {isAdmin && (
            <View style={[styles.adminChip, { borderColor: "rgba(59,130,246,0.5)", backgroundColor: "rgba(59,130,246,0.12)" }]}>
              <Ionicons name="shield-checkmark-outline" size={12} color="#3b82f6" />
              <Text style={styles.adminText}>Administrator</Text>
            </View>
          )}
        </Animated.View>

        {/* ── Stats ── */}
        <Animated.View entering={FadeInDown.delay(160).duration(450)} style={styles.statsRow}>
          <StatCard label="Plan" value={isPremium ? "Premium" : "Free"} />
          <StatCard label="Member since" value={memberSince} />
          <StatCard label="Status" value={session?.user?.email_confirmed_at ? "Verified" : "Pending"} />
        </Animated.View>

        {/* ── Account ── */}
        <Animated.Text entering={FadeInDown.delay(240).duration(450)} style={[styles.sectionTitle, { color: theme.placeholder }]}>
          Account
        </Animated.Text>

        {editing ? (
          <View style={[styles.editCard, { backgroundColor: theme.card, borderColor: GOLD }]}>
            <Text style={[styles.fieldLabel, { color: theme.subtitle }]}>Display name</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Your name"
              placeholderTextColor={theme.placeholder}
              style={[styles.editInput, { color: theme.inputText, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.editBtn, { borderColor: theme.inputBorder }]}
                onPress={() => setEditing(false)}
                disabled={saving}
              >
                <Text style={[styles.editBtnText, { color: theme.subtitle }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editBtnPrimary} onPress={saveName} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#111" size="small" />
                ) : (
                  <Text style={styles.editBtnPrimaryText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Animated.View entering={FadeInDown.delay(280).duration(450)} style={{ gap: 10 }}>
            <Row icon="person-outline" label="Display name" value={displayName || "Not set"} onPress={startEditing} />
            <Row icon="mail-outline" label="Email" value={email} />
            <Row
              icon="key-outline"
              label="Reset password"
              value="We'll email you a secure link"
              onPress={handlePasswordReset}
              right={
                busy ? <ActivityIndicator size="small" color={GOLD} /> : <Ionicons name="chevron-forward" size={17} color={theme.placeholder} />
              }
            />
          </Animated.View>
        )}

        {/* ── Membership ── */}
        <Animated.Text entering={FadeInDown.delay(340).duration(450)} style={[styles.sectionTitle, { color: theme.placeholder }]}>
          Membership
        </Animated.Text>
        <Animated.View entering={FadeInDown.delay(380).duration(450)} style={{ gap: 10 }}>
          <Row
            icon="star-outline"
            label={isPremium ? "Premium active" : "Upgrade to Premium"}
            value={isPremium ? "Ad-free streams + offline downloads" : "Ad-free streams, downloads & more"}
            onPress={isPremium ? undefined : handleUpgrade}
            right={upgrading ? <ActivityIndicator size="small" color={GOLD} /> : undefined}
          />
        </Animated.View>

        {/* ── Sign out ── */}
        <Animated.View entering={FadeInDown.delay(440).duration(450)} style={styles.signOutWrap}>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={18} color="#ef4444" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
          <Text style={[styles.version, { color: theme.placeholder }]}>ruxx stream • v1.0.0</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40, gap: 14 },

  header: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2 },

  identity: {
    borderRadius: 22,
    padding: 22,
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 30,
    padding: 2.5,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 30, fontWeight: "900" },
  name: { fontSize: 20, fontWeight: "800" },
  email: { fontSize: 13 },

  planChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 6,
  },
  planText: { fontSize: 12, fontWeight: "800" },
  adminChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    marginTop: 2,
  },
  adminText: { fontSize: 11, fontWeight: "700", color: "#3b82f6" },

  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", gap: 4 },
  statValue: { fontSize: 15, fontWeight: "800" },
  statLabel: { fontSize: 11, textAlign: "center" },

  sectionTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
    marginLeft: 2,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14.5, fontWeight: "700" },
  rowValue: { fontSize: 12 },

  editCard: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 10 },
  fieldLabel: { fontSize: 11.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  editInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
  },
  editActions: { flexDirection: "row", gap: 10 },
  editBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtnText: { fontSize: 14, fontWeight: "700" },
  editBtnPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtnPrimaryText: { fontSize: 14, fontWeight: "800", color: "#111" },

  signOutWrap: { marginTop: 18, gap: 12 },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(239,68,68,0.45)",
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  signOutText: { fontSize: 15, fontWeight: "800", color: "#ef4444" },
  version: { fontSize: 11, textAlign: "center" },
});
