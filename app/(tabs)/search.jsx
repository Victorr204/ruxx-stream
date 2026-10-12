import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useSearch } from "../../src/hooks/useMovies";
import { useIsDesktop, useContentWidth, CONTENT_MAX_WIDTH } from "../../src/hooks/useIsDesktop";
import MovieCard from "../../src/components/MovieCard";
import MovieRow from "../../src/components/MovieRow";
import BannerAdSlot from "../../src/components/BannerAdSlot";
import { fetchNewestMovies, fetchPopularGenres, fetchTrendingMovies } from "../../src/lib/api";

function columnsFor(width, wide) {
  if (wide && width >= 1180) return 7;
  if (width >= 1000) return 6;
  if (width >= 760) return 5;
  if (width >= 560) return 4;
  return 3;
}

export default function Search() {
  const { theme } = useTheme();
  const { q } = useLocalSearchParams();
  // The desktop top bar submits `/search?q=…`; mirror it into the local field.
  const qParam = typeof q === "string" ? q : Array.isArray(q) && typeof q[0] === "string" ? q[0] : null;
  const [query, setQuery] = useState(() => qParam ?? "");
  const [lastQParam, setLastQParam] = useState(qParam);
  const [touched, setTouched] = useState(false);
  const [hoverGenre, setHoverGenre] = useState(null);
  const [sugg, setSugg] = useState({ loaded: false, top: [], genres: [], error: null });
  const { data: results, loading, error } = useSearch(query);
  const { width: windowW } = useWindowDimensions();
  const isDesktop = useIsDesktop();
  const contentW = useContentWidth();

  useEffect(() => {
    if (!touched || sugg.loaded) return undefined;
    let cancelled = false;

    Promise.all([fetchTrendingMovies(8), fetchNewestMovies(8), fetchPopularGenres(6)])
      .then(([trending, newest, genres]) => {
        if (cancelled) return;
        setSugg({
          loaded: true,
          top: trending.length > 0 ? trending : newest,
          genres,
          error: null,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setSugg({
          loaded: true,
          top: [],
          genres: [],
          error: e instanceof Error ? e.message : "Could not load suggestions",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [touched, sugg.loaded]);

  // Keep the local field in sync when the global (top bar) search navigates
  // here with ?q=… (render-time state adjustment, no effect needed).
  if (qParam !== lastQParam) {
    setLastQParam(qParam);
    if (qParam !== null) {
      setQuery(qParam);
      setTouched(true);
    }
  }

  const columns = columnsFor(isDesktop ? contentW : windowW, isDesktop);
  const gap = 12;
  const gutters = isDesktop ? 80 : 40;
  const cardWidth = Math.floor((contentW - gutters - (2 * columns - 1) * gap) / columns);

  const hasQuery = query.trim().length > 0;
  const showSuggestions = touched && !hasQuery;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      <Text style={[styles.header, { color: theme.text }, isDesktop && styles.headerWide]}>Search</Text>

      <View style={[styles.searchBox, { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }, isDesktop && styles.searchBoxWide]}>
        <Ionicons name="search-outline" size={18} color={theme.placeholder} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setTouched(true)}
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
        <View style={[styles.center, isDesktop && styles.centerWide]}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      )}

      {!loading && error && (
        <View style={[styles.center, isDesktop && styles.centerWide]}>
          <Ionicons name="alert-circle-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Search failed</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>{error}</Text>
        </View>
      )}

      {!loading && !error && !hasQuery && !touched && (
        <View style={[styles.center, isDesktop && styles.centerWide]}>
          <Ionicons name="search-outline" size={44} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Find something to watch</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>
            Search by title — try a movie name you already know.
          </Text>
        </View>
      )}

      {!loading && !error && showSuggestions && (
        <ScrollView
          contentContainerStyle={[styles.suggScroll, isDesktop && styles.constrainWide]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!sugg.loaded && (
            <View style={styles.suggLoading}>
              <ActivityIndicator color={GOLD} />
              <Text style={[styles.suggNote, { color: theme.subtitle }]}>Loading suggestions…</Text>
            </View>
          )}

          {sugg.loaded && sugg.error && (
            <TouchableOpacity
              style={styles.suggRetry}
              onPress={() => setSugg({ loaded: false, top: [], genres: [], error: null })}
              activeOpacity={0.8}
            >
              <Text style={[styles.suggNote, { color: theme.subtitle }]}>{sugg.error} — tap to retry</Text>
            </TouchableOpacity>
          )}

          {sugg.loaded && !sugg.error && sugg.top.length > 0 && (
            <MovieRow
              title="Top Suggestions"
              movies={sugg.top}
              onPressMovie={(movie) => router.push(`/movie/${movie.id}`)}
            />
          )}

          {sugg.loaded && !sugg.error && sugg.genres.length > 0 && (
            <View style={[styles.suggSection, isDesktop && styles.suggSectionWide]}>
              <View style={[styles.suggHeader, isDesktop && styles.suggHeaderWide]}>
                <View style={styles.suggTick} />
                <Text style={[styles.suggTitle, { color: theme.text }, isDesktop && styles.suggTitleWide]}>Popular Genres</Text>
                <View style={styles.suggRule}>
                  <LinearGradient
                    colors={["rgba(232,184,74,0.4)", "rgba(255,255,255,0.05)", "transparent"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.genreTrack, isDesktop && styles.genreTrackWide]}
                decelerationRate="fast"
              >
                {sugg.genres.map(({ genre, count }) => (
                  <TouchableOpacity
                    key={genre.id}
                    style={[
                      styles.genreCard,
                      { backgroundColor: theme.card, borderColor: theme.cardBorder },
                      isDesktop && hoverGenre === genre.id && styles.genreCardHover,
                    ]}
                    onPress={() => router.push(`/category/${genre.id}`)}
                    onMouseEnter={isDesktop ? () => setHoverGenre(genre.id) : undefined}
                    onMouseLeave={isDesktop ? () => setHoverGenre(null) : undefined}
                    activeOpacity={0.85}
                  >
                    <View style={styles.genreIcon}>
                      <Ionicons name="albums-outline" size={14} color={GOLD} />
                    </View>
                    <Text style={[styles.genreName, { color: theme.text }]} numberOfLines={1}>
                      {genre.name}
                    </Text>
                    <Text style={[styles.genreCount, { color: theme.placeholder }]}>
                      {count === 1 ? "1 title" : `${count} titles`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {sugg.loaded && !sugg.error && sugg.top.length === 0 && sugg.genres.length === 0 && (
            <View style={styles.suggLoading}>
              <Text style={[styles.suggNote, { color: theme.subtitle }]}>
                Suggestions will show up here once the catalog fills.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {!loading && !error && hasQuery && results.length === 0 && (
        <View style={[styles.center, isDesktop && styles.centerWide]}>
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
          contentContainerStyle={[styles.grid, isDesktop && styles.gridWide]}
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

      <BannerAdSlot />
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
  headerWide: {
    fontSize: 30,
    marginHorizontal: 0,
    marginTop: 14,
    marginBottom: 20,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 40,
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
  searchBoxWide: {
    marginHorizontal: 0,
    maxWidth: CONTENT_MAX_WIDTH - 80,
    alignSelf: "center",
    width: "100%",
    height: 52,
    marginBottom: 24,
  },
  input: { flex: 1, fontSize: 15, height: 46, padding: 0 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  centerWide: { maxWidth: 520, alignSelf: "center", width: "100%", paddingHorizontal: 20 },
  centerTitle: { fontSize: 17, fontWeight: "800", marginTop: 6 },
  centerText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  suggScroll: { paddingBottom: 30 },
  suggLoading: {
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingVertical: 44,
    paddingHorizontal: 30,
  },
  suggRetry: { paddingVertical: 10, paddingHorizontal: 20 },
  suggNote: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },

  suggSection: { marginBottom: 8 },
  suggSectionWide: { marginBottom: 28 },
  suggHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 20,
    marginRight: 20,
    marginBottom: 12,
  },
  suggHeaderWide: { marginLeft: 40, marginRight: 40, marginBottom: 16 },
  suggTick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD, marginRight: 9 },
  suggTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  suggTitleWide: { fontSize: 13.5 },
  suggRule: { flex: 1, height: 1, marginLeft: 12, borderRadius: 1, overflow: "hidden" },
  genreTrack: { paddingHorizontal: 20, gap: 10 },
  genreTrackWide: { paddingHorizontal: 40 },
  genreCard: {
    width: 134,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 13,
    gap: 7,
  },
  genreCardHover: { borderColor: "rgba(232,184,74,0.6)", backgroundColor: "rgba(232,184,74,0.12)" },
  genreIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(232,184,74,0.4)",
    backgroundColor: "rgba(232,184,74,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  genreName: { fontSize: 14, fontWeight: "800", letterSpacing: -0.1 },
  genreCount: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },

  grid: { paddingHorizontal: 20, paddingBottom: 30, gap: 16 },
  gridWide: {
    paddingHorizontal: 40,
    paddingTop: 8,
    paddingBottom: 40,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  constrainWide: { maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", width: "100%", paddingBottom: 40 },
});
