import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Switch, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import AppAlert from "../../../utils/AppAlert";
import {
  fetchAdSettings,
  fetchAdUnits,
  saveAdSettings,
  saveAdUnit,
  type AdminAdSettings,
  type AdminAdUnit,
} from "../../lib/admin";
import { useAdsConfig } from "../../stores/adsConfig";

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  type: "info" | "error";
};

const DEFAULT_SETTINGS: AdminAdSettings = {
  pre_roll_enabled: true,
  mid_roll_enabled: true,
  banner_enabled: true,
  mid_roll_interval_seconds: 300,
  fail_open: true,
};

const PLACEMENT_LABELS: Record<string, string> = {
  pre_roll: "Pre-roll",
  mid_roll: "Mid-roll",
  banner: "Banner",
  rewarded: "Rewarded",
};

const UNIT_FIELDS = ["android_unit_id", "ios_unit_id", "web_unit_id", "tv_unit_id"] as const;

type UnitField = (typeof UNIT_FIELDS)[number];

function sameUnit(a: AdminAdUnit, b: AdminAdUnit): boolean {
  return UNIT_FIELDS.every((field) => (a[field] ?? "") === (b[field] ?? "")) && a.enabled === b.enabled;
}

export default function AdsPanel() {
  const { theme } = useTheme();
  const [settings, setSettings] = useState<AdminAdSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<AdminAdSettings>(DEFAULT_SETTINGS);
  const [units, setUnits] = useState<AdminAdUnit[]>([]);
  const [savedUnits, setSavedUnits] = useState<AdminAdUnit[]>([]);
  const [intervalText, setIntervalText] = useState("300");
  const [savedIntervalText, setSavedIntervalText] = useState("300");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPlacement, setSavingPlacement] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertState>({ visible: false, title: "", message: "", type: "info" });

  const showAlert = useCallback((title: string, message: string, type: AlertState["type"] = "info") => {
    setAlert({ visible: true, title, message, type });
  }, []);

  const fetchAll = useCallback(() => Promise.all([fetchAdSettings(), fetchAdUnits()]), []);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(([settingsRow, unitRows]) => {
        if (cancelled) return;
        const next = settingsRow ?? DEFAULT_SETTINGS;
        setSettings(next);
        setSavedSettings(next);
        setIntervalText(String(next.mid_roll_interval_seconds));
        setSavedIntervalText(String(next.mid_roll_interval_seconds));
        setUnits(unitRows);
        setSavedUnits(unitRows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        showAlert("Ads", e instanceof Error ? e.message : "Could not load ad configuration.", "error");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll, showAlert]);

  const settingsDirty =
    JSON.stringify(settings) !== JSON.stringify(savedSettings) || intervalText !== savedIntervalText;

  const handleSaveSettings = async () => {
    const interval = Number.parseInt(intervalText.trim(), 10);
    if (!Number.isFinite(interval) || interval < 30) {
      showAlert("Ads", "Mid-roll interval must be at least 30 seconds.");
      return;
    }
    setSavingSettings(true);
    try {
      const next: AdminAdSettings = { ...settings, mid_roll_interval_seconds: interval };
      await saveAdSettings(next);
      setSettings(next);
      setSavedSettings(next);
      setIntervalText(String(interval));
      setSavedIntervalText(String(interval));
      await useAdsConfig.getState().load(true);
      showAlert("Ads", "Ad settings saved.");
    } catch (e) {
      showAlert("Ads", e instanceof Error ? e.message : "Could not save ad settings.", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const patchUnit = (placement: string, patch: Partial<AdminAdUnit>) => {
    setUnits((rows) => rows.map((row) => (row.placement === placement ? { ...row, ...patch } : row)));
  };

  const handleSaveUnit = async (placement: string) => {
    const unit = units.find((row) => row.placement === placement);
    if (!unit) return;
    setSavingPlacement(placement);
    try {
      await saveAdUnit(unit);
      setSavedUnits((rows) => rows.map((row) => (row.placement === placement ? unit : row)));
      await useAdsConfig.getState().load(true);
      showAlert("Ads", `${PLACEMENT_LABELS[placement] ?? placement} unit saved.`);
    } catch (e) {
      showAlert("Ads", e instanceof Error ? e.message : "Could not save the ad unit.", "error");
    } finally {
      setSavingPlacement(null);
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
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Playback ads</Text>

        {(
          [
            ["pre_roll_enabled", "Pre-roll", "Before playback starts"],
            ["mid_roll_enabled", "Mid-roll", "Cue points during playback"],
            ["banner_enabled", "Banner", "Browse surfaces (mobile)"],
            ["fail_open", "Fail open", "Ad failure resumes content immediately"],
          ] as [keyof AdminAdSettings, string, string][]
        ).map(([key, label, hint], index, all) => {
          const isBool = typeof settings[key] === "boolean";
          if (!isBool) return null;
          return (
            <View key={key} style={[styles.settingRow, index === all.length - 1 && styles.settingRowLast]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: theme.text }]}>{label}</Text>
                <Text style={[styles.settingHint, { color: theme.placeholder }]}>{hint}</Text>
              </View>
              <Switch
                value={Boolean(settings[key])}
                onValueChange={(value) => setSettings((prev) => ({ ...prev, [key]: value }))}
                trackColor={{ true: GOLD, false: "rgba(255,255,255,0.15)" }}
                thumbColor="#f4f4f5"
              />
            </View>
          );
        })}

        <View style={[styles.settingRow, styles.settingRowLast]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Mid-roll interval</Text>
            <Text style={[styles.settingHint, { color: theme.placeholder }]}>
              Seconds between cues (min 30)
            </Text>
          </View>
          <TextInput
            style={[styles.intervalInput, inputStyle]}
            value={intervalText}
            onChangeText={setIntervalText}
            keyboardType="number-pad"
            placeholder="300"
            placeholderTextColor={theme.placeholder}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.saveBtn,
            { backgroundColor: GOLD, opacity: !settingsDirty || savingSettings ? 0.5 : 1 },
          ]}
          onPress={handleSaveSettings}
          disabled={!settingsDirty || savingSettings}
          activeOpacity={0.8}
        >
          {savingSettings ? (
            <ActivityIndicator size="small" color="#111" />
          ) : (
            <Text style={styles.saveBtnText}>Save settings</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.placeholder }]}>Ad units (AdMob ids)</Text>

      {units.map((unit) => {
        const original = savedUnits.find((row) => row.placement === unit.placement);
        const dirty = !original || !sameUnit(unit, original);
        const busy = savingPlacement === unit.placement;
        return (
          <View key={unit.placement} style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.unitHeader}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {PLACEMENT_LABELS[unit.placement] ?? unit.placement}
              </Text>
              <Switch
                value={unit.enabled}
                onValueChange={(value) => patchUnit(unit.placement, { enabled: value })}
                trackColor={{ true: GOLD, false: "rgba(255,255,255,0.15)" }}
                thumbColor="#f4f4f5"
              />
            </View>

            <View style={styles.unitGrid}>
              {(UNIT_FIELDS as readonly UnitField[]).map((field) => (
                <View key={field} style={styles.unitField}>
                  <Text style={[styles.unitFieldLabel, { color: theme.placeholder }]}>
                    {field.replace("_unit_id", "").toUpperCase()}
                  </Text>
                  <TextInput
                    style={inputStyle}
                    value={unit[field] ?? ""}
                    onChangeText={(value) => patchUnit(unit.placement, { [field]: value })}
                    placeholder="ca-app-pub-…"
                    placeholderTextColor={theme.placeholder}
                    autoCapitalize="none"
                  />
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.unitSave,
                { borderColor: dirty ? GOLD : theme.inputBorder, opacity: busy ? 0.6 : 1 },
              ]}
              onPress={() => void handleSaveUnit(unit.placement)}
              disabled={!dirty || busy}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator size="small" color={GOLD} />
              ) : (
                <Ionicons name="save-outline" size={15} color={dirty ? GOLD : theme.placeholder} />
              )}
              <Text style={[styles.unitSaveText, { color: dirty ? GOLD : theme.placeholder }]}>
                {dirty ? "Save unit" : "Saved"}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 48 },

  card: { borderRadius: 16, padding: 14, gap: 4 },
  cardTitle: { fontSize: 14, fontWeight: "900", marginBottom: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 2,
    marginLeft: 2,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingLabel: { fontSize: 13, fontWeight: "800" },
  settingHint: { fontSize: 11, marginTop: 1 },

  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  intervalInput: { width: 74, textAlign: "center" },

  saveBtn: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 13, fontWeight: "900", color: "#111" },

  unitHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  unitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  unitField: { width: "47%", gap: 4 },
  unitFieldLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },

  unitSave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 9,
    marginTop: 10,
  },
  unitSaveText: { fontSize: 12, fontWeight: "800" },
});
