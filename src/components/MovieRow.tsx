import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { GOLD, useTheme } from "../../context/ThemeContext";
import { useIsDesktop } from "../hooks/useIsDesktop";
import MovieCard from "./MovieCard";
import type { Movie } from "../lib/types";

type Props = {
  title: string;
  movies: Movie[];
  /** Playback fraction per movie id (continue-watching shelf). */
  progressById?: Record<string, number>;
  onPressMovie: (movie: Movie) => void;
  onSeeAll?: () => void;
  firstCardFocused?: boolean;
  enterDelay?: number;
};

const CARD_W_MOBILE = 124;
const CARD_W_DESKTOP = 168;
const GAP = 12;

// Horizontal shelf with a HUD-style section header — the repeating unit of
// the home feed. Kept as a plain ScrollView (rows are capped at ~12 titles).
export default function MovieRow({
  title,
  movies,
  progressById,
  onPressMovie,
  onSeeAll,
  firstCardFocused,
  enterDelay = 0,
}: Props) {
  const { theme } = useTheme();
  const isDesktop = useIsDesktop();
  if (movies.length === 0) return null;

  const cardWidth = isDesktop ? CARD_W_DESKTOP : CARD_W_MOBILE;
  const pad = isDesktop ? 32 : 20;

  return (
    <Animated.View style={styles.section} entering={FadeInDown.duration(420).delay(enterDelay)}>
      <View style={[styles.header, { marginLeft: pad, marginRight: pad }]}>
        <View style={styles.tick} />
        <Text style={[styles.heading, { color: theme.text }, isDesktop && styles.headingWide]}>{title}</Text>
        <View style={styles.rule}>
          <LinearGradient
            colors={["rgba(232,184,74,0.4)", "rgba(255,255,255,0.05)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        {onSeeAll && (
          <TouchableOpacity
            style={styles.seeAll}
            onPress={onSeeAll}
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`See all ${title}`}
          >
            <Text style={styles.seeAllText}>See all</Text>
            <Ionicons name="chevron-forward" size={13} color={GOLD} />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: pad }}
        decelerationRate="fast"
        snapToInterval={cardWidth + GAP}
      >
        {movies.map((movie, index) => (
          <MovieCard
            key={movie.id}
            movie={movie}
            width={cardWidth}
            onPress={onPressMovie}
            progress={progressById?.[movie.id]}
            hasTVPreferredFocus={firstCardFocused && index === 0}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  tick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD, marginRight: 9 },
  heading: {
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  headingWide: { fontSize: 14 },
  rule: { flex: 1, height: 1, marginLeft: 12, borderRadius: 1, overflow: "hidden" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 10 },
  seeAllText: {
    color: GOLD,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
