import assert from "node:assert/strict";
import test from "node:test";

import {
  FILE_CHUNK_SIZE,
  FILE_KEY_SIZE,
  FILE_NONCE_PREFIX_SIZE,
  WRAP_NONCE_SIZE,
  base64ToBytes,
  bytesToBase64,
  openFile,
  sealFile,
  unwrapFileKey,
  utf8Bytes,
  wrapFileKey,
} from "./crypto.ts";

const MASTER = new Uint8Array(FILE_KEY_SIZE).fill(7);
const WRONG_MASTER = new Uint8Array(FILE_KEY_SIZE).fill(9);
const FILE_KEY = new Uint8Array(FILE_KEY_SIZE).fill(3);
const NONCE_PREFIX = new Uint8Array(FILE_NONCE_PREFIX_SIZE).fill(5);
const AAD = utf8Bytes("ruxx.offline.v1:movie-1");

function memorySource(bytes) {
  let offset = 0;
  return {
    read(length) {
      const chunk = bytes.slice(offset, offset + length);
      offset += chunk.length;
      return chunk;
    },
  };
}

function memorySink() {
  const parts = [];
  return {
    parts,
    write(chunk) {
      parts.push(chunk.slice());
    },
    bytes() {
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    },
  };
}

async function roundtrip(plain) {
  const sealedSink = memorySink();
  await sealFile({
    source: memorySource(plain),
    sink: sealedSink,
    plainBytes: plain.length,
    fileKey: FILE_KEY,
    noncePrefix: NONCE_PREFIX,
    aad: AAD,
  });
  const sealed = sealedSink.bytes();

  const openSink = memorySink();
  await openFile({
    source: memorySource(sealed),
    sink: openSink,
    plainBytes: plain.length,
    cipherBytes: sealed.length,
    fileKey: FILE_KEY,
    noncePrefix: NONCE_PREFIX,
    aad: AAD,
  });
  return { sealed, opened: openSink.bytes() };
}

test("base64 round-trips every byte alignment", () => {
  for (const length of [0, 1, 2, 3, 4, 255, 256]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes, `length ${length}`);
  }
});

test("utf8Bytes encodes ASCII, multibyte and surrogate pairs", () => {
  assert.deepEqual(utf8Bytes("abc"), new Uint8Array([97, 98, 99]));
  assert.deepEqual(utf8Bytes("é"), new Uint8Array([0xc3, 0xa9]));
  assert.deepEqual(utf8Bytes("€"), new Uint8Array([0xe2, 0x82, 0xac]));
  assert.deepEqual(utf8Bytes("🎬"), new Uint8Array([0xf0, 0x9f, 0x8e, 0xac]));
});

test("file key wrap/unwrap round-trips and rejects the wrong master key", () => {
  const wrapNonce = new Uint8Array(WRAP_NONCE_SIZE).fill(1);
  const packed = wrapFileKey(MASTER, FILE_KEY, wrapNonce);
  assert.deepEqual(unwrapFileKey(MASTER, packed), FILE_KEY);
  assert.throws(() => unwrapFileKey(WRONG_MASTER, packed), /not readable/);
  assert.throws(() => unwrapFileKey(MASTER, bytesToBase64(new Uint8Array([1, 2]))), /corrupt/);
});

test("seal/open round-trips across chunk boundaries", async () => {
  const sizes = [1, 10, FILE_CHUNK_SIZE, FILE_CHUNK_SIZE + 5, 2 * FILE_CHUNK_SIZE + 1];
  for (const size of sizes) {
    const plain = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) plain[i] = (i * 13 + 1) & 0xff;
    const { sealed, opened } = await roundtrip(plain);
    assert.deepEqual(opened, plain, `size ${size}`);
    // 8-byte prefix-free records: each plain chunk adds a 16-byte tag.
    const records = Math.ceil(size / FILE_CHUNK_SIZE);
    assert.equal(sealed.length, size + records * 16, `sealed size ${size}`);
  }
});

test("tampered ciphertext fails verification", async () => {
  const plain = new Uint8Array(64).fill(42);
  const { sealed } = await roundtrip(plain);
  const tampered = sealed.slice();
  tampered[20] ^= 0xff;
  await assert.rejects(
    openFile({
      source: memorySource(tampered),
      sink: memorySink(),
      plainBytes: plain.length,
      cipherBytes: tampered.length,
      fileKey: FILE_KEY,
      noncePrefix: NONCE_PREFIX,
      aad: AAD,
    }),
    /corrupted/
  );
});

test("records from another movie do not decrypt (AAD binding)", async () => {
  const plain = new Uint8Array(32).fill(1);
  const sealedSink = memorySink();
  await sealFile({
    source: memorySource(plain),
    sink: sealedSink,
    plainBytes: plain.length,
    fileKey: FILE_KEY,
    noncePrefix: NONCE_PREFIX,
    aad: utf8Bytes("ruxx.offline.v1:movie-2"),
  });
  const sealed = sealedSink.bytes();
  await assert.rejects(
    openFile({
      source: memorySource(sealed),
      sink: memorySink(),
      plainBytes: plain.length,
      cipherBytes: sealed.length,
      fileKey: FILE_KEY,
      noncePrefix: NONCE_PREFIX,
      aad: AAD,
    }),
    /corrupted/
  );
});

test("truncated or padded files fail the size check", async () => {
  const plain = new Uint8Array(FILE_CHUNK_SIZE + 100).fill(6);
  const { sealed } = await roundtrip(plain);

  const truncated = sealed.slice(0, sealed.length - 10);
  await assert.rejects(
    openFile({
      source: memorySource(truncated),
      sink: memorySink(),
      plainBytes: plain.length,
      cipherBytes: truncated.length,
      fileKey: FILE_KEY,
      noncePrefix: NONCE_PREFIX,
      aad: AAD,
    }),
    /truncated|corrupted/
  );

  const padded = new Uint8Array(sealed.length + 16);
  padded.set(sealed, 0);
  await assert.rejects(
    openFile({
      source: memorySource(padded),
      sink: memorySink(),
      plainBytes: plain.length,
      cipherBytes: padded.length,
      fileKey: FILE_KEY,
      noncePrefix: NONCE_PREFIX,
      aad: AAD,
    }),
    /does not match|corrupted/
  );
});

test("shouldAbort stops seal/open mid-flight", async () => {
  const plain = new Uint8Array(FILE_CHUNK_SIZE * 2).fill(8);
  const { sealed } = await roundtrip(plain);
  await assert.rejects(
    sealFile({
      source: memorySource(plain),
      sink: memorySink(),
      plainBytes: plain.length,
      fileKey: FILE_KEY,
      noncePrefix: NONCE_PREFIX,
      aad: AAD,
      shouldAbort: () => true,
    }),
    (error) => error.name === "AbortError"
  );
  await assert.rejects(
    openFile({
      source: memorySource(sealed),
      sink: memorySink(),
      plainBytes: plain.length,
      cipherBytes: sealed.length,
      fileKey: FILE_KEY,
      noncePrefix: NONCE_PREFIX,
      aad: AAD,
      shouldAbort: () => true,
    }),
    (error) => error.name === "AbortError"
  );
});
