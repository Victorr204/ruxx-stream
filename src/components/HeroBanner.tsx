import { useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GOLD, GOLD_GRADIENT } from "../../context/ThemeContext";
import { formatMeta } from "../lib/format";
import type { Movie } from "../lib/types";

const { width: SCREEN_W } = Dimensions.get("window");
const BACKDROP_H = Math.min(Math.round(SCREEN_W * 0.62), 420);

// GOLD_GRADIENT is a plain string[] (ThemeContext is JS); expo-linear-gradient
// wants a tuple of at least two colors — it always has three.
const CTA_COLORS = GOLD_GRADIENT as unknown as readonly [string, string, ...string[]];

type Props = {
  movie: Movie;
  onPlay: (movie: Movie) => void;
  onInfo: (movie: Movie) => void;
  hasTVPreferredFocus?: boolean;
};

// Top hero: backdrop, gradient scrim, title, meta and the two CTAs.
export default function HeroBanner({ movie, onPlay, onInfo, hasTVPreferredFocus }: Props) {
  const [playFocused, setPlayFocused] = useState(false);
  const [infoFocused, setInfoFocused] = useState(false);
  const meta = formatMeta(movie);

  return (
    <View style={styles.wrap}>
      {movie.backdrop_url || movie.poster_url ? (
        <Image
          source={{ uri: movie.backdrop_url ?? movie.poster_url ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={250}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.fallbackBg} />
      )}

      <LinearGradient
        colors={["rgba(10,10,10,0.15)", "rgba(10,10,10,0.72)", "#0a0a0a"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {movie.title}
        </Text>

        <View style={styles.metaRow}>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {movie.genres && movie.genres.length > 0 && (
            <View style={styles.genreChips}>
              {movie.genres.slice(0, 3).map((g) => (
                <View key={g.id} style={styles.genreChip}>
                  <Text style={styles.genreText}>{g.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {movie.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {movie.description}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Play ${movie.title}`}
            hasTVPreferredFocus={hasTVPreferredFocus}
            onFocus={() => setPlayFocused(true)}
            onBlur={() => setPlayFocused(false)}
            onPress={() => onPlay(movie)}
            style={({ pressed }) => [styles.playBtn, playFocused && styles.focused, pressed && styles.pressed]}
          >
            <LinearGradient colors={CTA_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.playGrad}>
              <Ionicons name="play" size={17} color="#111" />
              <Text style={styles.playText}>Play</Text>
            </LinearGradient>
          </Pressable>

          <Pressable
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`More information about ${movie.title}`}
            onFocus={() => setInfoFocused(true)}
            onBlur={() => setInfoFocused(false)}
            onPress={() => onInfo(movie)}
            style={({ pressed }) => [
              styles.infoBtn,
              infoFocused && styles.focused,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="information-circle-outline" size={18} color="#fff" />
            <Text style={styles.infoText}>More Info</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: BACKDROP_H,
    marginBottom: 24,
    justifyContent: "flex-end",
  },
  fallbackBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#141414" },

  body: { paddingHorizontal: 20, gap: 9 },
  title: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.6,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  meta: { color: "rgba(255,255,255,0.75)", fontSize: 12.5, fontWeight: "700" },
  genreChips: { flexDirection: "row", gap: 6 },
  genreChip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  genreText: { color: "rgba(255,255,255,0.8)", fontSize: 10.5, fontWeight: "700" },

  description: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18.5,
  },

  actions: { flexDirection: "row", gap: 12, marginTop: 6 },

  playBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  playGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
  },
  playText: { color: "#111", fontSize: 16, fontWeight: "800" },

  infoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  infoText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  focused: {
    shadowColor: GOLD,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    transform: [{ scale: 1.02 }],
  },
  pressed: { opacity: 0.88 },
});
