import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useListPage } from "../../src/hooks/useMovies";
import { useIsDesktop, CONTENT_MAX_WIDTH } from "../../src/hooks/useIsDesktop";
import MovieCard from "../../src/components/MovieCard";

const CARD_GAP = 12;
/** Desktop gutters keep the grid inside the centered 1280px container. */
const WIDE_GUTTER = 40;

function columnsFor(width) {
  if (width >= 1000) return 6;
  if (width >= 760) return 5;
  if (width >= 560) return 4;
  return 3;
}

export default function ListPage() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { list, movies, total, hasMore, loading, error, loadingMore, moreError, loadMore, reload } =
    useListPage(id);
  const { width: windowW } = useWindowDimensions();
  const isDesktop = useIsDesktop();
  const contentW = isDesktop ? Math.min(windowW, CONTENT_MAX_WIDTH) : windowW;
  const [hoveredId, setHoveredId] = useState(null);

  // Desktop: pick columns from the capped content width (not the raw window),
  // and subtract the wider gutters so the grid can't overflow the container.
  const columns = columnsFor(isDesktop ? contentW : windowW);
  const gutters = isDesktop ? WIDE_GUTTER * 2 : 40;
  const cardWidth = Math.floor((contentW - gutters - (2 * columns - 1) * CARD_GAP) / columns);
  const notFound = !loading && error === "List not found";

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate("/mylist");
    }
  }, []);

  const openMovie = useCallback((movie) => router.push(`/movie/${movie.id}`), []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={[styles.headerBar, isDesktop && styles.headerBarWide]}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }, isDesktop && styles.titleWide]} numberOfLines={1}>
            {list?.name ?? "My List"}
          </Text>
          {!loading && !error && (
            <Text style={[styles.count, { color: theme.placeholder }, isDesktop && styles.countWide]}>
              {total === 1 ? "1 title" : `${total} titles`}
            </Text>
          )}
        </View>
      </View>

      <View style={[styles.rule, isDesktop && styles.ruleWide]}>
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

      {notFound && (
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>List not found</Text>
        </View>
      )}

      {!loading && error && !notFound && (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Couldn&apos;t load this list</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload}>
            <Ionicons name="refresh" size={14} color="#111" />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && movies.length === 0 && (
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={42} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>This list is empty</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>
            Open any movie page and tap My List to save titles here.
          </Text>
        </View>
      )}

      {!loading && !error && movies.length > 0 && (
        <FlatList
          key={columns}
          data={movies}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          contentContainerStyle={[styles.grid, isDesktop && styles.gridWide]}
          columnWrapperStyle={{ gap: CARD_GAP }}
          renderItem={({ item }) =>
            isDesktop ? (
              // Desktop: wrap the card so we can add a pointer hover lift
              // without touching MovieCard (owned elsewhere).
              <View
                style={[styles.cardSlot, hoveredId === item.id && styles.cardSlotHover]}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId((h) => (h === item.id ? null : h))}
              >
                <MovieCard movie={item} width={cardWidth} onPress={openMovie} />
              </View>
            ) : (
              <MovieCard movie={item} width={cardWidth} onPress={openMovie} />
            )
          }
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
  // Desktop: header sits on the same centered 1280px column as the grid.
  headerBarWide: {
    paddingHorizontal: WIDE_GUTTER,
    paddingTop: 22,
    paddingBottom: 14,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  titleWide: { fontSize: 28, letterSpacing: -0.6 },
  count: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 2,
  },
  countWide: { fontSize: 11.5, marginTop: 4 },
  rule: { height: 1, marginHorizontal: 20, marginBottom: 8, borderRadius: 1, overflow: "hidden" },
  ruleWide: {
    marginHorizontal: WIDE_GUTTER,
    marginBottom: 12,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },

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
  gridWide: {
    paddingHorizontal: WIDE_GUTTER,
    paddingTop: 10,
    paddingBottom: 48,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  // Desktop hover slot around each poster (web pointer only).
  cardSlot: {
    borderRadius: 14,
    transitionProperty: "transform, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease-out",
  },
  cardSlotHover: {
    transform: [{ translateY: -4 }],
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

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
