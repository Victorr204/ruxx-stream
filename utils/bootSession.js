import AsyncStorage from '@react-native-async-storage/async-storage';

// Result of the cold-start boot check (see app/_layout.tsx). Resolved once
// while the splash is up so the first screen can be chosen without another
// network round trip. Kept in memory (fast path) and mirrored to AsyncStorage
// so a slow boot can fall back to the target from the previous launch.
let boot = null;

const KEY_TARGET = 'boot:targetUrl';

// Merge a patch into the boot cache and persist the target subset.
export const setBootSession = (patch) => {
  boot = { ...(boot || {}), ...patch };
  try {
    if (Object.prototype.hasOwnProperty.call(patch, 'targetUrl')) {
      AsyncStorage.setItem(KEY_TARGET, patch.targetUrl || '').catch(() => {});
    }
  } catch (_e) {}
  return boot;
};

export const getBootSession = () => boot;

// Slow-boot fallback: recover the target persisted by the previous launch when
// the in-memory copy is missing (cold start). Best-effort — a failure here just
// means the caller decides the first screen on its own.
export const readPersistedBootTarget = async () => {
  try {
    const target = await AsyncStorage.getItem(KEY_TARGET);
    return target || '';
  } catch (_e) {
    return '';
  }
};

// Called when the session goes away (sign-out or expiry) so a stale target
// from a signed-in boot can never reroute a signed-out app.
export const clearBootSession = () => {
  boot = null;
  AsyncStorage.removeItem(KEY_TARGET).catch(() => {});
};
