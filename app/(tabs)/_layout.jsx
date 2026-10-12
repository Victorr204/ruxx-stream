import { View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD } from "../../context/ThemeContext";
import DesktopSidebar from "../../src/components/DesktopSidebar";
import { useIsDesktop } from "../../src/hooks/useIsDesktop";

export default function TabsLayout() {
  const { theme } = useTheme();
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.background }}>
        <DesktopSidebar />
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: GOLD,
              tabBarInactiveTintColor: theme.placeholder,
              tabBarStyle: { display: "none" },
              tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
            }}
          >
            <Tabs.Screen name="home" options={{ title: "Home" }} />
            <Tabs.Screen name="search" options={{ title: "Search" }} />
            <Tabs.Screen name="mylist" options={{ title: "My List" }} />
            <Tabs.Screen name="downloads" options={{ title: "Downloads" }} />
            <Tabs.Screen name="profile" options={{ title: "Profile" }} />
          </Tabs>
        </View>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: theme.placeholder,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: "rgba(255,255,255,0.08)",
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mylist"
        options={{
          title: "My List",
          tabBarIcon: ({ color, size }) => <Ionicons name="bookmark-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: "Downloads",
          tabBarIcon: ({ color, size }) => <Ionicons name="download-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
