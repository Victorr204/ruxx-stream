import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import AppAlert from "../../../utils/AppAlert";
import {
  fetchGrants,
  fetchMovieTitles,
  fetchProfileSummaries,
  grantDownloadToUser,
  revokeDownloadFromUser,
  type GrantRecord,
  type MovieTitle,
  type ProfileSummary,
} from "../../lib/admin";

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  type: "info" | "error";
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

type PickerProps = {
  visible: boolean;
  title: string;
  searchText: string;
  onSearch: (value: string) => void;
  items: { key: string; label: string; hint?: string }[];
  onSelect: (key: string) => void;
  onClose: () => void;
  emptyText: string;
};

function Picker({ visible, title, searchText, onSearch, items, onSelect, onClose, emptyText }: PickerProps) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.pickerRoot, { backgroundColor: theme.background }]}>
        <View style={styles.pickerHeader}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={[styles.pickerAction, { color: theme.subtitle }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.pickerTitle, { color: theme.text }]}>{title}</Text>
          <View style={{ width: 46 }} />
        </View>

        <View style={[styles.searchBox, { backgroundColor: theme.card, borderColor: theme.inputBorder }]}>
          <Ionicons name="search" size={15} color={theme.placeholder} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={searchText}
            onChangeText={onSearch}
            placeholder="Search…"
            placeholderTextColor={theme.placeholder}
            autoFocus
          />
        </View>

        <ScrollView contentContainerStyle={styles.pickerList}>
          {items.length === 0 ? (
            <Text style={[styles.pickerEmpty, { color: theme.placeholder }]}>{emptyText}</Text>
          ) : (
            items.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.pickerItem, { backgroundColor: theme.card }]}
                onPress={() => onSelect(item.key)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerItemLabel, { color: theme.text }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text style={[styles.pickerItemHint, { color: theme.placeholder }]} numberOfLines={1}>
                      {item.hint}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.placeholder} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

type GrantRowProps = {
  grant: GrantRecord;
  armed: boolean;
  busy: boolean;
  onRevoke: (grant: GrantRecord) => void;
};

function GrantRowItem({ grant, armed, busy, onRevoke }: GrantRowProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.grantCard, { backgroundColor: theme.card }]}>
      <View style={[styles.grantIcon, { backgroundColor: "rgba(232,184,74,0.10)" }]}>
        <Ionicons name="download-outline" size={16} color={GOLD} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.grantTitle, { color: theme.text }]} numberOfLines={1}>
          {grant.movie_title ?? `Movie ${shortId(grant.movie_id)}`}
        </Text>
        <Text style={[styles.grantMeta, { color: theme.placeholder }]} numberOfLines={1}>
          {(grant.profile_name || `User ${shortId(grant.user_id)}`) + " · " + formatDate(grant.granted_at)}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.revokeBtn, armed && styles.revokeBtnArmed]}
        onPress={() => onRevoke(grant)}
        disabled={busy}
        activeOpacity={0.7}
        accessibilityLabel={armed ? "Confirm revoke" : "Revoke download"}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <>
            <Ionicons name={armed ? "alert" : "close-circle-outline"} size={15} color="#ef4444" />
            <Text style={styles.revokeText}>{armed ? "Confirm" : "Revoke"}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function GrantsPanel() {
  const { theme } = useTheme();
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [movies, setMovies] = useState<MovieTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [moviePickerOpen, setMoviePickerOpen] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [movieQuery, setMovieQuery] = useState("");
  const [granting, setGranting] = useState(false);
  const [armedRevoke, setArmedRevoke] = useState<string | null>(null);
  const [busyRevoke, setBusyRevoke] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertState>({ visible: false, title: "", message: "", type: "info" });

  const showAlert = useCallback((title: string, message: string, type: AlertState["type"] = "info") => {
    setAlert({ visible: true, title, message, type });
  }, []);

  const fetchAll = useCallback(
    () => Promise.all([fetchGrants(), fetchProfileSummaries(), fetchMovieTitles()]),
    []
  );

  const load = useCallback(async () => {
    try {
      const [grantRows, profileRows, movieRows] = await fetchAll();
      setGrants(grantRows);
      setProfiles(profileRows);
      setMovies(movieRows);
    } catch (e) {
      showAlert("Grants", e instanceof Error ? e.message : "Could not load download grants.", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchAll, showAlert]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(([grantRows, profileRows, movieRows]) => {
        if (cancelled) return;
        setGrants(grantRows);
        setProfiles(profileRows);
        setMovies(movieRows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        showAlert("Grants", e instanceof Error ? e.message : "Could not load download grants.", "error");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll, showAlert]);

  const selectedUser = profiles.find((profile) => profile.id === selectedUserId) ?? null;
  const selectedMovie = movies.find((movie) => movie.id === selectedMovieId) ?? null;
  const alreadyGranted =
    !!selectedUser && !!selectedMovie
      ? grants.some((grant) => grant.user_id === selectedUser.id && grant.movie_id === selectedMovie.id)
      : false;

  const handleGrant = async () => {
    if (!selectedUser || !selectedMovie) {
      showAlert("Grants", "Pick a user and a movie first.");
      return;
    }
    setGranting(true);
    try {
      await grantDownloadToUser(selectedUser.id, selectedMovie.id);
      setSelectedUserId(null);
      setSelectedMovieId(null);
      await load();
      showAlert("Grants", `"${selectedMovie.title}" granted.`);
    } catch (e) {
      showAlert("Grants", e instanceof Error ? e.message : "Could not grant the download.", "error");
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (grant: GrantRecord) => {
    const key = `${grant.user_id}:${grant.movie_id}`;
    if (armedRevoke !== key) {
      setArmedRevoke(key);
      return;
    }
    setArmedRevoke(null);
    setBusyRevoke(key);
    try {
      await revokeDownloadFromUser(grant.user_id, grant.movie_id);
      setGrants((rows) => rows.filter((row) => `${row.user_id}:${row.movie_id}` !== key));
    } catch (e) {
      showAlert("Grants", e instanceof Error ? e.message : "Could not revoke the download.", "error");
    } finally {
      setBusyRevoke(null);
    }
  };

  const userItems = profiles
    .filter((profile) => {
      const needle = userQuery.trim().toLowerCase();
      if (!needle) return true;
      return (
        (profile.display_name ?? "").toLowerCase().includes(needle) ||
        profile.id.toLowerCase().includes(needle)
      );
    })
    .map((profile) => ({
      key: profile.id,
      label: profile.display_name || `Unnamed (${shortId(profile.id)})`,
      hint: `${profile.role}${profile.is_premium ? " · premium" : ""} · ${shortId(profile.id)}`,
    }));

  const movieItems = movies
    .filter((movie) => {
      const needle = movieQuery.trim().toLowerCase();
      return !needle || movie.title.toLowerCase().includes(needle);
    })
    .map((movie) => ({ key: movie.id, label: movie.title }));

  const renderGrant = (item: GrantRecord) => {
    const key = `${item.user_id}:${item.movie_id}`;
    return (
      <GrantRowItem
        key={key}
        grant={item}
        armed={armedRevoke === key}
        busy={busyRevoke === key}
        onRevoke={handleRevoke}
      />
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
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Grant a download</Text>

        <TouchableOpacity
          style={[styles.pickerField, { borderColor: theme.inputBorder }]}
          onPress={() => setUserPickerOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="person-outline" size={15} color={GOLD} />
          <Text style={[styles.pickerFieldText, { color: selectedUser ? theme.text : theme.placeholder }]} numberOfLines={1}>
            {selectedUser
              ? selectedUser.display_name || `Unnamed (${shortId(selectedUser.id)})`
              : "Choose a user"}
          </Text>
          <Ionicons name="chevron-down" size={15} color={theme.placeholder} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pickerField, { borderColor: theme.inputBorder }]}
          onPress={() => setMoviePickerOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="film-outline" size={15} color={GOLD} />
          <Text style={[styles.pickerFieldText, { color: selectedMovie ? theme.text : theme.placeholder }]} numberOfLines={1}>
            {selectedMovie ? selectedMovie.title : "Choose a movie"}
          </Text>
          <Ionicons name="chevron-down" size={15} color={theme.placeholder} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.grantBtn,
            { backgroundColor: GOLD, opacity: granting || alreadyGranted ? 0.5 : 1 },
          ]}
          onPress={() => void handleGrant()}
          disabled={granting || alreadyGranted}
          activeOpacity={0.8}
        >
          {granting ? (
            <ActivityIndicator size="small" color="#111" />
          ) : (
            <Text style={styles.grantBtnText}>{alreadyGranted ? "Already granted" : "Grant download"}</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.placeholder }]}>
        Active grants · {grants.length}
      </Text>

      <ScrollView contentContainerStyle={styles.list}>
        {grants.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="key-outline" size={32} color={theme.placeholder} />
            <Text style={[styles.emptyText, { color: theme.placeholder }]}>
              No download grants yet.
            </Text>
          </View>
        ) : (
          grants.map((grant) => renderGrant(grant))
        )}
      </ScrollView>

      <Picker
        visible={userPickerOpen}
        title="Choose a user"
        searchText={userQuery}
        onSearch={setUserQuery}
        items={userItems}
        onSelect={(id) => {
          setSelectedUserId(id);
          setUserPickerOpen(false);
        }}
        onClose={() => setUserPickerOpen(false)}
        emptyText="No users match."
      />

      <Picker
        visible={moviePickerOpen}
        title="Choose a movie"
        searchText={movieQuery}
        onSearch={setMovieQuery}
        items={movieItems}
        onSelect={(id) => {
          setSelectedMovieId(id);
          setMoviePickerOpen(false);
        }}
        onClose={() => setMoviePickerOpen(false)}
        emptyText="No movies match."
      />

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
  root: { flex: 1, paddingHorizontal: 16, gap: 10 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 13, textAlign: "center" },

  card: { borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: "900" },

  pickerField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  pickerFieldText: { flex: 1, fontSize: 13, fontWeight: "600" },

  grantBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 2,
  },
  grantBtnText: { fontSize: 13, fontWeight: "900", color: "#111" },

  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginLeft: 2,
    marginTop: 4,
  },

  list: { paddingBottom: 40, gap: 10 },

  grantCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 14,
    padding: 12,
  },
  grantIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  grantTitle: { fontSize: 13, fontWeight: "800" },
  grantMeta: { fontSize: 11, marginTop: 2 },

  revokeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  revokeBtnArmed: { backgroundColor: "rgba(239,68,68,0.2)", borderColor: "#ef4444" },
  revokeText: { fontSize: 11, fontWeight: "800", color: "#ef4444" },

  pickerRoot: { flex: 1 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  pickerTitle: { fontSize: 16, fontWeight: "900" },
  pickerAction: { fontSize: 14, fontWeight: "700", width: 46 },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginHorizontal: 18,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },

  pickerList: { paddingHorizontal: 18, paddingBottom: 32, gap: 8 },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 13,
    padding: 13,
  },
  pickerItemLabel: { fontSize: 14, fontWeight: "700" },
  pickerItemHint: { fontSize: 11, marginTop: 2 },
  pickerEmpty: { fontSize: 13, textAlign: "center", paddingVertical: 30 },
});
