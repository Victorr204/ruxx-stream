import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import { TMDB_ATTRIBUTION, searchTmdbTitles, fetchTmdbImport, type TmdbImport as TmdbImportRecord, type TmdbSearchHit } from "../../lib/tmdb";

// TMDb search box used by the movie editor. It never writes to the database:
// picking a result asks TMDb for the full record and hands it back through
// onPick, so the editor fills its own form and the admin still saves.

type Props = {
  onPick: (payload: TmdbImportRecord) => void;
  onError: (message: string) => void;
};

const DEBOUNCE_MS = 350;

function yearOf(releaseDate: string | null): string | null {
  if (!releaseDate) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? String(year) : null;
}

export default function TmdbImport({ onPick, onError }: Props) {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<number | null>(null);
  // Stops a slow response from overwriting the results of a newer query.
  const requestSeq = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (!term) return undefined;

    // All state writes happen in the callbacks below: the react-hooks
    // set-state-in-effect rule (and React itself) frowns on resetting state
    // synchronously from an effect body.
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      searchTmdbTitles(term)
        .then((hits) => {
          if (seq !== requestSeq.current) return;
          setResults(hits);
          setError(null);
        })
        .catch((e: unknown) => {
          if (seq !== requestSeq.current) return;
          setResults([]);
          setError(e instanceof Error ? e.message : "TMDb search failed.");
        })
        .finally(() => {
          if (seq === requestSeq.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Clearing the box resets immediately; typing starts the spinner right away
  // so the debounce window doesn't look like a dead input.
  const handleChangeQuery = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      requestSeq.current += 1;
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
  };

  const handlePick = async (hit: TmdbSearchHit) => {
    if (pickingId !== null) return;
    setPickingId(hit.id);
    try {
      onPick(await fetchTmdbImport(hit.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load that title from TMDb.");
    } finally {
      setPickingId(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.headRow}>
        <Ionicons name="search-outline" size={14} color={GOLD} />
        <Text style={[styles.headTitle, { color: theme.text }]}>Import from TMDb</Text>
      </View>
      <Text style={[styles.headHint, { color: theme.placeholder }]}>
        Fills the form below — nothing is saved until you press Save.
      </Text>

      <View style={[styles.searchRow, { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}>
        <Ionicons name="film-outline" size={15} color={theme.placeholder} />
        <TextInput
          style={[styles.input, { color: theme.text }]}
          value={query}
          onChangeText={handleChangeQuery}
          placeholder="Search a title, e.g. The Matrix"
          placeholderTextColor={theme.placeholder}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search TMDb by title"
        />
        {searching ? <ActivityIndicator size="small" color={GOLD} /> : null}
      </View>

      {error ? <Text style={[styles.error, { color: "#ef6c6c" }]}>{error}</Text> : null}

      {!error && !searching && query.trim() && results.length === 0 ? (
        <Text style={[styles.empty, { color: theme.placeholder }]}>
          No matches. TMDb usually lists a film under its original title.
        </Text>
      ) : null}

      {results.map((hit) => {
        const year = yearOf(hit.release_date);
        const busy = pickingId === hit.id;
        return (
          <TouchableOpacity
            key={hit.id}
            style={[styles.row, { borderColor: busy ? GOLD : theme.cardBorder }]}
            onPress={() => void handlePick(hit)}
            disabled={pickingId !== null}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Import ${hit.title}`}
          >
            {hit.poster_url ? (
              <Image source={{ uri: hit.poster_url }} style={styles.poster} />
            ) : (
              <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.inputBackground }]}>
                <Ionicons name="film-outline" size={18} color={theme.placeholder} />
              </View>
            )}

            <View style={styles.rowBody}>
              <View style={styles.rowTitleLine}>
                <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {hit.title}
                </Text>
                {year ? <Text style={[styles.rowYear, { color: theme.placeholder }]}>{year}</Text> : null}
              </View>
              {hit.overview ? (
                <Text style={[styles.rowOverview, { color: theme.placeholder }]} numberOfLines={2}>
                  {hit.overview}
                </Text>
              ) : null}
            </View>

            {busy ? (
              <ActivityIndicator size="small" color={GOLD} />
            ) : (
              <Ionicons name="add-circle-outline" size={20} color={GOLD} />
            )}
          </TouchableOpacity>
        );
      })}

      <Text style={[styles.attribution, { color: theme.placeholder }]}>{TMDB_ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  headTitle: { fontSize: 13, fontWeight: "900" },
  headHint: { fontSize: 11, marginTop: -4 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },

  error: { fontSize: 12, fontWeight: "600" },
  empty: { fontSize: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 13,
    padding: 9,
  },
  poster: { width: 44, height: 66, borderRadius: 7 },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowTitle: { flexShrink: 1, fontSize: 13.5, fontWeight: "800" },
  rowYear: { fontSize: 12, fontWeight: "700" },
  rowOverview: { fontSize: 11.5, lineHeight: 15 },

  attribution: { fontSize: 9.5, letterSpacing: 0.2 },
});
