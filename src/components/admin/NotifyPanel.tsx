import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../../context/ThemeContext";
import AppAlert from "../../../utils/AppAlert";
import { getSupabase } from "../../lib/supabase";

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  type: "info" | "error" | "success";
};

type SendResult = {
  sent?: number;
  failed?: number;
  total?: number;
  error?: string;
};

const MAX_TITLE = 100;
const MAX_BODY = 300;

export default function NotifyPanel() {
  const { theme } = useTheme();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<AlertState>({
    visible: false,
    title: "",
    message: "",
    type: "info",
  });

  const showAlert = (next: AlertState) => setAlert(next);

  const handleSend = async () => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) {
      showAlert({ visible: true, title: "Notify", message: "Give the announcement a title.", type: "error" });
      return;
    }
    if (trimmedTitle.length > MAX_TITLE) {
      showAlert({
        visible: true,
        title: "Notify",
        message: `Title must be at most ${MAX_TITLE} characters.`,
        type: "error",
      });
      return;
    }
    if (trimmedBody.length > MAX_BODY) {
      showAlert({
        visible: true,
        title: "Notify",
        message: `Message must be at most ${MAX_BODY} characters.`,
        type: "error",
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await getSupabase().functions.invoke("send-push", {
        body: { title: trimmedTitle, body: trimmedBody },
      });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as SendResult;
      if (result.error) throw new Error(result.error);

      const total = result.total ?? 0;
      if (total === 0) {
        showAlert({
          visible: true,
          title: "Notify",
          message: "No devices are registered for push yet — ask members to enable notifications on their Profile.",
          type: "info",
        });
        return;
      }
      const failedNote = result.failed ? `, ${result.failed} failed` : "";
      showAlert({
        visible: true,
        title: "Announcement sent",
        message: `Delivered to ${result.sent ?? 0} device(s)${failedNote} of ${total} registered.`,
        type: "success",
      });
      if ((result.sent ?? 0) > 0) {
        setTitle("");
        setBody("");
      }
    } catch (e) {
      showAlert({
        visible: true,
        title: "Notify",
        message: e instanceof Error ? e.message : "Could not send the announcement.",
        type: "error",
      });
    } finally {
      setSending(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.card, color: theme.text, borderColor: theme.inputBorder },
  ];

  return (
    <View style={styles.root}>
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <View style={styles.headerRow}>
          <View style={[styles.iconWrap, { backgroundColor: "rgba(232,184,74,0.10)" }]}>
            <Ionicons name="send-outline" size={17} color={GOLD} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>Broadcast announcement</Text>
            <Text style={[styles.hint, { color: theme.placeholder }]}>
              Pushes to every device that enabled notifications
            </Text>
          </View>
        </View>

        <Text style={[styles.label, { color: theme.placeholder }]}>Title *</Text>
        <TextInput
          style={inputStyle}
          value={title}
          onChangeText={setTitle}
          placeholder="New arrivals this week"
          placeholderTextColor={theme.placeholder}
          maxLength={MAX_TITLE}
        />

        <Text style={[styles.label, { color: theme.placeholder }]}>Message</Text>
        <TextInput
          style={[inputStyle, styles.bodyInput]}
          value={body}
          onChangeText={setBody}
          placeholder="Five new titles just landed — tap to browse."
          placeholderTextColor={theme.placeholder}
          multiline
          textAlignVertical="top"
          maxLength={MAX_BODY}
        />
        <Text style={[styles.counter, { color: theme.placeholder }]}>
          {title.length}/{MAX_TITLE} · {body.length}/{MAX_BODY}
        </Text>

        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: GOLD, opacity: sending ? 0.6 : 1 }]}
          onPress={() => void handleSend()}
          disabled={sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#111" />
          ) : (
            <>
              <Ionicons name="paper-plane-outline" size={15} color="#111" />
              <Text style={styles.sendText}>Send announcement</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

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
  root: { paddingHorizontal: 16, gap: 10 },
  card: { borderRadius: 16, padding: 16, gap: 8 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 4 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontWeight: "900" },
  hint: { fontSize: 11, marginTop: 2 },

  label: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  bodyInput: { minHeight: 96, paddingTop: 10 },
  counter: { fontSize: 11, textAlign: "right" },

  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 6,
  },
  sendText: { fontSize: 13, fontWeight: "900", color: "#111" },
});
