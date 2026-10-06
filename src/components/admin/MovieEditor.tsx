import { useState, type ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import { saveAdminMovie, type AdminMovie, type AdminMovieInput } from "../../lib/admin";
import type { Genre } from "../../lib/types";

type Props = {
  movie: AdminMovie | null;
  genres: Genre[];
  onClose: () => void;
  onSaved: (id: string, title: string) => void;
  onError: (message: string) => void;
};

type Draft = AdminMovieInput;

function draftFrom(movie: AdminMovie | null): Draft {
  return {
    title: movie?.title ?? "",
    description: movie?.description ?? "",
    release_year: movie?.release_year ?? null,
    maturity_rating: movie?.maturity_rating ?? "NR",
    runtime_seconds: movie?.runtime_seconds ?? null,
    poster_url: movie?.poster_url ?? "",
    backdrop_url: movie?.backdrop_url ?? "",
    trailer_url: movie?.trailer_url ?? "",
    stream_url: movie?.stream_url ?? "",
    r2_key_free: movie?.r2_key_free ?? "",
    is_active: movie?.is_active ?? true,
    is_featured: movie?.is_featured ?? false,
    genre_ids: movie ? [...movie.genre_ids] : [],
    premium_r2_key: movie?.premium_r2_key ?? "",
    premium_stream_url: movie?.premium_stream_url ?? "",
  };
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseNullableInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={fieldStyles.wrap}>
      <Text style={[fieldStyles.label, { color: theme.placeholder }]}>{label}</Text>
      {children}
      {hint ? <Text style={[fieldStyles.hint, { color: theme.placeholder }]}>{hint}</Text> : null}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  hint: { fontSize: 11 },
});

export default function MovieEditor({ movie, genres, onClose, onSaved, onError }: Props) {
  const { theme } = useTheme();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(movie));
  const [runtimeMinutes, setRuntimeMinutes] = useState(() =>
    movie?.runtime_seconds ? String(Math.round(movie.runtime_seconds / 60)) : ""
  );
  const [yearText, setYearText] = useState(() => (movie?.release_year ? String(movie.release_year) : ""));
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleGenre = (genreId: string) =>
    setDraft((prev) => ({
      ...prev,
      genre_ids: prev.genre_ids.includes(genreId)
        ? prev.genre_ids.filter((id) => id !== genreId)
        : [...prev.genre_ids, genreId],
    }));

  const handleSave = async () => {
    const title = draft.title.trim();
    if (!title) {
      onError("Title is required.");
      return;
    }
    if (!(draft.stream_url ?? "").trim() && !(draft.r2_key_free ?? "").trim()) {
      onError("Give the movie a source: a stream URL or an R2 object key.");
      return;
    }
    const releaseYear = parseNullableInt(yearText);
    if (yearText.trim() && releaseYear === null) {
      onError("Release year must be a positive number (e.g. 2026).");
      return;
    }
    const runtimeSeconds = parseNullableInt(runtimeMinutes);
    if (runtimeMinutes.trim() && runtimeSeconds === null) {
      onError("Runtime must be a positive number of minutes.");
      return;
    }

    setSaving(true);
    try {
      const savedId = await saveAdminMovie(movie?.id ?? null, {
        ...draft,
        title,
        description: textOrNull(draft.description ?? ""),
        release_year: releaseYear,
        maturity_rating: draft.maturity_rating.trim() || "NR",
        runtime_seconds: runtimeSeconds,
        poster_url: textOrNull(draft.poster_url ?? ""),
        backdrop_url: textOrNull(draft.backdrop_url ?? ""),
        trailer_url: textOrNull(draft.trailer_url ?? ""),
        stream_url: textOrNull(draft.stream_url ?? ""),
        r2_key_free: textOrNull(draft.r2_key_free ?? ""),
        premium_r2_key: textOrNull(draft.premium_r2_key ?? ""),
        premium_stream_url: textOrNull(draft.premium_stream_url ?? ""),
      });
      onSaved(savedId, title);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the movie.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.card, color: theme.text, borderColor: theme.inputBorder },
  ];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetHeader}>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} accessibilityRole="button">
              <Text style={[styles.sheetAction, { color: theme.subtitle }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              {movie ? "Edit movie" : "New movie"}
            </Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.7}>
              {saving ? (
                <ActivityIndicator size="small" color={GOLD} />
              ) : (
                <Text style={[styles.sheetAction, { color: GOLD, fontWeight: "900" }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.form}
            contentContainerStyle={{ gap: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Field label="Title *">
              <TextInput
                style={inputStyle}
                value={draft.title}
                onChangeText={(value) => set({ title: value })}
                placeholder="Movie title"
                placeholderTextColor={theme.placeholder}
              />
            </Field>

            <Field label="Description">
              <TextInput
                style={[inputStyle, styles.multiline]}
                value={draft.description ?? ""}
                onChangeText={(value) => set({ description: value })}
                placeholder="Synopsis"
                placeholderTextColor={theme.placeholder}
                multiline
                textAlignVertical="top"
              />
            </Field>

            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <Field label="Release year">
                  <TextInput
                    style={inputStyle}
                    value={yearText}
                    onChangeText={setYearText}
                    placeholder="2026"
                    placeholderTextColor={theme.placeholder}
                    keyboardType="number-pad"
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Runtime (min)">
                  <TextInput
                    style={inputStyle}
                    value={runtimeMinutes}
                    onChangeText={setRuntimeMinutes}
                    placeholder="120"
                    placeholderTextColor={theme.placeholder}
                    keyboardType="number-pad"
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Rating">
                  <TextInput
                    style={inputStyle}
                    value={draft.maturity_rating}
                    onChangeText={(value) => set({ maturity_rating: value })}
                    placeholder="PG-13"
                    placeholderTextColor={theme.placeholder}
                    autoCapitalize="characters"
                  />
                </Field>
              </View>
            </View>

            <Field label="Stream URL (direct file)" hint="Progressive mp4/mov/webm… URL — required unless an R2 key is set.">
              <TextInput
                style={inputStyle}
                value={draft.stream_url ?? ""}
                onChangeText={(value) => set({ stream_url: value })}
                placeholder="https://cdn.example.com/movie.mp4"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <Field label="R2 object key (free rendition)" hint="Alternative source when no stream URL is set.">
              <TextInput
                style={inputStyle}
                value={draft.r2_key_free ?? ""}
                onChangeText={(value) => set({ r2_key_free: value })}
                placeholder="movies/free/movie.mp4"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Premium source — R2 key" hint="High-quality rendition, premium accounts only.">
              <TextInput
                style={inputStyle}
                value={draft.premium_r2_key ?? ""}
                onChangeText={(value) => set({ premium_r2_key: value })}
                placeholder="movies/premium/movie-1080p.mp4"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Premium source — stream URL">
              <TextInput
                style={inputStyle}
                value={draft.premium_stream_url ?? ""}
                onChangeText={(value) => set({ premium_stream_url: value })}
                placeholder="https://cdn.example.com/movie-1080p.m3u8"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Poster URL">
              <TextInput
                style={inputStyle}
                value={draft.poster_url ?? ""}
                onChangeText={(value) => set({ poster_url: value })}
                placeholder="https://image.tmdb.org/…/poster.jpg"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Backdrop URL">
              <TextInput
                style={inputStyle}
                value={draft.backdrop_url ?? ""}
                onChangeText={(value) => set({ backdrop_url: value })}
                placeholder="https://image.tmdb.org/…/backdrop.jpg"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Trailer URL">
              <TextInput
                style={inputStyle}
                value={draft.trailer_url ?? ""}
                onChangeText={(value) => set({ trailer_url: value })}
                placeholder="https://…/trailer.mp4"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
              />
            </Field>

            <View style={[styles.toggleCard, { backgroundColor: theme.card }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleLabel, { color: theme.text }]}>Active</Text>
                  <Text style={[styles.toggleHint, { color: theme.placeholder }]}>
                    Visible to members in browse & search
                  </Text>
                </View>
                <Switch
                  value={draft.is_active}
                  onValueChange={(value) => set({ is_active: value })}
                  trackColor={{ true: GOLD, false: "rgba(255,255,255,0.15)" }}
                  thumbColor="#f4f4f5"
                />
              </View>
              <View style={[styles.toggleRow, styles.toggleRowLast]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleLabel, { color: theme.text }]}>Featured</Text>
                  <Text style={[styles.toggleHint, { color: theme.placeholder }]}>
                    Hero banner slot (one at a time)
                  </Text>
                </View>
                <Switch
                  value={draft.is_featured}
                  onValueChange={(value) => set({ is_featured: value })}
                  trackColor={{ true: GOLD, false: "rgba(255,255,255,0.15)" }}
                  thumbColor="#f4f4f5"
                />
              </View>
            </View>

            <Field label="Genres">
              <View style={styles.chipWrap}>
                {genres.map((genre) => {
                  const selected = draft.genre_ids.includes(genre.id);
                  return (
                    <TouchableOpacity
                      key={genre.id}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? GOLD : "rgba(255,255,255,0.06)",
                          borderColor: selected ? GOLD : theme.inputBorder,
                        },
                      ]}
                      onPress={() => toggleGenre(genre.id)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[styles.chipText, { color: selected ? "#111" : theme.subtitle }]}
                      >
                        {genre.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Field>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetAction: { fontSize: 14, fontWeight: "700" },

  form: { paddingHorizontal: 18, paddingTop: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  multiline: { minHeight: 88, paddingTop: 10 },
  pairRow: { flexDirection: "row", gap: 10 },

  toggleCard: { borderRadius: 14, paddingHorizontal: 14 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  toggleRowLast: { borderBottomWidth: 0 },
  toggleLabel: { fontSize: 14, fontWeight: "800" },
  toggleHint: { fontSize: 11, marginTop: 2 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "700" },
});
