import { ScrollView, StyleSheet, Text, View } from "react-native";
import MovieCard from "./MovieCard";
import type { Movie } from "../lib/types";

type Props = {
  title: string;
  movies: Movie[];
  /** Playback fraction per movie id (continue-watching shelf). */
  progressById?: Record<string, number>;
  onPressMovie: (movie: Movie) => void;
  firstCardFocused?: boolean;
};

// Horizontal shelf with a section header — the repeating unit of the home
// feed. Kept as a plain ScrollView (rows are capped at ~12 titles).
export default function MovieRow({ title, movies, progressById, onPressMovie, firstCardFocused }: Props) {
  if (movies.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
        decelerationRate="fast"
        snapToInterval={136}
      >
        {movies.map((movie, index) => (
          <MovieCard
            key={movie.id}
            movie={movie}
            onPress={onPressMovie}
            progress={progressById?.[movie.id]}
            hasTVPreferredFocus={firstCardFocused && index === 0}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  heading: {
    color: "#fff",
    fontSize: 16.5,
    fontWeight: "800",
    marginLeft: 20,
    marginBottom: 11,
    letterSpacing: 0.1,
  },
  track: { paddingHorizontal: 20 },
});
