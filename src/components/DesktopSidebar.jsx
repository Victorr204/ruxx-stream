import { useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GOLD, useTheme } from "../../context/ThemeContext";
import Logos from "../../assets/images/backlogo-transparent.png";
import { SIDEBAR_WIDTH } from "../hooks/useIsDesktop";

// Grouped the way a desktop app groups things: short labelled sections with
// generous hit targets instead of one flat list.
const SECTIONS = [
  {
    label: "Browse",
    items: [
      { href: "/home", label: "Home", icon: "home-outline", activeIcon: "home" },
      { href: "/search", label: "Search", icon: "search-outline", activeIcon: "search" },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/mylist", label: "My List", icon: "bookmark-outline", activeIcon: "bookmark" },
      { href: "/downloads", label: "Downloads", icon: "download-outline", activeIcon: "download" },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/profile", label: "Profile", icon: "person-outline", activeIcon: "person" }],
  },
];

export default function DesktopSidebar() {
  const { theme } = useTheme();
  const pathname = usePathname();
  const [hovered, setHovered] = useState(null);

  return (
    <View style={[styles.root, { backgroundColor: theme.card, borderRightColor: theme.cardBorder }]}>
      <View style={styles.brandRow}>
        <View style={styles.logoRing}>
          <Image source={Logos} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={[styles.brand, { color: theme.text }]}>
          ruxx <Text style={{ color: GOLD }}>stream</Text>
        </Text>
      </View>

      <View style={styles.sections}>
        {SECTIONS.map((section) => (
          <View key={section.label} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.placeholder }]}>{section.label}</Text>
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const isHovered = hovered === item.href;
              return (
                <TouchableOpacity
                  key={item.href}
                  style={[
                    styles.item,
                    { backgroundColor: active ? "rgba(232,184,74,0.10)" : isHovered ? "rgba(255,255,255,0.05)" : "transparent" },
                  ]}
                  onPress={() => router.push(item.href)}
                  onMouseEnter={() => setHovered(item.href)}
                  onMouseLeave={() => setHovered(null)}
                  activeOpacity={0.8}
                  accessible
                  accessibilityRole="link"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.label}
                >
                  {/* Active marker: a gold rail on the left edge of the pill */}
                  <View style={[styles.rail, active && styles.railOn]} />
                  <Ionicons name={active ? item.activeIcon : item.icon} size={18} color={active ? GOLD : theme.subtitle} />
                  <Text style={[styles.label, { color: active ? GOLD : theme.text }]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <View style={[styles.footer, { borderTopColor: theme.cardBorder }]}>
        <View style={styles.tick} />
        <Text style={[styles.footerText, { color: theme.placeholder }]}>Ruxx Digital Services</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: SIDEBAR_WIDTH,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 14,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 8,
    marginBottom: 26,
  },
  logoRing: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.55)",
    backgroundColor: "rgba(232,184,74,0.08)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 22, height: 22 },
  brand: { fontSize: 16, fontWeight: "900", letterSpacing: -0.3 },

  sections: { flex: 1, gap: 22 },
  section: { gap: 3 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    paddingHorizontal: 10,
    marginBottom: 7,
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 11,
    overflow: "hidden",
  },
  rail: {
    position: "absolute",
    left: 0,
    top: "25%",
    bottom: "25%",
    width: 3,
    borderRadius: 3,
    backgroundColor: "transparent",
  },
  railOn: { backgroundColor: GOLD },
  label: { fontSize: 13.5, fontWeight: "700", letterSpacing: 0.2 },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tick: { width: 3, height: 11, borderRadius: 2, backgroundColor: GOLD },
  footerText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
});
