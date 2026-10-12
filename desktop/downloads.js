// Desktop offline downloads — the Electron-side half of
// src/stores/downloads.ts. The renderer owns the manifest (localStorage);
// the main process owns the bytes: it streams the signed progressive URL
// into <videos>/ruxx-downloads/<id>.enc and hands back the same cipher
// metadata the native apps store in their manifest.
//
// The on-disk format is byte-compatible with src/lib/crypto.ts so every
// rule holds here too: the plain file is split into 4 MiB records, each
// sealed with its own AES-256-GCM invocation under
//   nonce  = 8-byte file prefix || 4-byte big-endian record index,
//   aad    = "ruxx.offline.v1:<movieId>",
// and the per-file key is wrapped under the device master key as
// base64(wrapNonce(12) || ciphertext || tag). The master key is held by
// the OS keystore via Electron safeStorage, so the sealed files are junk
// on any other machine. Playback decrypts to a transient
// <id>.play.<ext> served to <video> through app://offline/, wiped the
// moment the player releases it.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

const {
  FILE_CHUNK_SIZE,
  GCM_TAG_SIZE,
  FILE_KEY_SIZE,
  NONCE_PREFIX_SIZE,
  aadFor,
  wrapFileKey,
  unwrapFileKey,
  sealRecord,
  openRecord,
} = require("./crypto");

const MASTER_KEY_FILE = "offline-master.key";
const PROGRESS_THROTTLE_MS = 250;

let emitProgress = () => {};
/** movieId → AbortController for the in-flight transfer. */
const abortControllers = new Map();
/** movieId → in-flight decrypt-to-playback-copy promise. */
const prepareInflight = new Map();

function downloadsDir() {
  return path.join(app.getPath("videos"), "ruxx-downloads");
}

function encPath(movieId) {
  return path.join(downloadsDir(), `${movieId}.enc`);
}

function playbackPath(movieId, ext) {
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
  return path.join(downloadsDir(), `${movieId}.play.${safeExt}`);
}

/** Device master key: random, sealed with the OS keystore (safeStorage). */
function getOrCreateMasterKey() {
  const file = path.join(app.getPath("userData"), MASTER_KEY_FILE);
  try {
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    const key = crypto.randomBytes(FILE_KEY_SIZE).toString("base64");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
    return key;
  }
}

function sendProgress(movieId, bytesDone, totalBytes) {
  try {
    emitProgress({ movieId, bytesDone, totalBytes });
  } catch (e) {
    console.warn("[downloads] progress emit failed", e);
  }
}

async function removeQuietly(file) {
  try {
    await fs.promises.rm(file, { force: true });
  } catch (e) {
    console.warn("[downloads] remove failed", e);
  }
}

/** Delete a title's sealed file plus any transient playback copies. */
async function removeTitleFiles(movieId) {
  await removeQuietly(encPath(movieId));
  let names = [];
  try {
    names = await fs.promises.readdir(downloadsDir());
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${movieId}.play.`))
      .map((name) => removeQuietly(path.join(downloadsDir(), name)))
  );
}

/**
 * Stream `url` to disk and seal it in one pass (plaintext never lands on
 * disk unencrypted). Resolves to the manifest's cipher metadata.
 */
async function start({ movieId, url }) {
  if (!movieId || typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return { ok: false, code: "error", message: "Invalid download source." };
  }
  cancel(movieId); // clear any stale transfer for this title
  const controller = new AbortController();
  abortControllers.set(movieId, controller);

  let handle = null;
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      return { ok: false, code: "http", message: `Server returned ${response.status}` };
    }
    if (!response.body) throw new Error("Empty response body");

    const totalBytes = Number(response.headers.get("content-length")) || -1;
    const masterKey = getOrCreateMasterKey();
    const fileKey = crypto.randomBytes(FILE_KEY_SIZE);
    const noncePrefix = crypto.randomBytes(NONCE_PREFIX_SIZE);
    const aad = aadFor(movieId);

    await fs.promises.mkdir(downloadsDir(), { recursive: true });
    const target = encPath(movieId);
    await removeQuietly(target);
    handle = await fs.promises.open(target, "w", 0o600);

    let plainBytes = 0;
    let recordIndex = 0;
    let buffered = Buffer.alloc(0);
    let lastProgressAt = 0;

    const writeSealedRecord = async (chunk, index) => {
      const sealed = sealRecord(fileKey, noncePrefix, index, aad, chunk);
      await handle.write(sealed);
      plainBytes += chunk.length;
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        lastProgressAt = now;
        sendProgress(movieId, plainBytes, totalBytes);
      }
    };

    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (controller.signal.aborted) throw new Error("Operation cancelled");
      if (value?.length) buffered = Buffer.concat([buffered, Buffer.from(value)]);
      while (buffered.length >= FILE_CHUNK_SIZE) {
        const record = buffered.subarray(0, FILE_CHUNK_SIZE);
        buffered = buffered.subarray(FILE_CHUNK_SIZE);
        await writeSealedRecord(record, recordIndex);
        recordIndex += 1;
      }
    }
    if (buffered.length > 0) {
      await writeSealedRecord(buffered, recordIndex);
    }

    await handle.close();
    handle = null;
    const cipherBytes = (await fs.promises.stat(target)).size;
    sendProgress(movieId, plainBytes, totalBytes);
    return {
      ok: true,
      cipherKey: wrapFileKey(masterKey, fileKey),
      cipherNonce: noncePrefix.toString("base64"),
      cipherBytes,
      plainBytes,
    };
  } catch (e) {
    if (handle) await handle.close().catch(() => {});
    await removeQuietly(encPath(movieId));
    if (controller.signal.aborted || e?.name === "AbortError") {
      return { ok: false, code: "cancelled" };
    }
    console.warn("[downloads] transfer failed", e);
    return { ok: false, code: "error", message: String(e?.message ?? e) };
  } finally {
    abortControllers.delete(movieId);
  }
}

function cancel(movieId) {
  abortControllers.get(movieId)?.abort();
}

/**
 * Decrypt the sealed file to a transient copy for <video>. The key material
 * comes from the renderer's manifest (same fields native reads), so main
 * never needs its own bookkeeping. Resolves to an app://offline/ URL.
 */
async function preparePlayback({ movieId, ext, cipherKey, cipherNonce, plainBytes }) {
  const existing = prepareInflight.get(movieId);
  if (existing) return existing;
  const task = decryptToPlayback({ movieId, ext, cipherKey, cipherNonce, plainBytes }).finally(
    () => prepareInflight.delete(movieId)
  );
  prepareInflight.set(movieId, task);
  return task;
}

async function decryptToPlayback({ movieId, ext, cipherKey, cipherNonce, plainBytes }) {
  const source = encPath(movieId);
  let stat;
  try {
    stat = await fs.promises.stat(source);
  } catch {
    return null; // sealed file is gone — caller drops the entry
  }

  const target = playbackPath(movieId, ext);
  const targetUrl = `app://offline/${path.posix.basename(target)}`;
  try {
    // Another player may still hold this copy — reuse it.
    const held = await fs.promises.stat(target);
    if (held.size > 0) return targetUrl;
  } catch {
    // no copy yet — make one
  }

  const fileKey = unwrapFileKey(getOrCreateMasterKey(), cipherKey);
  const noncePrefix = Buffer.from(String(cipherNonce), "base64");
  if (noncePrefix.length !== NONCE_PREFIX_SIZE) throw new Error("Offline file key is not readable on this device");
  const aad = aadFor(movieId);

  const src = await fs.promises.open(source, "r");
  const dst = await fs.promises.open(target, "w", 0o600);
  try {
    let remaining = stat.size;
    let index = 0;
    let plainDone = 0;
    while (remaining > 0) {
      const want = Math.min(FILE_CHUNK_SIZE + GCM_TAG_SIZE, remaining);
      if (want <= GCM_TAG_SIZE) throw new Error("Offline file is truncated");
      const record = Buffer.allocUnsafe(want);
      const { bytesRead } = await src.read(record, 0, want, null);
      if (bytesRead !== want) throw new Error("short read while decrypting");
      const chunk = openRecord(fileKey, noncePrefix, index, aad, record);
      await dst.write(chunk);
      remaining -= want;
      plainDone += chunk.length;
      index += 1;
    }
    if (plainDone !== plainBytes) {
      throw new Error("Offline file size does not match its manifest");
    }
    return targetUrl;
  } catch (e) {
    await removeQuietly(target);
    throw e;
  } finally {
    await src.close().catch(() => {});
    await dst.close().catch(() => {});
  }
}

/** Wipe every transient playback copy for a title. */
async function releasePlayback(movieId) {
  let names = [];
  try {
    names = await fs.promises.readdir(downloadsDir());
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${movieId}.play.`))
      .map((name) => removeQuietly(path.join(downloadsDir(), name)))
  );
}

/** IPC wiring: register handlers on the given ipcMain instance. */
function registerIpc(ipcMain, getMainWindow) {
  emitProgress = (payload) => {
    const win = typeof getMainWindow === "function" ? getMainWindow() : getMainWindow;
    win?.webContents?.send("downloads:progress", payload);
  };

  ipcMain.handle("downloads:start", (_event, args) => start(args ?? {}));
  ipcMain.on("downloads:cancel", (_event, args) => cancel(args?.movieId));
  ipcMain.handle("downloads:remove", async (_event, args) => {
    if (!args?.movieId) return;
    cancel(args.movieId);
    await removeTitleFiles(args.movieId);
  });
  ipcMain.handle("downloads:exists", async (_event, args) => {
    const ids = Array.isArray(args?.movieIds) ? args.movieIds : [];
    const present = [];
    for (const movieId of ids) {
      try {
        await fs.promises.stat(encPath(movieId));
        present.push(movieId);
      } catch {
        // missing — reconcileManifest drops it renderer-side
      }
    }
    return present;
  });
  ipcMain.handle("downloads:prepare", (_event, args) =>
    preparePlayback(args ?? {}).catch((e) => {
      console.warn("[downloads] prepare failed", e);
      throw e;
    })
  );
  ipcMain.handle("downloads:release", (_event, args) => {
    if (args?.movieId) return releasePlayback(args.movieId);
    return undefined;
  });
}

module.exports = { registerIpc };
