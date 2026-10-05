// Cloudflare R2 (S3-compatible) request signing for Supabase Edge Functions.
//
// SigV4 construction mirrors the reference `aws4` implementation:
//   [method, uri, query, canonicalHeaders + "\n", signedHeaders, payloadHash].join("\n")

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const encoder = new TextEncoder();
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function r2ConfigFromEnv(): R2Config {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME as function secrets.",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** encodeURIComponent plus the extra RFC 3986 unreserved-char escaping. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Encode an object path segment by segment, keeping "/" separators. */
export function encodePath(objectPath: string): string {
  return objectPath.split("/").map(encodeRfc3986).join("/");
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Compact ISO-8601 basic format: 20261005T121345Z */
export function amzDateNow(now = new Date()): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256(
  key: Uint8Array | string,
  data: string,
): Promise<Uint8Array> {
  const keyData = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

export interface CanonicalInput {
  method: string;
  uri: string;
  query: string;
  /** Header lines without a trailing newline, already sorted and lower-cased. */
  canonicalHeaders: string;
  signedHeaders: string;
  payloadHash: string;
}

export function buildCanonicalRequest(input: CanonicalInput): string {
  return [
    input.method,
    input.uri,
    input.query,
    input.canonicalHeaders + "\n",
    input.signedHeaders,
    input.payloadHash,
  ].join("\n");
}

export async function buildStringToSign(
  amzDate: string,
  scope: string,
  canonicalRequest: string,
): Promise<string> {
  const hash = await sha256Hex(canonicalRequest);
  return ["AWS4-HMAC-SHA256", amzDate, scope, hash].join("\n");
}

export async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmacSha256("AWS4" + secretAccessKey, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, "aws4_request");
}

export function hostFor(cfg: R2Config): string {
  return `${cfg.accountId}.r2.cloudflarestorage.com`;
}

function presignQuery(
  cfg: R2Config,
  scope: string,
  amzDate: string,
  expiresInSeconds: number,
): string {
  return [
    "X-Amz-Algorithm=AWS4-HMAC-SHA256",
    "X-Amz-Credential=" + encodeRfc3986(`${cfg.accessKeyId}/${scope}`),
    "X-Amz-Date=" + amzDate,
    "X-Amz-Expires=" + String(expiresInSeconds),
    "X-Amz-SignedHeaders=host",
  ].join("&");
}

async function presign(
  cfg: R2Config,
  method: "GET" | "PUT",
  objectKey: string,
  expiresInSeconds: number,
  now = new Date(),
): Promise<string> {
  const host = hostFor(cfg);
  const amzDate = amzDateNow(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const uri = "/" + encodePath(`${cfg.bucket}/${objectKey}`);
  const query = presignQuery(cfg, scope, amzDate, expiresInSeconds);

  const canonical = buildCanonicalRequest({
    method,
    uri,
    query,
    canonicalHeaders: `host:${host}`,
    signedHeaders: "host",
    payloadHash: "UNSIGNED-PAYLOAD",
  });
  const stringToSign = await buildStringToSign(amzDate, scope, canonical);
  const key = await deriveSigningKey(cfg.secretAccessKey, dateStamp, "auto", "s3");
  const signature = toHex(await hmacSha256(key, stringToSign));

  return `https://${host}${uri}?${query}&X-Amz-Signature=${signature}`;
}

/** Short-lived read URL for a video object (default 6 hours). */
export function presignGetObject(
  cfg: R2Config,
  objectKey: string,
  expiresInSeconds = 21600,
  now = new Date(),
): Promise<string> {
  return presign(cfg, "GET", objectKey, expiresInSeconds, now);
}

/** Short-lived upload URL used by the admin panel (default 1 hour). */
export function presignPutObject(
  cfg: R2Config,
  objectKey: string,
  expiresInSeconds = 3600,
  now = new Date(),
): Promise<string> {
  return presign(cfg, "PUT", objectKey, expiresInSeconds, now);
}

/** Header-signed DELETE (presigned DELETE is not supported by S3/R2). */
export async function deleteObject(
  cfg: R2Config,
  objectKey: string,
  now = new Date(),
): Promise<{ ok: boolean; status: number; body: string }> {
  const host = hostFor(cfg);
  const amzDate = amzDateNow(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const uri = "/" + encodePath(`${cfg.bucket}/${objectKey}`);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonical = buildCanonicalRequest({
    method: "DELETE",
    uri,
    query: "",
    canonicalHeaders: [
      `host:${host}`,
      `x-amz-content-sha256:${EMPTY_SHA256}`,
      `x-amz-date:${amzDate}`,
    ].join("\n"),
    signedHeaders,
    payloadHash: EMPTY_SHA256,
  });
  const stringToSign = await buildStringToSign(amzDate, scope, canonical);
  const key = await deriveSigningKey(cfg.secretAccessKey, dateStamp, "auto", "s3");
  const signature = toHex(await hmacSha256(key, stringToSign));

  const res = await fetch(`https://${host}${uri}`, {
    method: "DELETE",
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": EMPTY_SHA256,
      "x-amz-date": amzDate,
    },
  });

  return {
    ok: res.ok,
    status: res.status,
    body: res.status === 204 ? "" : await res.text(),
  };
}
