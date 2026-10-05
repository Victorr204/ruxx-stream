import { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTheme, GOLD } from "../../context/ThemeContext";
import { useHomeFeed } from "../../src/hooks/useMovies";
import HeroBanner from "../../src/components/HeroBanner";
import MovieRow from "../../src/components/MovieRow";
import { useAuthStore } from "../../src/stores/auth";

export default function Home() {
  const { theme } = useTheme();
  const { data, loading, error, reload } = useHomeFeed();
  const profile = useAuthStore((s) => s.profile);

  const openMovie = useCallback((movie) => router.push(`/movie/${movie.id}`), []);
  const playMovie = useCallback((movie) => router.push(`/player/${movie.id}`), []);

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
          <ActivityIndicator color={GOLD} size="large" />
          <Text style={[styles.centerText, { color: theme.subtitle }]}>Loading your catalog…</Text>
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
          <TouchableOpacity style={[styles.retryBtn, { borderColor: GOLD }]} onPress={reload}>
            <Text style={[styles.retryText, { color: GOLD }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const continueList = data?.continueWatching ?? [];
  const progressById = Object.fromEntries(
    continueList.map((item) => [
      item.movie.id,
      item.progress.duration_seconds > 0
        ? item.progress.position_seconds / item.progress.duration_seconds
        : 0,
    ])
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <Text style={styles.brand}>
          ruxx <Text style={{ color: GOLD }}>stream</Text>
        </Text>
        <TouchableOpacity
          style={[styles.avatarBtn, { borderColor: GOLD }]}
          onPress={() => router.navigate("/profile")}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <Text style={[styles.avatarText, { color: GOLD }]}>{initials}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={GOLD} />}
      >
        {data?.featured && (
          <Animated.View entering={FadeInDown.duration(500)}>
            <HeroBanner movie={data.featured} onPlay={playMovie} onInfo={openMovie} hasTVPreferredFocus />
          </Animated.View>
        )}

        {continueList.length > 0 && (
          <MovieRow
            title="Continue Watching"
            movies={continueList.map((item) => item.movie)}
            progressById={progressById}
            onPressMovie={openMovie}
          />
        )}

        {(data?.rows ?? []).map((row) => (
          <MovieRow key={row.genre.id} title={row.genre.name} movies={row.movies} onPressMovie={openMovie} />
        ))}

        {!data?.featured && continueList.length === 0 && (data?.rows.length ?? 0) === 0 && (
          <View style={styles.center}>
            <Ionicons name="film-outline" size={42} color={theme.placeholder} />
            <Text style={[styles.centerTitle, { color: theme.text }]}>Nothing here yet</Text>
            <Text style={[styles.centerText, { color: theme.subtitle }]}>
              Titles added by the admin will show up here.
            </Text>
          </View>
        )}

        <Text style={[styles.footerNote, { color: theme.placeholder }]}>Operated by Ruxx Digital Services</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  brand: { color: "#fff", fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
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

  scroll: { paddingBottom: 30 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  centerTitle: { fontSize: 18, fontWeight: "800", marginTop: 6 },
  centerText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  retryBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  retryText: { fontSize: 14, fontWeight: "800" },

  footerNote: { fontSize: 11, textAlign: "center", marginTop: 4 },
});
