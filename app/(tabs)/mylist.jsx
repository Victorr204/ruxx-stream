import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { GOLD, GOLD_GRADIENT, useTheme } from "../../context/ThemeContext";
import { useAuthStore } from "../../src/stores/auth";
import { useIsDesktop, CONTENT_MAX_WIDTH } from "../../src/hooks/useIsDesktop";
import AppAlert from "../../utils/AppAlert";
import {
  createUserList,
  deleteUserList,
  fetchUserLists,
  isListLimitError,
  listLimitFor,
} from "../../src/lib/api";

export default function MyList() {
  const { theme } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const isPremium = profile?.is_premium ?? false;
  const limit = listLimitFor(isPremium);
  const isDesktop = useIsDesktop();

  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [armedId, setArmedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [createHover, setCreateHover] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "error" });
  const nameInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchUserLists()
      .then((data) => {
        if (!cancelled) {
          setLists(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Lists are created/deleted from movie pages — refetch when the tab
  // regains focus so the grid never shows stale membership.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchUserLists()
        .then((data) => {
          if (!cancelled) {
            setLists(data);
            setError(null);
          }
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const reload = useCallback(() => {
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  const showError = (title, message, type = "error") =>
    setAlert({ visible: true, title, message, type });

  const createList = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    if (lists.length >= limit) {
      showError(
        "List Limit Reached",
        isPremium
          ? "You've reached the 15 list limit."
          : "The Free plan allows 5 lists. Premium unlocks 15.",
        "info"
      );
      return;
    }

    setCreating(true);
    try {
      const created = await createUserList(name);
      setLists((prev) => [...prev, created]);
      setNewName("");
    } catch (e) {
      if (isListLimitError(e)) {
        showError(
          "List Limit Reached",
          isPremium
            ? "You've reached the 15 list limit."
            : "The Free plan allows 5 lists. Premium unlocks 15.",
          "info"
        );
      } else {
        showError("Could Not Create List", e instanceof Error ? e.message : "Please try again.");
      }
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!armedId || deletingId) return;
    setDeletingId(armedId);
    try {
      await deleteUserList(armedId);
      setLists((prev) => prev.filter((row) => row.id !== armedId));
      setArmedId(null);
    } catch (e) {
      showError("Could Not Delete List", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const openList = (list) => {
    if (armedId) {
      setArmedId(null);
      return;
    }
    router.push(`/list/${list.id}`);
  };

  const atCap = lists.length >= limit;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={["top"]}>
      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />

      <View pointerEvents="none" style={styles.aura}>
        <LinearGradient colors={["rgba(232,184,74,0.09)", "rgba(232,184,74,0)"]} style={StyleSheet.absoluteFill} />
      </View>

      <View style={[styles.header, isDesktop && styles.headerWide]}>
        <View style={styles.headerLeft}>
          <View style={styles.tick} />
          <Text style={[styles.title, { color: theme.text }, isDesktop && styles.titleWide]}>My List</Text>
        </View>
        <Text style={[styles.limit, { color: theme.placeholder }]}>
          {lists.length} / {limit} lists · {isPremium ? "Premium" : "Free plan"}
        </Text>
      </View>

      <View style={[styles.createRow, isDesktop && styles.createRowWide]}>
        <TextInput
          ref={nameInputRef}
          value={newName}
          onChangeText={setNewName}
          placeholder="New list name (e.g. Watch later)"
          placeholderTextColor={theme.placeholder}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.card, borderColor: theme.cardBorder },
            isDesktop && styles.inputWide,
          ]}
          maxLength={60}
          editable={!creating}
          returnKeyType="done"
          onSubmitEditing={createList}
        />
        <TouchableOpacity
          style={[
            styles.createBtn,
            atCap && styles.createBtnDisabled,
            isDesktop && styles.createBtnWide,
            isDesktop && createHover && !atCap && styles.createBtnHover,
          ]}
          onPress={createList}
          disabled={creating || !newName.trim()}
          onMouseEnter={isDesktop ? () => setCreateHover(true) : undefined}
          onMouseLeave={isDesktop ? () => setCreateHover(false) : undefined}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={GOLD_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.createGrad, isDesktop && styles.createGradWide]}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#111" />
            ) : (
              <Text style={styles.createBtnText}>Create</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {atCap && !isPremium ? (
        <TouchableOpacity
          style={[styles.upsell, isDesktop && styles.upsellWide]}
          onPress={() => router.push("/profile")}
          activeOpacity={0.8}
        >
          <Ionicons name="sparkles" size={13} color={GOLD} />
          <Text style={styles.upsellText}>Free plan allows 5 lists — Premium unlocks 15</Text>
        </TouchableOpacity>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>Couldn&apos;t load your lists</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload}>
            <Ionicons name="refresh" size={14} color="#111" />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : lists.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={42} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>No lists yet</Text>
          <Text style={[styles.centerText, { color: theme.subtitle }]}>
            Create your first list above, then add titles from any movie page.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, isDesktop && styles.scrollWide]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={GOLD} />}
        >
          {lists.map((list, index) => {
            const armed = armedId === list.id;
            const deleting = deletingId === list.id;
            return (
              <Animated.View key={list.id} entering={FadeInDown.duration(360).delay(Math.min(index * 60, 240))}>
                <TouchableOpacity
                  style={[
                    styles.listCard,
                    { backgroundColor: theme.card, borderColor: armed ? "#FF6B6B" : theme.cardBorder },
                    isDesktop && styles.listCardWide,
                    isDesktop && !armed && hoveredId === list.id && styles.listCardHover,
                  ]}
                  onPress={() => openList(list)}
                  onLongPress={() => setArmedId(armed ? null : list.id)}
                  onMouseEnter={isDesktop ? () => setHoveredId(list.id) : undefined}
                  onMouseLeave={isDesktop ? () => setHoveredId(null) : undefined}
                  activeOpacity={0.85}
                >
                  <View style={styles.listIcon}>
                    <Ionicons name="albums-outline" size={19} color={GOLD} />
                  </View>
                  <View style={styles.listText}>
                    <Text style={[styles.listName, { color: theme.text }, isDesktop && styles.listNameWide]} numberOfLines={1}>
                      {list.name}
                    </Text>
                    <Text style={[styles.listMeta, { color: theme.placeholder }, isDesktop && styles.listMetaWide]}>
                      {list.movie_count === 1 ? "1 title" : `${list.movie_count} titles`}
                    </Text>
                  </View>
                  {armed ? (
                    <View style={styles.armedRow}>
                      <TouchableOpacity
                        style={[styles.armedBtn, styles.deleteBtn]}
                        onPress={confirmDelete}
                        disabled={deleting}
                        activeOpacity={0.85}
                      >
                        {deleting ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.deleteText}>Delete</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.armedBtn, styles.cancelBtn, { borderColor: theme.cardBorder }]}
                        onPress={() => setArmedId(null)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.cancelText, { color: theme.subtitle }]}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={17} color={theme.placeholder} />
                  )}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
          <Text style={[styles.hint, { color: theme.placeholder }, isDesktop && styles.hintWide]}>
            Long-press a list to delete it. Tap a list to see its titles.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  aura: { position: "absolute", top: 0, left: 0, right: 0, height: 220 },

  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headerWide: {
    paddingHorizontal: 40,
    paddingTop: 22,
    paddingBottom: 16,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  tick: { width: 3, height: 15, borderRadius: 2, backgroundColor: GOLD },
  title: { fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  titleWide: { fontSize: 28 },
  limit: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },

  createRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 12 },
  createRowWide: {
    paddingHorizontal: 40,
    marginBottom: 20,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14.5,
    fontWeight: "600",
  },
  inputWide: { height: 50, paddingVertical: 0, paddingHorizontal: 16, fontSize: 15, borderRadius: 16 },
  createBtn: { borderRadius: 14, overflow: "hidden" },
  createBtnWide: { borderRadius: 16 },
  createBtnDisabled: { opacity: 0.45 },
  createBtnHover: { opacity: 0.88 },
  createGrad: { height: 44, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  createGradWide: { height: 50, paddingHorizontal: 24 },
  createBtnText: { color: "#111", fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },

  upsell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(232,184,74,0.4)",
    backgroundColor: "rgba(232,184,74,0.08)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  upsellWide: {
    marginHorizontal: 0,
    maxWidth: CONTENT_MAX_WIDTH - 80,
    alignSelf: "center",
    width: "100%",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  upsellText: { color: GOLD, fontSize: 12.5, fontWeight: "800" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  centerTitle: { fontSize: 17, fontWeight: "800", marginTop: 6, letterSpacing: -0.2 },
  centerText: { fontSize: 13.5, textAlign: "center", lineHeight: 19 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 8,
    backgroundColor: GOLD_GRADIENT[0],
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  retryText: { color: "#111", fontSize: 14, fontWeight: "800" },

  scroll: { paddingHorizontal: 20, paddingBottom: 30, gap: 10 },
  scrollWide: {
    paddingHorizontal: 40,
    paddingBottom: 40,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  listCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  listCardWide: { borderRadius: 18, paddingHorizontal: 18, paddingVertical: 16, gap: 16 },
  listCardHover: { borderColor: "rgba(232,184,74,0.5)" },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(232,184,74,0.4)",
    backgroundColor: "rgba(232,184,74,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  listText: { flex: 1, gap: 3 },
  listName: { fontSize: 15.5, fontWeight: "800" },
  listNameWide: { fontSize: 16.5 },
  listMeta: { fontSize: 11.5, fontWeight: "600" },
  listMetaWide: { fontSize: 12.5 },

  armedRow: { flexDirection: "row", gap: 8 },
  armedBtn: { borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  deleteBtn: { backgroundColor: "#E5484D" },
  deleteText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  cancelBtn: { borderWidth: 1 },
  cancelText: { fontSize: 12.5, fontWeight: "700" },

  hint: { fontSize: 11.5, textAlign: "center", marginTop: 8, lineHeight: 17 },
  hintWide: { fontSize: 12.5, marginTop: 18 },
});
