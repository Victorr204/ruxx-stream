import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { GOLD, GOLD_GRADIENT, useTheme } from "../../context/ThemeContext";
import { useAuthStore } from "../stores/auth";
import {
  addMovieToList,
  createUserList,
  fetchListIdsForMovie,
  fetchUserLists,
  isListLimitError,
  listLimitFor,
  removeMovieFromList,
} from "../lib/api";
import type { UserList } from "../lib/types";

type Props = {
  visible: boolean;
  movieId: string;
  onClose: () => void;
  onMembershipChange?: (listIds: string[]) => void;
};

export default function ListSheet({ visible, movieId, onClose, onMembershipChange }: Props) {
  const { theme } = useTheme();
  const isPremium = useAuthStore((s) => s.profile?.is_premium ?? false);
  const limit = listLimitFor(isPremium);

  // Which movie's lists are already on screen: the spinner covers the first
  // open (and a movie switch); repeat opens refetch without flashing it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [lists, setLists] = useState<UserList[]>([]);
  const [inListIds, setInListIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;

    Promise.all([fetchUserLists(), fetchListIdsForMovie(movieId)])
      .then(([userLists, membership]) => {
        if (cancelled) return;
        setLists(userLists);
        setInListIds(membership);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(movieId);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, movieId]);

  const loading = visible && loadedFor !== movieId;

  const emitMembership = (next: string[]) => {
    setInListIds(next);
    onMembershipChange?.(next);
  };

  const toggleList = async (list: UserList) => {
    if (busyId) return;
    const isInside = inListIds.includes(list.id);
    setBusyId(list.id);
    setError(null);

    try {
      if (isInside) {
        await removeMovieFromList(list.id, movieId);
        emitMembership(inListIds.filter((id) => id !== list.id));
        setLists((prev) =>
          prev.map((row) => (row.id === list.id ? { ...row, movie_count: Math.max(0, row.movie_count - 1) } : row))
        );
      } else {
        await addMovieToList(list.id, movieId);
        emitMembership([...inListIds, list.id]);
        setLists((prev) =>
          prev.map((row) => (row.id === list.id ? { ...row, movie_count: row.movie_count + 1 } : row))
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your list");
    } finally {
      setBusyId(null);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    if (lists.length >= limit) {
      setError(
        isPremium
          ? "You've reached the 15 list limit."
          : "Free plan allows 5 lists — go Premium for 15."
      );
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const created = await createUserList(name);
      await addMovieToList(created.id, movieId);
      setLists((prev) => [...prev, created]);
      emitMembership([...inListIds, created.id]);
      setNewName("");
    } catch (e) {
      if (isListLimitError(e)) {
        setError(
          isPremium
            ? "You've reached the 15 list limit."
            : "Free plan allows 5 lists — go Premium for 15."
        );
      } else {
        setError(e instanceof Error ? e.message : "Could not create the list");
      }
    } finally {
      setCreating(false);
    }
  };

  const atCap = lists.length >= limit;
  const atLeastOne = inListIds.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kavo}>
          <Animated.View
            entering={FadeInDown.duration(240)}
            style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
          >
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <View style={styles.headerTick} />
                <Text style={[styles.title, { color: theme.text }]}>My List</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={18} color={theme.subtitle} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.limitNote, { color: theme.placeholder }]}>
              {lists.length} / {limit} lists used · {isPremium ? "Premium" : "Free plan"}
            </Text>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={GOLD} />
              </View>
            ) : (
              <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
                {lists.map((list) => {
                  const inside = inListIds.includes(list.id);
                  const busy = busyId === list.id;
                  return (
                    <TouchableOpacity
                      key={list.id}
                      style={[
                        styles.row,
                        { borderColor: inside ? "rgba(232,184,74,0.45)" : theme.cardBorder },
                        inside && styles.rowInside,
                      ]}
                      onPress={() => toggleList(list)}
                      disabled={busy}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={inside ? "checkmark-circle" : "ellipse-outline"}
                        size={21}
                        color={inside ? GOLD : theme.placeholder}
                      />
                      <View style={styles.rowText}>
                        <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                          {list.name}
                        </Text>
                        <Text style={[styles.rowMeta, { color: theme.placeholder }]}>
                          {list.movie_count === 1 ? "1 title" : `${list.movie_count} titles`}
                        </Text>
                      </View>
                      {busy ? (
                        <ActivityIndicator size="small" color={GOLD} />
                      ) : (
                        <Text style={[styles.rowAction, { color: inside ? GOLD : theme.placeholder }]}>
                          {inside ? "Remove" : "Add"}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {lists.length === 0 && (
                  <Text style={[styles.empty, { color: theme.placeholder }]}>
                    No lists yet — create your first one below.
                  </Text>
                )}
              </ScrollView>
            )}

            <View style={[styles.createRow, { borderColor: theme.cardBorder }]}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="New list name (e.g. Watch later)"
                placeholderTextColor={theme.placeholder}
                style={[styles.input, { color: theme.text }]}
                maxLength={60}
                editable={!creating}
                returnKeyType="done"
                onSubmitEditing={createAndAdd}
              />
              <TouchableOpacity
                style={[styles.createBtn, atCap && styles.createBtnDisabled]}
                onPress={createAndAdd}
                disabled={creating || !newName.trim()}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={GOLD_GRADIENT as unknown as readonly [string, string, ...string[]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.createGrad}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color="#111" />
                  ) : (
                    <Ionicons name="add" size={17} color="#111" />
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {atCap && !error && !isPremium ? (
              <TouchableOpacity onPress={() => router.push("/profile")} activeOpacity={0.8}>
                <Text style={styles.upsell}>Free plan allows 5 lists — go Premium for 15 →</Text>
              </TouchableOpacity>
            ) : null}

            {!atLeastOne && !loading && lists.length > 0 ? (
              <Text style={[styles.hint, { color: theme.placeholder }]}>
                Tap a list to save this title into it.
              </Text>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  kavo: { width: "100%" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
    gap: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  headerTick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD },
  title: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  limitNote: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  loadingBox: { paddingVertical: 26, alignItems: "center" },
  rows: { maxHeight: 300 },
  rowsContent: { gap: 9 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowInside: { backgroundColor: "rgba(232,184,74,0.07)" },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 14.5, fontWeight: "800" },
  rowMeta: { fontSize: 11, fontWeight: "600" },
  rowAction: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 14 },
  createRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 5 },
  input: { flex: 1, fontSize: 14.5, fontWeight: "600", paddingVertical: 9 },
  createBtn: { borderRadius: 11, overflow: "hidden" },
  createBtnDisabled: { opacity: 0.45 },
  createGrad: { width: 42, height: 38, alignItems: "center", justifyContent: "center" },
  error: { color: "#FF6B6B", fontSize: 12.5, fontWeight: "600" },
  upsell: { color: GOLD, fontSize: 13, fontWeight: "800" },
  hint: { fontSize: 12, textAlign: "center" },
});
