import { useAuthStore } from "../stores/auth";
import { desktopPremiumLocked, isDesktopShell } from "../lib/platform";

/**
 * True when the premium-only desktop app must block playback for the
 * current account (signed out, or no active premium — admins bypass).
 *
 * Always false outside the desktop shell, so the website, mobile and TV
 * builds keep the free, ad-supported model untouched. The auth store is
 * still booting (`initialized === false`) this returns false too, so a
 * premium member never sees the wall flash for a frame at cold start.
 */
export function useDesktopPremiumLock(): boolean {
  const initialized = useAuthStore((s) => s.initialized);
  const profile = useAuthStore((s) => s.profile);
  if (!isDesktopShell()) return false;
  if (!initialized) return false;
  return desktopPremiumLocked(profile);
}
