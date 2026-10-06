import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalRequest,
  buildStringToSign,
  deriveSigningKey,
  encodePath,
  encodeRfc3986,
  hmacSha256,
  normalizeEndpoint,
  presignGetObject,
  presignPutObject,
  toHex,
} from "./storage.ts";

// Golden vectors for S3 SigV4 presigning. The expected signatures below were
// produced by cross-checking our primitives against the reference `aws4`
// library (header-signed and signQuery/presign modes) with the same fixed
// inputs, so a regression here means we silently broke URL expiry in prod.

const CFG = {
  endpoint: "acc123.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  bucket: "ruxx-stream",
};
const HOST = "acc123.r2.cloudflarestorage.com";
const SCOPE = "20261005/auto/s3/aws4_request";
const NOW = new Date("2026-10-05T12:00:00.000Z");

const EXPECTED_GET =
  "https://acc123.r2.cloudflarestorage.com/ruxx-stream/movies/abc.mp4" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
  "&X-Amz-Credential=AKIDEXAMPLE%2F20261005%2Fauto%2Fs3%2Faws4_request" +
  "&X-Amz-Date=20261005T120000Z" +
  "&X-Amz-Expires=21600" +
  "&X-Amz-SignedHeaders=host" +
  "&X-Amz-Signature=d0888c710235b43defbfeab55db21f4f0bec75bdc11f59060e7d874a2e9abbc9";

const EXPECTED_PUT =
  "https://acc123.r2.cloudflarestorage.com/ruxx-stream/uploads/a%20b.mp4" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
  "&X-Amz-Credential=AKIDEXAMPLE%2F20261005%2Fauto%2Fs3%2Faws4_request" +
  "&X-Amz-Date=20261005T120000Z" +
  "&X-Amz-Expires=3600" +
  "&X-Amz-SignedHeaders=host" +
  "&X-Amz-Signature=231e250c1a8040d630a974be3869bdb7c205fe7c4d28f7cf23dea4428111684b";

const QUERY = [
  "X-Amz-Algorithm=AWS4-HMAC-SHA256",
  `X-Amz-Credential=${encodeRfc3986(`AKIDEXAMPLE/${SCOPE}`)}`,
  "X-Amz-Date=20261005T120000Z",
  "X-Amz-Expires=21600",
  "X-Amz-SignedHeaders=host",
].join("&");

const EXPECTED_CANONICAL = [
  "GET",
  "/ruxx-stream/movies/abc.mp4",
  QUERY,
  `host:${HOST}`,
  "",
  "host",
  "UNSIGNED-PAYLOAD",
].join("\n");

test("presigned GET URL matches the verified golden vector", async () => {
  const url = await presignGetObject(CFG, "movies/abc.mp4", 21600, NOW);
  assert.equal(url, EXPECTED_GET);
});

test("presigned PUT URL percent-encodes spaces in object keys", async () => {
  const url = await presignPutObject(CFG, "uploads/a b.mp4", 3600, NOW);
  assert.equal(url, EXPECTED_PUT);
});

test("canonical request layout matches the SigV4 spec", () => {
  const canonical = buildCanonicalRequest({
    method: "GET",
    uri: `/${encodePath(`${CFG.bucket}/movies/abc.mp4`)}`,
    query: QUERY,
    canonicalHeaders: `host:${HOST}`,
    signedHeaders: "host",
    payloadHash: "UNSIGNED-PAYLOAD",
  });
  assert.equal(canonical, EXPECTED_CANONICAL);
});

test("string to sign binds the signed canonical request hash", async () => {
  const sts = await buildStringToSign("20261005T120000Z", SCOPE, EXPECTED_CANONICAL);
  const lines = sts.split("\n");
  assert.equal(lines[0], "AWS4-HMAC-SHA256");
  assert.equal(lines[1], "20261005T120000Z");
  assert.equal(lines[2], SCOPE);
  assert.equal(
    lines[3],
    "21693cc919e5055aed56aadf6401e8b092af39760a4f4e54bbaf6570a08361bd",
  );
});

test("signing key derivation reproduces the golden signature", async () => {
  const sts = await buildStringToSign("20261005T120000Z", SCOPE, EXPECTED_CANONICAL);
  const key = await deriveSigningKey(CFG.secretAccessKey, "20261005", "auto", "s3");
  assert.equal(
    toHex(await hmacSha256(key, sts)),
    "d0888c710235b43defbfeab55db21f4f0bec75bdc11f59060e7d874a2e9abbc9",
  );
});

test("encodePath keeps slashes but escapes reserved characters", () => {
  assert.equal(encodePath("ruxx-stream/my movie (1).mp4"), "ruxx-stream/my%20movie%20%281%29.mp4");
  assert.equal(encodeRfc3986("a/b c"), "a%2Fb%20c");
});

test("normalizeEndpoint strips schemes and paths", () => {
  assert.equal(normalizeEndpoint("s3.eu-central-003.backblazeb2.com"), "s3.eu-central-003.backblazeb2.com");
  assert.equal(normalizeEndpoint("https://s3.eu-central-003.backblazeb2.com"), "s3.eu-central-003.backblazeb2.com");
  assert.equal(normalizeEndpoint("https://s3.eu-central-003.backblazeb2.com/ruxx-stream/"), "s3.eu-central-003.backblazeb2.com");
});
