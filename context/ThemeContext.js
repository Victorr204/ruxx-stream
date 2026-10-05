import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";

const ThemeContext = createContext();

// ── Brand tokens (match login / register / PIN screens) ──
export const GOLD = "#e8b84a";
export const GOLD_GRADIENT = ["#f0c75e", "#e8b84a", "#d4a030"];
export const HERO_GRADIENT = ["#0a0a0a", "#16120a", "#0a0a0a"];
export const BG = "#0a0a0a";
export const BG_DEEP = "#050505";
export const CARD = "rgba(20,20,20,0.92)";
export const CARD_BORDER = "rgba(255,255,255,0.06)";
export const INPUT_BG = "rgba(255,255,255,0.04)";
export const INPUT_BORDER = "rgba(255,255,255,0.14)";
export const TEXT = "#ffffff";
export const TEXT_MUTED = "rgba(255,255,255,0.62)";
export const TEXT_DIM = "rgba(255,255,255,0.40)";
export const LABEL = "rgba(255,255,255,0.72)";

const darkTheme = {
  background: BG,
  text: TEXT,
  subtitle: TEXT_MUTED,
  placeholder: TEXT_DIM,
  label: LABEL,
  gray: "#333333",
  card: CARD,
  cardBorder: CARD_BORDER,
  border: "rgba(255,255,255,0.10)",
  inputBackground: INPUT_BG,
  inputBorder: INPUT_BORDER,
  inputText: TEXT,
  primary: GOLD,
  secondary: GOLD_GRADIENT[2],
  accent: GOLD,
  gold: GOLD,
  goldGradient: GOLD_GRADIENT,
  heroGradient: HERO_GRADIENT,
  danger: "#ef4444",
  success: "#16a34a",
  warning: "#f59e0b",
  shadow: "#000000",
  selectedBackground: GOLD,
  selectedText: "#111111",
  buttonBackground: GOLD,
  buttonText: "#111111",
  buttonBg: GOLD,
  modalOverlay: "rgba(0,0,0,0.6)",
  modalBg: "#141414",
  pageBg: BG,
  sectionBg: "#141414",
  alertText: "#111111",
  cardBackground: "#141414",
  chipBg: INPUT_BG,
  chipText: TEXT,
  chipSelectedBg: GOLD,
  chipSelectedText: "#111111",
  icon: GOLD,
  airtime: TEXT,
  fundbg: "#141414",
  ftext: TEXT,
  ttext: TEXT,
  itext: "#111111",
  scard: CARD,
};

const lightTheme = {
  background: "#f6f6f6",
  text: "#111111",
  subtitle: "#555555",
  placeholder: "#777777",
  label: "#333333",
  gray: "#e8e8e8",
  card: "#ffffff",
  cardBorder: "#e8e8e8",
  border: "#d9d9d9",
  inputBackground: "#ffffff",
  inputBorder: "#d1d5db",
  inputText: "#111111",
  primary: GOLD,
  secondary: GOLD_GRADIENT[2],
  accent: GOLD,
  gold: GOLD,
  goldGradient: GOLD_GRADIENT,
  heroGradient: ["#f6f6f6", "#f4ecd8", "#f6f6f6"],
  danger: "#ef4444",
  success: "#16a34a",
  warning: "#f59e0b",
  shadow: "#000000",
  selectedBackground: GOLD,
  selectedText: "#111111",
  buttonBackground: GOLD,
  buttonText: "#111111",
  buttonBg: GOLD,
  modalOverlay: "rgba(0,0,0,0.4)",
  modalBg: "#ffffff",
  pageBg: "#f6f6f6",
  sectionBg: "#ffffff",
  alertText: "#111111",
  cardBackground: "#ffffff",
  chipBg: "#ececec",
  chipText: "#111111",
  chipSelectedBg: GOLD,
  chipSelectedText: "#111111",
  icon: GOLD,
  airtime: "#111111",
  fundbg: "#ffffff",
  ftext: "#111111",
  ttext: "#111111",
  itext: "#111111",
  scard: "#ffffff",
};

export const ThemeProvider = ({ children }) => {
  const [mode, setMode] = useState("dark");
  const [systemScheme, setSystemScheme] = useState(() => Appearance.getColorScheme() || "light");

  useEffect(() => {
    let cancelled = false;
    const loadTheme = async () => {
      try {
        const savedMode = await AsyncStorage.getItem("themeMode");
        const initialMode = savedMode || "system";
        if (!cancelled) {
          setMode(initialMode);
        }
      } catch (_e) {
        if (!cancelled) setMode("dark");
      }
    };
    loadTheme();
    const listener = Appearance.addChangeListener(() => {
      if (!cancelled) {
        setSystemScheme(Appearance.getColorScheme() || "light");
      }
    });
    return () => {
      cancelled = true;
      listener.remove();
    };
  }, []);

  const theme = useMemo(() => {
    if (mode === "system") return systemScheme === "dark" ? darkTheme : lightTheme;
    return mode === "dark" ? darkTheme : lightTheme;
  }, [mode, systemScheme]);

  const value = useMemo(() => ({ mode, setMode, theme }), [mode, theme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () =>
  useContext(ThemeContext) || { mode: "dark", setMode: () => {}, theme: darkTheme };
