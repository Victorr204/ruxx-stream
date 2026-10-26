import { Modal, Platform, StyleSheet, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";

type Props = {
  url: string;
  onClose: () => void;
};

// TMDb hands back YouTube trailer links, but expo-video only plays direct media
// (mp4 / HLS) — feed it a youtube.com/watch URL and it just sits in an error
// state. YouTube links are therefore embedded instead, and everything else
// keeps using the native player exactly as before.
function youTubeIdOf(url: string): string | null {
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /\/embed\/([A-Za-z0-9_-]{6,})/,
    /\/shorts\/([A-Za-z0-9_-]{6,})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function TrailerEmbed({ videoId }: { videoId: string }) {
  // nocookie domain + no related videos: this plays inside your own app, so it
  // should not advertise someone else's catalogue at the end.
  const source = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;

  if (Platform.OS === "web") {
    return (
      <iframe
        src={source}
        title="Trailer"
        style={styles.frame}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }

  return (
    <WebView
      source={{ uri: source }}
      style={styles.frame}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
    />
  );
}

export default function TrailerModal({ url, onClose }: Props) {
  const player = useVideoPlayer(url, (instance) => {
    instance.play();
  });
  const [ready, setReady] = useState(false);
  const youTubeId = youTubeIdOf(url);

  useEffect(() => {
    if (player.status !== "readyToPlay") return undefined;
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, [player.status]);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {youTubeId ? (
          <TrailerEmbed videoId={youTubeId} />
        ) : (
          <>
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
          </>
        )}
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
  // absoluteFillObject isn't in this RN version's types, so spell the box out.
  frame: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 0,
    borderColor: "transparent",
  },
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
