// The scanner engine itself lives in `transcribe.web.tsx` — the hidden iframe
// / WebView target, bundled only for web. Expo Router's static manifest still
// needs a platform-neutral file for the route, so native resolves this stub
// (web prefers the .web sibling) and nothing heavy enters the native bundle.

import { Text, View } from "react-native";

export default function TranscribeRoute() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>
        The subtitle scanner runs inside the app, not as a page you can open.
      </Text>
    </View>
  );
}

const styles = {
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0b0b0f",
  },
  text: {
    color: "#8b8b96",
    fontSize: 14,
    textAlign: "center",
  },
} as const;
