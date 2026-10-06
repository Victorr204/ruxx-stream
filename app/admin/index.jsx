import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useAuthStore } from "../../src/stores/auth";
import CatalogPanel from "../../src/components/admin/CatalogPanel";
import AdsPanel from "../../src/components/admin/AdsPanel";
import GrantsPanel from "../../src/components/admin/GrantsPanel";

const SEGMENTS = [
  { key: "catalog", label: "Catalog", icon: "film-outline" },
  { key: "ads", label: "Ads", icon: "megaphone-outline" },
  { key: "grants", label: "Grants", icon: "key-outline" },
];

export default function AdminConsole() {
  const { theme } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const [segment, setSegment] = useState("catalog");

  // RLS is the real guard (every admin write is is_admin()-checked); this
  // just bounces non-admins out of a screen they could never use.
  useEffect(() => {
    if (profile && profile.role !== "admin") router.replace("/profile");
  }, [profile]);

  if (!profile || profile.role !== "admin") {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to profile"
        >
          <Ionicons name="chevron-back" size={20} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Admin Console</Text>
          <Text style={[styles.subtitle, { color: theme.placeholder }]}>Catalog, ads & downloads</Text>
        </View>
      </View>

      <View style={[styles.segments, { backgroundColor: theme.card }]}>
        {SEGMENTS.map((item) => {
          const active = segment === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.segment, active && { backgroundColor: GOLD }]}
              onPress={() => setSegment(item.key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={item.icon}
                size={14}
                color={active ? "#111" : theme.subtitle}
              />
              <Text style={[styles.segmentText, { color: active ? "#111" : theme.subtitle }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.panelWrap}>
        {segment === "catalog" ? <CatalogPanel /> : null}
        {segment === "ads" ? <AdsPanel /> : null}
        {segment === "grants" ? <GrantsPanel /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { fontSize: 12, marginTop: 1 },

  segments: {
    flexDirection: "row",
    margin: 16,
    marginBottom: 0,
    padding: 4,
    borderRadius: 14,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 11,
  },
  segmentText: { fontSize: 12, fontWeight: "800" },

  panelWrap: { flex: 1, marginTop: 14 },
});
