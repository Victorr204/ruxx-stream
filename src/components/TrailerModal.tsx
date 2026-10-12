import { Modal, StyleSheet, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";

type Props = {
  url: string;
  onClose: () => void;
};

export default function TrailerModal({ url, onClose }: Props) {
  const player = useVideoPlayer(url, (instance) => {
    instance.play();
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (player.status !== "readyToPlay") return;
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, [player.status]);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          nativeControls
          contentFit="contain"
          allowsPictureInPicture={false}
          startsPictureInPictureAutomatically={false}
        />
        {!ready ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.close}
          onPress={onClose}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Close trailer"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  close: {
    position: "absolute",
    top: 48,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
});
