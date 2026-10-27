import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import { createMovieFromTmdb } from "../../lib/admin";
import { fetchGenres } from "../../lib/api";
import { formatBytes } from "../../lib/downloads";
import {
  cancelActiveUpload,
  isUploadCancelled,
  pickAndUploadVideo,
  type UploadedVideo,
  type UploadProgressEvent,
} from "../../lib/upload";
import {
  TMDB_ATTRIBUTION,
  fetchTmdbImport,
  matchGenresByName,
  searchTmdbTitles,
  type TmdbSearchHit,
} from "../../lib/tmdb";
import { bestCandidate, guessTitleFromFilename, type TitleGuess } from "../../lib/tmdbMatch";

// The whole catalog write path, compressed into one button.
//
// The admin picks a video file and nothing else happens by hand: the file
// goes to object storage, the filename is decoded into a title + year, TMDb
// is searched with that guess and the strongest match is pre-selected. Every
// field a human used to type — synopsis, artwork, runtime, rating, genres —
// arrives with the TMDb record, so publishing is a single confirmation.
//
// The one thing this deliberately will not do is guess quietly. A wrong
// auto-match would publish another film's metadata as if it were correct, so
// the guess is always shown with its poster and can be replaced by tapping a
// different result before anything is written.

type Stage = "idle" | "uploading" | "review" | "saving" | "done";

type Props = {
  /** Called after a title is live, so the caller can refresh its list. */
  onPublished: () => void;
};

const DEBOUNCE_MS = 350;

export default function QuickAdd({ onPublished }: Props) {
  const { theme } = useTheme();

  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<UploadProgressEvent | null>(null);
  const [uploaded, setUploaded] = useState<UploadedVideo | null>(null);
  const [guess, setGuess] = useState<TitleGuess | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Stops a slow response from overwriting the results of a newer query.
  const requestSeq = useRef(0);

  useEffect(() => {
    const term = query.trim();
    const seq = ++requestSeq.current;

    const timer = setTimeout(() => {
      if (!term) {
        if (seq === requestSeq.current) {
          setResults([]);
          setSearchError(null);
          setSearching(false);
        }
        return;
      }
      searchTmdbTitles(term)
        .then((hits) => {
          if (seq !== requestSeq.current) return;
          setResults(hits);
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (seq !== requestSeq.current) return;
          setResults([]);
          setSearchError(e instanceof Error ? e.message : "TMDb search failed.");
        })
        .finally(() => {
          if (seq === requestSeq.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const best = useMemo(() => (guess ? bestCandidate(guess, results) : null), [guess, results]);

  // The row to publish: an explicit tap wins, then the auto-match, then the
  // first hit — so a confident guess is publishable without any interaction.
  const selected = useMemo(() => {
    const wanted = selectedId ?? best?.best?.id ?? results[0]?.id ?? null;
    return results.find((hit) => hit.id === wanted) ?? null;
  }, [results, selectedId, best]);

  const busy = stage === "uploading" || stage === "saving";

  const reset = () => {
    setStage("idle");
    setProgress(null);
    setUploaded(null);
    setGuess(null);
    setQuery("");
    setResults([]);
    setSearching(false);
    setSearchError(null);
    setSelectedId(null);
    setUploadError(null);
    setPublishError(null);
  };

  // Only reachable from "idle", and every path back to "idle" from a stage
  // that had a query goes through reset() below — so query is always "" here
  // and the derived term always counts as a change, re-triggering the search.
  const handlePickFile = async () => {
    if (busy) return;
    setUploadError(null);
    setPublishError(null);
    setProgress(null);
    setUploaded(null);
    setGuess(null);
    setResults([]);
    setSelectedId(null);
    setStage("uploading");

    try {
      const picked = await pickAndUploadVideo({ compress: true, onProgress: setProgress });
      if (picked === "cancelled") {
        setStage("idle");
        return;
      }

      const derived = guessTitleFromFilename(picked.name);
      setUploaded(picked);
      setGuess(derived);
      setStage("review");

      const term = derived.year ? `${derived.title} ${derived.year}` : derived.title;
      setQuery(term);
      if (term.trim()) setSearching(true);
    } catch (e) {
      if (isUploadCancelled(e)) {
        setStage("idle");
        return;
      }
      setUploadError(e instanceof Error ? e.message : "Could not upload that video.");
      setStage("idle");
    }
  };

  const handlePublish = async () => {
    if (busy || !selected || !uploaded) return;
    setPublishError(null);
    setStage("saving");

    try {
      const record = await fetchTmdbImport(selected.id);
      // A genre with no counterpart in this catalog is dropped rather than
      // invented, so a missing genre row never blocks a publish.
      const genres = await fetchGenres().catch(() => []);
      const { ids } = matchGenresByName(record.genre_names, genres);
      await createMovieFromTmdb(record, uploaded.key, ids);
      setStage("done");
      onPublished();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Could not publish that title.");
      setStage("review");
    }
  };

  const yearOf = (releaseDate: string | null): string | null => {
    if (!releaseDate) return null;
    const year = Number(releaseDate.slice(0, 4));
    return Number.isFinite(year) && year > 0 ? String(year) : null;
  };

  const pct = Math.max(2, Math.round((progress?.fraction ?? 0) * 100));

  return (
    <View style={[styles.root, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.headRow}>
        <Ionicons name="cloud-upload-outline" size={14} color={GOLD} />
        <Text style={[styles.headTitle, { color: theme.text }]}>Add a video</Text>
      </View>
      <Text style={[styles.headHint, { color: theme.placeholder }]}>
        Pick a file — title, artwork, synopsis and genres come from TMDb automatically. Nothing to
        type.
      </Text>

      {stage === "idle" ? (
        <>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: GOLD }]}
            onPress={() => void handlePickFile()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Choose a video file to add"
          >
            <Ionicons name="videocam-outline" size={16} color="#111" />
            <Text style={styles.primaryBtnText}>Choose video file</Text>
          </TouchableOpacity>
          {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
        </>
      ) : null}

      {stage === "uploading" ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressRow}>
            <View style={[styles.progressTrack, { backgroundColor: theme.inputBorder }]}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <TouchableOpacity
              onPress={cancelActiveUpload}
              activeOpacity={0.7}
              style={styles.cancelBtn}
              accessibilityRole="button"
              accessibilityLabel="Cancel upload"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.progressLabel, { color: theme.placeholder }]} numberOfLines={2}>
            {progress?.label ?? "Working…"}
          </Text>
        </View>
      ) : null}

      {stage === "review" || stage === "saving" ? (
        <>
          {uploaded ? (
            <View style={styles.fileRow}>
              <Ionicons name="videocam-outline" size={13} color={GOLD} />
              <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>
                {uploaded.name}
              </Text>
              <Text style={[styles.fileSize, { color: theme.placeholder }]}>
                {formatBytes(uploaded.outputBytes)}
              </Text>
            </View>
          ) : null}

          <View
            style={[
              styles.searchRow,
              { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder },
            ]}
          >
            <Ionicons name="search-outline" size={15} color={theme.placeholder} />
            <TextInput
              style={[styles.input, { color: theme.text }]}
              value={query}
              onChangeText={(value) => {
                setQuery(value);
                if (!value.trim()) {
                  requestSeq.current += 1;
                  setResults([]);
                  setSearchError(null);
                  setSearching(false);
                  return;
                }
                setSearching(true);
              }}
              placeholder="Search a title, e.g. The Matrix"
              placeholderTextColor={theme.placeholder}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search TMDb by title"
            />
            {searching ? <ActivityIndicator size="small" color={GOLD} /> : null}
          </View>

          {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
          {publishError ? <Text style={styles.error}>{publishError}</Text> : null}

          {!searching && !searchError && !publishError && query.trim() && results.length === 0 ? (
            <Text style={[styles.empty, { color: theme.placeholder }]}>
              No matches. TMDb usually lists a film under its original title.
            </Text>
          ) : null}

          {best?.best ? (
            <View style={styles.autoBadge}>
              <Ionicons name="sparkles-outline" size={12} color={GOLD} />
              <Text style={styles.autoBadgeText}>Auto-matched from the filename</Text>
            </View>
          ) : null}

          {!best?.best && !searching && query.trim() && results.length > 0 ? (
            <Text style={[styles.empty, { color: theme.placeholder }]}>
              Couldn&apos;t auto-match — tap the right film below.
            </Text>
          ) : null}

          {results.map((hit) => {
            const year = yearOf(hit.release_date);
            const isSelected = selected?.id === hit.id;
            return (
              <TouchableOpacity
                key={hit.id}
                style={[
                  styles.row,
                  { borderColor: isSelected ? GOLD : theme.cardBorder, borderWidth: isSelected ? 1.5 : 1 },
                ]}
                onPress={() => setSelectedId(hit.id)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Select ${hit.title}`}
              >
                {hit.poster_url ? (
                  <Image source={{ uri: hit.poster_url }} style={styles.poster} />
                ) : (
                  <View
                    style={[
                      styles.poster,
                      styles.posterFallback,
                      { backgroundColor: theme.inputBackground },
                    ]}
                  >
                    <Ionicons name="film-outline" size={18} color={theme.placeholder} />
                  </View>
                )}

                <View style={styles.rowBody}>
                  <View style={styles.rowTitleLine}>
                    <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                      {hit.title}
                    </Text>
                    {year ? (
                      <Text style={[styles.rowYear, { color: theme.placeholder }]}>{year}</Text>
                    ) : null}
                  </View>
                  {hit.overview ? (
                    <Text style={[styles.rowOverview, { color: theme.placeholder }]} numberOfLines={2}>
                      {hit.overview}
                    </Text>
                  ) : null}
                </View>

                <Ionicons
                  name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                  size={20}
                  color={isSelected ? GOLD : theme.placeholder}
                />
              </TouchableOpacity>
            );
          })}

          {selected ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: GOLD }]}
              onPress={() => void handlePublish()}
              activeOpacity={0.8}
              disabled={stage === "saving"}
              accessibilityRole="button"
              accessibilityLabel={`Publish ${selected.title}`}
            >
              {stage === "saving" ? (
                <ActivityIndicator size="small" color="#111" />
              ) : (
                <Ionicons name="checkmark-circle-outline" size={16} color="#111" />
              )}
              <Text style={styles.primaryBtnText} numberOfLines={1}>
                {stage === "saving"
                  ? "Publishing…"
                  : `Publish “${selected.title}”`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {stage === "done" ? (
        <View style={styles.doneWrap}>
          <Ionicons name="checkmark-circle" size={30} color={GOLD} />
          <Text style={[styles.doneTitle, { color: theme.text }]}>Published</Text>
          <Text style={[styles.doneHint, { color: theme.placeholder }]}>
            It&apos;s live in the catalog now.
          </Text>
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: theme.cardBorder }]}
            onPress={reset}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Add another video"
          >
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Add another</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
  headHint: { fontSize: 11, marginTop: -4, lineHeight: 15 },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 14,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "900", color: "#111", flexShrink: 1 },

  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    height: 42,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 13.5, fontWeight: "800" },

  error: { fontSize: 12, fontWeight: "600", color: "#ef6c6c" },
  empty: { fontSize: 12, lineHeight: 16 },

  progressWrap: { gap: 8 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { flex: 1, height: 7, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: GOLD },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  cancelText: { fontSize: 12, fontWeight: "800", color: "#ef6c6c" },
  progressLabel: { fontSize: 11.5, lineHeight: 15 },

  fileRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  fileName: { flex: 1, fontSize: 12, fontWeight: "700" },
  fileSize: { fontSize: 11, fontWeight: "700" },

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

  autoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(232,184,74,0.12)",
  },
  autoBadgeText: { fontSize: 10.5, fontWeight: "800", color: GOLD, letterSpacing: 0.2 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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

  doneWrap: { alignItems: "center", gap: 6, paddingVertical: 12 },
  doneTitle: { fontSize: 16, fontWeight: "900" },
  doneHint: { fontSize: 12, marginBottom: 4 },

  attribution: { fontSize: 9.5, letterSpacing: 0.2 },
});
