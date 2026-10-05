import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../context/ThemeContext";

// Phase 4 replaces this with real catalog search.
export default function Search() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.center}>
        <Ionicons name="search-outline" size={44} color={theme.placeholder} />
        <Text style={[styles.title, { color: theme.text }]}>Search</Text>
        <Text style={[styles.subtitle, { color: theme.subtitle }]}>
          Find movies and series by title, genre or year.
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
