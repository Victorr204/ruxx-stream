import { useEffect, useState, type ReactNode } from "react";
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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import {
  deleteAdminSubtitle,
  fetchAdminSubtitles,
  saveAdminMovie,
  saveAdminSubtitle,
  type AdminMovie,
  type AdminMovieInput,
  type AdminSubtitle,
} from "../../lib/admin";
import {
  cancelActiveUpload,
  isUploadCancelled,
  pickAndUploadArtwork,
  pickAndUploadVideo,
  type UploadProgressEvent,
  type UploadStage,
} from "../../lib/upload";
import { formatBytes } from "../../lib/downloads";
import { SUBTITLE_LANGUAGES, languageLabel, parseSubtitles } from "../../lib/subtitles";
import type { Genre } from "../../lib/types";

type Props = {
  movie: AdminMovie | null;
  genres: Genre[];
  onClose: () => void;
  onSaved: (id: string, title: string) => void;
  onError: (message: string) => void;
};

type Draft = AdminMovieInput;

type VideoJob = {
  stage: UploadStage;
  fraction: number;
  label: string;
};

type VideoSummary = {
  originalBytes: number;
  outputBytes: number;
  compressed: boolean;
  warning?: string;
};

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

function parseMinutesToSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const minutes = Number(trimmed);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const seconds = Math.round(minutes * 60);
  return seconds >= 1 ? seconds : null;
}

function minutesInputFromSeconds(seconds: number): string {
  return String(Math.max(0.02, Math.round((seconds / 60) * 100) / 100));
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
    movie?.runtime_seconds ? minutesInputFromSeconds(movie.runtime_seconds) : ""
  );
  const [yearText, setYearText] = useState(() => (movie?.release_year ? String(movie.release_year) : ""));
  const [saving, setSaving] = useState(false);
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [videoSummary, setVideoSummary] = useState<VideoSummary | null>(null);
  const [skipCompression, setSkipCompression] = useState(false);
  const [artworkUploading, setArtworkUploading] = useState<"poster_url" | "backdrop_url" | null>(
    null
  );
  const [subtitleList, setSubtitleList] = useState<{
    movieId: string;
    rows: AdminSubtitle[];
  } | null>(null);
  const [subLang, setSubLang] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);

  const movieId = movie?.id ?? null;
  const subtitles = subtitleList && subtitleList.movieId === movieId ? subtitleList.rows : [];

  useEffect(() => {
    if (!movieId) return undefined;
    let cancelled = false;
    fetchAdminSubtitles(movieId)
      .then((rows) => {
        if (!cancelled) setSubtitleList({ movieId, rows });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const handleUploadSubtitle = async () => {
    if (!movieId || !subLang || subBusy) return;
    setSubBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!/\.(srt|vtt)$/i.test(asset.name ?? "")) {
        onError("Pick a .srt or .vtt subtitle file.");
        return;
      }
      const blob = (asset as { file?: Blob }).file;
      const text =
        blob && typeof blob.text === "function"
          ? await blob.text()
          : await FileSystemLegacy.readAsStringAsync(asset.uri);
      if (parseSubtitles(text).length === 0) {
        onError("That file has no readable subtitle cues.");
        return;
      }
      await saveAdminSubtitle({
        movie_id: movieId,
        language: subLang,
        label: languageLabel(subLang),
        source: text,
      });
      const rows = await fetchAdminSubtitles(movieId);
      setSubtitleList({ movieId, rows });
      setSubLang(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Subtitle upload failed.");
    } finally {
      setSubBusy(false);
    }
  };

  const handleDeleteSubtitle = async (subtitleId: string) => {
    if (!movieId || subBusy) return;
    setSubBusy(true);
    try {
      await deleteAdminSubtitle(subtitleId);
      const rows = await fetchAdminSubtitles(movieId);
      setSubtitleList({ movieId, rows });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not delete the subtitle file.");
    } finally {
      setSubBusy(false);
    }
  };

  const toggleGenre = (genreId: string) =>
    setDraft((prev) => ({
      ...prev,
      genre_ids: prev.genre_ids.includes(genreId)
        ? prev.genre_ids.filter((id) => id !== genreId)
        : [...prev.genre_ids, genreId],
    }));

  const handlePickVideo = async () => {
    if (videoJob) return;
    setVideoSummary(null);
    try {
      const picked = await pickAndUploadVideo({
        compress: !skipCompression,
        onProgress: (event: UploadProgressEvent) =>
          setVideoJob({
            stage: event.stage,
            fraction: event.fraction,
            label: event.label,
          }),
        onProbed: (durationSeconds) => {
          if (!runtimeMinutes.trim() && durationSeconds > 0) {
            setRuntimeMinutes(minutesInputFromSeconds(durationSeconds));
          }
        },
      });
      if (picked === "cancelled") return;
      // The uploaded object becomes the playable source; drop any stale
      // external URL so the status line stays truthful.
      set({ r2_key_free: picked.key, stream_url: "" });
      setVideoSummary({
        originalBytes: picked.originalBytes,
        outputBytes: picked.outputBytes,
        compressed: picked.compressed,
        warning: picked.compressionWarning,
      });
    } catch (e) {
      if (!isUploadCancelled(e)) {
        onError(e instanceof Error ? e.message : "Upload failed.");
      }
    } finally {
      setVideoJob(null);
    }
  };

  const handlePickArtwork = async (field: "poster_url" | "backdrop_url") => {
    if (artworkUploading) return;
    setArtworkUploading(field);
    try {
      const picked = await pickAndUploadArtwork();
      if (picked !== "cancelled") {
        if (field === "poster_url") set({ poster_url: picked });
        else set({ backdrop_url: picked });
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Artwork upload failed.");
    } finally {
      setArtworkUploading(null);
    }
  };

  const handleSave = async () => {
    const title = draft.title.trim();
    if (!title) {
      onError("Title is required.");
      return;
    }
    if (!(draft.stream_url ?? "").trim() && !(draft.r2_key_free ?? "").trim()) {
      onError("Upload the movie file — the video is stored and linked automatically.");
      return;
    }
    const releaseYear = parseNullableInt(yearText);
    if (yearText.trim() && releaseYear === null) {
      onError("Release year must be a positive number (e.g. 2026).");
      return;
    }
    const runtimeSeconds = parseMinutesToSeconds(runtimeMinutes);
    if (runtimeMinutes.trim() && runtimeSeconds === null) {
      onError("Runtime must be a positive number of minutes — 0.1 = 6 seconds, 0.5 = 30 seconds.");
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

  const storedKey = (draft.r2_key_free ?? "").trim();
  const baseHint = storedKey
    ? `Stored in Backblaze B2 — ${storedKey}`
    : (draft.stream_url ?? "").trim()
      ? "Legacy external source — choose a file to replace it."
      : "Nothing uploaded yet — choose the movie file; it saves to Backblaze B2 automatically.";
  const webNote =
    Platform.OS === "web"
      ? " Browser uploads aren't compressed — use the mobile app for large titles."
      : "";
  const videoFileHint = `${baseHint}${webNote}`;

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
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || !!videoJob || !!artworkUploading}
              activeOpacity={0.7}
            >
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
                <Field label="Runtime (min)" hint="Decimals allowed — 0.1 = 6 seconds, 1.5 = 90 seconds.">
                  <TextInput
                    style={inputStyle}
                    value={runtimeMinutes}
                    onChangeText={setRuntimeMinutes}
                    placeholder="120"
                    placeholderTextColor={theme.placeholder}
                    keyboardType="decimal-pad"
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

            <Field label="Video file" hint={videoFileHint}>
              {videoJob ? (
                <View style={styles.jobWrap}>
                  <View style={styles.jobRow}>
                    <View style={[styles.jobTrack, { backgroundColor: theme.inputBorder }]}>
                      <View
                        style={[
                          styles.jobFill,
                          { width: `${Math.max(2, Math.round(videoJob.fraction * 100))}%` },
                        ]}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={cancelActiveUpload}
                      activeOpacity={0.7}
                      style={styles.jobCancel}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel upload"
                    >
                      <Text style={styles.jobCancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={[fieldStyles.hint, { color: theme.placeholder }]}
                    numberOfLines={2}
                  >
                    {videoJob.label}
                  </Text>
                </View>
              ) : (
                <View style={styles.sourceRow}>
                  <TouchableOpacity
                    style={[styles.uploadBtn, { backgroundColor: GOLD }]}
                    onPress={handlePickVideo}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.uploadBtnText}>
                      {(draft.r2_key_free ?? "").trim() ? "Replace video file" : "Choose video file"}
                    </Text>
                  </TouchableOpacity>
                  {Platform.OS !== "web" ? (
                    <View style={styles.compressToggle}>
                      <Text style={[styles.compressLabel, { color: theme.subtitle }]}>
                        Compress
                      </Text>
                      <Switch
                        value={!skipCompression}
                        onValueChange={(value) => setSkipCompression(!value)}
                        trackColor={{ true: GOLD, false: "rgba(255,255,255,0.15)" }}
                        thumbColor="#f4f4f5"
                      />
                    </View>
                  ) : null}
                </View>
              )}
              {videoSummary && !videoJob ? (
                <View style={styles.summaryWrap}>
                  <Text style={[fieldStyles.hint, { color: theme.subtitle }]}>
                    {videoSummary.compressed
                      ? `Uploaded ${formatBytes(videoSummary.outputBytes)} — compressed from ${formatBytes(videoSummary.originalBytes)}`
                      : `Uploaded ${formatBytes(videoSummary.outputBytes)} — original file`}
                  </Text>
                  {videoSummary.warning ? (
                    <Text style={[fieldStyles.hint, { color: "#f59e0b" }]}>
                      Compression skipped: {videoSummary.warning}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Field>

            <Field
              label="Poster"
              hint={
                (draft.poster_url ?? "").trim()
                  ? "Image set — replace it any time."
                  : "Shown on cards and the movie page."
              }
            >
              <View style={styles.sourceRow}>
                {(draft.poster_url ?? "").trim() ? (
                  <Image
                    source={{ uri: draft.poster_url ?? "" }}
                    style={styles.artPreviewPoster}
                    resizeMode="cover"
                  />
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.uploadBtn,
                    { backgroundColor: artworkUploading ? "rgba(232,184,74,0.5)" : GOLD },
                  ]}
                  onPress={() => handlePickArtwork("poster_url")}
                  disabled={!!artworkUploading}
                  activeOpacity={0.8}
                >
                  {artworkUploading === "poster_url" ? (
                    <ActivityIndicator size="small" color="#111" />
                  ) : (
                    <Text style={styles.uploadBtnText}>
                      {(draft.poster_url ?? "").trim() ? "Replace poster" : "Choose poster image"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </Field>

            <Field
              label="Backdrop"
              hint={
                (draft.backdrop_url ?? "").trim()
                  ? "Image set — replace it any time."
                  : "Wide hero image behind the title."
              }
            >
              <View style={styles.sourceRow}>
                {(draft.backdrop_url ?? "").trim() ? (
                  <Image
                    source={{ uri: draft.backdrop_url ?? "" }}
                    style={styles.artPreviewBackdrop}
                    resizeMode="cover"
                  />
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.uploadBtn,
                    { backgroundColor: artworkUploading ? "rgba(232,184,74,0.5)" : GOLD },
                  ]}
                  onPress={() => handlePickArtwork("backdrop_url")}
                  disabled={!!artworkUploading}
                  activeOpacity={0.8}
                >
                  {artworkUploading === "backdrop_url" ? (
                    <ActivityIndicator size="small" color="#111" />
                  ) : (
                    <Text style={styles.uploadBtnText}>
                      {(draft.backdrop_url ?? "").trim()
                        ? "Replace backdrop"
                        : "Choose backdrop image"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
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

            <Field
              label="Subtitles"
              hint={
                movieId
                  ? "Upload .srt or .vtt files so viewers can watch in their language."
                  : "Save the movie first, then upload subtitle files."
              }
            >
              {movieId ? (
                <View style={styles.subWrap}>
                  {subtitles.length > 0 ? (
                    <View style={styles.subList}>
                      {subtitles.map((row) => (
                        <View
                          key={row.id}
                          style={[
                            styles.subRow,
                            { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder },
                          ]}
                        >
                          <Ionicons name="document-text-outline" size={16} color={GOLD} />
                          <Text style={[styles.subName, { color: theme.text }]} numberOfLines={1}>
                            {row.label}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleDeleteSubtitle(row.id)}
                            disabled={subBusy}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${row.label} subtitles`}
                          >
                            <Ionicons name="trash-outline" size={16} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.chipWrap}>
                    {SUBTITLE_LANGUAGES.map((lang) => {
                      const selected = subLang === lang.code;
                      return (
                        <TouchableOpacity
                          key={lang.code}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? GOLD : "rgba(255,255,255,0.06)",
                              borderColor: selected ? GOLD : theme.inputBorder,
                            },
                          ]}
                          onPress={() => setSubLang(selected ? null : lang.code)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[styles.chipText, { color: selected ? "#111" : theme.subtitle }]}
                          >
                            {lang.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.uploadBtn,
                      styles.subUploadBtn,
                      { backgroundColor: subLang ? GOLD : "rgba(255,255,255,0.08)" },
                    ]}
                    onPress={handleUploadSubtitle}
                    disabled={!subLang || subBusy}
                    activeOpacity={0.85}
                  >
                    {subBusy ? (
                      <ActivityIndicator size="small" color="#111" />
                    ) : (
                      <Ionicons name="cloud-upload-outline" size={16} color={subLang ? "#111" : theme.placeholder} />
                    )}
                    <Text style={[styles.uploadBtnText, { color: subLang ? "#111" : theme.placeholder }]}>
                      {subLang ? `Upload ${languageLabel(subLang)} file` : "Pick a language"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
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

  sourceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  uploadBtn: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignSelf: "flex-start" },
  uploadBtnText: { fontSize: 14, fontWeight: "900", color: "#111" },

  subWrap: { gap: 10 },
  subList: { gap: 6 },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  subName: { flex: 1, fontSize: 13.5, fontWeight: "700" },
  subUploadBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  artPreviewPoster: { width: 56, height: 84, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)" },
  artPreviewBackdrop: { width: 112, height: 63, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)" },

  jobWrap: { gap: 6 },
  jobRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  jobTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  jobFill: { height: "100%", borderRadius: 3, backgroundColor: GOLD },
  jobCancel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(239,68,68,0.14)",
  },
  jobCancelText: { fontSize: 12, fontWeight: "800", color: "#ef4444" },
  compressToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
  compressLabel: { fontSize: 12, fontWeight: "700" },
  summaryWrap: { gap: 4, marginTop: 2 },

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
