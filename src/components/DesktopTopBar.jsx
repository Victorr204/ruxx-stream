import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GOLD, useTheme } from "../../context/ThemeContext";
import { useAuthStore } from "../stores/auth";

// Sticky bar across the top of the content area (the sidebar owns the brand).
// Carries the global search and the account action so every screen below it
// doesn't have to re-implement both.
export default function DesktopTopBar() {
  const { theme } = useTheme();
  const pathname = usePathname();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const [term, setTerm] = useState("");

  const initials = (profile?.display_name || "R")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const submit = () => {
    const q = term.trim();
    // Already on search — let the field there take it rather than remounting.
    if (pathname === "/search") return;
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <View style={[styles.bar, { backgroundColor: theme.background, borderBottomColor: theme.cardBorder }]}>
      <View style={[styles.field, { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={theme.placeholder} />
        <TextInput
          value={term}
          onChangeText={setTerm}
          onSubmitEditing={submit}
          returnKeyType="search"
          placeholder="Search titles, genres, people…"
          placeholderTextColor={theme.placeholder}
          style={[styles.input, { color: theme.text }]}
          accessibilityLabel="Search titles"
        />
        {term.length > 0 && (
          <TouchableOpacity onPress={() => setTerm("")} accessibilityLabel="Clear search" accessibilityRole="button">
            <Ionicons name="close-circle" size={15} color={theme.placeholder} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.spacer} />

      {session ? (
        <TouchableOpacity
          style={[styles.avatar, { borderColor: GOLD, backgroundColor: "rgba(232,184,74,0.10)" }]}
          onPress={() => router.navigate("/profile")}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <Text style={[styles.avatarText, { color: GOLD }]}>{initials}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.signIn, { borderColor: "rgba(232,184,74,0.55)" }]}
          onPress={() => router.push("/login")}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text style={[styles.signInText, { color: GOLD }]}>Sign in</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    height: 64,
    paddingHorizontal: 32,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    width: 440,
    maxWidth: "45%",
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 13.5, fontWeight: "500", paddingVertical: 0, outlineStyle: "none" },
  spacer: { flex: 1 },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "900" },

  signIn: {
    paddingHorizontal: 18,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  signInText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
});
