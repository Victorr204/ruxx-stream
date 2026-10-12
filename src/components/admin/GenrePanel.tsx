import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import AppAlert from "../../../utils/AppAlert";
import { fetchAdminGenres, createGenre, updateGenre, deleteGenre } from "../../lib/admin";
import type { AdminGenre } from "../../lib/admin";

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  type: "info" | "error";
};

export default function GenrePanel() {
  const { theme } = useTheme();
  const [genres, setGenres] = useState<AdminGenre[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newOrder, setNewOrder] = useState("");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editOrder, setEditOrder] = useState("");
  const [alert, setAlert] = useState<AlertState>({ visible: false, title: "", message: "", type: "info" });

  const showAlert = useCallback((title: string, message: string, type: AlertState["type"] = "info") => {
    setAlert({ visible: true, title, message, type });
  }, []);

  const load = useCallback(() => {
    fetchAdminGenres()
      .then((rows) => {
        setGenres(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        showAlert("Genres", e instanceof Error ? e.message : "Could not load genres.", "error");
        setLoading(false);
      });
  }, [showAlert]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      showAlert("Genres", "Enter a genre name first.");
      return;
    }
    const order = Number.parseInt(newOrder.trim() || "0", 10);
    setCreating(true);
    try {
      await createGenre(name, Number.isFinite(order) ? order : 0);
      setNewName("");
      setNewOrder("");
      load();
      showAlert("Genres", `“${name}” added.`, "info");
    } catch (e) {
      showAlert("Genres", e instanceof Error ? e.message : "Could not add the genre.", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editId) return;
    const name = editName.trim();
    const order = Number.parseInt(editOrder.trim() || "0", 10);
    setSavingId(editId);
    try {
      await updateGenre(editId, { name: name || undefined, sort_order: Number.isFinite(order) ? order : 0 });
      setEditId(null);
      load();
      showAlert("Genres", "Genre updated.", "info");
    } catch (e) {
      showAlert("Genres", e instanceof Error ? e.message : "Could not update the genre.", "error");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (genre: AdminGenre) => {
    setSavingId(genre.id);
    try {
      await deleteGenre(genre.id);
      load();
      showAlert("Genres", `“${genre.name}” deleted.`, "info");
    } catch (e) {
      showAlert(
        "Genres",
        e instanceof Error
          ? e.message
          : "Could not delete — the genre may still be linked to movies.",
        "error"
      );
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.card, color: theme.text, borderColor: theme.inputBorder },
  ];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />

      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Add genre</Text>
        <View style={styles.createRow}>
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            value={newName}
            onChangeText={setNewName}
            placeholder="Name (e.g. Nollywood)"
            placeholderTextColor={theme.placeholder}
          />
          <TextInput
            style={[inputStyle, styles.orderInput]}
            value={newOrder}
            onChangeText={setNewOrder}
            placeholder="0"
            placeholderTextColor={theme.placeholder}
            keyboardType="number-pad"
          />
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: GOLD, opacity: creating || !newName.trim() ? 0.5 : 1 }]}
            onPress={handleCreate}
            disabled={creating || !newName.trim()}
            activeOpacity={0.8}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#111" />
            ) : (
              <Ionicons name="add" size={18} color="#111" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.placeholder }]}>
        All genres ({genres.length})
      </Text>

      {genres.map((genre) => {
        const editing = editId === genre.id;
        const busy = savingId === genre.id;
        return (
          <View key={genre.id} style={[styles.genreRow, { backgroundColor: theme.card }]}>
            {editing ? (
              <View style={styles.editRow}>
                <TextInput
                  style={[inputStyle, { flex: 1 }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Name"
                  placeholderTextColor={theme.placeholder}
                />
                <TextInput
                  style={[inputStyle, styles.orderInput]}
                  value={editOrder}
                  onChangeText={setEditOrder}
                  placeholder="0"
                  placeholderTextColor={theme.placeholder}
                  keyboardType="number-pad"
                />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={[styles.genreName, { color: theme.text }]} numberOfLines={1}>
                  {genre.name}
                </Text>
                <Text style={[styles.genreMeta, { color: theme.placeholder }]} numberOfLines={1}>
                  {genre.slug} • order {genre.sort_order}
                </Text>
              </View>
            )}

            <View style={styles.actions}>
              {editing ? (
                <>
                  <TouchableOpacity
                    style={[styles.iconBtn, { backgroundColor: GOLD }]}
                    onPress={handleSaveEdit}
                    disabled={busy}
                    activeOpacity={0.8}
                    accessibilityLabel="Save genre"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#111" />
                    ) : (
                      <Ionicons name="checkmark" size={16} color="#111" />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconBtn, { backgroundColor: "rgba(255,255,255,0.08)" }]}
                    onPress={() => setEditId(null)}
                    activeOpacity={0.8}
                    accessibilityLabel="Cancel edit"
                  >
                    <Ionicons name="close" size={16} color={theme.subtitle} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.iconBtn, { backgroundColor: "rgba(255,255,255,0.08)" }]}
                    onPress={() => {
                      setEditId(genre.id);
                      setEditName(genre.name);
                      setEditOrder(String(genre.sort_order));
                    }}
                    activeOpacity={0.8}
                    accessibilityLabel="Edit genre"
                  >
                    <Ionicons name="pencil" size={15} color={theme.subtitle} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconBtn, { backgroundColor: "rgba(239,68,68,0.12)" }]}
                    onPress={() => handleDelete(genre)}
                    disabled={busy}
                    activeOpacity={0.8}
                    accessibilityLabel="Delete genre"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#ef4444" />
                    ) : (
                      <Ionicons name="trash-outline" size={15} color="#ef4444" />
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );
      })}

      {genres.length === 0 && (
        <Text style={[styles.empty, { color: theme.placeholder }]}>No genres yet — add the first one above.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },

  card: { borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: "800" },

  createRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  editRow: { flex: 1, flexDirection: "row", gap: 8 },

  input: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 11,
    height: 40,
    fontSize: 13.5,
  },
  orderInput: { flex: 0, width: 58 },

  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    textTransform: "uppercase",
    marginTop: 6,
  },

  genreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 13,
    padding: 12,
  },
  genreName: { fontSize: 14, fontWeight: "800" },
  genreMeta: { fontSize: 11, marginTop: 1 },

  actions: { flexDirection: "row", gap: 7 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  empty: { fontSize: 13, textAlign: "center", paddingVertical: 24 },
});
