import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from "react-native";

function ErrorFallback({ message, onRetry }) {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const bg = dark ? "#0b0f1a" : "#ffffff";
  const titleC = dark ? "#f3f4f6" : "#111111";
  const bodyC = dark ? "#9ca3af" : "#666666";
  const btnBg = dark ? "#3b82f6" : "#2563eb";

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Text style={[styles.title, { color: titleC }]}>Something went wrong</Text>
      <Text style={[styles.message, { color: bodyC }]}>{message}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: btnBg }]}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry after error"
      >
        <Text style={styles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Something went wrong" };
  }

  componentDidCatch(error) {
    if (__DEV__) {
      console.error("ErrorBoundary:", error);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, message: "" });
    if (this.props.onRetry) this.props.onRetry();
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback message={this.state.message} onRetry={this.handleReload} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 24,
  },
  title: { fontSize: 20, fontWeight: "700", color: "#111", marginBottom: 8 },
  message: { fontSize: 14, color: "#666", textAlign: "center", marginBottom: 20 },
  button: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
