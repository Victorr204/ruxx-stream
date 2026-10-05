import AsyncStorage from '@react-native-async-storage/async-storage';

// Result of the cold-start boot check (see app/_layout.jsx). Resolved once
// while the splash is up so the first screen can be chosen without another
// network round trip, and so verify-pin can fire the biometric prompt instantly.
// Kept in memory (fast path) and mirrored to AsyncStorage so a slow boot can
// fall back to the flags from the previous launch.
let boot = null;

const KEY_USER_ID = 'boot:userId';
const KEY_HAS_PIN = 'boot:hasPin';
const KEY_USE_BIOMETRIC = 'boot:useBiometric';
const FLAG_KEYS = [KEY_USER_ID, KEY_HAS_PIN, KEY_USE_BIOMETRIC];

const parseFlag = (value) => (value === '1' ? true : value === '0' ? false : null);

// Merge a patch into the boot cache and persist the flag subset.
export const setBootSession = (patch) => {
  boot = { ...(boot || {}), ...patch };
  try {
    const pairs = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'userId')) {
      pairs.push([KEY_USER_ID, patch.userId || '']);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'hasPin')) {
      pairs.push([KEY_HAS_PIN, patch.hasPin ? '1' : '0']);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'useBiometric')) {
      pairs.push([KEY_USE_BIOMETRIC, patch.useBiometric ? '1' : '0']);
    }
    if (pairs.length) AsyncStorage.multiSet(pairs).catch(() => {});
  } catch (_e) {}
  return boot;
};

export const getBootSession = () => boot;

export const clearBootSession = () => {
  boot = null;
  AsyncStorage.multiRemove(FLAG_KEYS).catch(() => {});
};

// Flags from the last successful boot / last PIN change. Used to pick the
// first screen and to trigger biometrics without waiting on the network.
export const readCachedFlags = async () => {
  try {
    const entries = await AsyncStorage.multiGet(FLAG_KEYS);
    const map = {};
    for (const entry of entries) map[entry[0]] = entry[1];
    return {
      userId: map[KEY_USER_ID] || null,
      hasPin: parseFlag(map[KEY_HAS_PIN]),
      useBiometric: parseFlag(map[KEY_USE_BIOMETRIC]),
    };
  } catch (_e) {
    return { userId: null, hasPin: null, useBiometric: null };
  }
};

// User doc for a given user if the boot gate already fetched it, else null.
export const getCachedUserDoc = (userId) => {
  if (!boot || !userId) return null;
  if (boot.userId && boot.userId !== userId) return null;
  const doc = boot.userDoc || null;
  if (doc && doc.userId && doc.userId !== userId) return null;
  return doc;
};
