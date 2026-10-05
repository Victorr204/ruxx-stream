import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../context/ThemeContext";

// Phase 4 replaces this with the real home feed (hero, continue-watching,
// genre rows).
export default function Home() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.center}>
        <Ionicons name="film-outline" size={44} color={theme.placeholder} />
        <Text style={[styles.title, { color: theme.text }]}>Home</Text>
        <Text style={[styles.subtitle, { color: theme.subtitle }]}>
          Your catalog is loading…
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 8 },
  subtitle: { fontSize: 14, textAlign: "center" },
});
