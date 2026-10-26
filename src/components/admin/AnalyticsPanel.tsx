import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import AppAlert from "../../../utils/AppAlert";
import { fetchAdminStats, fetchAdminUsers } from "../../lib/admin";
import type { AdminStats, AdminUserRow } from "../../lib/admin";

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  type: "info" | "error";
};

const STALE_AFTER = Date.now() - 30 * 86_400_000;

/** Formats a naira amount with grouping and no decimals for large sums. */
function naira(value: number | null | undefined): string {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const rounded = Math.round(amount);
  return `₦${rounded.toLocaleString("en-NG")}`;
}

function StatTile({ label, value, icon, accent }: { label: string; value: string | number; icon: keyof typeof Ionicons.glyphMap; accent?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.card }, accent && styles.tileAccent]}>
      <View style={[styles.tileIcon, accent && styles.tileIconAccent]}>
        <Ionicons name={icon} size={15} color={accent ? "#111" : GOLD} />
      </View>
      <Text style={[styles.tileValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.tileLabel, { color: theme.placeholder }]}>{label}</Text>
    </View>
  );
}

export default function AnalyticsPanel() {
  const { theme } = useTheme();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [alert, setAlert] = useState<AlertState>({ visible: false, title: "", message: "", type: "info" });

  const showAlert = useCallback((title: string, message: string, type: AlertState["type"] = "info") => {
    setAlert({ visible: true, title, message, type });
  }, []);

  const loadAll = useCallback(() => {
    Promise.all([fetchAdminStats(), fetchAdminUsers()])
      .then(([statsRow, userRows]) => {
        setStats(statsRow);
        setUsers(userRows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        showAlert("Analytics", e instanceof Error ? e.message : "Could not load analytics.", "error");
        setLoading(false);
      });
  }, [showAlert]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = users.filter((user) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (user.display_name ?? "").toLowerCase().includes(q) ||
      (user.email ?? "").toLowerCase().includes(q)
    );
  });

  // Share of all accounts that currently pay. Guarded against a zero
  // denominator so an empty platform reads as 0% rather than NaN.
  const totalUsers = stats?.users_total ?? 0;
  const conversion = totalUsers > 0 ? Math.round(((stats?.premium_users ?? 0) / totalUsers) * 100) : 0;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

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

      <Text style={[styles.sectionTitle, { color: theme.placeholder }]}>Revenue</Text>
      <View style={styles.tiles}>
        <StatTile label="Total made" value={naira(stats?.revenue_total_naira)} icon="cash-outline" accent />
        <StatTile label="Last 30 days" value={naira(stats?.revenue_30d_naira)} icon="calendar-outline" accent />
        <StatTile label="Last 90 days" value={naira(stats?.revenue_90d_naira)} icon="calendar-clear-outline" />
        <StatTile label="Avg charge" value={naira(stats?.avg_charge_naira)} icon="pricetag-outline" />
        <StatTile label="Charges" value={stats?.charges_total ?? 0} icon="card-outline" />
        <StatTile label="Payers" value={stats?.paying_customers ?? 0} icon="person-add-outline" />
      </View>

      <Text style={[styles.sectionTitle, { color: theme.placeholder }]}>Subscribers</Text>
      <View style={styles.tiles}>
        <StatTile label="Active premium" value={stats?.premium_users ?? 0} icon="diamond-outline" accent />
        <StatTile label="Total accounts" value={stats?.users_total ?? 0} icon="people-outline" />
        <StatTile label="New (30d)" value={stats?.new_users_30d ?? 0} icon="person-add-outline" />
        <StatTile label="Churn events (30d)" value={stats?.churn_events_30d ?? 0} icon="person-remove-outline" />
        <StatTile label="Charges (30d)" value={stats?.charges_30d ?? 0} icon="card-outline" />
        <StatTile label="Conversion" value={`${conversion}%`} icon="pie-chart-outline" />
      </View>

      <Text style={[styles.sectionTitle, { color: theme.placeholder }]}>Engagement</Text>
      <View style={styles.tiles}>
        <StatTile label="Plays (30d)" value={stats?.plays_30d ?? 0} icon="play-outline" />
        <StatTile label="Ad impressions (30d)" value={stats?.ad_impressions_30d ?? 0} icon="megaphone-outline" />
      </View>

      <View style={[styles.searchBox, { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={theme.placeholder} />
        <TextInput
          style={[styles.searchInput, { color: theme.inputText }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by name or email…"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {filtered.map((user) => {
        const signedIn = user.last_sign_in ? new Date(user.last_sign_in) : null;
        const stale = !signedIn || signedIn.getTime() < STALE_AFTER;
        return (
          <View key={user.id} style={[styles.userRow, { backgroundColor: theme.card }]}>
            <View style={[styles.userIcon, { backgroundColor: user.is_premium ? "rgba(232,184,74,0.14)" : "rgba(255,255,255,0.06)" }]}>
              <Ionicons
                name={user.is_premium ? "diamond" : "person-outline"}
                size={15}
                color={user.is_premium ? GOLD : theme.placeholder}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.userName, { color: theme.text }]} numberOfLines={1}>
                {user.display_name || user.email || user.id.slice(0, 8)}
              </Text>
              <Text style={[styles.userMeta, { color: theme.placeholder }]} numberOfLines={1}>
                {[user.email, user.role].filter(Boolean).join(" • ")}
              </Text>
            </View>
            <View style={styles.userRight}>
              <Text style={[styles.userDate, { color: stale ? theme.placeholder : theme.subtitle }]}>
                {signedIn ? signedIn.toLocaleDateString() : "Never"}
              </Text>
              {user.is_premium && (
                <View style={[styles.premiumChip, { backgroundColor: GOLD }]}>
                  <Text style={styles.premiumChipText}>PREMIUM</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}

      {filtered.length === 0 && (
        <Text style={[styles.empty, { color: theme.placeholder }]}>No accounts match that filter.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },

  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    textTransform: "uppercase",
    marginTop: 6,
  },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 100,
    borderRadius: 16,
    padding: 13,
    gap: 6,
  },
  tileAccent: { borderWidth: 1, borderColor: "rgba(232,184,74,0.45)" },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(232,184,74,0.10)",
  },
  tileIconAccent: { backgroundColor: GOLD },
  tileValue: { fontSize: 19, fontWeight: "900", letterSpacing: -0.3 },
  tileLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4 },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
    marginTop: 8,
  },
  searchInput: { flex: 1, fontSize: 14, height: 40, padding: 0 },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 14,
    padding: 12,
  },
  userIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  userName: { fontSize: 14, fontWeight: "800" },
  userMeta: { fontSize: 11.5, marginTop: 1 },
  userRight: { alignItems: "flex-end", gap: 4 },
  userDate: { fontSize: 11, fontWeight: "600" },
  premiumChip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  premiumChipText: { fontSize: 8.5, fontWeight: "900", letterSpacing: 0.8, color: "#111" },

  empty: { fontSize: 13, textAlign: "center", paddingVertical: 24 },
});
