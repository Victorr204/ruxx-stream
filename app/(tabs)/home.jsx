import { useCallback, useEffect } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInDown,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useHomeFeed } from "../../src/hooks/useMovies";
import { useIsDesktop, CONTENT_MAX_WIDTH } from "../../src/hooks/useIsDesktop";
import HeroCarousel from "../../src/components/HeroCarousel";
import MovieRow from "../../src/components/MovieRow";
import { useAuthStore } from "../../src/stores/auth";
import { NEW_LISTING_SEGMENT } from "../../src/lib/api";
import BannerAdSlot from "../../src/components/BannerAdSlot";
import Logos from "../../assets/images/backlogo-transparent.png";

const GOLD_HAIRLINE = ["rgba(232,184,74,0.5)", "rgba(255,255,255,0.10)", "transparent"];

export default function Home() {
  const { theme } = useTheme();
  const { data, loading, error, fetchedAt, reload } = useHomeFeed();
  const profile = useAuthStore((s) => s.profile);
  const isDesktop = useIsDesktop();

  useFocusEffect(
    useCallback(() => {
      if (fetchedAt && Date.now() - fetchedAt > 120_000) reload();
    }, [fetchedAt, reload])
  );

  const openMovie = useCallback((movie) => router.push(`/movie/${movie.id}`), []);
  const playMovie = useCallback((movie) => router.push(`/player/${movie.id}`), []);
  const openCategory = useCallback((genreId) => router.push(`/category/${genreId}`), []);

  const initials = (profile?.display_name || "R")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <CatalogLoader />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={42} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Couldn&apos;t load titles</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload}>
            <Ionicons name="refresh" size={14} color="#111" />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const heroItems = data?.hero ?? [];
  const newReleases = data?.newReleases ?? [];
  const trending = data?.trending ?? [];
  const continueList = data?.continueWatching ?? [];
  const popularGenres = data?.popularGenres ?? [];
  const rows = data?.rows ?? [];
  const progressById = Object.fromEntries(
    continueList.map((item) => [
      item.movie.id,
      item.progress.duration_seconds > 0
        ? item.progress.position_seconds / item.progress.duration_seconds
        : 0,
    ])
  );
  const hasContent =
    heroItems.length > 0 ||
    newReleases.length > 0 ||
    trending.length > 0 ||
    continueList.length > 0 ||
    popularGenres.length > 0 ||
    rows.length > 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      <View pointerEvents="none" style={styles.aura}>
        <LinearGradient colors={["rgba(232,184,74,0.09)", "rgba(232,184,74,0)"]} style={StyleSheet.absoluteFill} />
      </View>

      {/* Brand + account live in the sidebar/top bar on desktop, so this
          mobile-only chrome is dropped at the breakpoint. */}
      {!isDesktop && (
        <>
          <View style={styles.topBar}>
            <View style={styles.brandGroup}>
              <View style={styles.logoRingSmall}>
                <Image source={Logos} style={styles.logoSmall} resizeMode="contain" />
              </View>
              <Text style={[styles.brand, { color: theme.text }]}>
                ruxx <Text style={{ color: GOLD }}>stream</Text>
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.avatarBtn, { borderColor: GOLD }]}
              onPress={() => router.navigate("/profile")}
              accessibilityRole="button"
              accessibilityLabel="Open profile"
            >
              <Text style={[styles.avatarText, { color: GOLD }]}>{initials}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.topRule}>
            <LinearGradient colors={GOLD_HAIRLINE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </View>
        </>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollWide]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={GOLD} />}
      >
        {heroItems.length > 0 && (
          <Animated.View entering={FadeInDown.duration(500)}>
            <HeroCarousel
              items={heroItems}
              onPlay={playMovie}
              onInfo={openMovie}
              hasTVPreferredFocus
            />
          </Animated.View>
        )}

        {trending.length > 0 && (
          <MovieRow
            title="Trending Now"
            movies={trending}
            onPressMovie={openMovie}
            enterDelay={40}
          />
        )}

        {newReleases.length > 0 && (
          <MovieRow
            title="New Movies"
            movies={newReleases}
            onPressMovie={openMovie}
            onSeeAll={() => openCategory(NEW_LISTING_SEGMENT)}
          />
        )}

        {continueList.length > 0 && (
          <MovieRow
            title="Continue Watching"
            movies={continueList.map((item) => item.movie)}
            progressById={progressById}
            onPressMovie={openMovie}
          />
        )}

        {popularGenres.length > 0 && (
          <Animated.View style={styles.popularSection} entering={FadeInDown.duration(420).delay(70)}>
            <View style={[styles.popularHeader, isDesktop && styles.popularHeaderWide]}>
              <View style={styles.popularTick} />
              <Text style={[styles.popularTitle, { color: theme.text }, isDesktop && styles.popularTitleWide]}>Popular Genres</Text>
              <View style={styles.popularRule}>
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
              contentContainerStyle={[styles.popularTrack, isDesktop && styles.popularTrackWide]}
              decelerationRate="fast"
            >
              {popularGenres.map(({ genre, count }) => (
                <TouchableOpacity
                  key={genre.id}
                  style={[styles.genreCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
                  onPress={() => openCategory(genre.id)}
                  activeOpacity={0.85}
                  focusable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${genre.name}, ${count === 1 ? "1 title" : `${count} titles`}`}
                >
                  <View style={styles.genreIcon}>
                    <Ionicons name="albums-outline" size={15} color={GOLD} />
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
          </Animated.View>
        )}

        {rows.map((row, index) => (
          <MovieRow
            key={row.genre.id}
            title={row.genre.name}
            movies={row.movies}
            onPressMovie={openMovie}
            onSeeAll={() => openCategory(row.genre.id)}
            enterDelay={Math.min(index * 70, 280)}
          />
        ))}

        {!hasContent && (
          <View style={styles.center}>
            <Ionicons name="film-outline" size={42} color={theme.placeholder} />
            <Text style={[styles.centerTitle, { color: theme.text }]}>Nothing here yet</Text>
            <Text style={[styles.centerText, { color: theme.subtitle }]}>
              Titles added by the admin will show up here.
            </Text>
          </View>
        )}

        <View style={[styles.footer, isDesktop && styles.footerWide]}>
          <View style={styles.footerLine}>
            <LinearGradient
              colors={["transparent", "rgba(232,184,74,0.35)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <Text style={[styles.footerNote, { color: theme.placeholder }]}>Operated by Ruxx Digital Services</Text>
          <View style={styles.footerLine}>
            <LinearGradient
              colors={["rgba(232,184,74,0.35)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>
      </ScrollView>
      <BannerAdSlot />
    </SafeAreaView>
  );
}

function CatalogLoader() {
  const { theme } = useTheme();
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [spin, pulse]);

  const arcStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: 0.8 + pulse.value * 0.2,
    transform: [{ scale: 0.96 + pulse.value * 0.06 }],
  }));

  return (
    <View style={styles.loader}>
      <View style={styles.loaderCore}>
        <Animated.View style={[styles.loaderArc, arcStyle]} />
        <Animated.View style={[styles.loaderBadge, badgeStyle]}>
          <Image source={Logos} style={styles.loaderLogo} resizeMode="contain" />
        </Animated.View>
      </View>
      <Text style={[styles.loadingText, { color: theme.subtitle }]}>Loading your catalog…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  aura: { position: "absolute", top: 0, left: 0, right: 0, height: 240 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  topBarWide: { paddingHorizontal: 32 },
  brand: { color: "#fff", fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
  brandGroup: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoRingSmall: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1.2,
    borderColor: "rgba(232,184,74,0.45)",
    backgroundColor: "rgba(232,184,74,0.07)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  logoSmall: { width: 27, height: 27, backgroundColor: "transparent" },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(232,184,74,0.1)",
  },
  avatarText: { fontSize: 13.5, fontWeight: "900" },

  topRule: {
    height: 1,
    marginHorizontal: 20,
    marginBottom: 4,
    borderRadius: 1,
    overflow: "hidden",
  },
  topRuleWide: { marginHorizontal: 32 },

  scroll: { paddingBottom: 30 },
  scrollWide: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  centerTitle: { fontSize: 18, fontWeight: "800", marginTop: 6, letterSpacing: -0.2 },
  centerText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },
  loadingText: {
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 2,
  },
  loader: { alignItems: "center", gap: 20 },
  loaderCore: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  loaderArc: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: "rgba(232,184,74,0.15)",
    borderTopColor: GOLD,
    borderRightColor: "rgba(232,184,74,0.55)",
  },
  loaderBadge: {
    width: 78,
    height: 78,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.45)",
    backgroundColor: "rgba(232,184,74,0.06)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GOLD,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  loaderLogo: { width: 56, height: 56, backgroundColor: "transparent" },

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

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 6,
  },
  footerWide: { paddingHorizontal: 32 },
  footerLine: { flex: 1, height: 1, borderRadius: 1, overflow: "hidden" },
  footerNote: { fontSize: 10, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },

  popularSection: { marginBottom: 24 },
  popularHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 20,
    marginRight: 20,
    marginBottom: 12,
  },
  popularHeaderWide: { marginLeft: 32, marginRight: 32 },
  popularTick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD, marginRight: 9 },
  popularTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  popularTitleWide: { fontSize: 14 },
  popularRule: { flex: 1, height: 1, marginLeft: 12, borderRadius: 1, overflow: "hidden" },
  popularTrack: { paddingHorizontal: 20, gap: 10 },
  popularTrackWide: { paddingHorizontal: 32 },
  genreCard: {
    width: 134,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 13,
    gap: 7,
  },
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
});
