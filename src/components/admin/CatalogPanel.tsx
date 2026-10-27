import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
} from "react-native";
import type { ListRenderItem } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import AppAlert from "../../../utils/AppAlert";
import { fetchGenres } from "../../lib/api";
import {
  deleteAdminMovie,
  fetchAdminMovies,
  setMovieFlags,
  type AdminMovie,
} from "../../lib/admin";
import { formatRuntime } from "../../lib/format";
import type { Genre } from "../../lib/types";
import MovieEditor from "./MovieEditor";
import QuickAdd from "./QuickAdd";

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  type: "info" | "error";
};

function runtimeLabel(movie: AdminMovie): string {
  return movie.runtime_seconds ? formatRuntime(movie.runtime_seconds) : "—";
}

export default function CatalogPanel() {
  const { theme } = useTheme();
  const [movies, setMovies] = useState<AdminMovie[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminMovie | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertState>({
    visible: false,
    title: "",
    message: "",
    type: "info",
  });

  const showAlert = useCallback((title: string, message: string, type: AlertState["type"] = "info") => {
    setAlert({ visible: true, title, message, type });
  }, []);

  const fetchAll = useCallback(() => Promise.all([fetchAdminMovies(), fetchGenres()]), []);

  const load = useCallback(async () => {
    try {
      const [movieRows, genreRows] = await fetchAll();
      setMovies(movieRows);
      setGenres(genreRows);
    } catch (e) {
      showAlert("Catalog", e instanceof Error ? e.message : "Could not load the catalog.", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchAll, showAlert]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(([movieRows, genreRows]) => {
        if (cancelled) return;
        setMovies(movieRows);
        setGenres(genreRows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        showAlert("Catalog", e instanceof Error ? e.message : "Could not load the catalog.", "error");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll, showAlert]);

  const toggleFlag = async (movie: AdminMovie, flag: "is_active" | "is_featured") => {
    setBusyId(movie.id);
    try {
      const next = !movie[flag];
      await setMovieFlags(movie.id, { [flag]: next });
      setMovies((rows) =>
        rows.map((row) => {
          if (row.id === movie.id) return { ...row, [flag]: next };
          // Only one title can hold the hero slot at a time.
          if (flag === "is_featured" && next) return { ...row, is_featured: false };
          return row;
        })
      );
    } catch (e) {
      showAlert("Catalog", e instanceof Error ? e.message : "Could not update the movie.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (movie: AdminMovie) => {
    if (armedDeleteId !== movie.id) {
      setArmedDeleteId(movie.id);
      return;
    }
    setArmedDeleteId(null);
    setBusyId(movie.id);
    try {
      const warning = await deleteAdminMovie(movie.id);
      setMovies((rows) => rows.filter((row) => row.id !== movie.id));
      showAlert("Catalog", warning ? `"${movie.title}" deleted. ${warning}` : `"${movie.title}" deleted.`);
    } catch (e) {
      showAlert("Catalog", e instanceof Error ? e.message : "Could not delete the movie.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (movie: AdminMovie) => {
    setEditing(movie);
    setEditorOpen(true);
  };

  const needle = query.trim().toLowerCase();
  const filtered = needle ? movies.filter((movie) => movie.title.toLowerCase().includes(needle)) : movies;

  const renderMovie: ListRenderItem<AdminMovie> = ({ item }) => {
    const genreNames = item.genre_ids
      .map((id) => genres.find((genre) => genre.id === id)?.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");
    const isActive = item.is_active;
    const armed = armedDeleteId === item.id;
    const busy = busyId === item.id;

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: theme.card }]}
        onPress={() => openEdit(item)}
        activeOpacity={0.75}
        disabled={busy}
      >
        {item.poster_url ? (
          <Image source={{ uri: item.poster_url }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.background }]}>
            <Ionicons name="film-outline" size={22} color={theme.placeholder} />
          </View>
        )}

        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.cardMeta, { color: theme.placeholder }]} numberOfLines={1}>
            {[item.release_year ?? "—", runtimeLabel(item), item.maturity_rating].join(" · ")}
          </Text>
          {genreNames ? (
            <Text style={[styles.cardGenres, { color: theme.subtitle }]} numberOfLines={1}>
              {genreNames}
            </Text>
          ) : null}

          <View style={styles.tagRow}>
            <View
              style={[
                styles.tag,
                {
                  backgroundColor: isActive ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)",
                  borderColor: isActive ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
                },
              ]}
            >
              <Text style={[styles.tagText, { color: isActive ? "#22c55e" : "#ef4444" }]}>
                {isActive ? "Active" : "Hidden"}
              </Text>
            </View>
            {item.is_featured ? (
              <View
                style={[styles.tag, { backgroundColor: "rgba(232,184,74,0.14)", borderColor: "rgba(232,184,74,0.4)" }]}
              >
                <Text style={[styles.tagText, { color: GOLD }]}>Featured</Text>
              </View>
            ) : null}
            {item.premium_r2_key || item.premium_stream_url ? (
              <View
                style={[styles.tag, { backgroundColor: "rgba(59,130,246,0.14)", borderColor: "rgba(59,130,246,0.4)" }]}
              >
                <Text style={[styles.tagText, { color: "#3b82f6" }]}>Premium</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => toggleFlag(item, "is_active")}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityLabel={isActive ? "Hide movie" : "Show movie"}
          >
            <Ionicons name={isActive ? "eye-off-outline" : "eye-outline"} size={18} color={theme.subtitle} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => toggleFlag(item, "is_featured")}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityLabel={item.is_featured ? "Unfeature movie" : "Feature movie"}
          >
            <Ionicons
              name={item.is_featured ? "star" : "star-outline"}
              size={17}
              color={item.is_featured ? GOLD : theme.subtitle}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, armed && styles.iconBtnArmed]}
            onPress={() => handleDelete(item)}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityLabel={armed ? "Confirm delete" : "Delete movie"}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Ionicons name={armed ? "alert" : "trash-outline"} size={17} color="#ef4444" />
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.addWrap}>
        {/* The only way to add a title now: upload a file, TMDb supplies the
            metadata, and it goes live on confirm. The old "New" button that
            opened a blank metadata form is gone on purpose. */}
        <QuickAdd onPublished={() => void load()} />
      </View>

      <View style={styles.toolbar}>
        <View style={[styles.searchBox, { backgroundColor: theme.card, borderColor: theme.inputBorder }]}>
          <Ionicons name="search" size={15} color={theme.placeholder} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Filter titles…"
            placeholderTextColor={theme.placeholder}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery("")} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={15} color={theme.placeholder} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderMovie}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="film-outline" size={36} color={theme.placeholder} />
            <Text style={[styles.emptyText, { color: theme.placeholder }]}>
              {needle ? "No titles match that filter." : "No movies yet — add a video above."}
            </Text>
          </View>
        }
      />

      {editorOpen ? (
        <MovieEditor
          movie={editing}
          genres={genres}
          onClose={() => setEditorOpen(false)}
          onSaved={(_id, title) => {
            setEditorOpen(false);
            void load();
            showAlert("Catalog", `Saved "${title}".`);
          }}
          onError={(message) => showAlert("Catalog", message, "error")}
        />
      ) : null}

      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 10 },

  toolbar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  addWrap: { paddingHorizontal: 16, marginBottom: 14 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },

  card: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 10,
    gap: 11,
    alignItems: "center",
  },
  poster: { width: 54, height: 78, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.05)" },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontWeight: "800" },
  cardMeta: { fontSize: 11 },
  cardGenres: { fontSize: 11 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  tagText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },

  cardActions: { gap: 4, alignItems: "center" },
  iconBtn: {
    width: 32,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  iconBtnArmed: { backgroundColor: "rgba(239,68,68,0.16)" },

  emptyText: { fontSize: 13, textAlign: "center", paddingHorizontal: 40 },
});
