import React from "react";
import { View, Text, TouchableOpacity, Modal } from "react-native";
import { useTheme } from "../context/ThemeContext";

const FALLBACK_THEME = {
  modalOverlay: "rgba(0,0,0,0.5)",
  card: "#ffffff",
  text: "#000000",
  subtitle: "#555555",
};

export default function AppAlert({ visible, title, message, type = "error", onClose, theme }) {
  const ctx = useTheme();
  const t = theme || ctx?.theme || FALLBACK_THEME;
  const colorMap = {
    error: "#FF3B30",
    success: "#34C759",
    info: "#007AFF",
  };
  const accent = colorMap[type] || colorMap.error;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 30, backgroundColor: t.modalOverlay || "rgba(0,0,0,0.5)" }}>
        <View style={{ width: "100%", borderRadius: 20, padding: 28, alignItems: "center", backgroundColor: t.card || "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center", marginBottom: 16, backgroundColor: accent + "18" }}>
            <Text style={{ fontSize: 26, fontWeight: "700", color: accent }}>
              {type === "success" ? "✓" : type === "info" ? "i" : "!"}
            </Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8, textAlign: "center", color: t.text || "#000" }}>{title}</Text>
          <Text style={{ fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24, color: t.subtitle || "#888" }}>{message}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={{ width: "100%", paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: accent }}
            activeOpacity={0.8}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
