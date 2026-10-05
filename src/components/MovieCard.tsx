import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { GOLD } from "../../context/ThemeContext";
import type { Movie } from "../lib/types";

type Props = {
  movie: Movie;
  width?: number;
  /** 0..1 playback progress — renders the resume bar under the poster. */
  progress?: number;
  onPress: (movie: Movie) => void;
  hasTVPreferredFocus?: boolean;
};

// Poster tile used by every shelf. Focus-ready: focusable, labelled, and it
// shows a gold ring while focused (TV D-pad / keyboard on web).
export default function MovieCard({ movie, width = 124, progress, onPress, hasTVPreferredFocus }: Props) {
  const [focused, setFocused] = useState(false);
  const height = Math.round(width * 1.5);

  return (
    <Pressable
      focusable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${movie.title}${movie.release_year ? `, ${movie.release_year}` : ""}`}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onPress(movie)}
      style={({ pressed }) => [
        styles.wrap,
        { width },
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.poster, { height, backgroundColor: "#151515" }]}>
        {movie.poster_url ? (
          <Image
            source={{ uri: movie.poster_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="film-outline" size={26} color="rgba(232,184,74,0.55)" />
          </View>
        )}

        <View style={styles.ratingBadge}>
          <Text style={styles.ratingText}>{movie.maturity_rating}</Text>
        </View>

        {typeof progress === "number" && progress > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, Math.round(progress * 100))}%` }]} />
          </View>
        )}
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {movie.title}
      </Text>
      {movie.release_year ? <Text style={styles.year}>{movie.release_year}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginRight: 12 },
  focused: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pressed: { opacity: 0.85 },

  poster: {
    borderRadius: 12,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  fallback: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  ratingBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: { color: "#fff", fontSize: 9.5, fontWeight: "800" },

  progressTrack: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: GOLD, borderRadius: 2 },

  title: {
    color: "#fff",
    fontSize: 12.5,
    fontWeight: "700",
    marginTop: 7,
    lineHeight: 16,
  },
  year: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 1 },
});
