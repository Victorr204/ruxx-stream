import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { GOLD, useTheme } from "../../context/ThemeContext";

type Props = {
  visible: boolean;
  speed: number;
  onSelect: (rate: number) => void;
  onClose: () => void;
};

const SPEED_ROWS: { rate: number; hint: string }[] = [
  { rate: 0.5, hint: "Half speed" },
  { rate: 0.75, hint: "Slower" },
  { rate: 1, hint: "Normal" },
  { rate: 1.25, hint: "Slightly fast" },
  { rate: 1.5, hint: "Fast" },
  { rate: 2, hint: "Double speed" },
];

export default function SpeedSheet({ visible, speed, onSelect, onClose }: Props) {
  const { theme } = useTheme();

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
              <Text style={[styles.title, { color: theme.text }]}>Playback speed</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={theme.subtitle} />
            </TouchableOpacity>
          </View>

          <View style={styles.rows}>
            {SPEED_ROWS.map((row) => {
              const selected = row.rate === speed;
              return (
                <TouchableOpacity
                  key={row.rate}
                  style={[
                    styles.row,
                    { borderColor: selected ? "rgba(232,184,74,0.45)" : theme.cardBorder },
                    selected && styles.rowActive,
                  ]}
                  onPress={() => onSelect(row.rate)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.rate} times speed`}
                >
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={21}
                    color={selected ? GOLD : theme.placeholder}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: theme.text }]}>
                      {row.rate === 1 ? "Normal (1×)" : `${row.rate}×`}
                    </Text>
                    <Text style={[styles.rowMeta, { color: theme.placeholder }]}>{row.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
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
  rows: { gap: 9 },
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
