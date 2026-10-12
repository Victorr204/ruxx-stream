import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GOLD, useTheme } from "../../context/ThemeContext";
import Logos from "../../assets/images/backlogo-transparent.png";
import { SIDEBAR_WIDTH } from "../hooks/useIsDesktop";

const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: "home-outline", activeIcon: "home" },
  { href: "/search", label: "Search", icon: "search-outline", activeIcon: "search" },
  { href: "/mylist", label: "My List", icon: "bookmark-outline", activeIcon: "bookmark" },
  { href: "/downloads", label: "Downloads", icon: "download-outline", activeIcon: "download" },
  { href: "/profile", label: "Profile", icon: "person-outline", activeIcon: "person" },
];

export default function DesktopSidebar() {
  const { theme } = useTheme();
  const pathname = usePathname();

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

      <View style={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <TouchableOpacity
              key={item.href}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => router.push(item.href)}
              activeOpacity={0.8}
              accessible
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              <Ionicons name={active ? item.activeIcon : item.icon} size={20} color={active ? GOLD : theme.subtitle} />
              <Text style={[styles.label, { color: active ? GOLD : theme.text }, active && styles.labelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <View style={[styles.tick, { backgroundColor: GOLD }]} />
        <Text style={[styles.footerText, { color: theme.placeholder }]}>ruxx stream</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: SIDEBAR_WIDTH,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    marginBottom: 32,
  },
  logoRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 22, height: 22 },
  brand: { fontSize: 15, fontWeight: "900", letterSpacing: -0.3 },
  nav: { flex: 1, gap: 4 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  itemActive: { backgroundColor: "rgba(232,184,74,0.08)" },
  label: { fontSize: 13.5, fontWeight: "700", letterSpacing: 0.2 },
  labelActive: { fontWeight: "800" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 16,
  },
  tick: { width: 3, height: 11, borderRadius: 2 },
  footerText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
});
