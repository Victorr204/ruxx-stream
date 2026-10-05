import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useSearch } from "../../src/hooks/useMovies";
import MovieCard from "../../src/components/MovieCard";

const { width: SCREEN_W } = Dimensions.get("window");

function columnsFor(width) {
  if (width >= 1000) return 6;
  if (width >= 760) return 5;
  if (width >= 560) return 4;
  return 3;
}

export default function Search() {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const { data: results, loading, error } = useSearch(query);

  const columns = columnsFor(SCREEN_W);
  const gap = 12;
  const cardWidth = Math.floor((SCREEN_W - 40 - gap * (columns - 1)) / columns);

  const hasQuery = query.trim().length > 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      <Text style={[styles.header, { color: theme.text }]}>Search</Text>

      <View style={[styles.searchBox, { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}>
        <Ionicons name="search-outline" size={18} color={theme.placeholder} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search titles…"
          placeholderTextColor={theme.placeholder}
          style={[styles.input, { color: theme.inputText }]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {hasQuery && (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={17} color={theme.placeholder} />
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      )}

      {!loading && error && (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Search failed</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>{error}</Text>
        </View>
      )}

      {!loading && !error && !hasQuery && (
        <View style={styles.center}>
          <Ionicons name="search-outline" size={44} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Find something to watch</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>
            Search by title — try a movie name you already know.
          </Text>
        </View>
      )}

      {!loading && !error && hasQuery && results.length === 0 && (
        <View style={styles.center}>
          <Ionicons name="file-tray-outline" size={42} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>No matches</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>
            Nothing found for “{query.trim()}”.
          </Text>
        </View>
      )}

      {!loading && !error && results.length > 0 && (
        <FlatList
          key={columns}
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap }}
          renderItem={({ item }) => (
            <MovieCard
              movie={item}
              width={cardWidth}
              onPress={(movie) => router.push(`/movie/${movie.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 14,
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 16,
  },
  input: { flex: 1, fontSize: 15, height: 46, padding: 0 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  centerTitle: { fontSize: 17, fontWeight: "800", marginTop: 6 },
  centerText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  grid: { paddingHorizontal: 20, paddingBottom: 30, gap: 16 },
});
