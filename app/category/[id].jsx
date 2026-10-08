import { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useGenrePage } from "../../src/hooks/useMovies";
import { NEW_LISTING_SEGMENT } from "../../src/lib/api";
import MovieCard from "../../src/components/MovieCard";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_GAP = 12;

function columnsFor(width) {
  if (width >= 1000) return 6;
  if (width >= 760) return 5;
  if (width >= 560) return 4;
  return 3;
}

export default function Category() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { genre, movies, total, hasMore, loading, error, loadingMore, moreError, loadMore, reload } =
    useGenrePage(id);
  const isNewListing = id === NEW_LISTING_SEGMENT;

  const columns = columnsFor(SCREEN_W);
  const cardWidth = Math.floor((SCREEN_W - 40 - (2 * columns - 1) * CARD_GAP) / columns);

  const goBack = useCallback(() => {
    try {
      router.back();
    } catch (_e) {
      router.navigate("/home");
    }
  }, []);

  const openMovie = useCallback((movie) => router.push(`/movie/${movie.id}`), []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {isNewListing ? "New Movies" : genre?.name ?? "Category"}
          </Text>
          {!loading && !error && (
            <Text style={[styles.count, { color: theme.placeholder }]}>
              {total === 1 ? "1 title" : `${total} titles`}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.rule}>
        <LinearGradient
          colors={["rgba(232,184,74,0.5)", "rgba(255,255,255,0.10)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} size="large" />
          <Text style={[styles.centerText, { color: theme.subtitle }]}>Loading titles…</Text>
        </View>
      )}

      {!loading && !error && !isNewListing && !genre && (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Category not found</Text>
        </View>
      )}

      {!loading && !!id && error && (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Couldn&apos;t load titles</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload}>
            <Ionicons name="refresh" size={14} color="#111" />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (isNewListing || !!genre) && movies.length === 0 && (
        <View style={styles.center}>
          <Ionicons name="film-outline" size={42} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Nothing here yet</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>
            Titles in this category will show up here.
          </Text>
        </View>
      )}

      {!loading && !error && movies.length > 0 && (
        <FlatList
          key={columns}
          data={movies}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: CARD_GAP }}
          renderItem={({ item }) => (
            <MovieCard movie={item} width={cardWidth} onPress={openMovie} />
          )}
          ListFooterComponent={
            <View style={styles.footerBlock}>
              {moreError && (
                <TouchableOpacity style={styles.moreRetry} onPress={loadMore}>
                  <Text style={[styles.moreRetryText, { color: theme.subtitle }]}>{moreError} — tap to retry</Text>
                </TouchableOpacity>
              )}
              {hasMore && !moreError && (
                <TouchableOpacity
                  style={[styles.moreBtn, loadingMore && styles.moreBtnBusy]}
                  onPress={loadMore}
                  disabled={loadingMore}
                  accessibilityRole="button"
                  accessibilityLabel="Load more titles"
                >
                  {loadingMore ? (
                    <ActivityIndicator color="#111" size="small" />
                  ) : (
                    <>
                      <Ionicons name="add" size={16} color="#111" />
                      <Text style={styles.moreText}>Load more</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {!hasMore && total > 0 && (
                <Text style={[styles.endNote, { color: theme.placeholder }]}>
                  {`That's all ${total} ${total === 1 ? "title" : "titles"}`}
                </Text>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  count: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 2,
  },
  rule: { height: 1, marginHorizontal: 20, marginBottom: 8, borderRadius: 1, overflow: "hidden" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  centerTitle: { fontSize: 17, fontWeight: "800", marginTop: 6 },
  centerText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  retryBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  retryText: { color: "#111", fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },

  grid: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 34 },

  footerBlock: { paddingTop: 22, alignItems: "center" },
  moreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 12,
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  moreBtnBusy: { opacity: 0.7 },
  moreText: { color: "#111", fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },
  moreRetry: { paddingVertical: 6 },
  moreRetryText: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  endNote: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
});
