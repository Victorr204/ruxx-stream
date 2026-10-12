import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { GOLD, useTheme } from "../../context/ThemeContext";
import type { Movie } from "../lib/types";

type Props = {
  movie: Movie;
  width?: number;
  /** 0..1 playback progress — renders the resume bar under the poster. */
  progress?: number;
  onPress: (movie: Movie) => void;
  hasTVPreferredFocus?: boolean;
};

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_START_MS = Date.now();

// Poster tile used by every shelf. Focus-ready: focusable, labelled, and it
// shows a gold ring while focused (TV D-pad / keyboard on web).
export default function MovieCard({ movie, width = 124, progress, onPress, hasTVPreferredFocus }: Props) {
  const [focused, setFocused] = useState(false);
  const { theme } = useTheme();
  const height = Math.round(width * 1.5);
  const percent = typeof progress === "number" ? Math.min(100, Math.round(progress * 100)) : 0;
  const isNew = SESSION_START_MS - Date.parse(movie.created_at) < NEW_WINDOW_MS;

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
            cachePolicy="memory-disk"
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

        {isNew && (
          <View style={styles.newBadge}>
            <Text style={styles.newText}>New</Text>
          </View>
        )}

        {percent > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        )}
      </View>

      <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
        {movie.title}
      </Text>
      {movie.release_year ? <Text style={[styles.year, { color: theme.placeholder }]}>{movie.release_year}</Text> : null}
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
  pressed: { opacity: 0.9, transform: [{ scale: 0.96 }] },

  poster: {
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "flex-end",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  fallback: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  ratingBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(5,5,5,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: { color: "#fff", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },

  newBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: GOLD,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  newText: { color: "#111", fontSize: 9, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },

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
    fontSize: 12.5,
    fontWeight: "700",
    marginTop: 7,
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  year: { fontSize: 11, marginTop: 1, letterSpacing: 0.3 },
});
