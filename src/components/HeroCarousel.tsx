import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GOLD, GOLD_GRADIENT } from "../../context/ThemeContext";
import { formatMeta } from "../lib/format";
import type { HeroItem, Movie } from "../lib/types";

const FALLBACK_W = Dimensions.get("window").width || 390;
const AUTO_MS = 4000;

function heroHeight(w: number): number {
  if (w >= 900) return Math.min(Math.round(w * 0.42), 500);
  return Math.min(Math.round(w * 0.62), 420);
}

// GOLD_GRADIENT is a plain string[] (ThemeContext is JS); expo-linear-gradient
// wants a tuple of at least two colors — it always has three.
const CTA_COLORS = GOLD_GRADIENT as unknown as readonly [string, string, ...string[]];

type Props = {
  items: HeroItem[];
  onPlay: (movie: Movie) => void;
  onInfo: (movie: Movie) => void;
  hasTVPreferredFocus?: boolean;
};

type SlideProps = {
  item: HeroItem;
  width: number;
  onPlay: (movie: Movie) => void;
  onInfo: (movie: Movie) => void;
  hasTVPreferredFocus?: boolean;
  onFocusChange: (delta: number) => void;
};

function Slide({ item, width, onPlay, onInfo, hasTVPreferredFocus, onFocusChange }: SlideProps) {
  const [playFocused, setPlayFocused] = useState(false);
  const [infoFocused, setInfoFocused] = useState(false);
  const { movie, label } = item;
  const meta = formatMeta(movie);
  const wide = width >= 900;
  const height = heroHeight(width);

  return (
    <View style={[styles.slide, { width, height }]}>
      {movie.backdrop_url || movie.poster_url ? (
        <Image
          source={{ uri: movie.backdrop_url ?? movie.poster_url ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
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

      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={styles.eyebrow}>
          <View style={styles.eyebrowTick} />
          <Text style={styles.eyebrowText}>{label}</Text>
        </View>

        <Text style={[styles.title, wide && styles.titleWide]} numberOfLines={2}>
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
          <Text style={[styles.description, wide && styles.descriptionWide]} numberOfLines={wide ? 3 : 2}>
            {movie.description}
          </Text>
        ) : null}

        <View style={[styles.actions, wide && styles.actionsWide]}>
          <Pressable
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Play ${movie.title}`}
            hasTVPreferredFocus={hasTVPreferredFocus}
            onFocus={() => {
              setPlayFocused(true);
              onFocusChange(1);
            }}
            onBlur={() => {
              setPlayFocused(false);
              onFocusChange(-1);
            }}
            onPress={() => onPlay(movie)}
            style={({ pressed }) => [styles.playBtn, wide && styles.btnWide, playFocused && styles.focused, pressed && styles.pressed]}
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
            onFocus={() => {
              setInfoFocused(true);
              onFocusChange(1);
            }}
            onBlur={() => {
              setInfoFocused(false);
              onFocusChange(-1);
            }}
            onPress={() => onInfo(movie)}
            style={({ pressed }) => [
              styles.infoBtn,
              wide && styles.btnWide,
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

export default function HeroCarousel({ items, onPlay, onInfo, hasTVPreferredFocus }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const focusCount = useRef(0);
  const [index, setIndex] = useState(0);
  const [slideW, setSlideW] = useState(FALLBACK_W);

  useEffect(() => {
    if (items.length < 2 || slideW <= 0) return undefined;
    const timer = setInterval(() => {
      if (focusCount.current > 0) return;
      const next = (indexRef.current + 1) % items.length;
      indexRef.current = next;
      setIndex(next);
      scrollRef.current?.scrollTo({ x: next * slideW, animated: true });
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [items.length, slideW]);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / slideW);
    if (next >= 0 && next < items.length && next !== indexRef.current) {
      indexRef.current = next;
      setIndex(next);
    }
  };

  if (items.length === 0) return null;

  return (
    <View
      style={[styles.wrap, { height: heroHeight(slideW) }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - slideW) > 1) setSlideW(w);
      }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {items.map((item, i) => (
          <Slide
            key={item.movie.id}
            item={item}
            width={slideW}
            onPlay={onPlay}
            onInfo={onInfo}
            hasTVPreferredFocus={hasTVPreferredFocus && i === 0}
            onFocusChange={(delta) => {
              focusCount.current += delta;
            }}
          />
        ))}
      </ScrollView>

      {items.length > 1 && (
        <View style={styles.dots} pointerEvents="none">
          {items.map((item, i) => (
            <View key={item.movie.id} style={[styles.dot, i === index % items.length && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: heroHeight(FALLBACK_W), marginBottom: 18 },
  slide: { justifyContent: "flex-end" },
  fallbackBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#141414" },

  dots: {
    position: "absolute",
    top: 14,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotActive: { width: 18, backgroundColor: GOLD },

  body: { paddingHorizontal: 20, gap: 9 },
  bodyWide: { paddingHorizontal: 48, paddingBottom: 12, maxWidth: 780, alignSelf: "flex-start" },

  eyebrow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrowTick: { width: 3, height: 12, borderRadius: 2, backgroundColor: GOLD },
  eyebrowText: {
    color: GOLD,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },

  title: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.6,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  titleWide: { fontSize: 42 },

  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  meta: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  genreChips: { flexDirection: "row", gap: 6 },
  genreChip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3.5,
  },
  genreText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  description: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 13,
    lineHeight: 18.5,
    letterSpacing: 0.1,
  },
  descriptionWide: { fontSize: 14.5, lineHeight: 21 },

  actions: { flexDirection: "row", gap: 12, marginTop: 6 },
  actionsWide: { maxWidth: 420 },

  playBtn: {
    flex: 1,
    borderRadius: 999,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btnWide: { flex: 0, minWidth: 190 },
  playGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
  },
  playText: { color: "#111", fontSize: 15.5, fontWeight: "800", letterSpacing: 0.4 },

  infoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  infoText: { color: "#fff", fontSize: 14.5, fontWeight: "700", letterSpacing: 0.4 },

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
