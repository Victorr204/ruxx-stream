// Offline-download cryptography: per-file AES-256-GCM record format and
// key wrapping. Pure TypeScript (no React Native imports) so node:test
// covers it (src/lib/crypto.test.mjs) — the downloads store supplies the
// file handles.
//
// Format: a plain file is split into FILE_CHUNK_SIZE records; each record
// is sealed with its own one-shot GCM invocation, nonce = 8-byte random
// file prefix (kept in the manifest) || 4-byte big-endian record index,
// AAD = "ruxx.offline.v1:<movieId>". That binds every record to its file
// and position, so truncation, reordering or grafting another file's
// records all fail verification. The file itself carries no header — the
// manifest is the source of truth for key, nonce prefix and plain size.
//
// The per-file AES key is random, wrapped (encrypted) with the
// device master key from expo-secure-store and stored back in the
// manifest as base64(wrapNonce || sealedKey).

import { gcm } from "@noble/ciphers/aes.js";

export const FILE_CHUNK_SIZE = 4 * 1024 * 1024;
export const FILE_KEY_SIZE = 32;
export const FILE_NONCE_PREFIX_SIZE = 8;
export const WRAP_NONCE_SIZE = 12;
export const GCM_TAG_SIZE = 16;

const AAD_DOMAIN = "ruxx.offline.v1";
const FILE_KEY_AAD = `${AAD_DOMAIN}:filekey`;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const b0 = bytes[i];
    const b1 = remaining > 1 ? bytes[i + 1] : -1;
    const b2 = remaining > 2 ? bytes[i + 2] : -1;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)];
    out += b1 < 0 ? "=" : B64_ALPHABET[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)];
    out += b2 < 0 ? "=" : B64_ALPHABET[b2 & 63];
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = B64_ALPHABET.indexOf(clean[i]);
    if (value < 0) throw new Error("invalid base64");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
  }
  return out;
}

/** UTF-8 encoder — RN's Hermes has no global TextEncoder. */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

export function aadFor(movieId: string): Uint8Array {
  return utf8Bytes(`${AAD_DOMAIN}:${movieId}`);
}

function recordNonce(prefix: Uint8Array, index: number): Uint8Array {
  const nonce = new Uint8Array(prefix.length + 4);
  nonce.set(prefix, 0);
  // Big-endian record index — wraps only after 2^32 records (16 PiB).
  nonce[prefix.length] = (index >>> 24) & 0xff;
  nonce[prefix.length + 1] = (index >>> 16) & 0xff;
  nonce[prefix.length + 2] = (index >>> 8) & 0xff;
  nonce[prefix.length + 3] = index & 0xff;
  return nonce;
}

/** Wrap (encrypt) a random file key with the device master key. */
export function wrapFileKey(
  masterKey: Uint8Array,
  fileKey: Uint8Array,
  wrapNonce: Uint8Array,
): string {
  const sealed = gcm(masterKey, wrapNonce, utf8Bytes(FILE_KEY_AAD)).encrypt(fileKey);
  const packed = new Uint8Array(wrapNonce.length + sealed.length);
  packed.set(wrapNonce, 0);
  packed.set(sealed, wrapNonce.length);
  return bytesToBase64(packed);
}

/** Unwrap a file key; throws when the master key or blob is wrong. */
export function unwrapFileKey(masterKey: Uint8Array, packed: string): Uint8Array {
  const blob = base64ToBytes(packed);
  if (blob.length <= WRAP_NONCE_SIZE) throw new Error("corrupt wrapped key");
  const wrapNonce = blob.slice(0, WRAP_NONCE_SIZE);
  const sealed = blob.slice(WRAP_NONCE_SIZE);
  try {
    return gcm(masterKey, wrapNonce, utf8Bytes(FILE_KEY_AAD)).decrypt(sealed);
  } catch {
    throw new Error("Offline file key is not readable on this device");
  }
}

export type ByteSource = {
  /** Returns exactly `length` bytes unless EOF is hit (then fewer/empty). */
  read(length: number): Uint8Array;
};

export type ByteSink = {
  write(chunk: Uint8Array): void;
};

export type SealOptions = {
  source: ByteSource;
  sink: ByteSink;
  /** Plain size in bytes. */
  plainBytes: number;
  fileKey: Uint8Array;
  noncePrefix: Uint8Array;
  aad: Uint8Array;
  onProgress?: (fraction: number) => void;
  shouldAbort?: () => boolean;
};

function abortError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

/** Encrypt plain → records, writing them sequentially into the sink. */
export async function sealFile(options: SealOptions): Promise<void> {
  const { source, sink, plainBytes, fileKey, noncePrefix, aad } = options;
  let processed = 0;
  let index = 0;
  while (processed < plainBytes) {
    if (options.shouldAbort?.()) throw abortError();
    const want = Math.min(FILE_CHUNK_SIZE, plainBytes - processed);
    const chunk = source.read(want);
    if (chunk.length !== want) throw new Error("short read while encrypting");
    const sealed = gcm(fileKey, recordNonce(noncePrefix, index), aad).encrypt(chunk);
    sink.write(sealed);
    processed += want;
    index += 1;
    options.onProgress?.(processed / plainBytes);
  }
}

export type OpenOptions = SealOptions & {
  /** Cipher size in bytes (records only — no header). */
  cipherBytes: number;
  /** Expected plain size; a mismatch means the file was truncated or padded. */
  plainBytes: number;
};

/** Decrypt records → plain; verifies size against `plainBytes`. */
export async function openFile(options: OpenOptions): Promise<void> {
  const { source, sink, cipherBytes, plainBytes, fileKey, noncePrefix, aad } = options;
  if (cipherBytes <= GCM_TAG_SIZE) throw new Error("Offline file is empty or truncated");
  let remaining = cipherBytes;
  let plainDone = 0;
  let index = 0;
  while (remaining > 0) {
    if (options.shouldAbort?.()) throw abortError();
    const want = Math.min(FILE_CHUNK_SIZE + GCM_TAG_SIZE, remaining);
    if (want <= GCM_TAG_SIZE) throw new Error("Offline file is truncated");
    const record = source.read(want);
    if (record.length !== want) throw new Error("short read while decrypting");
    let chunk: Uint8Array;
    try {
      chunk = gcm(fileKey, recordNonce(noncePrefix, index), aad).decrypt(record);
    } catch {
      throw new Error("Offline file is corrupted or was modified");
    }
    sink.write(chunk);
    remaining -= want;
    plainDone += chunk.length;
    index += 1;
    options.onProgress?.((cipherBytes - remaining) / cipherBytes);
  }
  if (plainDone !== plainBytes) {
    throw new Error("Offline file size does not match its manifest");
  }
}
