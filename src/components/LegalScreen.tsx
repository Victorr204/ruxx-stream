import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTheme } from "../../context/ThemeContext";

export type LegalSection = {
  heading: string;
  body: string[];
};

type Props = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
};

/** Shared chrome for the Terms / Privacy routes: back bar + long-form text. */
export default function LegalScreen({ title, updated, intro, sections }: Props) {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={[styles.backBtn, { backgroundColor: theme.card }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={19} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <Text style={[styles.updated, { color: theme.placeholder }]}>Last updated {updated}</Text>
          <Text style={[styles.intro, { color: theme.subtitle }]}>{intro}</Text>

          {sections.map((section, index) => (
            <View key={section.heading} style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.heading, { color: theme.text }]}>
                {index + 1}. {section.heading}
              </Text>
              {section.body.map((paragraph) => (
                <Text key={paragraph} style={[styles.paragraph, { color: theme.subtitle }]}>
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}

          <Text style={[styles.foot, { color: theme.placeholder }]}>
            Questions about this document? Reach us from the Profile screen.
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  scroll: { paddingHorizontal: 16, paddingBottom: 44, gap: 12 },
  updated: {
    fontSize: 11.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  intro: { fontSize: 14, lineHeight: 21, marginBottom: 4 },
  card: { borderRadius: 18, padding: 16, gap: 9 },
  heading: { fontSize: 14.5, fontWeight: "800" },
  paragraph: { fontSize: 13.5, lineHeight: 20.5 },
  foot: { fontSize: 12, textAlign: "center", marginTop: 6, lineHeight: 18 },
});
