import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../context/ThemeContext";

// Placeholder until Phase 5 lands the real player (resume, ads, cue points,
// D-pad controls, hls.js on web).
export default function Player() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => {
            try {
              router.back();
            } catch (_e) {
              router.navigate("/home");
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Leave player"
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.center}>
          <ActivityIndicator color={GOLD} size="large" />
          <Text style={styles.title}>Preparing your stream…</Text>
          <Text style={styles.subtitle}>{Array.isArray(params.id) ? params.id[0] : params.id}</Text>
          <Text style={[styles.hint, { color: theme.placeholder }]}>Press back to return</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  back: {
    marginLeft: 16,
    marginTop: 8,
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  title: { color: "#fff", fontSize: 17, fontWeight: "800", marginTop: 6 },
  subtitle: { color: "rgba(255,255,255,0.5)", fontSize: 12.5 },
  hint: { fontSize: 12, marginTop: 4 },
});
