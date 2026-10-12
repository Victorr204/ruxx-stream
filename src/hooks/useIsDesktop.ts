import { Platform, useWindowDimensions } from "react-native";

export const DESKTOP_BREAKPOINT = 1024;
export const SIDEBAR_WIDTH = 232;
export const CONTENT_MAX_WIDTH = 1280;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  if (Platform.isTV) return false;
  if (typeof width !== "number" || width <= 0) return false;
  return width >= DESKTOP_BREAKPOINT;
}

export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  const safe = typeof width === "number" && width > 0 ? width : 0;
  const desktop = !Platform.isTV && safe >= DESKTOP_BREAKPOINT;
  const available = desktop ? safe - SIDEBAR_WIDTH : safe;
  return Math.min(available, CONTENT_MAX_WIDTH) || safe;
}
