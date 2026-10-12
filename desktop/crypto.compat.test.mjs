// Cross-implementation compatibility: the desktop shell seals files with
// Node crypto (desktop/crypto.js) while every other platform reads/writes
// the same format through @noble/ciphers (src/lib/crypto.ts). A download
// made on desktop must decrypt anywhere and vice versa — these tests pin
// that down byte-for-byte.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import {
  FILE_CHUNK_SIZE,
  FILE_KEY_SIZE,
  FILE_NONCE_PREFIX_SIZE,
  base64ToBytes,
  openFile,
  sealFile,
  unwrapFileKey,
  utf8Bytes,
  wrapFileKey,
} from "../src/lib/crypto.ts";
import {
  aadFor,
  openRecord,
  sealRecord,
  unwrapFileKey as desktopUnwrapFileKey,
  wrapFileKey as desktopWrapFileKey,
} from "./crypto.js";

const MASTER = crypto.randomBytes(FILE_KEY_SIZE).toString("base64");
const MOVIE_ID = "movie-42";

function memorySource(bytes) {
  let offset = 0;
  return {
    read(length) {
      const chunk = bytes.subarray(offset, offset + length);
      offset += chunk.length;
      return new Uint8Array(chunk);
    },
  };
}

function memorySink() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    bytes() {
      return Buffer.concat(chunks);
    },
  };
}

test("key wrapping is interchangeable in both directions", () => {
  const fileKey = crypto.randomBytes(FILE_KEY_SIZE);

  // desktop wraps → renderer unwraps
  const desktopPacked = desktopWrapFileKey(MASTER, fileKey);
  const byRenderer = unwrapFileKey(base64ToBytes(MASTER), desktopPacked);
  assert.deepEqual(Buffer.from(byRenderer), fileKey);

  // renderer wraps → desktop unwraps
  const rendererPacked = wrapFileKey(
    base64ToBytes(MASTER),
    fileKey,
    crypto.randomBytes(12)
  );
  assert.deepEqual(desktopUnwrapFileKey(MASTER, rendererPacked), fileKey);

  // a wrong master key must fail on both sides
  const WRONG = crypto.randomBytes(FILE_KEY_SIZE).toString("base64");
  assert.throws(() => desktopUnwrapFileKey(WRONG, desktopPacked));
  assert.throws(() => unwrapFileKey(base64ToBytes(WRONG), desktopPacked));
});

test("desktop-sealed records open with the renderer's openFile", () => {
  const fileKey = crypto.randomBytes(FILE_KEY_SIZE);
  const noncePrefix = crypto.randomBytes(FILE_NONCE_PREFIX_SIZE);
  const aad = aadFor(MOVIE_ID);
  // 2 full records + a short tail — covers every record-index branch.
  const plain = crypto.randomBytes(FILE_CHUNK_SIZE * 2 + 1234);

  const sealed = [];
  let index = 0;
  for (let offset = 0; offset < plain.length; offset += FILE_CHUNK_SIZE) {
    const chunk = plain.subarray(offset, offset + FILE_CHUNK_SIZE);
    sealed.push(sealRecord(fileKey, noncePrefix, index, aad, chunk));
    index += 1;
  }
  const cipher = Buffer.concat(sealed);

  const sink = memorySink();
  openFile({
    source: memorySource(cipher),
    sink,
    cipherBytes: cipher.length,
    plainBytes: plain.length,
    fileKey,
    noncePrefix,
    aad,
  });
  assert.deepEqual(sink.bytes(), plain);
});

test("renderer-sealed file opens record-by-record on desktop", () => {
  const fileKey = crypto.randomBytes(FILE_KEY_SIZE);
  const noncePrefix = crypto.randomBytes(FILE_NONCE_PREFIX_SIZE);
  const aad = utf8Bytes(`ruxx.offline.v1:${MOVIE_ID}`);
  const plain = crypto.randomBytes(FILE_CHUNK_SIZE + 777);

  const sink = memorySink();
  sealFile({
    source: memorySource(plain),
    sink,
    plainBytes: plain.length,
    fileKey,
    noncePrefix,
    aad,
  });
  const cipher = sink.bytes();

  const opened = [];
  let index = 0;
  for (let offset = 0; offset < cipher.length; offset += FILE_CHUNK_SIZE + 16) {
    const record = cipher.subarray(offset, offset + FILE_CHUNK_SIZE + 16);
    opened.push(openRecord(fileKey, noncePrefix, index, aad, record));
    index += 1;
  }
  assert.deepEqual(Buffer.concat(opened), plain);
});

test("tampered and truncated desktop records are rejected", () => {
  const fileKey = crypto.randomBytes(FILE_KEY_SIZE);
  const noncePrefix = crypto.randomBytes(FILE_NONCE_PREFIX_SIZE);
  const aad = aadFor(MOVIE_ID);
  const record = sealRecord(fileKey, noncePrefix, 3, aad, Buffer.from("hello ruxx"));

  const flipped = Buffer.from(record);
  flipped[0] ^= 0xff;
  assert.throws(() => openRecord(fileKey, noncePrefix, 3, aad, flipped));

  // wrong record index => nonce mismatch => auth failure
  assert.throws(() => openRecord(fileKey, noncePrefix, 4, aad, record));

  // a record smaller than one GCM tag can only be a truncated tail
  assert.throws(
    () => openRecord(fileKey, noncePrefix, 3, aad, record.subarray(0, 12)),
    /truncated/i
  );
});
