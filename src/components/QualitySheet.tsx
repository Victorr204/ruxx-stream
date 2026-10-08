import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { GOLD, useTheme } from "../../context/ThemeContext";
import { bitRateLabel, type QualityLevel } from "../lib/quality";

type Props = {
  visible: boolean;
  /** Highest → lowest. */
  levels: QualityLevel[];
  auto: boolean;
  currentHeight: number | null;
  /** null selects Auto (engine picks the level itself). */
  onSelect: (height: number | null) => void;
  onClose: () => void;
};

function levelMeta(level: QualityLevel): string {
  const bitrate = bitRateLabel(level.bitrate);
  if (bitrate) return bitrate;
  if (level.width && level.height) return `${level.width}×${level.height}`;
  return "Video track";
}

export default function QualitySheet({
  visible,
  levels,
  auto,
  currentHeight,
  onSelect,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const maxLabel = levels.length > 0 ? levels[0].label : null;

  const renderRow = (
    key: string,
    label: string,
    meta: string,
    selected: boolean,
    onPress: () => void
  ) => (
    <TouchableOpacity
      key={key}
      style={[
        styles.row,
        { borderColor: selected ? "rgba(232,184,74,0.45)" : theme.cardBorder },
        selected && styles.rowActive,
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={21}
        color={selected ? GOLD : theme.placeholder}
      />
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.placeholder }]}>{meta}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
          accessibilityLabel="Close"
        />
        <Animated.View
          entering={FadeInDown.duration(240)}
          style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerTick} />
              <Text style={[styles.title, { color: theme.text }]}>Quality</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={theme.subtitle} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
            {renderRow(
              "auto",
              "Auto",
              maxLabel ? `Best fit up to ${maxLabel}` : "Let the player decide",
              auto,
              () => onSelect(null)
            )}
            {levels.map((level) =>
              renderRow(
                level.id,
                level.label,
                levelMeta(level),
                !auto && level.height === currentHeight,
                () => onSelect(level.height)
              )
            )}
          </ScrollView>
        </Animated.View>
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
  rows: { maxHeight: 400 },
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
  rowActive: { backgroundColor: "rgba(232,184,74,0.07)" },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 14.5, fontWeight: "800" },
  rowMeta: { fontSize: 11, fontWeight: "600" },
});
