import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { GOLD, useTheme } from "../../context/ThemeContext";
import { CONTENT_MAX_WIDTH, useContentWidth, useIsDesktop } from "../hooks/useIsDesktop";
import MovieCard, { desktopCardWidth } from "./MovieCard";
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
const GAP = 12;
/** Desktop gutters line the shelf up with the centered 1280px container. */
const DESKTOP_PAD = 40;

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
  const contentWidth = useContentWidth();
  if (movies.length === 0) return null;

  // Desktop tiles scale with the content column (~6–7 across 1280px); mobile
  // keeps its fixed 124px tile.
  const cardWidth = isDesktop ? desktopCardWidth(contentWidth) : CARD_W_MOBILE;
  const pad = isDesktop ? DESKTOP_PAD : 20;

  return (
    <Animated.View
      style={[styles.section, isDesktop && styles.sectionWide]}
      entering={FadeInDown.duration(420).delay(enterDelay)}
    >
      <View style={[styles.header, { marginLeft: pad, marginRight: pad }, isDesktop && styles.headerWide]}>
        <View style={[styles.tick, isDesktop && styles.tickWide]} />
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
            style={[styles.seeAll, isDesktop && styles.seeAllWide]}
            onPress={onSeeAll}
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`See all ${title}`}
          >
            <Text style={[styles.seeAllText, isDesktop && styles.seeAllTextWide]}>See all</Text>
            <Ionicons name="chevron-forward" size={isDesktop ? 16 : 13} color={GOLD} />
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
  // Desktop: extra air above each shelf + fill the centered 1280px column.
  sectionWide: { marginTop: 44, width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  headerWide: { marginBottom: 16 },
  tick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD, marginRight: 9 },
  tickWide: { width: 4, height: 17 },
  heading: {
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  headingWide: { fontSize: 19, letterSpacing: 1.6 },
  rule: { flex: 1, height: 1, marginLeft: 12, borderRadius: 1, overflow: "hidden" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 10 },
  seeAllWide: { marginLeft: 16, paddingVertical: 5, paddingHorizontal: 4 },
  seeAllText: {
    color: GOLD,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  seeAllTextWide: { fontSize: 12.5, letterSpacing: 1.2 },
});
