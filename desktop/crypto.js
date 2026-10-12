// Pure-Node half of the desktop download crypto — no Electron imports, so
// node:test can verify byte-compatibility with the renderer's
// src/lib/crypto.ts (desktop/crypto.compat.test.mjs does exactly that).
//
// Record format (identical to src/lib/crypto.ts): the plain file is split
// into FILE_CHUNK_SIZE records; each is sealed with its own AES-256-GCM
// invocation under nonce = 8-byte file prefix || 4-byte big-endian record
// index, AAD = "ruxx.offline.v1:<movieId>". The per-file key is wrapped
// under the device master key as base64(wrapNonce(12) || ciphertext || tag).

const crypto = require("crypto");

const FILE_CHUNK_SIZE = 4 * 1024 * 1024;
const GCM_TAG_SIZE = 16;
const FILE_KEY_SIZE = 32;
const NONCE_PREFIX_SIZE = 8;
const WRAP_NONCE_SIZE = 12;
const AAD_DOMAIN = "ruxx.offline.v1";

function recordNonce(prefix, index) {
  const nonce = Buffer.allocUnsafe(prefix.length + 4);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(index >>> 0, prefix.length);
  return nonce;
}

function aadFor(movieId) {
  return Buffer.from(`${AAD_DOMAIN}:${movieId}`, "utf8");
}

/** Wrap a per-file key under the master key: base64(nonce || sealed). */
function wrapFileKey(masterKeyBase64, fileKey) {
  const wrapNonce = crypto.randomBytes(WRAP_NONCE_SIZE);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(masterKeyBase64, "base64"),
    wrapNonce
  );
  cipher.setAAD(Buffer.from(`${AAD_DOMAIN}:filekey`, "utf8"));
  const sealed = Buffer.concat([cipher.update(fileKey), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([wrapNonce, sealed]).toString("base64");
}

/** Unwrap a file key; throws when the master key or blob is wrong. */
function unwrapFileKey(masterKeyBase64, packed) {
  const blob = Buffer.from(String(packed), "base64");
  if (blob.length <= WRAP_NONCE_SIZE) throw new Error("corrupt wrapped key");
  const wrapNonce = blob.subarray(0, WRAP_NONCE_SIZE);
  const sealed = blob.subarray(WRAP_NONCE_SIZE);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(masterKeyBase64, "base64"),
    wrapNonce
  );
  decipher.setAAD(Buffer.from(`${AAD_DOMAIN}:filekey`, "utf8"));
  decipher.setAuthTag(sealed.subarray(sealed.length - GCM_TAG_SIZE));
  return Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - GCM_TAG_SIZE)),
    decipher.final(),
  ]);
}

/** Seal one record: returns ciphertext || tag (no header). */
function sealRecord(fileKey, noncePrefix, index, aad, chunk) {
  const cipher = crypto.createCipheriv("aes-256-gcm", fileKey, recordNonce(noncePrefix, index));
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(chunk), cipher.final(), cipher.getAuthTag()]);
}

/** Open one record; throws on truncation, corruption, or the wrong key. */
function openRecord(fileKey, noncePrefix, index, aad, record) {
  if (record.length <= GCM_TAG_SIZE) throw new Error("Offline file is truncated");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    fileKey,
    recordNonce(noncePrefix, index)
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(record.subarray(record.length - GCM_TAG_SIZE));
  return Buffer.concat([
    decipher.update(record.subarray(0, record.length - GCM_TAG_SIZE)),
    decipher.final(),
  ]);
}

module.exports = {
  FILE_CHUNK_SIZE,
  GCM_TAG_SIZE,
  FILE_KEY_SIZE,
  NONCE_PREFIX_SIZE,
  WRAP_NONCE_SIZE,
  recordNonce,
  aadFor,
  wrapFileKey,
  unwrapFileKey,
  sealRecord,
  openRecord,
};
